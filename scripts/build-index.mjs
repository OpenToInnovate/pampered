#!/usr/bin/env node
/**
 * Merge the OpenStreetMap cache and the curated files into one normalised list.
 *
 *   npm run refresh        first, to pull OSM
 *   npm run build:index    this, to merge
 *   npm run sync           then, to push into D1
 *
 * Reads:
 *   data/osm/<selection>.json   one file per selection, written by refresh-osm.mjs
 *   content/places/*.yaml       everything openclaw adds by hand
 * Writes:
 *   data/index.json             gitignored; the input to sync-d1.mjs
 *
 * A curated row always wins over an OSM row for the same place. When a curated
 * row lands within 60 metres of an OSM row with a similar name, the OSM row is
 * suppressed and the suppression is logged, so it is a decision and not an
 * accident. Suppressions are reported, never silent.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  OSM_CACHE_DIR,
  ROOT,
  isoNow,
  loadCuratedPlaces,
  loadRegions,
  loadSelections,
  slugify,
} from "./lib/content.mjs";

const log = (...args) => console.log(...args);

/** Metres. Closer than this with a similar name, and two rows are one place. */
const DUPLICATE_RADIUS_M = 60;

function distMetres(lat1, lon1, lat2, lon2) {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dphi = p2 - p1;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** "The Dog & Duck" and "dog and duck" are the same name. */
function nameTokens(name) {
  return new Set(
    String(name ?? "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((t) => t && t !== "the" && t !== "a"),
  );
}

function namesSimilar(a, b) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.size || !tb.size) return false;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  // Jaccard >= 0.5: "Dog and Duck" vs "Ye Dog and Duck" is 0.75, kept;
  // "Duck Inn" vs "Dog and Duck" is 0.25, kept separate.
  return overlap / (ta.size + tb.size - overlap) >= 0.5;
}

/** Node has lat/lon; ways and relations arrive with a centre from `out center`. */
function elementPoint(el) {
  if (typeof el.lat === "number" && typeof el.lon === "number") return [el.lat, el.lon];
  if (el.center && typeof el.center.lat === "number") return [el.center.lat, el.center.lon];
  return null;
}

function pick(...values) {
  for (const v of values) if (v !== undefined && v !== null && v !== "") return v;
  return null;
}

const KNOWN_DOG = new Set(["yes", "designated", "permitted", "inside", "outside", "leashed", "off_leash", "no"]);

function dogPolicyOf(tags) {
  const raw = tags.dog;
  if (raw == null) return "unknown";
  return KNOWN_DOG.has(raw) ? raw : "unknown";
}

/** Which selections an element's tags satisfy, in selections.yaml order. */
function selectionsFor(tags, selections, fetchedBy) {
  const matched = [];
  for (const sel of selections) {
    const spec = sel.osm;
    if (!spec) continue;
    const branches = spec.any ?? (spec.tags ? [{ tags: spec.tags }] : []);
    const hit = branches.some((branch) =>
      Object.entries(branch.tags ?? {}).every(([key, values]) => {
        const actual = tags[key];
        const list = Array.isArray(values) ? values : [values];
        return actual != null && list.includes(actual);
      }),
    );
    if (hit) matched.push(sel.id);
  }
  // The query that fetched it matched by construction; if local re-evaluation
  // disagrees, trust the query rather than silently dropping the row.
  if (fetchedBy && !matched.includes(fetchedBy)) matched.push(fetchedBy);
  return matched;
}

