/**
 * GET /api/places?bbox=minLon,minLat,maxLon,maxLat&sel=cafes,pubs&q=...&near=lon,lat&radius=2000&limit=200
 *
 * The viewport query. The map calls this on every settled pan/zoom, debounced,
 * and the list renders the same payload. One endpoint, one shape, no separate
 * "map" and "list" APIs to drift apart.
 *
 * Caching: responses are marked `public, max-age=300, stale-while-revalidate=3600`.
 * The data changes on a human timescale (a weekly refresh), and a viewport that
 * was right five minutes ago is still right. Cloudflare caches per URL, and the
 * URL carries the whole query, so this is safe.
 */
import type { APIEvent } from "@solidjs/start/server";
import { selections } from "~/content/selections";
import { searchPlaces } from "~/server/places";
import type { Bbox, LonLat } from "~/lib/geo";

const KNOWN = new Set(selections.map((s) => s.id));
const MAX_LIMIT = 500;

function bad(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

export async function GET(event: APIEvent): Promise<Response> {
  const params = event.nativeEvent.url.searchParams;

  const bboxRaw = params.get("bbox") ?? "";
  const parts = bboxRaw.split(",").map(Number);
  if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) {
    return bad("bbox must be minLon,minLat,maxLon,maxLat");
  }
  const [minLon, minLat, maxLon, maxLat] = parts as [number, number, number, number];
  if (!(minLon < maxLon && minLat < maxLat) || Math.abs(minLat) > 85.1 || Math.abs(maxLat) > 85.1) {
    return bad("bbox is not a box");
  }
  // A whole-planet query is a mistake or an attack. The widest honest viewport
  // is a country, and even that should be paged, not dumped.
  if (maxLon - minLon > 30 || maxLat - minLat > 30) {
    return bad("bbox is too large; zoom in");
  }
  const bbox: Bbox = [minLon, minLat, maxLon, maxLat];

  const sel = (params.get("sel") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => KNOWN.has(s));

  let near: LonLat | null = null;
  const nearRaw = params.get("near");
  if (nearRaw) {
    const [lon, lat] = nearRaw.split(",").map(Number);
    if (lon == null || lat == null || !Number.isFinite(lon) || !Number.isFinite(lat)) {
      return bad("near must be lon,lat");
    }
    near = [lon, lat];
  }

  const radiusRaw = params.get("radius");
  const radius = radiusRaw == null ? null : Number(radiusRaw);
  if (radiusRaw != null && (!Number.isFinite(radius) || radius! < 0 || radius! > 50_000)) {
    return bad("radius must be 0–50000 metres");
  }

  const limitRaw = params.get("limit");
  const limit = limitRaw == null ? 200 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return bad(`limit must be 1–${MAX_LIMIT}`);
  }

  const q = (params.get("q") ?? "").slice(0, 120);

  try {
    const result = await searchPlaces({ bbox, selections: sel, q, near, radius, limit });
    return Response.json(result, {
      headers: {
        // The data changes weekly; a viewport cached for five minutes is fine.
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      },
    });
  } catch (error) {
    // A database failure is a 503 with no detail, because the detail is for the
    // logs and the visitor just needs to know it is temporary.
    console.error("/api/places:", error instanceof Error ? error.message : error);
    return Response.json({ error: "search is temporarily unavailable" }, { status: 503 });
  }
}