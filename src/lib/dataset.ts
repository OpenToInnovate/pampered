/**
 * Loading the published dataset.
 *
 * Two layers of caching, both free and both outside the Worker:
 *
 *   memory        — so panning re-filters what is already there
 *   Cache Storage — so a second visit fetches nothing
 *
 * A selection's file is fetched once and never again. That is the whole point:
 * the directory is precomputed, and the browser holds it rather than the
 * database being asked for it again.
 */
import { createSignal } from "solid-js";
import type { Manifest, PlaceRecord } from "./search";
import { mergeRecords } from "./search";

const BASE = "/data";

/**
 * True while server-rendering.
 *
 * A relative `fetch("/data/…")` throws on the server because there is no
 * origin to resolve it against, so the server reads the bundled dataset
 * instead. The branch is dead code in the client build and never reaches the
 * browser — `scripts/guard-no-request-db.mjs` fails the build if it does.
 */
const IS_SSR = import.meta.env.SSR;

/** Cached for the life of the tab. */
const memory = new Map<string, PlaceRecord[]>();
const inflight = new Map<string, Promise<PlaceRecord[]>>();

/** What the server already rendered, read back off the page. */
const SEED_ID = "pampered-seed";
let seedCache: PlaceRecord[] | null | undefined;

const [manifest, setManifest] = createSignal<Manifest | null>(null);

export function datasetManifest(): Manifest | null {
  return manifest();
}

/**
 * Load the manifest once. It carries the build time and the per-selection
 * counts, which is what the footer and the legend read instead of asking a
 * database for a `COUNT(*)`.
 */
export async function loadManifest(): Promise<Manifest> {
  if (manifest()) return manifest()!;
  const body = await loadJson(`${BASE}/manifest.json`);
  const value = body as Manifest;
  setManifest(value);
  return value;
}

export async function loadSelection(id: string): Promise<PlaceRecord[]> {
  const cached = memory.get(id);
  if (cached) return cached;

  const pending = inflight.get(id);
  if (pending) return pending;

  const job = (async () => {
    try {
      const url = `${BASE}/${encodeURIComponent(id)}.json`;
      // Cache Storage first. A returning visitor reads from disk and the network
      // is never touched, which is also what keeps this working on a train.
      const stored = await readFromCache(url);
      if (stored) {
        memory.set(id, stored);
        return stored;
      }
      const places = parsePlaces(await loadJson(url));
      memory.set(id, places);
      void writeToCache(url, places);
      return places;
    } finally {
      inflight.delete(id);
    }
  })();

  inflight.set(id, job);
  return job;
}

/**
 * Load several selections at once and return the union.
 *
 * A single selection failing to load is tolerated — a visitor who cannot reach
 * one chip's data still gets the other two. Every selection failing is an
 * error, because "the directory did not load" and "there is nothing here" must
 * never look the same. Getting that wrong is what turned an eight-hour outage
 * into a site that appeared to be working.
 */
export async function loadSelections(ids: readonly string[]): Promise<PlaceRecord[]> {
  const unique = [...new Set(ids)];
  const results = await Promise.allSettled(unique.map((id) => loadSelection(id)));
  return settleSelectionLoads(results, unique.length);
}

/**
 * Merge the outcomes, refusing to look like an empty directory.
 *
 * A single selection failing is tolerated — a visitor who cannot reach one
 * chip's data still gets the other two. Every selection failing is an error,
 * because "the directory did not load" and "there is nothing here" must never
 * look the same. Getting that wrong is what turned an eight-hour outage into a
 * site that appeared to be working: HTTP 200, zero rows, no message.
 *
 * Pure, so it can be tested without a network, a browser or a stub.
 */
