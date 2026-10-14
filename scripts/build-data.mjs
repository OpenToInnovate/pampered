#!/usr/bin/env node
/**
 * Publish the directory as static assets. Nothing at request time touches D1.
 *
 * This is the fix for the thing that took two sites down. Pampered used to ask
 * D1 for every viewport query, and its footer asked D1 for two full-table row
 * counts on every page view — about 14,500 rows per visit on a 7,000-row table.
 * That exhausted the account's daily D1 row-read quota, and because the quota
 * is per-account rather than per-database it took korg-e.com/mir down with it.
 *
 * So the dataset is precomputed here instead. The browser fetches one small
 * JSON per selection and filters it itself. Measured cost of the default
 * selections: 26 KB gzipped. The whole directory: 187 KB. Neither touches a
 * database.
 *
 *   npm run build:data      this
 *   npm run build           then, which runs this via prebuild
 *
 * Writes:
 *   public/data/manifest.json      counts, build time, field list
 *   public/data/<selection>.json   slim records for that selection
 *   data/published.json            the whole thing, bundled into the Worker
 *                                   for server-rendering venue pages
 *
 * Null fields are dropped rather than serialised. Most OpenStreetMap rows have
 * no notes, no phone and no booking link, and an explicit null for each of those
 * is roughly a third of the bytes.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { ROOT, loadSelections } from "./lib/content.mjs";

const OUT_DIR = join(ROOT, "public", "data");
const log = (...args) => console.log(...args);

/**
 * One published record, in the same shape the components already consumed from
 * the old SlimPlace API. That is deliberate: nothing downstream of this file
 * had to change to remove the database from the request path, which is the
 * difference between a fix and a rewrite.
 *
 * Coordinates are rounded to four decimals, about 11 metres at this latitude —
 * a fraction of the width of the building most of these venues sit in.
 *
 * Null fields are dropped rather than serialised. Most OpenStreetMap rows have
 * no notes, no phone and no booking link, and an explicit null for each of those
 * is roughly a third of the bytes.
 */
function publish(place) {
  const rec = {
    id: place.id,
    name: place.name ?? null,
    lat: round(place.lat, 4),
    lon: round(place.lon, 4),
    primary: place.primary ?? null,
    selections: place.selections ?? [],
    dogPolicy: place.dog_policy ?? "unknown",
    source: place.source ?? null,
    verified: place.verified ? 1 : 0,
  };

  const optional = {
    city: place.city,
    street: place.street,
    postcode: place.postcode,
    openingHours: place.opening_hours,
    phone: place.phone,
    website: place.website,
    instagram: place.instagram,
    notes: place.notes,
    bookingUrl: place.booking_url,
    bookingLabel: place.booking_label,
    image: place.image,
    cuisine: place.cuisine,
    outdoorSeating: place.outdoor_seating,
    wheelchair: place.wheelchair,
    provenance: place.provenance,
    osmUpdated: place.osm_updated,
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value !== null && value !== undefined && value !== "") rec[key] = value;
  }
  return rec;
}

function round(n, places) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Bytes, so the log can be compared against the payload budget in AGENTS.md. */
function gzipSize(text) {
  return gzipSync(Buffer.from(text), { level: 9 }).length;
}

/**
 * Rebuild from the OSM cache when it is here, and from the committed published
 * data when it is not.
 *
 * `data/osm/` is 8.4 MB of raw OpenStreetMap responses and is gitignored, so a
 * fresh clone cannot produce `data/index.json`. It does not need to: the
 * published files in `public/data/` are the site's content, they are committed,
 * and they are enough to assemble `data/published.json`, which is the only thing
 * the Worker bundle needs. So a clean clone — or CI — builds the same site
 * without the cache, and nobody refreshes OpenStreetMap by accident.
 */
