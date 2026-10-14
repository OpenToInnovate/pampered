/**
 * The search, as a cached server function.
 *
 * The finder page needs the same data on the server (for the first paint) and
 * on the client (for every pan). A relative `fetch("/api/places…")` has no host
 * on the server, so the server path calls D1 directly through this query while
 * the client path uses plain REST — which keeps Cloudflare's edge cache in
 * front of the hot viewports instead of an RPC envelope.
 */
import { query } from "@solidjs/router";
import type { Bbox, LonLat } from "~/lib/geo";

export interface FetchKey {
  bbox: string;
  sel: string;
  q: string;
  near: string;
  radius: string;
}

export function parseFetchKey(key: FetchKey): {
  bbox: Bbox;
  selections: string[];
  q: string;
  near: LonLat | null;
  radius: number | null;
} {
  const parts = key.bbox.split(",").map(Number);
  const bbox: Bbox = [
    parts[0] ?? 0,
    parts[1] ?? 0,
    parts[2] ?? 0,
    parts[3] ?? 0,
  ];
  const nearParts = key.near ? key.near.split(",").map(Number) : [];
  return {
    bbox,
    selections: key.sel ? key.sel.split(",") : [],
    q: key.q,
    near:
      nearParts.length >= 2 && Number.isFinite(nearParts[0]) && Number.isFinite(nearParts[1])
        ? [nearParts[0] as number, nearParts[1] as number]
        : null,
    radius: key.radius ? Number(key.radius) : null,
  };
}

export const searchPlacesQuery = query(async (key: FetchKey) => {
  "use server";
  const { searchPlaces } = await import("~/server/places");
  const parsed = parseFetchKey(key);
  return searchPlaces({ ...parsed, limit: 200 });
}, "places-search");