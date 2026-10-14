/**
 * The finder. One page: a map behind, a sheet in front, and a URL holding it all.
 *
 * The data flow is a loop with exactly one fetch in it:
 *
 *   map settles -> onViewport -> bbox signal -> resource -> /api/places
 *       -> places signal -> MapView pins + result list
 *
 * The URL carries q, sel, place, near and the camera. The map owns the live
 * camera; the URL owns everything else. Pans update the URL debounced and
 * replaced (a history entry per pan would make Back useless); chips, search and
 * selection push (Back should undo those).
 */
import { useLocation, useNavigate } from "@solidjs/router";
import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, Show } from "solid-js";
import BottomSheet from "~/components/BottomSheet";
import MiniCard from "~/components/MiniCard";
import PlaceCard, { EmptyList } from "~/components/PlaceCard";
import SearchBar from "~/components/SearchBar";
import SelectionChips from "~/components/SelectionChips";
import type { ChipSelection } from "~/components/SelectionChips";
import { selections } from "~/content/selections";
import type { Bbox } from "~/lib/geo";
import { bboxForCamera, parseView, serialiseView, FALLBACK_CENTRE, FALLBACK_ZOOM } from "~/lib/url-state";
import type { ViewState } from "~/lib/url-state";
import MapView from "~/map/MapView";
import type { Camera, MapPlace, SelectionStyle } from "~/map/MapView";
import SvgFallback from "~/map/SvgFallback";
import type { SearchResult, SlimPlace } from "~/server/places";

const KNOWN_IDS = new Set(selections.map((s) => s.id));
const STYLES: SelectionStyle[] = selections.map((s) => ({ id: s.id, colour: s.colour, icon: s.icon }));

import type { FetchKey } from "~/server/search-query";
import { searchPlacesQuery } from "~/server/search-query";

async function fetchPlaces(key: FetchKey): Promise<SearchResult> {
  // Server render: D1 directly, because a relative fetch() has no host here.
  // Client: plain REST, so Cloudflare's edge cache sits in front of hot viewports.
  if (typeof window === "undefined") return searchPlacesQuery(key);
  const params = new URLSearchParams({ bbox: key.bbox, limit: "200" });
  if (key.sel) params.set("sel", key.sel);
  if (key.q) params.set("q", key.q);
  if (key.near) params.set("near", key.near);
  if (key.radius) params.set("radius", key.radius);
  const res = await fetch(`/api/places?${params.toString()}`);
  if (!res.ok) throw new Error(`search failed (${res.status})`);
  return (await res.json()) as SearchResult;
}

interface PlaceApiRecord {
  id: string;
  name: string | null;
  lat: number;
  lon: number;
  selections: string[];
  primary: string | null;
  dogPolicy?: string | null;
  dog_policy?: string | null;
  street: string | null;
  city: string | null;
  postcode: string | null;
  website?: string | null;
  openingHours?: string | null;
  opening_hours?: string | null;
  source: string;
  verified: boolean;
}

async function fetchPlace(id: string): Promise<SlimPlace | null> {
  try {
    const res = await fetch(`/api/places/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    // The detail endpoint returns the full record; the card only needs the slim shape.
    const full = (await res.json()) as PlaceApiRecord;
    if (!full || typeof full.id !== "string") return null;
    return {
      id: full.id,
      name: full.name,
      lat: full.lat,
      lon: full.lon,
      selections: Array.isArray(full.selections) ? full.selections : [],
      primary: full.primary,
      dogPolicy: full.dogPolicy ?? full.dog_policy ?? null,
      street: full.street,
      city: full.city,
      postcode: full.postcode,
      website: full.website ?? null,
      openingHours: full.openingHours ?? full.opening_hours ?? null,
      source: full.source,
      verified: !!full.verified,
      distance: null,
    };
  } catch {
    return null;
  }
}

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

  const fetchKey = createMemo<FetchKey>(() => {
    const v = view();
    const b = settledBbox() ?? bbox() ?? bboxForCamera(v.at ?? FALLBACK_CENTRE, v.zoom);
    return {
      bbox: b.map((n) => n.toFixed(5)).join(","),
      sel: [...v.sel].sort().join(","),
      q: v.q,
      near: v.near ? v.near.map((n) => n.toFixed(5)).join(",") : "",
      radius: v.radius ? String(v.radius) : "",
    };
  });

  const [result] = createResource(fetchKey, fetchPlaces);
  const places = createMemo<SlimPlace[]>(() => result()?.places ?? []);
  const counts = createMemo<Record<string, number>>(() => result()?.counts ?? {});

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

  // Selection: prefer the row already in hand, fetch only when the pin's place
  // is not in the current list (a shared link straight to a venue).
  const selectedId = createMemo(() => view().place);
  const selectedInList = createMemo(() => places().find((p) => p.id === selectedId()) ?? null);
  const [fetchedSelected] = createResource(selectedId, async (id) => {
    if (!id || selectedInList()) return null;
    return fetchPlace(id);
  });
  const selectedPlace = createMemo(() => selectedInList() ?? fetchedSelected() ?? null);

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
    if (result.loading) return "Searching…";
    if (result.error) return "Search failed";
    const total = result()?.total ?? 0;
    const extra = result()?.truncated ? "+" : "";
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
          when={!result.error}
          fallback={
            <div class="empty-list">
              <p>
                <strong>Search failed.</strong>
              </p>
              <p class="muted tiny">Check your connection and try again. The map still works.</p>
            </div>
          }
        >
          <Show
            when={places().length > 0 || result.loading}
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
          </Show>
        </Show>
      </BottomSheet>
    </main>
  );
}
