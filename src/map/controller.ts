/**
 * The MapLibre controller. No framework, no JSX, no Solid.
 *
 * It owns exactly three things: the map instance, the `pampered` GeoJSON source,
 * and the translation of selections into layers. Everything else — what the
 * viewport means, which URL it becomes, what a tap selects — belongs to the
 * caller, because those are product decisions and this file is a map driver.
 *
 * Carried over from `../OurBlock/src/globe.js`:
 *   - the OpenFreeMap style URL and the no-key setup that goes with it
 *   - inserting our layers below the first label layer, so place names stay readable
 *   - a hard failure path to the SVG fallback instead of a grey rectangle
 *
 * Deliberately not carried over: the 3D buildings, the pitch, the landmarks,
 * and the 1,600 lines of game around them. A finder is read at arm's length on
 * a phone; tilt is decoration it cannot afford.
 */
import type { Bbox, LonLat } from "~/lib/geo";
import { iconSvg, isIconName } from "./icons";
// The worker is a separate 500kb bundle that MapLibre loads at runtime. Vite
// emits it as an asset and hands back its URL; without this MapLibre guesses a
// URL relative to the main chunk, gets a 404, and the map fails with "Worker
// failed to load" — which is exactly what the fallback is for, but not what a
// working device should see.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  SymbolLayerSpecification,
} from "maplibre-gl";

export const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

export interface Camera {
  centre: LonLat;
  zoom: number;
  bearing: number;
  pitch: number;
}

export interface PinFeature {
  type: "Feature";
  properties: {
    id: string;
    /** Selection id. Drives the pin colour and, at high zoom, which white glyph sits on it. */
    primary: string;
    name: string | null;
  };
  geometry: { type: "Point"; coordinates: LonLat };
}

export interface SelectionStyle {
  id: string;
  colour: string;
  icon: string;
}

export interface ControllerEvents {
  onMoveEnd: (bbox: Bbox, camera: Camera) => void;
  onSelect: (id: string | null) => void;
  onFailed: (reason: string) => void;
  onReady: () => void;
}

type Maplibre = typeof import("maplibre-gl");
type MLMap = import("maplibre-gl").Map;

const CLUSTER_SOURCE_ID = "pampered";
const SELECTED_SOURCE_ID = "pampered-selected";

/** WebGL2 specifically. MapLibre v6 dropped the WebGL1 path entirely, so a
    device that only speaks WebGL1 is a fallback device, not a map device. */
export function webgl2Ok(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!canvas.getContext("webgl2");
  } catch {
    return false;
  }
}

function cameraOf(map: MLMap): Camera {
  const c = map.getCenter();
  return {
    centre: [c.lng, c.lat],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };
}

function bboxOf(map: MLMap): Bbox {
  const b = map.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}

async function svgToImage(svg: string, size: number): Promise<ImageBitmap> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image(size, size);
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("icon decode failed"));
      img.src = url;
    });
    return await createImageBitmap(img);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Our layers go under the first label layer, so "Camden High Street" is never
    hidden behind a pin. This is `tuckGroundUnderBuildings` from OurBlock with
    the buildings taken out. */
function firstLabelLayer(map: MLMap): string | undefined {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.type === "symbol") return layer.id;
  }
  return undefined;
}

function pinColorExpression(styles: SelectionStyle[]): ExpressionSpecification {
  const expr: unknown[] = ["match", ["get", "primary"]];
  for (const s of styles) expr.push(s.id, s.colour);
  expr.push("#6B7280");
  // Hand-built but exactly the shape MapLibre evaluates. The cast is at the one
  // place colours enter the map, so a bad colour fails here and nowhere else.
  return expr as unknown as ExpressionSpecification;
}

export interface MapHandle {
  setAllFeatures: (features: PinFeature[]) => void;
  setActiveSelections: (ids: readonly string[]) => void;
  setSelected: (id: string | null) => void;
  flyToCamera: (camera: Camera, opts?: { duration?: number }) => void;
  getCamera: () => Camera | null;
  getBbox: () => Bbox | null;
  resize: () => void;
  destroy: () => void;
}

/**
 * Create the map inside `container`. Resolves with a handle once the style and
 * our layers are up; calls `events.onFailed` and resolves null when there is no
 * map to be had, so the caller can mount the SVG fallback instead.
 */
