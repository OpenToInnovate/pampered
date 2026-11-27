#!/usr/bin/env node
/**
 * Pull London's railway stations and the lines that serve them, and publish
 * them as a static asset for the map.
 *
 * Why this is not a selection: a selection is a dog-friendly filter, and a
 * station is not a place you take a dog. It is a landmark — context on the map —
 * so it has its own small pipeline and never appears in the chips, the D1
 * filter or the Overpass refresh for venues.
 *
 * The basemap's OpenMapTiles `poi` layer only carries `class=rail` and a coarse
 * `subclass`; it knows nothing about line names or colours. Those come from OSM
 * route relations, which do carry `ref`, `name` and `colour`:
 *
 *   - London Underground   `route=subway` + `network=London Underground`;
 *   - London Overground    `route=train` + `operator=Transport for London`;
 *   - Elizabeth line       `route=train` + `name` starting "Elizabeth line";
 *   - DLR                  `route=light_rail` + `network=Docklands Light...`.
 *
 * National Rail termini have no route relations of their own to piggyback on,
 * so the major ones are taken from the terminus belt in the middle of town:
 * a station that joined no TfL route but sits inside `CENTRAL_BBOX` gets the
 * National Rail double arrow. Suburban NR stations stay unmarked — the point
 * is landmarks, not every platform on the network.
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

/** Where National Rail gets a landmark symbol. Zone 1 plus a little slack:
    the termini, the Thameslink spine and Waterloo East, but not the suburbs —
    the southern floor sits just above South Bermondsey, which is a through
    station on the outer edge of town however you spell it. */
const CENTRAL_BBOX = [51.489, -0.215, 51.535, 0.02];

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

/** The other networks a landmark can belong to. Each gets one roundel in the
    network's own colour — the sub-lines Overground named in 2024 are data
    here, not icons, because a roundel has room for one colour. National Rail
    renders as the double arrow, not a roundel. */