export function settleSelectionLoads(
  results: readonly PromiseSettledResult<PlaceRecord[]>[],
  requested: number,
): PlaceRecord[] {
  const batches: PlaceRecord[][] = [];
  let failed = 0;
  let firstError: unknown;
  for (const outcome of results) {
    if (outcome.status === "fulfilled") batches.push(outcome.value);
    else {
      failed++;
      firstError ??= outcome.reason;
    }
  }
  if (failed > 0 && failed === requested) {
    throw firstError instanceof Error ? firstError : new Error("the directory did not load");
  }
  return mergeRecords(batches);
}

/**
 * The dataset the server already rendered, read synchronously off the page.
 *
 * Without this the server draws a list from the files on disk and the browser
 * draws nothing until its own fetch lands, and reconciling those two shapes
 * during hydration throws "Cannot read properties of null (reading
 * 'nextSibling')" and drops the page into the error boundary. Reading the
 * server's own answer back means both sides of hydration agree, and it saves
 * the browser downloading the same bytes twice.
 *
 * Returns null on the server, and null in the browser when there is no seed —
 * which is every page that was not pre-rendered.
 */
export function seedFromDocument(): PlaceRecord[] | null {
  if (seedCache !== undefined) return seedCache;
  seedCache = null;
  if (typeof document === "undefined") return null;
  const el = document.getElementById(SEED_ID);
  const text = el?.textContent;
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as { places?: PlaceRecord[] };
    const places = Array.isArray(parsed.places) ? parsed.places : [];
    if (!places.length) return null;
    seedCache = places;
    for (const rec of places) {
      for (const id of rec.selections ?? []) {
        const bucket = memory.get(id);
        if (bucket) {
          if (!bucket.some((p) => p.id === rec.id)) bucket.push(rec);
        } else {
          memory.set(id, [rec]);
        }
      }
    }
    return places;
  } catch {
    // A malformed seed is no worse than no seed: the client falls back to
    // fetching, which is the path that always works.
    return null;
  }
}

/** The id the server writes its seed under. Shared so the two cannot drift. */
export const SEED_ELEMENT_ID = SEED_ID;

/**
 * The seed, as a script body safe to inline.
 *
 * `</script>` inside a string ends the element no matter how it is quoted, and
 * venue names come from OpenStreetMap. One pass that cannot appear in the data
 * is enough.
 */
export function serialiseSeed(selections: readonly string[], places: readonly PlaceRecord[]): string {
  return JSON.stringify({ selections, places }).replace(/</g, "\\u003c");
}

/** Already in memory, without triggering a fetch. */
export function peekSelection(id: string): PlaceRecord[] | undefined {
  return memory.get(id);
}

export function isLoaded(id: string): boolean {
  return memory.has(id);
}

/* ------------------------------------------------------------------ loading */

async function loadJson(path: string): Promise<unknown> {
  if (IS_SSR) {
    const server = await import("./dataset.server");
    return path.endsWith("/manifest.json")
      ? server.readManifest()
      : server.readSelection(path.slice(path.lastIndexOf("/") + 1).replace(".json", ""));
  }
  const res = await fetch(path, { cache: "force-cache" });
  if (!res.ok) throw new Error(`${path} responded ${res.status}`);
  return res.json();
}

function parsePlaces(body: unknown): PlaceRecord[] {
  const value = body as { places?: PlaceRecord[] } | null;
  return Array.isArray(value?.places) ? value.places : [];
}

/* ------------------------------------------------------------------ caching */

const CACHE_NAME = "pampered-data-v1";

async function readFromCache(url: string): Promise<PlaceRecord[] | null> {
  if (typeof caches === "undefined" || IS_SSR) return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(url);
    if (!hit) return null;
    return parsePlaces(await hit.json());
  } catch {
    // Private browsing, quota, or no Cache Storage. The network path still works.
    return null;
  }
}

async function writeToCache(url: string, places: PlaceRecord[]): Promise<void> {
  if (typeof caches === "undefined" || IS_SSR) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(url, new Response(JSON.stringify({ places }), {
      headers: { "content-type": "application/json" },
    }));
  } catch {
    // A full quota must never break the map. The next visit fetches again.
  }
}