export async function createMap(
  container: HTMLElement,
  initial: Camera,
  styles: SelectionStyle[],
  events: ControllerEvents,
): Promise<MapHandle | null> {
  if (!webgl2Ok()) {
    events.onFailed("no webgl2");
    return null;
  }

  let ml: Maplibre;
  try {
    ml = await import("maplibre-gl");
    ml.setWorkerUrl(workerUrl);
    await import("maplibre-gl/dist/maplibre-gl.css");
  } catch {
    events.onFailed("maplibre failed to load");
    return null;
  }

  const reducedMotion =
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  let map: MLMap;
  try {
    map = new ml.Map({
      container,
      style: MAP_STYLE,
      center: initial.centre,
      zoom: initial.zoom,
      bearing: initial.bearing,
      pitch: 0,
      minZoom: 3,
      maxZoom: 18,
      maxPitch: 0,
      attributionControl: { compact: true },
      // The map is full-bleed, not embedded in a scrolling page, so there is no
      // scroll trap to protect against. Cooperative gestures would just make
      // every zoom take two fingers for no reason.
      cooperativeGestures: false,
      dragRotate: false,
      touchPitch: false,
      touchZoomRotate: true,
      fadeDuration: reducedMotion ? 0 : 300,
      crossSourceCollisions: true,
    });
  } catch {
    events.onFailed("map construction failed");
    return null;
  }

  map.addControl(new ml.NavigationControl({ visualizePitch: false, showCompass: false }), "top-right");
  map.addControl(
    new ml.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, showUserLocation: true }),
    "top-right",
  );

  let destroyed = false;
  let allFeatures: PinFeature[] = [];
  let activeIds: readonly string[] = styles.map((s) => s.id);
  let selectedId: string | null = null;

  const applyFeatures = () => {
    if (destroyed) return;
    const source = map.getSource(CLUSTER_SOURCE_ID) as import("maplibre-gl").GeoJSONSource | undefined;
    if (!source) return;
    const active = new Set(activeIds);
    const filtered = activeIds.length
      ? allFeatures.filter((f) => active.has(f.properties.primary))
      : [];
    source.setData({ type: "FeatureCollection", features: filtered });
  };

  const applySelected = () => {
    if (destroyed) return;
    const source = map.getSource(SELECTED_SOURCE_ID) as
      | import("maplibre-gl").GeoJSONSource
      | undefined;
    if (!source) return;
    const feature = selectedId ? allFeatures.find((f) => f.properties.id === selectedId) : undefined;
    source.setData({
      type: "FeatureCollection",
      features: feature ? [feature] : [],
    });
  };

  map.on("webglcontextlost", () => events.onFailed("webglcontextlost"));
  map.on("error", (e) => {
    // A tile failing is routine (a tunnel, a tunnel's wifi). A style failing is
    // the map failing, and the style failing is the only error we escalate.
    const src = (e as { sourceId?: string }).sourceId ?? "";
    if (!src) events.onFailed("style failed");
  });

  map.on("moveend", () => {
    if (destroyed) return;
    events.onMoveEnd(bboxOf(map), cameraOf(map));
  });

  map.on("click", "pampered-pins", (e) => {
    const feature = e.features?.[0];
    const id = feature?.properties?.["id"];
    events.onSelect(typeof id === "string" ? id : null);
  });

  map.on("click", "pampered-clusters", async (e) => {
    const features = map.queryRenderedFeatures(e.point, { layers: ["pampered-clusters"] });
    const clusterId = features[0]?.properties?.["cluster_id"];
    const source = map.getSource(CLUSTER_SOURCE_ID) as
      | import("maplibre-gl").GeoJSONSource
      | undefined;
    if (clusterId == null || !source) return;
    try {
      const zoom = await source.getClusterExpansionZoom(Number(clusterId));
      const coords = (features[0]?.geometry as { coordinates?: LonLat } | undefined)?.coordinates;
      if (coords) map.easeTo({ center: coords, zoom, duration: reducedMotion ? 0 : 400 });
    } catch {
      // A cluster that will not expand is tapped again, not reported.
    }
  });

  // Tapping empty map dismisses the selection. The mini-card is Solid-rendered,
  // not a MapLibre popup, so there is nothing else to close.
  map.on("click", (e) => {
    const hits = map.queryRenderedFeatures(e.point, { layers: ["pampered-pins", "pampered-clusters"] });
    if (!hits.length) events.onSelect(null);
  });

  map.on("mouseenter", "pampered-pins", () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", "pampered-pins", () => {
    map.getCanvas().style.cursor = "";
  });

  const loaded = await new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const timer = setTimeout(() => {
      events.onFailed("style timeout");
      done(false);
    }, 20_000);
    map.once("load", async () => {
      clearTimeout(timer);
      try {
        const before = firstLabelLayer(map);

        map.addSource(CLUSTER_SOURCE_ID, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 48,
        });
        map.addSource(SELECTED_SOURCE_ID, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });

        const add = (layer: CircleLayerSpecification | SymbolLayerSpecification) => {
          if (before) map.addLayer(layer, before);
          else map.addLayer(layer);
        };

        add({
          id: "pampered-clusters",
          type: "circle",
          source: CLUSTER_SOURCE_ID,
          filter: ["has", "point_count"],
          paint: {
            "circle-color": "#55504a",
            "circle-opacity": 0.9,
            "circle-radius": ["step", ["get", "point_count"], 16, 25, 20, 100, 26],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          },
        });
        add({
          id: "pampered-cluster-count",
          type: "symbol",
          source: CLUSTER_SOURCE_ID,
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-size": 12,
            "text-allow-overlap": true,
          },
          paint: { "text-color": "#ffffff" },
        });

        add({
          id: "pampered-pins",
          type: "circle",
          source: CLUSTER_SOURCE_ID,
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 5, 14, 7, 18, 10],
            // The match is data-driven from selections.yaml via `styles`, which
            // is why adding a selection needs no code change: the colour arrives
            // here as data and MapLibre never knows the difference.
            "circle-color": pinColorExpression(styles),
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
            "circle-stroke-opacity": 0.95,
          },
        });

        // White glyphs on the coloured dots, only when close enough to read them.
        // The names were checked against src/map/icons.tsx by `npm run check`,
        // so isIconName failing here means content and code drifted at runtime.
        for (const s of styles) {
          if (!s.icon || !isIconName(s.icon)) continue;
          const imageId = `pampered-icon-${s.id}`;
          if (!map.hasImage(imageId)) {
            try {
              const bitmap = await svgToImage(iconSvg(s.icon, "#ffffff", 28), 28);
              map.addImage(imageId, bitmap, { pixelRatio: 2 });
            } catch {
              // A missing glyph degrades to a plain dot. The chip still has the icon.
            }
          }
        }
        add({
          id: "pampered-icons",
          type: "symbol",
          source: CLUSTER_SOURCE_ID,
          filter: ["!", ["has", "point_count"]],
          minzoom: 15,
          layout: {
            "icon-image": ["concat", "pampered-icon-", ["get", "primary"]],
            "icon-size": 0.8,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
        });

        add({
          id: "pampered-selected",
          type: "circle",
          source: SELECTED_SOURCE_ID,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 9, 14, 12, 18, 15],
            "circle-color": "transparent",
            "circle-stroke-color": "#1c1a17",
            "circle-stroke-width": 2.5,
          },
        });

        applyFeatures();
        done(true);
      } catch {
        events.onFailed("layer setup failed");
        done(false);
      }
    });
  });

  if (!loaded || destroyed) {
    if (!destroyed) map.remove();
    return null;
  }

  try {
    (window as unknown as { __pamperedMap?: MLMap }).__pamperedMap = map;
  } catch {
    // Debug handle only; never load-bearing.
  }
  events.onReady();

  return {
    setAllFeatures: (features) => {
      allFeatures = features;
      applyFeatures();
      applySelected();
    },
    setActiveSelections: (ids) => {
      activeIds = ids;
      applyFeatures();
    },
    setSelected: (id) => {
      selectedId = id;
      applySelected();
    },
    flyToCamera: (camera, opts) => {
      if (destroyed) return;
      map.flyTo({
        center: camera.centre,
        zoom: camera.zoom,
        bearing: camera.bearing,
        duration: opts?.duration ?? (reducedMotion ? 0 : 900),
      });
    },
    getCamera: () => (destroyed ? null : cameraOf(map)),
    getBbox: () => (destroyed ? null : bboxOf(map)),
    resize: () => {
      if (!destroyed) map.resize();
    },
    destroy: () => {
      destroyed = true;
      map.remove();
    },
  };
}

/** SlimPlace rows to the features the controller renders. */
export function toPinFeatures(
  places: {
    id: string;
    name: string | null;
    lat: number;
    lon: number;
    primary: string | null;
    selections: string[];
  }[],
  fallbackPrimary: (ids: readonly string[]) => string | null,
): PinFeature[] {
  return places
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .map((p) => {
      const primary = p.primary ?? fallbackPrimary(p.selections) ?? "unknown";
      return {
        type: "Feature" as const,
        properties: { id: p.id, primary, name: p.name },
        geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] as LonLat },
      };
    });
}