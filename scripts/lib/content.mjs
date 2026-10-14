/**
 * The pipeline's view of `content/`.
 *
 * This reads the same YAML the browser does, with the same package, but it is
 * deliberately plain JavaScript in plain Node rather than an import from
 * `src/`. The app resolves `content/selections.yaml` through a Vite plugin that
 * Node has no idea about, and a build step that generates a TypeScript copy of
 * the content would mean two things to keep in step. Instead the two readers
 * share a file and `scripts/validate.mjs` is the thing that catches it if they
 * ever disagree about what that file means.
 */
import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const CONTENT_DIR = join(ROOT, "content");
export const PLACES_DIR = join(CONTENT_DIR, "places");
export const OSM_CACHE_DIR = join(ROOT, "data", "osm");

export async function readYaml(path) {
  const text = await readFile(path, "utf8");
  const value = parseYaml(text);
  if (value === null || typeof value !== "object") {
    throw new Error(`${path} did not parse to a mapping`);
  }
  return value;
}

export async function loadSelections() {
  const doc = await readYaml(join(CONTENT_DIR, "selections.yaml"));
  return {
    version: doc.version,
    area: doc.area,
    groups: doc.groups ?? [],
    dogPolicy: doc.dog_policy ?? {},
    selections: doc.selections ?? [],
  };
}

export async function loadRegions() {
  const doc = await readYaml(join(CONTENT_DIR, "regions.yaml"));
  return { version: doc.version, regions: doc.regions ?? [] };
}

/**
 * Every curated venue, across every file.
 *
 * Files whose name starts with an underscore are skipped. That is how the
 * documentation example stays documentation: there is no build flag to forget
 * and no way for a placeholder address to reach production by accident.
 */
export async function loadCuratedPlaces() {
  let files;
  try {
    files = await readdir(PLACES_DIR);
  } catch {
    return [];
  }

  const places = [];
  for (const file of files.sort()) {
    if (file.startsWith("_") || !/\.ya?ml$/i.test(extname(file))) continue;
    const doc = await readYaml(join(PLACES_DIR, file));
    for (const place of doc.places ?? []) {
      places.push({ ...place, __file: file });
    }
  }
  return places;
}

/**
 * Build the Overpass QL for one selection.
 *
 * A selection is one or more branches. Within a branch every tag must match
 * (AND); branches are OR'd. That is exactly the shape in `content/selections.yaml`,
 * which is why the groomers selection can say "shop=pet with a dog tag, or
 * shop=beauty with a dog tag" without this function knowing anything about
 * grooming.
 *
 * `out center` rather than `out body >; out skel`: ways and relations have no
 * centre of their own, and a dog park drawn as a polygon is the most common way
 * for this data to arrive. Without `center` those rows would be discarded and the
 * selection would silently look empty.
 */
export function overpassQueryFor(selection, bbox, timeoutSec = 180) {
  const [south, west, north, east] = bbox;
  const spec = selection.osm;
  if (!spec) return null;

  const branches = spec.any ?? (spec.tags ? [{ tags: spec.tags }] : []);
  if (!branches.length) return null;

  const lines = branches.map((branch) => {
    const clauses = Object.entries(branch.tags ?? {}).map(([key, values]) => {
      const list = Array.isArray(values) ? values : [values];
      if (list.length === 1) return `["${key}"="${escapeQ(list[0])}"]`;
      return `["${key}"~"^(${[...list].map(escapeRegex).join("|")})$"]`;
    });
    // nwr = node, way, relation. Overpass has no better word for all three.
    return `  nwr${clauses.join("")}(${south},${west},${north},${east});`;
  });

  return `[out:json][timeout:${timeoutSec}];\n(\n${lines.join("\n")}\n);\nout center tags qt;`;
}

function escapeQ(value) {
  return String(value).replace(/["\\]/g, "\\$&");
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The OpenStreetMap values we treat as a positive dog policy, in `content/selections.yaml` order. */
export function positiveDogValues(selection) {
  const spec = selection.osm;
  if (!spec) return [];
  const branches = spec.any ?? (spec.tags ? [spec.tags] : []);
  const out = new Set();
  for (const branch of branches) {
    for (const value of branch.tags?.dog ?? []) out.add(value);
  }
  return [...out];
}

/**
 * Tried in order. The primary first, because it has the freshest data; the
 * others because at a busy hour the primary answers everything with a 504 and
 * something slow-but-working beats nothing. Verified live on 2026-10-14, when
 * the primary was refusing even trivial queries while mail.ru answered in 18s.
 */
export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

/** Overpass rejects anything without a User-Agent, and bans the ones that lie. */
export const USER_AGENT =
  "pampered.korg-e.com (dog-friendly directory; https://pampered.korg-e.com/)";

export async function overpass(query, endpoint, signal, timeoutMs = 240_000) {
  // Overpass's own `timeout:` caps server work; this caps the client waiting for
  // it. Without it a dropped connection hangs the whole refresh forever.
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
    body: new URLSearchParams({ data: query }),
    signal: combined,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Overpass ${response.status} from ${new URL(endpoint).host}: ${text.slice(0, 300)}`);
  }
  return response.json();
}

/** A place slug that is stable, readable and safe in a URL. */
export function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Cheap unique-ifier: `the-dog-and-duck`, `the-dog-and-duck-2`. */
export function uniqueSlug(base, taken) {
  const root = slugify(base) || "place";
  let slug = root;
  let n = 2;
  while (taken.has(slug)) slug = `${root}-${n++}`;
  taken.add(slug);
  return slug;
}

export function isoNow() {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}