function osmRow(el, selectionId, selections, osmTimestamp) {
  const tags = el.tags ?? {};
  const point = elementPoint(el);
  if (!point) return { skip: `no coordinates (${el.type}/${el.id})` };

  const name = pick(tags.name, tags.operator);
  const isArea = el.type !== "node";
  const fetchedSelection = selections.find((s) => s.id === selectionId);
  // A pin with no name is noise. An area with no name still draws a shape worth
  // seeing, and a utility layer like water bowls keeps its unnamed taps, so both
  // survive with a null name and the UI falls back to the selection label.
  if (!name && !isArea && !fetchedSelection?.allowUnnamed) {
    return { skip: `no name (${el.type}/${el.id})` };
  }

  const ids = selectionsFor(tags, selections, selectionId);
  if (!ids.length) return { skip: `matched no selection on re-evaluation (${el.type}/${el.id})` };

  const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ") || null;

  // A dog park, an off-lead area and a water bowl are for dogs by definition.
  // OpenStreetMap rarely tags them dog=yes because there is nothing to allow —
  // so when the tags say nothing, the selection says it instead. This is
  // enrichment, not invention: the row still carries its OSM identity and the
  // rule is written here, not hidden.
  let policy = dogPolicyOf(tags);
  if (policy === "unknown") {
    if (ids.includes("off-lead")) policy = "off_leash";
    else if (ids.includes("dog-parks")) policy = "designated";
    else if (ids.includes("water-bowls")) policy = "yes";
  }

  return {
    row: {
      id: `osm:${el.type}/${el.id}`,
      source: "osm",
      verified: false,
      name: name ?? null,
      selections: ids,
      primary: ids[0] ?? null,
      lat: point[0],
      lon: point[1],
      street,
      city: tags["addr:city"] ?? null,
      region: null,
      postcode: tags["addr:postcode"] ?? null,
      phone: pick(tags["contact:phone"], tags.phone),
      website: pick(tags["contact:website"], tags.website),
      instagram: pick(tags["contact:instagram"], tags.instagram),
      image: null,
      opening_hours: tags.opening_hours ?? null,
      dog_policy: policy,
      outdoor_seating: tags.outdoor_seating ?? null,
      wheelchair: tags.wheelchair ?? null,
      cuisine: tags.cuisine ?? null,
      booking_url: null,
      booking_label: null,
      notes: null,
      provenance: `osm:${el.type}/${el.id} @ ${osmTimestamp ?? el.timestamp ?? "unknown"}`,
      osm_updated: el.timestamp ?? null,
      created_at: "",
      updated_at: isoNow(),
    },
  };
}

function curatedRow(place, knownSelectionIds, knownRegionIds) {
  const problems = [];
  const id = /^[a-z0-9][a-z0-9-]*$/.test(place.id ?? "") ? place.id : slugify(place.name ?? "place");
  if (place.source !== "curated" && place.source !== "manual") {
    problems.push(`source must be "curated" or "manual", got ${JSON.stringify(place.source)}`);
  }
  if (place.source === "manual" && place.verified) {
    problems.push("a manual row may not claim verified");
  }
  for (const sel of place.selections ?? []) {
    if (!knownSelectionIds.has(sel)) problems.push(`unknown selection ${JSON.stringify(sel)}`);
  }
  if (place.region && !knownRegionIds.has(place.region)) {
    problems.push(`unknown region ${JSON.stringify(place.region)}`);
  }
  if (typeof place.lat !== "number" || typeof place.lon !== "number") {
    problems.push("lat and lon must both be numbers");
  }
  if (!place.name || typeof place.name !== "string") problems.push("name is required");
  if (problems.length) return { problems: { id, file: place.__file, problems } };

  return {
    row: {
      id,
      source: place.source,
      verified: place.source === "curated" && place.verified === true,
      name: place.name,
      selections: [...(place.selections ?? [])],
      primary: (place.selections ?? [])[0] ?? null,
      lat: place.lat,
      lon: place.lon,
      street: place.street ?? null,
      city: place.city ?? null,
      region: place.region ?? null,
      postcode: place.postcode ?? null,
      phone: place.phone ?? null,
      website: place.website ?? null,
      instagram: place.instagram ?? null,
      image: place.image ?? null,
      opening_hours: place.opening_hours ?? null,
      dog_policy: place.dog_policy ?? "unknown",
      outdoor_seating: place.outdoor_seating ?? null,
      wheelchair: place.wheelchair ?? null,
      cuisine: place.cuisine ?? null,
      booking_url: place.booking?.url ?? null,
      booking_label: place.booking?.label ?? null,
      notes: place.notes ?? null,
      provenance: `${place.__file} @ ${isoNow()}`,
      osm_updated: null,
      created_at: "",
      updated_at: isoNow(),
    },
  };
}

