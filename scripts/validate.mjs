#!/usr/bin/env node
/**
 * The linter, run by `npm run check` alongside `tsc --noEmit`.
 *
 * TypeScript checks the code. This checks the content, because the content is
 * half the product and it is edited by hand. Everything it refuses is something
 * that would otherwise fail silently: a typo'd selection id that makes a venue
 * vanish, a colour a quarter of visitors cannot distinguish, a "verified" badge
 * on a row nobody checked.
 *
 * It exits non-zero on the first hard error. Warnings are printed and let
 * through, because a warning that blocks the build gets deleted, and a warning
 * that gets read gets fixed.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, loadCuratedPlaces, loadRegions, loadSelections, loadVets } from "./lib/content.mjs";

const errors = [];
const warnings = [];
const fail = (where, message) => errors.push(`${where}: ${message}`);
const warn = (where, message) => warnings.push(`${where}: ${message}`);

/* ------------------------------------------------------------------ colour */

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
};
const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (rgb) => {
  const [r, g, b] = rgb.map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG contrast of a colour against the map land. The map is the background
    the pins sit on, so a colour that passes here is visible where it matters. */
const contrastVsMap = (hex) => {
  const map = luminance(hexToRgb("#f2f0ec"));
  const ink = luminance(hexToRgb(hex));
  const [hi, lo] = ink > map ? [ink, map] : [map, ink];
  return (hi + 0.05) / (lo + 0.05);
};

function rgbToLab(rgb) {
  let [r, g, b] = rgb.map(linear);
  let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  let y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  [x, y, z] = [f(x), f(y), f(z)];
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const deltaE = (a, b) => {
  const A = rgbToLab(hexToRgb(a));
  const B = rgbToLab(hexToRgb(b));
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
};

/* -------------------------------------------------------------- selections */

const KNOWN_DOG = new Set([
  "yes",
  "designated",
  "permitted",
  "inside",
  "outside",
  "leashed",
  "off_leash",
  "unleashed",
  "no",
  "unknown",
]);

async function iconNames() {
  const text = await readFile(join(ROOT, "src", "map", "icons.tsx"), "utf8");
  const match = /ICON_NAMES = \[([\s\S]*?)\] as const/.exec(text);
  if (!match) {
    fail("src/map/icons.tsx", "could not find ICON_NAMES; the icon check is blind");
    return new Set();
  }
  return new Set([...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
}

function checkOsmSpec(where, spec, index) {
  if (!spec || typeof spec !== "object") return fail(where, "osm must be a mapping");
  const branches = spec.any ?? (spec.tags ? [{ tags: spec.tags }] : []);
  if (!Array.isArray(branches) || !branches.length) {
    return fail(where, "osm needs `tags` or a non-empty `any` list");
  }
  if (index === "any" && !Array.isArray(spec.any)) return;
  branches.forEach((branch, i) => {
    const at = `${where} (branch ${i})`;
    if (!branch || typeof branch !== "object" || !branch.tags || typeof branch.tags !== "object") {
      return fail(at, "each branch needs a `tags` mapping");
    }
    for (const [key, values] of Object.entries(branch.tags)) {
      if (!key || typeof key !== "string") fail(at, "tag keys must be non-empty strings");
      const list = Array.isArray(values) ? values : [values];
      if (!list.length) fail(at, `tag ${key} has no values`);
      for (const v of list) {
        if (typeof v !== "string" || !v.length) fail(at, `tag ${key} has an empty value`);
      }
      if (key === "dog") {
        for (const v of list) {
          if (!KNOWN_DOG.has(v)) fail(at, `unknown dog value ${JSON.stringify(v)}`);
        }
      }
    }
  });
}

async function checkSelections(file) {
  const where = "content/selections.yaml";
  if (file.version !== 1) fail(where, `version is ${file.version}, expected 1`);

  const bbox = file.area?.bbox;
  if (
    !Array.isArray(bbox) ||
    bbox.length !== 4 ||
    bbox.some((v) => typeof v !== "number" || !Number.isFinite(v))
  ) {
    fail(where, "area.bbox must be [south, west, north, east] numbers");
  } else {
    const [s, w, n, e] = bbox;
    if (!(s < n && w < e)) fail(where, "area.bbox must satisfy south < north and west < east");
    if (s < -90 || n > 90 || w < -180 || e > 180) fail(where, "area.bbox is outside the planet");
  }

  const groups = new Set((file.groups ?? []).map((g) => g.id));
  if (!groups.size) fail(where, "no groups declared");

  const icons = await iconNames();
  const ids = new Set();
  const colours = [];

  for (const sel of file.selections ?? []) {
    const at = `${where} / ${sel.id ?? "(no id)"}`;
    if (!sel.id || typeof sel.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(sel.id)) {
      fail(at, "id must be a lowercase hyphenated slug");
      continue;
    }
    if (ids.has(sel.id)) fail(at, "duplicate id");
    ids.add(sel.id);

    if (!sel.label || typeof sel.label !== "string") fail(at, "label is required");
    if (!sel.short || sel.short.length > 12) fail(at, "short must be present and fit on a phone chip");
    if (!groups.has(sel.group)) fail(at, `unknown group ${JSON.stringify(sel.group)}`);
    if (!icons.has(sel.icon)) fail(at, `unknown icon ${JSON.stringify(sel.icon)}`);

    if (!/^#[0-9a-fA-F]{6}$/.test(sel.colour ?? "")) {
      fail(at, "colour must be #RRGGBB");
    } else {
      const ratio = contrastVsMap(sel.colour);
      // 4.5:1 is the text standard and pins are smaller than text, so this is
      // the floor, not the aspiration. Darken the colour; do not delete this.
      if (ratio < 4.5) fail(at, `colour ${sel.colour} is ${ratio.toFixed(2)}:1 against the map, needs 4.5:1`);
      colours.push([sel.id, sel.colour]);
    }

    if (sel.default !== undefined && typeof sel.default !== "boolean") {
      fail(at, "default must be true or false when present");
    }
    if (typeof sel.minzoom !== "number" || sel.minzoom < 2 || sel.minzoom > 19) {
      fail(at, "minzoom must be a zoom level between 2 and 19");
    }
    if (!sel.blurb || typeof sel.blurb !== "string") fail(at, "blurb is required");
    if (sel.osm) checkOsmSpec(at, sel.osm, "root");
  }

  if (![...(file.selections ?? [])].some((s) => s.default)) {
    fail(where, "at least one selection must be default, or first-time visitors see an empty map");
  }

  // Two selections whose colours a colour-blind visitor cannot tell apart are
  // one selection with two names. 15 ΔE is generous; the palette was built at 20+.
  for (let i = 0; i < colours.length; i++) {
    for (let j = i + 1; j < colours.length; j++) {
      const d = deltaE(colours[i][1], colours[j][1]);
      if (d < 15) warn(where, `${colours[i][0]} and ${colours[j][0]} are ${d.toFixed(1)} ΔE apart`);
    }
  }

  // Every dog value a query can match must have a label, or the UI invents one.
  const labels = new Set(Object.keys(file.dogPolicy ?? {}));
  for (const sel of file.selections ?? []) {
    const spec = sel.osm;
    if (!spec) continue;
    const branches = spec.any ?? (spec.tags ? [{ tags: spec.tags }] : []);
    for (const branch of branches) {
      for (const v of branch.tags?.dog ?? []) {
        if (!labels.has(v)) fail(where, `dog value ${JSON.stringify(v)} has no label in dog_policy`);
      }
    }
  }

  return ids;
}

/* ----------------------------------------------------------------- regions */

async function checkRegions(file) {
  const where = "content/regions.yaml";
  if (file.version !== 1) fail(where, `version is ${file.version}, expected 1`);
  const ids = new Set();
  for (const r of file.regions ?? []) {
    const at = `${where} / ${r.id ?? "(no id)"}`;
    if (!r.id || !/^[a-z0-9][a-z0-9-]*$/.test(r.id)) fail(at, "id must be a lowercase hyphenated slug");
    else if (ids.has(r.id)) fail(at, "duplicate id");
    else ids.add(r.id);
    if (!r.label) fail(at, "label is required");
    const [lon, lat] = r.centre ?? [];
    if (typeof lon !== "number" || typeof lat !== "number" || Math.abs(lat) > 85.1) {
      fail(at, "centre must be [lon, lat] with a sane latitude");
    }
    if (typeof r.zoom !== "number" || r.zoom < 2 || r.zoom > 19) fail(at, "zoom must be 2–19");
  }
  if (!ids.size) warn(where, "no regions; the jump list will be empty");
  return ids;
}

/* ------------------------------------------------------------------ places */

async function checkPlaces(selectionIds, regionIds) {
  const curated = await loadCuratedPlaces();
  if (!curated.length) {
    warn("content/places/", "no curated rows; the site runs on OSM alone");
    return;
  }
  const ids = new Set();
  for (const place of curated) {
    const at = `content/places/${place.__file} / ${place.id ?? "(no id)"}`;
      if (!place.id || !/^[a-z0-9][a-z0-9-]*$/.test(place.id)) {
        fail(at, "id must be a lowercase hyphenated slug");
        continue;
      }
      if (ids.has(place.id)) fail(at, "duplicate id across content/places/");
      ids.add(place.id);
      if (!place.name) fail(at, "name is required");
      if (place.source !== "curated" && place.source !== "manual") {
        fail(at, `source must be "curated" or "manual", got ${JSON.stringify(place.source)}`);
      }
      if (place.source === "manual" && place.verified) {
        fail(at, "a manual row may not claim verified. Check it, or leave the badge off.");
      }
      if (place.source === "curated" && !place.notes) {
        warn(at, "a curated row with no notes is a name on a pin and nothing more");
      }
      if (!Array.isArray(place.selections) || !place.selections.length) {
        fail(at, "selections must be a non-empty list");
      } else {
        for (const sel of place.selections) {
          if (!selectionIds.has(sel)) fail(at, `unknown selection ${JSON.stringify(sel)}`);
        }
      }
      if (typeof place.lat !== "number" || Math.abs(place.lat) > 85.1) fail(at, "lat must be a number");
      if (typeof place.lon !== "number" || Math.abs(place.lon) > 180) fail(at, "lon must be a number");
      if (place.region && !regionIds.has(place.region)) fail(at, `unknown region ${JSON.stringify(place.region)}`);
      if (place.dog_policy && !KNOWN_DOG.has(place.dog_policy)) {
        fail(at, `unknown dog_policy ${JSON.stringify(place.dog_policy)}`);
      }
      if (place.booking && (!place.booking.url || typeof place.booking.url !== "string")) {
        fail(at, "booking needs a url");
      }
  }
}

/* -------------------------------------------------------------------- tube */

/**
 * The tube file is a committed build output, so a stale or hand-edited copy is
 * possible. It is a landmark layer, not the directory, but a half-joined tube
 * map is still a lie about where stations are, so the same rules apply.
 */
async function checkTube() {
  const path = join(ROOT, "public", "data", "tube.json");
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    warn("public/data/tube.json", "missing; run npm run refresh:tube (map shows no roundels)");
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    fail("public/data/tube.json", "not valid JSON");
    return;
  }

  const lines = Array.isArray(data.lines) ? data.lines : [];
  const stations = Array.isArray(data.stations) ? data.stations : [];
  if (stations.length < 200) fail("public/data/tube.json", `only ${stations.length} stations (expected 200+)`);
  if (lines.length < 10) fail("public/data/tube.json", `only ${lines.length} lines (expected 10+)`);

  const lineIds = new Set();
  for (const [i, line] of lines.entries()) {
    const at = `tube line ${i}`;
    if (!line || typeof line.id !== "string" || !line.id) fail(at, "needs an id");
    else if (lineIds.has(line.id)) fail(at, `duplicate id ${JSON.stringify(line.id)}`);
    else lineIds.add(line.id);
    if (!line || typeof line.name !== "string" || !line.name) fail(at, "needs a name");
    if (!line || typeof line.colour !== "string" || !/^#[0-9a-f]{6}$/i.test(line.colour)) {
      fail(at, `colour must be #rrggbb, got ${JSON.stringify(line?.colour)}`);
    }
  }

  // Some names are legitimately borne by two stations — Canary Wharf, Shadwell
  // — so a duplicate name is only an error when the coordinates agree too,
  // which means the join failed to split genuinely different stations.
  const names = new Map(); // name -> lat/lon of the first entry
  for (const [i, station] of stations.entries()) {
    const at = `tube station ${i}`;
    if (!station || typeof station.name !== "string" || !station.name) fail(at, "needs a name");
    else if (names.has(station.name)) {
      const first = names.get(station.name);
      const apart =
        typeof station.lat === "number" &&
        (Math.abs(first.lat - station.lat) > 0.0003 ||
          Math.abs(first.lon - station.lon) > 0.0003);
      if (!apart) fail(at, `duplicate station ${JSON.stringify(station.name)} at the same spot`);
      else warn("public/data/tube.json", `station name ${JSON.stringify(station.name)} is shared by two stations`);
    } else {
      names.set(station.name, { lat: station.lat, lon: station.lon });
    }
    if (typeof station?.lat !== "number" || station.lat < 51.2 || station.lat > 51.8) {
      fail(at, `lat ${JSON.stringify(station?.lat)} is outside London`);
    }
    if (typeof station?.lon !== "number" || station.lon < -0.75 || station.lon > 0.4) {
      fail(at, `lon ${JSON.stringify(station?.lon)} is outside London`);
    }
    const stationLines = Array.isArray(station?.lines) ? station.lines : [];
    if (!stationLines.length) fail(at, "has no lines");
    for (const id of stationLines) {
      if (!lineIds.has(id)) fail(at, `unknown line ${JSON.stringify(id)}`);
    }
    if (station?.primary && !stationLines.includes(station.primary)) {
      fail(at, `primary ${JSON.stringify(station.primary)} is not one of its lines`);
    }
  }
}

/* --------------------------------------------------------------------- vets */

async function checkVets() {
  const { policy, vets } = await loadVets();
  if (!policy?.disclosure) fail("content/vets.yaml", "policy.disclosure is required");
  if (!policy?.ranking) fail("content/vets.yaml", "policy.ranking is required");
  if (!vets.length) warn("content/vets.yaml", "no providers listed");

  const ids = new Set();
  const colours = new Map();
  for (const vet of vets) {
    const at = `content/vets.yaml: ${vet.id ?? "(no id)"}`;
    if (!vet.id || !/^[a-z0-9-]+$/.test(vet.id)) fail(at, "id must be a lowercase slug");
    else if (ids.has(vet.id)) fail(at, "duplicate id");
    else ids.add(vet.id);
    if (!vet.name) fail(at, "name is required");

    if (!/^#[0-9a-f]{6}$/i.test(vet.colour ?? "")) {
      fail(at, "colour must be a 6-digit hex");
    } else {
      // The sponsor colour is text (the wordmark), so it must clear 4.5:1
      // against the surface it sits on. Unlike map selections, two providers
      // may share a near-identical blue — they are never drawn side by side.
      const ratio = contrastVsMap(vet.colour);
      if (ratio < 4.5) fail(at, `colour ${vet.colour} is ${ratio.toFixed(2)}:1 against the map, needs 4.5:1`);
    }

    for (const key of ["plan_url", "website"]) {
      const url = vet[key];
      if (url != null && !/^https:\/\//.test(url)) fail(at, `${key} must be an https URL`);
    }
    if (vet.logo != null && !/^\//.test(vet.logo)) fail(at, "logo must be a path under public/");
    if (!Array.isArray(vet.match) || !vet.match.length) fail(at, "match must list at least one fragment");
    if (vet.confirmed !== true) {
      warn(at, "unconfirmed: colour, links and logo need sign-off before this sponsor card is published");
    }
  }
  if (!vets.some((v) => v.sponsor === true)) {
    warn("content/vets.yaml", "no provider is marked sponsor: true yet");
  }
  return ids;
}

/* -------------------------------------------------------------------- main */

async function main() {
  const selectionsFile = await loadSelections();
  const selectionIds = await checkSelections(selectionsFile);
  const { regions } = await loadRegions();
  const regionIds = await checkRegions({ version: 1, regions });
  await checkPlaces(selectionIds, regionIds);
  await checkTube();
  await checkVets();

  for (const w of warnings) console.log(`warning: ${w}`);
  if (errors.length) {
    console.log("");
    for (const e of errors) console.log(`error: ${e}`);
    console.log(`\n${errors.length} error(s), ${warnings.length} warning(s). Fix the errors; read the warnings.\n`);
    process.exitCode = 1;
  } else {
    console.log(`content ok (${selectionIds.size} selections, ${regionIds.size} regions, ${warnings.length} warning(s))\n`);
  }
}

main().catch((error) => {
  console.error(`\nvalidate failed: ${error instanceof Error ? error.stack ?? error.message : error}\n`);
  process.exitCode = 1;
});