const NETWORKS = [
  { id: "overground", name: "London Overground", colour: "#EE7C0E" },
  { id: "elizabeth", name: "Elizabeth line", colour: "#6950A1" },
  { id: "dlr", name: "Docklands Light Railway", colour: "#00AFAD" },
  { id: "rail", name: "National Rail", colour: "#DC241F" },
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

/** Which network (line id) a non-Underground route relation belongs to. The
    selectors are deliberately narrower than "everything in London" — a
    Chiltern or Southeastern route must not dress a station in Overground
    orange. */
function networkOf(rel) {
  const t = rel.tags ?? {};
  if (t.route === "light_rail" || /docklands/i.test(t.network ?? "")) return "dlr";
  if (/^elizabeth/i.test(String(t.name ?? ""))) return "elizabeth";
  if (t.route === "train" && t.operator === "Transport for London") return "overground";
  return null;
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

/** Every railway station, not only Underground ones: DLR and Elizabeth line
    stations are plain `railway=station`, and the National Rail termini have
    nothing `subway`-shaped about them at all. What keeps the count sane is
    the join later — an unjoined suburban NR station is simply dropped. */
const STATION_QUERY = `[out:json][timeout:280];
nwr["railway"="station"]${bbox};
out center tags;`;

const ROUTE_QUERY = `[out:json][timeout:280];
relation["route"="subway"]${bbox};
out body;
>;
out skel qt;`;

const NETWORK_ROUTE_QUERY = `[out:json][timeout:280];
(
  relation["route"="train"]["operator"="Transport for London"]${bbox};
  relation["route"="train"]["name"~"^Elizabeth line"]${bbox};
  relation["route"="light_rail"]["network"~"Docklands Light Railway"]${bbox};
);
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

/**
 * One entry per physical station. London has station pairs that share a name
 * but not a location — the DLR and Elizabeth line Canary Wharfs, Shadwell's
 * two halves, Shepherd's Bush twice — and each deserves its own mark, so
 * entries are only merged when the name AND the coordinates agree. Nodes win
 * over ways: a station way's centre can sit between platforms.
 */
function buildStations(stationJson) {
  const stations = [];
  const byName = new Map(); // normalised name -> station[]
  const elements = [...(stationJson.elements ?? [])].filter(
    (el) => el.tags?.name && coordOf(el),
  );
  elements.sort((a, b) => (a.type === "node" ? 0 : 1) - (b.type === "node" ? 0 : 1));
  for (const el of elements) {
    const name = el.tags.name;
    const [lat, lon] = coordOf(el);
    const key = normName(name);
    if (!key) continue;
    const identity = `${el.tags.network ?? ""} ${el.tags.operator ?? ""}`;
    // Only a station whose own tags claim the national network may wear the
    // double arrow; without this a TfL platforms node that failed to join
    // would be dressed up as a National Rail terminus.
    const nr = /national rail|network rail/i.test(identity);
    const twins = byName.get(key) ?? [];
    const twin = twins.find((s) => haversine([lat, lon], [s.lat, s.lon]) < 80);
    if (twin) {
      // The same station mapped twice (node plus way, say). One entry; the
      // name stays an alias so a stop join by either spelling still lands,
      // and a twin that claimed the national network keeps that claim.
      twin.aliases.add(key);
      twin.nr = twin.nr || nr;
      continue;
    }
    const station = {
      id: `osm:${el.type}/${el.id}`,
      name,
      aliases: new Set([key]),
      lat,
      lon,
      nr,
      lines: new Set(),
    };
    stations.push(station);
    twins.push(station);
    byName.set(key, twins);
  }
  return { stations, byName };
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
 *   2. the stop position is named and the name matches a station — nearest
 *      match when a name covers two stations (Canary Wharf's two halves);
 *   3. the stop position is named but unmatched — fall back to proximity,
 *      because spellings drift ("King's Cross" vs "King's Cross St Pancras");
 *   4. an unnamed stop position is skipped and counted, never joined by
 *      distance alone: a node that asserts nothing cannot lend its position
 *      to a line.
 *
 * `lineForRelation` maps a relation to a line id, or null to skip it; that is
 * what keeps Chiltern Railways out of the Underground's colours.
 */
function joinRoutes(routeJson, stationIndex, stopJson, lineForRelation, label) {
  const nodeCoords = buildNodeCoords(routeJson);
  const { stations, byName } = stationIndex;

  // Station nodes, keyed by raw OSM id, for rule 1.
  const stationNodeIds = new Set();
  for (const station of stations) {
    const match = /^osm:node\/(\d+)$/.exec(station.id);
    if (match) stationNodeIds.add(Number(match[1]));
  }

  // Stop-position names, keyed by raw OSM id, for rules 2 and 3.
  const stopNames = new Map();
  for (const el of stopJson.elements ?? []) {
    const key = normName(el.tags?.name);
    if (key) stopNames.set(el.id, key);
  }

  const nearest = (candidates, coord) => {
    if (!candidates.length || !coord) return null;
    let best = null;
    let bestDistance = Infinity;
    for (const station of candidates) {
      const d = haversine(coord, [station.lat, station.lon]);
      if (d < bestDistance) {
        bestDistance = d;
        best = station;
      }
    }
    return best;
  };

  let stops = 0;
  let stationNodeJoins = 0;
  let nameJoins = 0;
  let proximityJoins = 0;
  let skippedUnnamed = 0;
  let skippedRelations = 0;

  for (const rel of routeJson.elements ?? []) {
    if (rel.type !== "relation") continue;
    const line = lineForRelation(rel);
    if (!line) {
      skippedRelations++;
      continue;
    }
    for (const member of rel.members ?? []) {
      if (member.type !== "node" || !String(member.role ?? "").startsWith("stop")) continue;
      stops++;

      let best = null;
      let rule = null;
      if (stationNodeIds.has(member.ref)) {
        rule = "station-node";
      } else {
        const nameKey = stopNames.get(member.ref);
        if (nameKey == null) rule = null; // unnamed: never joined by distance
        else rule = byName.has(nameKey) ? "name" : "proximity";
      }

      if (rule === null) {
        skippedUnnamed++;
        continue;
      } else if (rule === "station-node") {
        best = stations.find((s) => {
          const m = /^osm:node\/(\d+)$/.exec(s.id);
          return m && Number(m[1]) === member.ref;
        });
        if (best) stationNodeJoins++;
      } else if (rule === "name") {
        best = nearest(byName.get(stopNames.get(member.ref)) ?? [], nodeCoords.get(member.ref));
        if (best) nameJoins++;
      } else {
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
        if (best) proximityJoins++;
      }
      if (best) best.lines.add(line);
    }
  }
  log(
    `  ${label}: ${stops} stop positions — ${stationNodeJoins} via station node, ` +
      `${nameJoins} by name, ${proximityJoins} named by proximity, ` +
      `${skippedUnnamed} unnamed skipped, ${skippedRelations} relations skipped`,
  );
  return stationIndex;
}

/** Normalised name with the "London " prefix dropped — the spelling OSM uses
    for mainline termini ("London St. Pancras International") and the spelling
    everybody else uses ("St Pancras International") become the same key. */
function canonicalKey(name) {
  return normName(name).replace(/^london /, "");
}

/** Do two line sets describe the same station? Equal sets are a dead
    giveaway; a subset means the smaller entry is a view of the same place
    (Tottenham Court Road's Northern/Central node and its Elizabeth node).
    Overlapping-but-neither subsets (Paddington's two node placements) are
    left alone: the evidence is not strong enough to say. */
const sameOrSubset = (a, b) => {
  if (a.size === b.size && [...a].every((x) => b.has(x))) return true;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  return [...small].every((x) => big.has(x));
};

/**
 * Collapse entries that describe one station complex. Splitting by name and
 * location earlier is deliberately loose, so after the join a duplicate
 * shows itself: two entries within a couple of hundred metres whose line
 * sets agree. Waterloo and Charing Cross keep their two marks — terminus
 * plus tube station — because their line sets share nothing, and the map is
 * right to show both.
 */
function mergeDuplicates(stations) {
  const groups = new Map();
  for (const station of stations) {
    const key = canonicalKey(station.name);
    const group = groups.get(key);
    if (group) group.push(station);
    else groups.set(key, [station]);
  }

  const keep = (a, b) => {
    // The common name survives: "St Pancras International", not "London ...".
    const aLondon = /^london /i.test(a.name);
    const bLondon = /^london /i.test(b.name);
    if (aLondon !== bLondon) return aLondon ? b : a;
    return a.lines.size >= b.lines.size ? a : b;
  };

  let mergedCount = 0;
  const survivors = [];
  for (const group of groups.values()) {
    for (const station of group) {
      const twin = survivors.find(
        (t) =>
          canonicalKey(t.name) === canonicalKey(station.name) &&
          haversine([t.lat, t.lon], [station.lat, station.lon]) <= 250 &&
          sameOrSubset(t.lines, station.lines),
      );
      if (!twin) {
        survivors.push(station);
        continue;
      }
      const winner = keep(twin, station);
      for (const line of station.lines) twin.lines.add(line);
      for (const line of twin.lines) winner.lines.add(line);
      winner.nr = twin.nr || station.nr;
      if (winner !== twin) {
        survivors.splice(survivors.indexOf(twin), 1, winner);
      }
      mergedCount++;
    }
  }
  log(`  merged ${mergedCount} duplicate station entries`);
  return survivors;
}

async function main() {
  const stationJson = await run(STATION_QUERY, "stations");
  const stopJson = await run(STOP_QUERY, "stop positions");
  const routeJson = await run(ROUTE_QUERY, "underground routes");
  const networkRouteJson = await run(NETWORK_ROUTE_QUERY, "overground/elizabeth/dlr routes");

  const stationIndex = buildStations(stationJson);
  joinRoutes(routeJson, stationIndex, stopJson, (rel) => {
    // The Underground query returns only route=subway relations; a relation
    // whose ref is not one of the eleven lines (and every London relation has
    // a ref) is somebody else's subway and is skipped.
    return (lineOf(rel.tags?.ref) ?? lineOf(rel.tags?.name))?.id ?? null;
  }, "underground");
  joinRoutes(networkRouteJson, stationIndex, stopJson, networkOf, "overground/elizabeth/dlr");

  // National Rail termini: nothing joined, but squarely in the middle of
  // town. These are the only stations that get a line without a route
  // relation vouching for them, which is why the box is small.
  const [cs, cw, cn, ce] = CENTRAL_BBOX;
  let railStations = 0;
  for (const station of stationIndex.stations) {
    if (station.lines.size > 0) continue;
    if (!station.nr) continue;
    if (station.lat < cs || station.lat > cn || station.lon < cw || station.lon > ce) continue;
    station.lines.add("rail");
    railStations++;
  }

  const order = new Map([...LINES, ...NETWORKS].map((line, i) => [line.id, i]));
  const stations = mergeDuplicates(stationIndex.stations)
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
    lines: [...LINES, ...NETWORKS].filter((line) => usedLines.has(line.id)),
    stations,
  };

  // Fail loudly. A landmark layer missing most of its stations is worse than
  // none: the reader cannot tell a data gap from a genuinely quiet station.
  if (stations.length < 200) {
    throw new Error(
      `only ${stations.length} stations joined (expected 200+); refusing to publish a partial layer`,
    );
  }
  if (usedLines.size < 12) {
    throw new Error(`only ${usedLines.size} lines resolved (expected 12+); refusing to publish`);
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
  log(
    `\nPublished ${stations.length} stations across ${usedLines.size} lines ` +
      `(${railStations} National Rail termini) to public/data/tube.json`,
  );
  for (const line of data.lines) log(`  ${line.name.padEnd(26)} ${String(perLine[line.id] ?? 0).padStart(4)} stations  ${line.colour}`);
}

main().catch((error) => {
  console.error(`\nrefresh:tube failed: ${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
});
