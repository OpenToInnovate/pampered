#!/usr/bin/env node
/**
 * Pull London Underground stations and the lines that serve them, and publish
 * them as a static asset for the map.
 *
 * Why this is not a selection: a selection is a dog-friendly filter, and a tube
 * station is not a place you take a dog. It is a landmark — context on the map —
 * so it has its own small pipeline and never appears in the chips, the D1
 * filter or the Overpass refresh for venues.
 *
 * The basemap's OpenMapTiles `poi` layer only carries `class=rail` and a coarse
 * `subclass`; it knows nothing about line names or colours. Per-line colours
 * therefore come from OSM `route=subway` relations, which do carry `ref` and
 * `colour`, joined to station nodes by proximity to their stop positions.
 *
 * Honesty rules, same as everywhere else:
 *   - every station and line says it came from OpenStreetMap;
 *   - colours are the official TfL line colours, keyed by line, because OSM's
 *     relation colours drift (Central is #e42313 there, #E32017 at TfL);
 *   - if the join produces too few stations, this fails and publishes nothing
 *     rather than shipping a half-drawn tube map.
 *
 *   npm run refresh:tube
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, overpass, isoNow } from "./lib/content.mjs";

/** A little wider than Greater London: Amersham and Chesham are tube stations
    outside the boundary, and Heathrow sits on the western edge. */
const BBOX = [51.25, -0.7, 51.75, 0.36]; // south, west, north, east
const OUT = join(ROOT, "public", "data", "tube.json");
const CACHE = join(ROOT, "data", "osm", "tube.json");

/** Tried in order. mail.ru leads because the public primary is routinely at
    capacity and this query is large enough to be refused rather than queued. */
const ENDPOINTS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

/** Official TfL line colours, in the order the Tube map lists them. */
const LINES = [
  { id: "bakerloo", name: "Bakerloo", colour: "#B36305" },
  { id: "central", name: "Central", colour: "#E32017" },
  { id: "circle", name: "Circle", colour: "#FFD300" },
  { id: "district", name: "District", colour: "#00782A" },
  { id: "hammersmith-city", name: "Hammersmith & City", colour: "#F3A9BB" },
  { id: "jubilee", name: "Jubilee", colour: "#A0A5A9" },
  { id: "metropolitan", name: "Metropolitan", colour: "#9B0056" },
  { id: "northern", name: "Northern", colour: "#000000" },
  { id: "piccadilly", name: "Piccadilly", colour: "#003688" },
  { id: "victoria", name: "Victoria", colour: "#0098D4" },
  { id: "waterloo-city", name: "Waterloo & City", colour: "#95CDBA" },
];

const LINE_BY_ALIAS = new Map();
for (const line of LINES) {
  LINE_BY_ALIAS.set(line.id, line);
  LINE_BY_ALIAS.set(line.name.toLowerCase(), line);
}
// OSM spells these two both ways.
LINE_BY_ALIAS.set("hammersmith and city", LINE_BY_ALIAS.get("hammersmith-city"));
LINE_BY_ALIAS.set("waterloo and city", LINE_BY_ALIAS.get("waterloo-city"));

