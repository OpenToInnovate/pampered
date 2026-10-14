#!/usr/bin/env node
/**
 * Pull OpenStreetMap for every selection that has an OSM query.
 *
 * Overpass is a free service run by volunteers, and at busy hours it answers a
 * Great-Britain-wide query with a 504 and a small one with data. This script is
 * shaped around that fact rather than around the happy path:
 *
 *   - one request at a time, never in parallel, with a real User-Agent
 *   - a cooldown between requests, longer after a failure
 *   - a second and third endpoint to fall back to
 *   - when a whole-area query is refused, the area is split into quadrants and
 *     each is fetched in turn, up to two levels deep
 *   - every tile is written to disk the moment it arrives, so killing the
 *     process loses nothing and a re-run only asks for the missing tiles
 *
 * Nothing here is destructive. It writes to `data/osm/`, which is gitignored.
 *
 *   npm run refresh                 every selection
 *   npm run refresh -- cafes pubs   only those
 *   npm run refresh -- --force      ignore the cache
 *   npm run refresh -- --tile=2     start already split once (for a bad hour)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  OSM_CACHE_DIR,
  OVERPASS_ENDPOINTS,
  isoNow,
  loadSelections,
  overpass,
  overpassQueryFor,
} from "./lib/content.mjs";

const FORCE = process.argv.includes("--force");
const ONLY = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const START_DEPTH = Number(
  (process.argv.find((a) => a.startsWith("--tile=")) ?? "--tile=0").split("=")[1],
);
// --endpoint=<substring>: only try endpoints whose URL contains it. When the
// primary is having a bad hour, `--endpoint=mail.ru` skips straight to the
// mirror that answers instead of burning three attempts and two minutes first.
const ENDPOINT_FILTER = (process.argv.find((a) => a.startsWith("--endpoint=")) ?? "").split("=")[1] ?? "";
const ENDPOINTS = OVERPASS_ENDPOINTS.filter((e) => !ENDPOINT_FILTER || e.includes(ENDPOINT_FILTER));
if (!ENDPOINTS.length) throw new Error(`No endpoint matches --endpoint=${ENDPOINT_FILTER}`);

/** Between successful requests. Overpass asks for politeness; this is politeness. */
const COOLDOWN_MS = 8000;
/** 429 and 504 mean "come back later". Anything shorter than this is how an instance bans you. */
const BACKOFF_MS = 45_000;
/** Attempts per tile per endpoint before subdividing or giving up. */
const ATTEMPTS = 3;
/** Two levels of quadrants turns GB into sixteen tiles. Past that the tiles start
    costing more in requests than they save in patience. */
const MAX_DEPTH = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms) => ms + Math.floor(Math.random() * 4000);
const log = (...args) => console.log(...args);

/** [south, west, north, east], stringified for filenames and the manifest. */
function tileKey(bbox) {
  return bbox.map((v) => v.toFixed(2)).join("_");
}

function quadrants([south, west, north, east]) {
  const midLat = (south + north) / 2;
  const midLon = (west + east) / 2;
  return [
    [south, west, midLat, midLon],
    [south, midLon, midLat, east],
    [midLat, west, north, midLon],
    [midLat, midLon, north, east],
  ];
}

function areaKm2([south, west, north, east]) {
  const midLat = (((south + north) / 2) * Math.PI) / 180;
  const latKm = (north - south) * 111.32;
  const lonKm = (east - west) * 111.32 * Math.cos(midLat);
  return Math.round(latKm * lonKm);
}

async function loadJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * One tile, tried on every endpoint in turn.
 *
 * Returns the parsed Overpass response, or throws when nothing answered. A 504
 * is not treated as final: it almost always means "this particular query on a
 * busy instance", which is why the caller subdivides rather than retrying
 * the same bytes forever.
 */
async function fetchTile(query, label) {
  let lastError = new Error("no endpoint attempted");
  for (const endpoint of ENDPOINTS) {
    const host = new URL(endpoint).host;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        return await overpass(query, endpoint);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const message = lastError.message;
        log(`      ! ${host} attempt ${attempt}: ${message.slice(0, 140)}`);
        // 504 on a tile usually clears if you simply ask again in a minute. 429
        // means you are asking too often, full stop.
        if (/\b429\b/.test(message)) await sleep(jitter(BACKOFF_MS * 2));
        else if (attempt < ATTEMPTS) await sleep(jitter(BACKOFF_MS));
      }
    }
  }
  throw new Error(`${label}: ${lastError.message.slice(0, 200)}`);
}

