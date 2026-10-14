/**
 * The finder. One page: a map behind, a sheet in front, and a URL holding it all.
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
import BottomSheet from "~/components/BottomSheet";
import MiniCard from "~/components/MiniCard";
import PlaceCard, { EmptyList } from "~/components/PlaceCard";
import SearchBar from "~/components/SearchBar";
import SelectionChips from "~/components/SelectionChips";
import type { ChipSelection } from "~/components/SelectionChips";
import { selections } from "~/content/selections";
import { loadSelections, seedFromDocument, serialiseSeed, SEED_ELEMENT_ID } from "~/lib/dataset";
import type { Bbox } from "~/lib/geo";
import { searchPlaces } from "~/lib/search";
import type { PlaceRecord } from "~/lib/search";
import { bboxForCamera, parseView, serialiseView, FALLBACK_CENTRE, FALLBACK_ZOOM } from "~/lib/url-state";
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

  const commit = (v: ViewState, replace: boolean) => {
    navigate(`/${serialiseView(v)}`, { replace, scroll: false });
  };

  let camTimer: ReturnType<typeof setTimeout> | undefined;
  const commitCamera = (v: ViewState) => {
    clearTimeout(camTimer);
    camTimer = setTimeout(() => commit(v, true), 700);
  };

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

  // The dataset, fetched per selection and then held in memory for the life of
  // the tab. Only the active selections are loaded, so a visitor who never taps
  // "Vets" never downloads the 146 kB of vets.
  const activeSelections = createMemo(() => [...view().sel].sort());

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

  const detailHref = createMemo(() => {
    const id = selectedId();
    if (!id) return "";
    return `/p/${encodeURIComponent(id)}${location.search}`;
  });

  const onViewport = (b: Bbox, cam: Camera) => {
    setBbox(b);
    const v = view();
    commitCamera({ ...v, at: cam.centre, zoom: cam.zoom, bearing: cam.bearing });
  };

  const onSelect = (id: string | null) => {
    const v = view();
    commit({ ...v, place: id }, false);
  };

  const onToggle = (id: string) => {
    const v = view();
    const sel = v.sel.includes(id) ? v.sel.filter((s) => s !== id) : [...v.sel, id];
    // Switching the last chip off is allowed — the map goes quiet and the list
    // says why — but the URL keeps every id so toggling back restores exactly.
    commit({ ...v, sel: sel.length ? sel : [], place: null }, false);
  };

  const onSearch = (q: string) => {
    commit({ ...view(), q, place: null }, false);
  };

  const onJump = (lon: number, lat: number, zoom: number) => {
    commit({ ...view(), at: [lon, lat], zoom, place: null, near: null, radius: null }, false);
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
    if (!("geolocation" in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const lon = pos.coords.longitude;
        const lat = pos.coords.latitude;
        commit(
          { ...view(), at: [lon, lat], zoom: 13, near: [lon, lat], radius: 10_000, place: null },
          false,
        );
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 300_000 },
    );
  };

  const clearNear = () => {
    commit({ ...view(), near: null, radius: null }, false);
  };

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
            activeSelections={view().sel}
            selectedId={selectedId()}
            styles={STYLES}
            onViewport={onViewport}
            onSelect={onSelect}
            onFailed={setMapFailed}
          />
        </Show>
        <div class="finder-overlay">
          <SearchBar value={view().q} onSearch={onSearch} />
          <SelectionChips chips={chips()} onToggle={onToggle} />
          <div class="row finder-tools">
            <button
              type="button"
              class="btn btn-icon near-me"
              aria-label={view().near ? "Clear nearby search" : "Search near me"}
              aria-pressed={!!view().near}
              disabled={locating()}
              onClick={() => (view().near ? clearNear() : onNearMe())}
            >
              {locating() ? "…" : view().near ? "✕" : "◎"}
            </button>
            {view().near && <span class="tiny muted">within 10 km of you</span>}
          </div>
        </div>
        <Show when={selectedPlace()}>
          {(place) => (
            <MiniCard place={place()} detailHref={detailHref()} onClose={() => onSelect(null)} />
          )}
        </Show>
      </div>

      <BottomSheet title={title()} count={countText()}>
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
            fallback={<EmptyList q={view().q} selectionCount={view().sel.length} />}
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
      </BottomSheet>
    </main>
  );
}