async function main() {
  const { area, selections } = await loadSelections();
  const { regions } = await loadRegions();
  const knownSelectionIds = new Set(selections.map((s) => s.id));
  const knownRegionIds = new Set(regions.map((r) => r.id));

  const builtAt = isoNow();
  const stats = {
    osmElements: 0,
    osmRows: 0,
    osmSkipped: {},
    curated: 0,
    manual: 0,
    curatedErrors: [],
    suppressed: [],
  };

  // ---- OSM ----
  const byIdentity = new Map();
  for (const sel of selections) {
    if (!sel.osm) continue;
    let file;
    try {
      file = JSON.parse(await readFile(join(OSM_CACHE_DIR, `${sel.id}.json`), "utf8"));
    } catch {
      log(`  - ${sel.id}: no cache (run npm run refresh first)`);
      continue;
    }
    for (const el of file.elements ?? []) {
      stats.osmElements++;
      const outcome = osmRow(el, sel.id, selections, file.osmTimestamp);
      if (outcome.skip) {
        const key = outcome.skip.replace(/ \([^)]*\)$/, "");
        stats.osmSkipped[key] = (stats.osmSkipped[key] ?? 0) + 1;
        continue;
      }
      const existing = byIdentity.get(outcome.row.id);
      if (existing) {
        // One element can match several selections. Merge the selection lists
        // rather than emitting the row twice.
        existing.selections = [...new Set([...existing.selections, ...outcome.row.selections])];
        existing.primary = existing.selections[0] ?? null;
      } else {
        byIdentity.set(outcome.row.id, outcome.row);
        stats.osmRows++;
      }
    }
  }

  // ---- curated ----
  const curated = await loadCuratedPlaces();
  for (const place of curated) {
    const outcome = curatedRow(place, knownSelectionIds, knownRegionIds);
    if (outcome.problems) {
      stats.curatedErrors.push(outcome.problems);
      continue;
    }
    const row = outcome.row;
    stats[row.source]++;

    // A curated row about a place OSM already knows suppresses the OSM row.
    // The check is deliberately conservative: 60 metres and a real name overlap,
    // because two different pubs on the same street are not the same pub.
    for (const [id, osm] of byIdentity) {
      if (osm.source !== "osm") continue;
      if (distMetres(row.lat, row.lon, osm.lat, osm.lon) > DUPLICATE_RADIUS_M) continue;
      if (!row.name || !osm.name || !namesSimilar(row.name, osm.name)) continue;
      byIdentity.delete(id);
      stats.suppressed.push({ curated: row.id, osm: id, osmName: osm.name });
      stats.osmRows--;
    }
    byIdentity.set(row.id, row);
  }

  const places = [...byIdentity.values()];
  await mkdir(join(ROOT, "data"), { recursive: true });
  await writeFile(
    join(ROOT, "data", "index.json"),
    JSON.stringify({ builtAt, area, stats, places }),
  );

  log(`\nBuilt data/index.json at ${builtAt}`);
  log(`  OSM: ${stats.osmElements.toLocaleString("en-GB")} elements -> ${stats.osmRows.toLocaleString("en-GB")} rows`);
  for (const [reason, n] of Object.entries(stats.osmSkipped)) log(`    skipped: ${reason} (${n})`);
  log(`  curated: ${stats.curated}, manual: ${stats.manual}`);
  if (stats.curatedErrors.length) {
    log(`  ERRORS in content/places/:`);
    for (const err of stats.curatedErrors) {
      log(`    ${err.file} / ${err.id}: ${err.problems.join("; ")}`);
    }
  }
  if (stats.suppressed.length) {
    log(`  suppressed OSM duplicates: ${stats.suppressed.length}`);
    for (const s of stats.suppressed.slice(0, 20)) log(`    ${s.osm} (${s.osmName}) <- ${s.curated}`);
  }
  log(`\nTotal: ${places.length.toLocaleString("en-GB")} places. Next: npm run sync\n`);

  if (stats.curatedErrors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`\nbuild:index failed: ${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
});