async function fetchRecursive(selection, bbox, depth, manifestEntry, stats) {
  const key = tileKey(bbox);
  const tileFile = join(OSM_CACHE_DIR, `${selection.id}.${key}.json`);

  if (!FORCE) {
    const cached = await loadJson(tileFile);
    if (cached && Array.isArray(cached.elements)) {
      manifestEntry.tiles[key] = manifestEntry.tiles[key] ?? {};
      if (!manifestEntry.tiles[key].count) {
        manifestEntry.tiles[key] = {
          count: cached.count,
          fetchedAt: cached.fetchedAt,
          osmTimestamp: cached.osmTimestamp,
          depth,
        };
      }
      return cached.elements;
    }
  }

  const query = overpassQueryFor(selection, bbox);
  const indent = "  ".repeat(depth + 1);
  log(`${indent}> ${selection.id} @ ${key} (${areaKm2(bbox).toLocaleString("en-GB")} km²)`);

  try {
    const json = await fetchTile(query, `${selection.id} @ ${key}`);
    const elements = Array.isArray(json.elements) ? json.elements : [];
    const stamp = json.osm3s?.timestamp_osm_base ?? isoNow();

    await writeFile(
      tileFile,
      JSON.stringify({
        selection: selection.id,
        query,
        bbox,
        fetchedAt: isoNow(),
        osmTimestamp: stamp,
        depth,
        count: elements.length,
        elements,
      }),
    );
    manifestEntry.tiles[key] = { count: elements.length, fetchedAt: isoNow(), osmTimestamp: stamp, depth };
    stats.fetched++;
    stats.elements += elements.length;
    log(`${indent}  ${elements.length} elements`);
    await sleep(jitter(COOLDOWN_MS));
    return elements;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (depth < MAX_DEPTH) {
      log(`${indent}  refused (${message.slice(0, 100)}), splitting`);
      const merged = new Map();
      for (const quad of quadrants(bbox)) {
        for (const el of await fetchRecursive(selection, quad, depth + 1, manifestEntry, stats)) {
          merged.set(`${el.type}/${el.id}`, el);
        }
      }
      // Tiles a level up asked for a union; ways that cross a quadrant boundary
      // arrive twice, once per tile, so the merge is by identity, not concat.
      return [...merged.values()];
    }
    // Some tile at the deepest level refused. Keep a record rather than throwing,
    // so one awkward stretch of the North Sea does not lose the other fifteen.
    log(`${indent}  FAILED at max depth: ${message.slice(0, 160)}`);
    manifestEntry.failed = manifestEntry.failed ?? [];
    manifestEntry.failed.push({ key, depth, error: message.slice(0, 300), at: isoNow() });
    stats.failed++;
    return [];
  }
}

/** Merge every tile of a selection into one file, deduplicated by element identity. */
async function consolidate(selection, manifest) {
  const entry = (manifest.selections[selection.id] ??= { osm: true, tiles: {} });
  const merged = new Map();
  for (const [key, info] of Object.entries(entry.tiles ?? {})) {
    const tile = await loadJson(join(OSM_CACHE_DIR, `${selection.id}.${key}.json`));
    if (!tile) continue;
    for (const el of tile.elements ?? []) merged.set(`${el.type}/${el.id}`, el);
  }
  const elements = [...merged.values()];
  const stamp = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  await writeFile(
    join(OSM_CACHE_DIR, `${selection.id}.json`),
    JSON.stringify({
      selection: selection.id,
      bbox: manifest.area.bbox,
      fetchedAt: isoNow(),
      osmTimestamp: stamp,
      count: elements.length,
      elements,
    }),
  );
  entry.count = elements.length;
  entry.fetchedAt = isoNow();
  return elements.length;
}

async function main() {
  const { area, selections } = await loadSelections();
  await mkdir(OSM_CACHE_DIR, { recursive: true });

  const wanted = ONLY.length ? selections.filter((s) => ONLY.includes(s.id)) : selections;
  if (ONLY.length) {
    const missing = ONLY.filter((id) => !wanted.some((s) => s.id === id));
    if (missing.length) {
      throw new Error(
        `No such selection(s): ${missing.join(", ")}. Known: ${selections.map((s) => s.id).join(", ")}`,
      );
    }
  }

  const manifestPath = join(OSM_CACHE_DIR, "manifest.json");
  const manifest = (await loadJson(manifestPath)) ?? { version: 1, ranAt: null, selections: {} };
  // Set before any consolidate runs. A fresh manifest has no area yet, and the
  // first selection would otherwise crash reading manifest.area.bbox.
  manifest.area = area;

  const stats = { fetched: 0, reused: 0, elements: 0, failed: 0 };

  for (const s of wanted.filter((x) => !x.osm)) {
    log(`  - ${s.id}: curated only, nothing to fetch`);
    manifest.selections[s.id] = { ...(manifest.selections[s.id] ?? {}), osm: false };
  }

  const targets = wanted.filter((s) => s.osm);
  log(`\nRefreshing ${targets.length} selection(s) for ${area.name}\n`);

  for (const selection of targets) {
    const entry = (manifest.selections[selection.id] ??= { osm: true, tiles: {} });
    entry.tiles ??= {};
    await fetchRecursive(selection, area.bbox, START_DEPTH, entry, stats);
    const count = await consolidate(selection, manifest);
    log(`  = ${selection.id}: ${count.toLocaleString("en-GB")} unique elements`);
    await writeFile(manifestPath, JSON.stringify({ ...manifest, area: area, ranAt: isoNow() }, null, 2));
  }

  manifest.version = 1;
  manifest.area = area;
  manifest.ranAt = isoNow();
  manifest.summary = stats;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  log(
    `\nDone. ${stats.fetched} tile(s) fetched, ${stats.elements.toLocaleString("en-GB")} elements, ` +
      `${stats.failed} tile(s) failed.`,
  );
  log("Next: npm run build:index && npm run sync\n");
}

main().catch((error) => {
  console.error(`\nrefresh failed: ${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
});