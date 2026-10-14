/**
 * Geometry, ported from `../OurBlock/src/geo.js` and then made portable.
 *
 * The original was written for a fixed Tower Hamlets viewport where the map was
 * always looking at a small area at high zoom, so it could get away with an
 * equirectangular projection and no antimeridian handling. This is the same
 * maths, kept deliberately boring, because it is also what renders the fallback
 * when WebGL is missing — the code that only runs on a broken device is exactly
 * the code you do not want to be clever in.
 */

export type LonLat = [lon: number, lat: number];
export type Bbox = [minLon: number, minLat: number, maxLon: number, maxLat: number];

export interface Projector {
  (lon: number, lat: number): [x: number, y: number];
  invert(x: number, y: number): LonLat;
  /** Pixels per degree of longitude, corrected for latitude. */
  scale: number;
}

export const EARTH_RADIUS_M = 6371000;

/** Bounding box of a set of GeoJSON features, or of raw coordinate arrays. */
export function bboxOf(features: { geometry?: { coordinates?: unknown } | null }[]): Bbox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const walk = (coords: unknown): void => {
    if (!coords) return;
    if (Array.isArray(coords) && typeof coords[0] === "number" && typeof coords[1] === "number") {
      const x = coords[0];
      const y = coords[1];
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      return;
    }
    if (Array.isArray(coords)) for (const c of coords) walk(c);
  };

  for (const f of features) walk(f.geometry?.coordinates);
  if (!Number.isFinite(minX)) return [0, 0, 0, 0];
  return [minX, minY, maxX, maxY];
}

/** Clamp a bbox to the Web Mercator-safe latitude range so the projector cannot blow up. */
export function clampBbox(bbox: Bbox): Bbox {
  const MAX_LAT = 85.051129;
  return [
    Math.max(-180, bbox[0]),
    Math.max(-MAX_LAT, bbox[1]),
    Math.min(180, bbox[2]),
    Math.min(MAX_LAT, bbox[3]),
  ];
}

/**
 * Equirectangular projection fitted to a bbox, which is accurate enough at the
 * scale a fallback map ever draws and is four lines long.
 */
export function makeProjector(bbox: Bbox, width: number, height: number, pad = 28): Projector {
  const [minX, minY, maxX, maxY] = clampBbox(bbox);
  const lon0 = (minX + maxX) / 2;
  const lat0 = (minY + maxY) / 2;
  const latScale = Math.cos((lat0 * Math.PI) / 180);
  const dx = (maxX - minX) * latScale;
  const dy = maxY - minY;
  const scale = Math.min((width - pad * 2) / (dx || 1), (height - pad * 2) / (dy || 1));
  const cx = width / 2;
  const cy = height / 2;

  const project = ((lon: number, lat: number): [number, number] => [
    cx + (lon - lon0) * latScale * scale,
    cy - (lat - lat0) * scale,
  ]) as Projector;

  project.invert = (x, y): LonLat => [
    lon0 + (x - cx) / (latScale * scale || 1),
    lat0 - (y - cy) / (scale || 1),
  ];
  project.scale = scale;
  return project;
}

