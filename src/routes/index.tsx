/**
 * The finder. One page: a map behind, a results drawer beside it, and a URL
 * holding it all.
 *
 * The data flow has no server in it:
 *
 *   selection chips -> loadSelections() -> records in memory
 *   map settles     -> bbox signal      -> searchPlaces() in the browser
 *       -> result -> MapView pins + result list
 *
 * Nothing here reads a database. That is not a micro-optimisation: an earlier
 * version asked D1 for every viewport and its footer asked D1 for two
 * full-table row counts on every page view, which exhausted the account's daily
 * D1 row-read quota and took korg-e.com/mir down with it. The quota is per
 * account, so a hobby directory could take down an unrelated site.
 *
 * The URL carries q, sel, place, near and the camera. The map owns the live
 * camera; the URL owns everything else. Pans update the URL debounced and
 * replaced (a history entry per pan would make Back useless); chips, search and
 * selection push (Back should undo those).
 */
import { useLocation, useNavigate } from "@solidjs/router";
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { NoHydration } from "solid-js/web";
import MiniCard from "~/components/MiniCard";
import PlaceCard, { EmptyList } from "~/components/PlaceCard";
import ReportSheet from "~/components/ReportSheet";
import SearchBar from "~/components/SearchBar";
import SearchOverlay from "~/components/SearchOverlay";
import SelectionChips from "~/components/SelectionChips";
import SideDrawer from "~/components/SideDrawer";
import type { ChipSelection } from "~/components/SelectionChips";
import { selections } from "~/content/selections";
import { loadSelections, seedFromDocument, serialiseSeed, SEED_ELEMENT_ID } from "~/lib/dataset";
import type { Bbox, LonLat } from "~/lib/geo";
import { searchPlaces } from "~/lib/search";
import type { PlaceRecord } from "~/lib/search";
import {
  bboxForCamera,
  cameraForCommit,
  parseView,
  serialiseView,
  toggleSelection,
  FALLBACK_CENTRE,
  FALLBACK_ZOOM,
} from "~/lib/url-state";
import type { ViewState } from "~/lib/url-state";
import MapView from "~/map/MapView";
import type { Camera, MapPlace, SelectionStyle } from "~/map/MapView";
import SvgFallback from "~/map/SvgFallback";

const KNOWN_IDS = new Set(selections.map((s) => s.id));
const STYLES: SelectionStyle[] = selections.map((s) => ({ id: s.id, colour: s.colour, icon: s.icon }));