async function loadSource(selections) {
  const indexPath = join(ROOT, "data", "index.json");
  try {
    const index = JSON.parse(await readFile(indexPath, "utf8"));
    return { mode: "rebuild", index };
  } catch {
    /* fall through */
  }

  const groups = new Map();
  let total = 0;
  let builtAt = null;
  for (const selection of selections) {
    try {
      const body = JSON.parse(
        await readFile(join(OUT_DIR, `${selection.id}.json`), "utf8"),
      );
      groups.set(selection.id, body.places ?? []);
      total += (body.places ?? []).length;
      builtAt = body.builtAt ?? builtAt;
    } catch {
      log(`  - ${selection.id}: no published data`);
    }
  }
  if (!total) {
    throw new Error(
      "No data/index.json and no published data. Run `npm run refresh && npm run build:index`.",
    );
  }
  log("No data/index.json; assembling from the committed published data.");
  return { mode: "assemble", records: mergeGroups(groups), builtAt: builtAt ?? new Date().toISOString() };
}

function mergeGroups(groups) {
  const seen = new Map();
  for (const list of groups.values()) for (const rec of list) if (!seen.has(rec.id)) seen.set(rec.id, rec);
  return [...seen.values()];
}

async function main() {
  const { selections } = await loadSelections();
  const source = await loadSource(selections);

  await mkdir(OUT_DIR, { recursive: true });

  const builtAt = source.builtAt ?? new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const records = source.mode === "rebuild" ? source.index.places.map(publish) : source.records;

  // Group by selection. A place in two selections appears in both files, which
  // is what makes toggling a chip a fetch rather than a search over everything.
  const bySelection = new Map(selections.map((s) => [s.id, []]));
  for (const rec of records) {
    for (const id of rec.selections) {
      const bucket = bySelection.get(id);
      if (bucket) bucket.push(rec);
    }
  }

  const counts = {};
  let defaultRaw = 0;
  let defaultGz = 0;

  for (const selection of selections) {
    // In assemble mode the per-selection files are the *source*, so they must
    // not be written back. Rewriting them from the union they were just read
    // from loses every place that belonged to no currently-listed selection, and
    // each run shrinks the data a little more — which is how a build step
    // becomes a very slow way to delete a directory.
    const body =
      source.mode === "rebuild"
        ? JSON.stringify({ selection: selection.id, builtAt, places: bySelection.get(selection.id) ?? [] })
        : await readFile(join(OUT_DIR, `${selection.id}.json`), "utf8").catch(
            () => JSON.stringify({ selection: selection.id, builtAt, places: [] }),
          );
    if (source.mode === "rebuild") {
      await writeFile(join(OUT_DIR, `${selection.id}.json`), body);
    }

    const gz = gzipSize(body);
    counts[selection.id] = (bySelection.get(selection.id) ?? []).length;
    if (selection.default) {
      defaultRaw += body.length;
      defaultGz += gz;
    }
    log(`  ${selection.id.padEnd(13)} ${String(counts[selection.id]).padStart(5)}  ${kb(body.length).padStart(6)} raw  ${kb(gz).padStart(6)} gzip`);
  }

  const manifest = {
    builtAt,
    total: records.length,
    counts,
    fields: [
      "id", "name", "lat", "lon", "primary", "selections", "dogPolicy", "source", "verified",
      "city", "street", "postcode", "openingHours", "phone", "website", "instagram",
      "notes", "bookingUrl", "bookingLabel", "image", "cuisine", "outdoorSeating",
      "wheelchair", "provenance", "osmUpdated",
    ],
  };
  await writeFile(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));

  // The full set, bundled into the Worker so a venue page can be server-rendered
  // without a database and without the client downloading a second dataset.
  await writeFile(join(ROOT, "data", "published.json"), JSON.stringify({ builtAt, places: records }));

  const manifestBody = await readFile(join(OUT_DIR, "manifest.json"), "utf8");
  log("");
  log(`  default selections  ${kb(defaultRaw)} raw  ${kb(defaultGz)} gzip`);
  log(`  manifest.json       ${kb(manifestBody.length)} raw`);
  log(`  whole directory     ${kb(JSON.stringify(records).length)} raw`);
  log(`\nPublished ${records.length.toLocaleString("en-GB")} places to public/data/ at ${builtAt}`);
  log("Request-time database reads: 0\n");
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(0)}kB`;
}

main().catch((error) => {
  log(`\nbuild:data failed: ${error instanceof Error ? error.stack ?? error.message : error}\n`);
  process.exitCode = 1;
});