function ringPath(ring: number[][], project: Projector, minPx = 0.9): string {
  if (!ring?.length) return "";
  let d = "";
  let lastX = Infinity;
  let lastY = Infinity;
  let started = false;
  for (let i = 0; i < ring.length; i++) {
    const point = ring[i];
    if (!point) continue;
    const [x, y] = project(point[0] as number, point[1] as number);
    // Drop points closer together than a pixel. A borough outline has tens of
    // thousands of them and the ones that matter are all further apart than that.
    if (started && Math.hypot(x - lastX, y - lastY) < minPx && i !== ring.length - 1) continue;
    d += `${started ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    lastX = x;
    lastY = y;
    started = true;
  }
  return `${d}Z`;
}

export type AnyGeometry =
  | { type: "Point"; coordinates: number[] }
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] }
  | { type: null };

export function geomPath(geom: AnyGeometry | undefined | null, project: Projector): string {
  if (!geom) return "";
  if (geom.type === "Polygon") {
    return (geom.coordinates ?? []).map((r) => ringPath(r, project)).join("");
  }
  if (geom.type === "MultiPolygon") {
    return (geom.coordinates ?? [])
      .map((poly) => (poly ?? []).map((r) => ringPath(r, project)).join(""))
      .join("");
  }
  if (geom.type === "Point") {
    const [x, y] = project(geom.coordinates[0] as number, geom.coordinates[1] as number);
    return `M${x.toFixed(1)},${y.toFixed(1)}`;
  }
  return "";
}

/** Centroid of a GeoJSON feature. Boxes, not centroids, because a convex centroid of a crescent is nowhere near it. */
export function pointOf(feature: { geometry?: AnyGeometry | null }): LonLat | null {
  const g = feature.geometry;
  if (!g) return null;
  if (g.type === "Point") return [g.coordinates[0] as number, g.coordinates[1] as number];

  const ring =
    g.type === "Polygon"
      ? g.coordinates[0]
      : g.type === "MultiPolygon"
        ? g.coordinates[0]?.[0]
        : null;
  if (!ring?.length) return null;

  let sx = 0;
  let sy = 0;
  for (const p of ring) {
    sx += p[0] as number;
    sy += p[1] as number;
  }
  return [sx / ring.length, sy / ring.length];
}

/** Great-circle metres. Good to about 0.5%, which is far inside "how far is this pub". */
export function distMetres(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dphi = p2 - p1;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** A circle on the ground, as a closed ring. Used for the "near me" radius. */
export function circleRing(lon: number, lat: number, radiusM: number, steps = 32): number[][] {
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  const ring: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    ring.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return ring;
}

/**
 * The four corners of a viewport, in the order MapLibre hands them back.
 *
 * `map.getBounds()` returns south-west and north-east, which is a bounding box.
 * Panning to it is wrong the moment the map is pitched or rotated, because the
 * visible region is then a trapezoid whose corners stick out past the bbox. This
 * returns the rotated corners instead, so a "search what I can see" query does
 * not silently miss the places in the corners.
 */
export function viewportCorners(
  centre: LonLat,
  zoom: number,
  bearingDeg: number,
  pitchDeg: number,
  width: number,
  height: number,
): [LonLat, LonLat, LonLat, LonLat] {
  const tileSize = 512;
  const scale = tileSize * 2 ** zoom;

  // Half the visible field of view, measured at the map centre's distance.
  const groundHalfHeight = (height / 2 / scale) * 360;
  const fovFactor = pitchDeg > 1 ? 1 / Math.cos((pitchDeg * Math.PI) / 180) : 1;
  const farHalf = Math.min(groundHalfHeight * fovFactor, 85);
  const nearHalf = Math.min(groundHalfHeight / fovFactor, 85);

  const rad = (-bearingDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const halfWidth = width / 2;

  // Three depths rather than two: the near edge is closer to the camera so it
  // covers more longitude for the same pixels.
  const depths = [
    { half: farHalf, x: halfWidth, y: 0 },
    { half: nearHalf, x: -halfWidth, y: 0 },
    { half: nearHalf, x: 0, y: farHalf - nearHalf },
    { half: nearHalf, x: 0, y: -(farHalf - nearHalf) },
  ];

  const corner = ({ half, x, y }: { half: number; x: number; y: number }): LonLat => {
    const dx = x * (half / Math.max(groundHalfHeight, 1e-6));
    const dy = y * (half / Math.max(groundHalfHeight, 1e-6));
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    const lat = centre[1] + ry;
    const lonScale = Math.max(1e-6, Math.cos((lat * Math.PI) / 180));
    return [centre[0] + rx / lonScale, lat];
  };

  const [a, b, c, d] = depths;
  if (!a || !b || !c || !d) return [centre, centre, centre, centre];
  return [corner(a), corner(b), corner(c), corner(d)];
}

/** Smallest bbox containing a set of points. Used to turn viewport corners back into a query box. */
export function bboxOfPoints(points: readonly LonLat[]): Bbox {
  if (!points.length) return [0, 0, 0, 0];
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of points) {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  return clampBbox([minLon, minLat, maxLon, maxLat]);
}