function lineOf(ref) {
  if (!ref) return null;
  const key = String(ref)
    .toLowerCase()
    .replace(/\s+line\b.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return LINE_BY_ALIAS.get(key) ?? null;
}

const log = (...args) => console.log(...args);

async function run(query, label) {
  let lastError;
  for (const endpoint of ENDPOINTS) {
    try {
      log(`  ${label} via ${new URL(endpoint).host}…`);
      const json = await overpass(query, endpoint, undefined, 300_000);
      if (!json?.elements) throw new Error("no elements in response");
      return json;
    } catch (error) {
      lastError = error;
      log(`    failed: ${error instanceof Error ? error.message : error}`);
    }
  }
  throw lastError ?? new Error(`${label} failed on every endpoint`);
}

const [S, W, N, E] = BBOX;
const bbox = `(${S},${W},${N},${E})`;

const STATION_QUERY = `[out:json][timeout:280];
(
  nwr["railway"="station"]["station"="subway"]${bbox};
  nwr["railway"="station"]["subway"="yes"]${bbox};
  nwr["railway"="station"]["network"~"London Underground",i]${bbox};
  nwr["railway"="station"]["operator"~"London Underground",i]${bbox};
  nwr["public_transport"="station"]["subway"="yes"]${bbox};
);
out center tags;`;

const ROUTE_QUERY = `[out:json][timeout:280];
relation["route"="subway"]${bbox};
out body;
>;
out skel qt;`;

// The route query's recursive `out skel` yields member nodes bare — ids and
// coords, no tags — so a stop position's own name is invisible there. This
// second query fetches the stop nodes with tags. London stops are tagged in
// two schemes — the older `railway=stop` and the newer
// `public_transport=stop_position`, often with no railway tag at all — and a
// query for either alone silently misses half of them.
const STOP_QUERY = `[out:json][timeout:280];
(
  node["railway"~"^stop"]${bbox};
  node["public_transport"="stop_position"]${bbox};
);
out body;`;

function normName(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/\b(underground|tube|dlr|rail|station)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function haversine(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function coordOf(el) {
  if (typeof el.lat === "number" && typeof el.lon === "number") return [el.lat, el.lon];
  if (el.center && typeof el.center.lat === "number") return [el.center.lat, el.center.lon];
  return null;
}

function buildStations(stationJson) {
  const byName = new Map();
  for (const el of stationJson.elements ?? []) {
    const name = el.tags?.name;
    const coord = coordOf(el);
    if (!name || !coord) continue;
    const key = normName(name);
    if (!key) continue;
    const existing = byName.get(key);
    if (existing) {
      // Two nodes for one station (Underground and National Rail). Keep the
      // first, remember the alias so a line join by either name still lands.
      existing.aliases.add(name);
      continue;
    }
    byName.set(key, {
      id: `osm:${el.type}/${el.id}`,
      name,
      aliases: new Set([name]),
      lat: coord[0],
      lon: coord[1],
      lines: new Set(),
    });
  }
  return byName;
}

function buildNodeCoords(routeJson) {
  const nodes = new Map();
  for (const el of routeJson.elements ?? []) {
    if (el.type === "node" && typeof el.lat === "number" && typeof el.lon === "number") {
      nodes.set(el.id, [el.lat, el.lon]);
    }
  }
  return nodes;
}

/**
 * Attach lines to stations, name first and distance second:
 *
 *   1. the stop member IS a station node — the strongest evidence there is;
 *   2. the stop position is named and the name matches a station;
 *   3. the stop position is named but unmatched — fall back to proximity,
 *      because spellings drift ("King's Cross" vs "King's Cross St Pancras");
 *   4. an unnamed stop position is skipped and counted, never joined by
 *      distance alone: a node that asserts nothing cannot lend its position
 *      to a line.
 */
function joinLines(routeJson, stationsByName, stopJson) {
  const nodeCoords = buildNodeCoords(routeJson);

  // Station nodes, keyed by raw OSM id, for rule 1.
  const stationNodeIds = new Set();
  for (const station of stationsByName.values()) {
    const match = /^osm:node\/(\d+)$/.exec(station.id);
    if (match) stationNodeIds.add(Number(match[1]));
  }

  // Stop-position names, keyed by raw OSM id, for rules 2 and 3.
  const stopNames = new Map();
  for (const el of stopJson.elements ?? []) {
    const key = normName(el.tags?.name);
    if (key) stopNames.set(el.id, key);
  }

  const stations = [...stationsByName.values()];
  let stops = 0;
  let byStationNode = 0;
  let byName = 0;
  let byProximity = 0;
  let skippedUnnamed = 0;

  for (const rel of routeJson.elements ?? []) {
    if (rel.type !== "relation") continue;
    if (rel.tags?.route !== "subway") continue;
    const line = lineOf(rel.tags?.ref) ?? lineOf(rel.tags?.name);
    if (!line) continue;
    for (const member of rel.members ?? []) {
      if (member.type !== "node" || !String(member.role ?? "").startsWith("stop")) continue;
      stops++;

      const stationForNode = (ref) => {
        if (stationNodeIds.has(ref)) return "station-node";
        const nameKey = stopNames.get(ref);
        if (nameKey == null) return null; // unnamed: never joined by distance
        if (stationsByName.has(nameKey)) return "name";
        return "proximity";
      };
      const rule = stationForNode(member.ref);

      let best = null;
      if (rule === "station-node") {
        best = stations.find((s) => {
          const m = /^osm:node\/(\d+)$/.exec(s.id);
          return m && Number(m[1]) === member.ref;
        });
        if (best) byStationNode++;
      } else if (rule === "name") {
        best = stationsByName.get(stopNames.get(member.ref)) ?? null;
        if (best) byName++;
      } else if (rule === "proximity") {
        const coord = nodeCoords.get(member.ref);
        if (!coord) continue;
        let bestDistance = 400; // metres; a stop position can sit at the platform end
        for (const station of stations) {
          const d = haversine(coord, [station.lat, station.lon]);
          if (d < bestDistance) {
            bestDistance = d;
            best = station;
          }
        }
        if (best) byProximity++;
      } else {
        skippedUnnamed++;
        continue;
      }
      if (best) best.lines.add(line.id);
    }
  }
  log(
    `  ${stops} stop positions: ${byStationNode} via station node, ${byName} by name, ` +
      `${byProximity} named by proximity, ${skippedUnnamed} unnamed skipped`,
  );
  return stations;
}

async function main() {
  const stationJson = await run(STATION_QUERY, "stations");
  const stopJson = await run(STOP_QUERY, "stop positions");
  const routeJson = await run(ROUTE_QUERY, "routes");

  const stationsByName = buildStations(stationJson);
  const joined = joinLines(routeJson, stationsByName, stopJson);

  const order = new Map(LINES.map((line, i) => [line.id, i]));
  const stations = joined
    .filter((s) => s.lines.size > 0)
    .map((s) => {
      const lines = [...s.lines].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
      return {
        id: s.id,
        name: s.name,
        lat: Number(s.lat.toFixed(5)),
        lon: Number(s.lon.toFixed(5)),
        lines,
        primary: lines[0],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const usedLines = new Set(stations.flatMap((s) => s.lines));
  const data = {
    builtAt: isoNow(),
    source: "OpenStreetMap via Overpass (ODbL); colours from TfL",
    bbox: BBOX,
    lines: LINES.filter((line) => usedLines.has(line.id)),
    stations,
  };

  // Fail loudly. A tube map missing most of its stations is worse than none:
  // the reader cannot tell a data gap from a line that genuinely has no stops.
  if (stations.length < 200) {
    throw new Error(
      `only ${stations.length} stations joined (expected 200+); refusing to publish a partial tube map`,
    );
  }
  if (usedLines.size < 10) {
    throw new Error(`only ${usedLines.size} lines resolved (expected 10+); refusing to publish`);
  }
  for (const station of stations) {
    if (!station.lines.length) throw new Error(`${station.name} has no line`);
  }

  const body = `${JSON.stringify(data, null, 2)}\n`;
  await mkdir(join(ROOT, "data", "osm"), { recursive: true });
  await writeFile(OUT, body);
  await writeFile(CACHE, body);

  const perLine = {};
  for (const s of stations) for (const l of s.lines) perLine[l] = (perLine[l] ?? 0) + 1;
  log(`\nPublished ${stations.length} tube stations across ${usedLines.size} lines to public/data/tube.json`);
  for (const line of data.lines) log(`  ${line.name.padEnd(20)} ${String(perLine[line.id] ?? 0).padStart(4)} stations  ${line.colour}`);
}

main().catch((error) => {
  console.error(`\nrefresh:tube failed: ${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
});
