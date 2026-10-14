/**
 * Every piece of view state lives in the URL.
 *
 * That is the whole reason a person can send somebody "these are the dog parks
 * near me, zoomed to where I am" and get exactly what they saw. It also means
 * back and forward work, and that a cold render on the server can produce the
 * same list the client will, without shipping the whole dataset to do it.
 */
import { regions, defaultSelectionIds } from "~/content/selections";
import { clampBbox } from "./geo";
import type { Bbox, LonLat } from "./geo";

export interface ViewState {
  /** Free-text search. Empty means no text filter. */
  q: string;
  /** Where the map is looking. `null` until the map reports a camera. */
  at: LonLat | null;
  zoom: number;
  bearing: number;
  pitch: number;
  /** Which selections are on the map. Always at least one. */
  sel: string[];
  /** The venue whose card is open, or null. */
  place: string | null;
  /** Centre of the "near me" search, when the visitor has asked for one. */
  near: LonLat | null;
  /** Radius in metres for the "near me" search, or null for no limit. */
  radius: number | null;
}

export const DEFAULT_VIEW: ViewState = {
  q: "",
  at: null,
  zoom: 10.6,
  bearing: 0,
  pitch: 0,
  sel: [...defaultSelectionIds],
  place: null,
  near: null,
  radius: null,
};

/** Where the map opens before anybody has moved it: London, then the largest curated region. */
export const FALLBACK_CENTRE: LonLat = regions[0]?.centre ?? [-0.1276, 51.5074];
export const FALLBACK_ZOOM = regions[0]?.zoom ?? 10.6;

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const numParam = (raw: string | null): number | null => {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

export function parseView(search: string, knownIds: ReadonlySet<string>): ViewState {
  const p = new URLSearchParams(search);

  const q = (p.get("q") ?? "").slice(0, 120).trim();

  let at: LonLat | null = null;
  let zoom = DEFAULT_VIEW.zoom;
  let bearing = 0;
  let pitch = 0;
  const raw = p.get("at");
  if (raw) {
    const parts = raw.split(",").map(Number);
    const lon = parts[0];
    const lat = parts[1];
    if (parts.length >= 2 && isFiniteNumber(lon) && isFiniteNumber(lat) && Math.abs(lat) <= 85.1) {
      at = [lon, lat];
      const z = parts[2];
      const b = parts[3];
      const pi = parts[4];
      if (isFiniteNumber(z)) zoom = clamp(z, 2, 19);
      if (isFiniteNumber(b)) bearing = ((b % 360) + 360) % 360;
      if (isFiniteNumber(pi)) pitch = clamp(pi, 0, 70);
    }
  }

  // An unknown selection id is dropped rather than trusted. A shared link that
  // outlives a rename should show the map without that layer, not a blank map.
  const rawSel = (p.get("sel") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && knownIds.has(s));
  const sel = rawSel.length ? dedupe(rawSel) : [...defaultSelectionIds];

  let near: LonLat | null = null;
  const rawNear = p.get("near");
  if (rawNear) {
    const parts = rawNear.split(",").map(Number);
    const lon = parts[0];
    const lat = parts[1];
    if (parts.length >= 2 && isFiniteNumber(lon) && isFiniteNumber(lat)) {
      near = [lon, lat];
    }
  }

  const radiusNum = numParam(p.get("radius"));
  const radius = radiusNum == null ? null : clamp(radiusNum, 100, 50_000);

  return {
    q,
    at: at ?? [FALLBACK_CENTRE[0], FALLBACK_CENTRE[1]],
    zoom,
    bearing,
    pitch,
    sel,
    place: p.get("p"),
    near,
    radius,
  };
}

/**
 * The shortest URL that means the same thing.
 *
 * The camera is rounded to about a metre and the pitch is dropped entirely while
 * it is zero, because a URL with `,0,,0` in it is noise nobody can read out
 * loud. Rewriting the address bar on every pan frame would also make the back
 * button useless, so the caller debounces.
 */
export function serialiseView(view: ViewState): string {
  const p = new URLSearchParams();
  if (view.q) p.set("q", view.q);

  const lon = round(view.at?.[0] ?? FALLBACK_CENTRE[0], 5);
  const lat = round(view.at?.[1] ?? FALLBACK_CENTRE[1], 5);
  const z = round(view.zoom, 2);
  const parts = view.pitch > 1 ? [lon, lat, z, round(view.bearing, 0), round(view.pitch, 0)] : [lon, lat, z];
  p.set("at", parts.join(","));

  const sel = dedupe(view.sel);
  if (sel.length && sel.join(",") !== defaultSelectionIds.join(",")) p.set("sel", sel.join(","));
  if (view.place) p.set("p", view.place);
  if (view.near) p.set("near", `${round(view.near[0], 5)},${round(view.near[1], 5)}`);
  if (view.radius) p.set("radius", String(Math.round(view.radius)));
  return `?${p.toString()}`;
}

export function viewFromBbox(bbox: Bbox): Partial<ViewState> {
  return {
    at: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
    zoom: bboxToZoom(bbox),
  };
}

/**
 * The inverse of `makeProjector`, for a 1024x1024 square.
 *
 * Only used to seed the initial camera on a cold render, so it is allowed to be
 * approximate. MapLibre corrects the zoom once it loads.
 */
export function bboxToZoom(bbox: Bbox, viewportPx = 512): number {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const lonSpan = Math.max(1e-6, maxLon - minLon);
  const latSpan = Math.max(1e-6, maxLat - minLat);
  const latSpanClamped = Math.max(1e-6, mercatorY(minLat) - mercatorY(maxLat));
  const zoomX = Math.log2((viewportPx * 360) / (lonSpan * 256));
  const zoomY = Math.log2((viewportPx * 360) / (latSpanClamped * 256));
  return clamp(Math.min(zoomX, zoomY), 2, 19);
}

function mercatorY(lat: number): number {
  const clamped = clamp(lat, -85.051129, 85.051129);
  const rad = (clamped * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + rad / 2));
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * An approximate viewport for a camera, for the server render.
 *
 * The server has no map and so no measured bounds. This estimates them from the
 * zoom, which is close enough to fetch the right list: the client corrects to
 * the true bounds the moment the map reports them, and the list updates once.
 */
export function bboxForCamera(centre: LonLat, zoom: number, widthPx = 800, heightPx = 600): Bbox {
  const degPerPx = 360 / (256 * 2 ** clamp(zoom, 2, 19));
  const halfW = ((widthPx / 2) * degPerPx) / Math.max(0.2, Math.cos((centre[1] * Math.PI) / 180));
  const halfH = (heightPx / 2) * degPerPx;
  return clampBbox([centre[0] - halfW, centre[1] - halfH, centre[0] + halfW, centre[1] + halfH]);
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function dedupe(list: readonly string[]): string[] {
  return [...new Set(list)];
}