export default function Home() {
  const location = useLocation();
  const navigate = useNavigate();

  const [view, setView] = createSignal<ViewState>(parseView(location.search, KNOWN_IDS));
  createEffect(() => setView(parseView(location.search, KNOWN_IDS)));

  const [bbox, setBbox] = createSignal<Bbox | null>(null);
  const [mapFailed, setMapFailed] = createSignal<string | null>(null);
  const [locating, setLocating] = createSignal(false);
  /** Geolocation explains itself when it fails, instead of a button that does nothing. */
  const [locateError, setLocateError] = createSignal<string | null>(null);

  const commit = (v: ViewState, replace: boolean) => {
    navigate(`/${serialiseView(v)}`, { replace, scroll: false });
  };

  // The map's live camera, kept outside reactivity. It changes on every pan frame,
  // and only controls read it, so it must not trigger renders or refetches.
  let live: { centre: LonLat; zoom: number; bearing: number } | null = null;

  // The timer outlives the page: a map settle just before a link is followed
  // would otherwise fire its navigate after the route has changed and yank the
  // reader back to the finder. Worse, the map's teardown can deliver one last
  // moveend after unmount, scheduling a timer nobody is left to clear — so
  // every commit path checks a flag that dies with the component.
  let camTimer: ReturnType<typeof setTimeout> | undefined;
  let alive = true;
  onCleanup(() => {
    alive = false;
    clearTimeout(camTimer);
  });
  const commitCamera = () => {
    clearTimeout(camTimer);
    // The view is read at fire time, not capture time: a chip tapped or a
    // place chosen between the pan and this timer must survive the write.
    camTimer = setTimeout(() => {
      if (alive) commit(cameraForCommit(view(), live), true);
    }, 700);
  };

  /** The view as it is right now, with the map's live camera rather than the URL's. */
  const currentView = () => cameraForCommit(view(), live);

  // The map's bounds, debounced so a fling across the city fetches once at the
  // end instead of once per tile. 300ms is long enough to settle, short enough
  // that the list never feels detached from the map.
  const [settledBbox, setSettledBbox] = createSignal<Bbox | null>(null);
  let bboxTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on(bbox, (b) => {
      clearTimeout(bboxTimer);
      if (!b) {
        setSettledBbox(null);
        return;
      }
      bboxTimer = setTimeout(() => setSettledBbox(b), 300);
    }),
  );
  onCleanup(() => clearTimeout(bboxTimer));

  // The dataset, fetched per selection and then held in memory for the life of
  // the tab. Only the active selections are loaded, so a visitor who never taps
  // A large selection never downloads the whole directory for a small one.
  // Keyed on the joined string, not the array. A new array on every URL change
  // (including every pan's debounced write) re-ran the fetch on each one.
  const activeSelections = createMemo<string[]>(
    () => [...view().sel].sort(),
    [],
    { equals: (a, b) => a.length === b.length && a.every((id, i) => id === b[i]) },
  );

  // The server reads the published files off disk and renders a full list. This
  // is that same list, read back off the page, so both sides of hydration draw
  // the same tree and the browser does not fetch what it was just sent.
  const seeded = seedFromDocument();
  const [records, { refetch }] = createResource(
    activeSelections,
    loadSelections,
    seeded ? { initialValue: seeded } : {},
  );

  /**
   * Whether hydration has finished, and therefore whether it is safe for the
   * page to change shape.
   *
   * Even seeded, a browser that cannot reach a data file ends up with nothing
   * while the server had everything. Letting Solid reconcile a branch that
   * appeared mid-hydration throws "Cannot read properties of null (reading
   * 'nextSibling')" and drops the page into the error boundary — which is
   * precisely the case the error message exists for. The gate is what makes the
   * graceful path actually graceful.
   */
  const [hydrated, setHydrated] = createSignal(false);
  onMount(() => setHydrated(true));

  /** True only when we are past hydration and the data genuinely did not load. */
  const loadFailed = () => hydrated() && !!records.error;

  // The whole search, recomputed on every settled camera change. Synchronous,
  // so panning has no loading state and no request — the filter runs over data
  // that is already here.
  const result = createMemo(() => {
    const v = view();
    const b = settledBbox() ?? bbox() ?? bboxForCamera(v.at ?? FALLBACK_CENTRE, v.zoom);
    return searchPlaces(records() ?? [], {
      bbox: b,
      selections: v.sel,
      q: v.q,
      near: v.near,
      radius: v.radius,
      openNow: v.openNow,
      order: v.order,
      limit: 200,
    });
  });

  const places = createMemo<PlaceRecord[]>(() => result().places);
  const counts = createMemo<Record<string, number>>(() => result().counts);

  const mapPlaces = createMemo<MapPlace[]>(() =>
    places().map((p) => ({
      id: p.id,
      name: p.name,
      lat: p.lat,
      lon: p.lon,
      primary: p.primary,
      selections: p.selections,
    })),
  );

  const camera = createMemo<Camera>(() => {
    const v = view();
    return {
      centre: v.at ?? FALLBACK_CENTRE,
      zoom: v.zoom || FALLBACK_ZOOM,
      bearing: v.bearing,
      pitch: 0,
    };
  });

  const chips = createMemo<ChipSelection[]>(() => {
    const active = new Set(view().sel);
    const c = counts();
    return selections.map((s) => ({
      id: s.id,
      short: s.short,
      icon: s.icon,
      colour: s.colour,
      count: active.has(s.id) || c[s.id] ? (c[s.id] ?? 0) : null,
      active: active.has(s.id),
    }));
  });

  // Selection: the row is already in memory, because the list it came from is.
  // A shared link straight to a venue whose selection is switched off has
  // nothing loaded, so the detail route server-renders it instead.
  const selectedId = createMemo(() => view().place);
  const selectedPlace = createMemo<PlaceRecord | null>(
    () => places().find((p) => p.id === selectedId()) ?? null,
  );

  // The paw report sheet, opened from the mini-card. The place snapshot is
  // taken on open, so closing the mini-card does not mutate a form in flight.
  const [reportPlace, setReportPlace] = createSignal<PlaceRecord | null>(null);

  // The results drawer is closed by default on a phone: the map is the page.
  // The edge tab is the way in, and selecting a place closes it again.
  const [drawerOpen, setDrawerOpen] = createSignal(false);

  // The search overlay. The header pill opens it; the header is mounted by App,
  // two levels above this route, so it asks with an event — the same channel
  // the city jump already uses.
  const [searchOpen, setSearchOpen] = createSignal(false);
  createEffect(() => {
    const handler = () => setSearchOpen(true);
    window.addEventListener("pampered:search", handler);
    onCleanup(() => window.removeEventListener("pampered:search", handler));
  });

  const detailHref = createMemo(() => {
    const id = selectedId();
    if (!id) return "";
    return `/p/${encodeURIComponent(id)}${location.search}`;
  });

  const onViewport = (b: Bbox, cam: Camera) => {
    if (!alive) return;
    setBbox(b);
    live = { centre: cam.centre, zoom: cam.zoom, bearing: cam.bearing };
    commitCamera();
  };

  const onSelect = (id: string | null) => {
    commit({ ...currentView(), place: id }, false);
  };

  const onToggle = (id: string) => {
    // Switching the last chip off is allowed — the map goes quiet and the list
    // says why — but the URL keeps every id so toggling back restores exactly.
    const sel = toggleSelection(view().sel, id, KNOWN_IDS);
    commit({ ...currentView(), sel, place: null }, false);
  };

  const onSearch = (q: string) => {
    commit({ ...currentView(), q, place: null }, false);
  };

  const onJump = (lon: number, lat: number, zoom: number) => {
    commit({ ...currentView(), at: [lon, lat], zoom, place: null, near: null, radius: null }, false);
  };

  createEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ lon: number; lat: number; zoom: number }>).detail;
      if (detail) onJump(detail.lon, detail.lat, detail.zoom);
    };
    window.addEventListener("pampered:jump", handler);
    onCleanup(() => window.removeEventListener("pampered:jump", handler));
  });

  const onNearMe = () => {
    if (!("geolocation" in navigator)) {
      setLocateError("This browser does not offer location.");
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const lon = pos.coords.longitude;
        const lat = pos.coords.latitude;
        commit(
          {
            ...currentView(),
            at: [lon, lat],
            zoom: 13,
            near: [lon, lat],
            radius: 10_000,
            // A near-me list ordered by name buries the closest pub at the
            // bottom. Nearest-first is the only order that earns the GPS prompt.
            order: "near",
            place: null,
          },
          false,
        );
      },
      (err) => {
        setLocating(false);
        // Geolocation failing silently is how "near me" buttons die quietly in
        // production. Permission denied reads differently from a dead GPS.
        setLocateError(
          err.code === err.PERMISSION_DENIED
            ? "Location is blocked. Allow it in the browser and try again."
            : "Could not find you. Try again in a moment.",
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 300_000 },
    );
  };

  const clearNear = () => {
    setLocateError(null);
    commit({ ...currentView(), near: null, radius: null }, false);
  };

  const onToggleOpen = () => {
    commit({ ...currentView(), openNow: !view().openNow, place: null }, false);
  };

  const onOrder = (order: "near" | "name") => {
    commit({ ...currentView(), order, place: null }, false);
  };

  const [shared, setShared] = createSignal(false);
  let sharedTimer: ReturnType<typeof setTimeout> | undefined;
  const onShare = async () => {
    clearTimeout(sharedTimer);
    const url = `${window.location.origin}${window.location.pathname}${location.search}`;
    try {
      await navigator.clipboard.writeText(url);
      setShared(true);
    } catch {
      // Clipboard needs a secure context and a permission grant; the prompt
      // fallback works everywhere the button does.
      const answer = window.prompt("Copy this link to share this view:", url);
      if (answer != null) setShared(true);
      else return;
    }
    sharedTimer = setTimeout(() => setShared(false), 2000);
  };

  // The filter, sort and share cluster. It lives over the map on desktop and
  // inside the drawer on a phone. The drawer is the one place for controls, so
  // the map itself carries no filter row at all.
  const filterControls = () => (
    <>
      <button
        type="button"
        class="btn open-toggle"
        aria-pressed={view().openNow}
        onClick={onToggleOpen}
        title="Only places we can prove are open right now"
      >
        {view().openNow ? "● Open now" : "○ Open now"}
      </button>
      <div class="order-switch" role="group" aria-label="Sort the list">
        <button
          type="button"
          class="btn btn-quiet order-btn"
          aria-pressed={view().order === "name"}
          onClick={() => onOrder("name")}
        >
          A–Z
        </button>
        <button
          type="button"
          class="btn btn-quiet order-btn"
          aria-pressed={view().order === "near"}
          onClick={() => onOrder("near")}
        >
          Nearest
        </button>
      </div>
      <span class="spacer" />
      <button
        type="button"
        class="btn btn-icon share-btn"
        aria-label="Copy a link to this view"
        title="Copy a link to this view"
        onClick={onShare}
      >
        <Show
          when={shared()}
          fallback={
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
          }
        >
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
        </Show>
      </button>
    </>
  );

  // "/" focuses search from the keyboard, the one shortcut a directory earns.
  // Ignored while typing, and Escape always blurs back out.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        document.getElementById("site-search")?.focus();
      }
      if (e.key === "Escape" && document.activeElement instanceof HTMLElement) {
        if (typing) document.activeElement.blur();
        else if (selectedId()) onSelect(null);
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  const title = createMemo(() => {
    const v = view();
    if (v.q) return `“${v.q}”`;
    if (v.near) return "Near you";
    return "Dog-friendly places";
  });

  const countText = createMemo(() => {
    // `hydrated() &&` so the pre-render and the first client render agree.
    if (hydrated() && records.loading) return "Loading the directory…";
    // A failed load is never allowed to read as "there is nothing here". That
    // mistake is what made an eight-hour outage look like an empty site: the
    // page returned 200, the list rendered zero rows, and nothing said why.
    if (loadFailed()) return "Could not load the directory";
    const total = result().total;
    const extra = result().truncated ? "+" : "";
    return `${total.toLocaleString("en-GB")}${extra} ${total === 1 ? "place" : "places"} in view`;
  });

  return (
    <main class="finder">
      <div class="finder-body">
        <div class="finder-map">
          <Show
            when={!mapFailed()}
            fallback={
              <SvgFallback
                places={mapPlaces()}
                selectedId={selectedId()}
                onSelect={onSelect}
              />
            }
          >
            <MapView
              camera={camera()}
              places={mapPlaces()}
              activeSelections={activeSelections()}
              selectedId={selectedId()}
              styles={STYLES}
              onViewport={onViewport}
              onSelect={onSelect}
              onFailed={setMapFailed}
            />
          </Show>
        </div>
        <div class="finder-overlay">
          <SearchBar value={view().q} onSearch={onSearch} />
          <SelectionChips chips={chips()} onToggle={onToggle} />
          <div class="row finder-tools">
            <button
              type="button"
              class="btn near-me"
              aria-label={view().near ? "Clear nearby search" : "Search near me"}
              aria-pressed={!!view().near}
              disabled={locating()}
              onClick={() => (view().near ? clearNear() : onNearMe())}
            >
              {locating() ? "…" : view().near ? "✕ Nearby" : "◎ Nearby"}
            </button>
            {filterControls()}
          </div>
        </div>
        {/* Outside the overlay: on a phone the overlay is hidden (the header
            pill and the drawer replace it), and a geolocation failure must
            still be seen. */}
        <Show when={locateError()}>
          {(msg) => (
            <p class="tiny finder-error" role="alert">
              {msg()}
            </p>
          )}
        </Show>
        <Show when={selectedPlace()}>
          {(place) => (
            <MiniCard
              place={place()}
              detailHref={detailHref()}
              onClose={() => onSelect(null)}
              onReport={() => setReportPlace(place())}
            />
          )}
        </Show>
        <Show when={reportPlace()}>
          {(pl) => (
            <ReportSheet
              place={{ id: pl().id, name: pl().name, lat: pl().lat, lon: pl().lon }}
              onClose={() => setReportPlace(null)}
            />
          )}
        </Show>
      </div>

      <SideDrawer
        title={title()}
        count={countText()}
        tabCount={result().total}
        open={drawerOpen()}
        onOpenChange={setDrawerOpen}
        filters={<SelectionChips chips={chips()} onToggle={onToggle} />}
        toolbar={filterControls()}
        closeWhen={!!selectedPlace()}
      >
        <Show
          when={!loadFailed()}
          fallback={
            <div class="empty-list" role="alert">
              <p>
                <strong>The directory could not be loaded.</strong>
              </p>
              <p class="muted tiny">
                This is a problem on our side, not yours. The map below still works, and the
                listing is on{" "}
                <a href="https://www.openstreetmap.org/copyright" rel="noopener">
                  OpenStreetMap
                </a>
                .
              </p>
              <button type="button" class="btn" onClick={() => refetch()}>
                Try again
              </button>
            </div>
          }
        >
          <Show
            when={places().length > 0 || (hydrated() && records.loading)}
            fallback={<EmptyList q={view().q} selectionCount={view().sel.length} openNow={view().openNow} />}
          >
            <ul id="results" class="result-list" aria-label={title()}>
              <For each={places()}>
                {(p) => (
                  <PlaceCard
                    place={p}
                    selected={p.id === selectedId()}
                    href={`/p/${encodeURIComponent(p.id)}${location.search}`}
                    onSelect={onSelect}
                  />
                )}
              </For>
            </ul>

            {/* The server's answer, for the browser to hydrate from. NoHydration
                because the browser reads it out of the DOM rather than
                re-rendering it — rendering it on both sides would be a second
                copy of the directory in the document. */}
            <NoHydration>
              <Show when={records()}>
                <script
                  type="application/json"
                  id={SEED_ELEMENT_ID}
                  innerHTML={serialiseSeed(activeSelections(), records()!)}
                />
              </Show>
            </NoHydration>
          </Show>
        </Show>
      </SideDrawer>
      <SearchOverlay
        open={searchOpen()}
        chips={chips()}
        near={!!view().near}
        locating={locating()}
        onClose={() => setSearchOpen(false)}
        onToggle={(id) => onToggle(id)}
        onSearch={(q) => onSearch(q)}
        onNear={() => (view().near ? clearNear() : onNearMe())}
      />
    </main>
  );
}
