/**
 * A published place. This is the shape in `public/data/<selection>.json` and it
 * is the same shape the components consumed from the old API, so nothing
 * downstream had to change when the database left the request path.
 *
 * Every field except the first three is optional, because most OpenStreetMap
 * rows genuinely do not have one. `scripts/build-data.mjs` drops nulls rather
 * than serialising them, which is why `name` can be `null` but `notes` is
 * simply absent.
 */
export interface PlaceRecord {
  id: string;
  name: string | null;
  lat: number;
  lon: number;
  /** Selection id whose colour the pin takes. */
  primary: string | null;
  selections: string[];
  dogPolicy: string;
  source: string;
  /** 0 or 1 rather than a boolean, because this arrives as JSON and `false` survives it. */
  verified: 0 | 1;
  city?: string;
  street?: string;
  postcode?: string;
  openingHours?: string;
  phone?: string;
  website?: string;
  instagram?: string;
  notes?: string;
  bookingUrl?: string;
  bookingLabel?: string;
  image?: string;
  cuisine?: string;
  outdoorSeating?: string;
  wheelchair?: string;
  provenance?: string;
  osmUpdated?: string;
  /** Metres from the search centre. Present only after a search, never in the data files. */
  distance?: number | null;
}

export interface Manifest {
  builtAt: string;
  total: number;
  counts: Record<string, number>;
  fields: string[];
}

export interface SearchParams {
  bbox: [minLon: number, minLat: number, maxLon: number, maxLat: number];
  /** Empty means every loaded selection. */
  selections: readonly string[];
  q?: string;
  near?: readonly [number, number] | null;
  radius?: number | null;
  limit?: number;
}

export interface SearchResult {
  places: PlaceRecord[];
  total: number;
  /**
   * How many places each selection has in view, counted *before* the selection
   * filter. That is what makes a chip's count useful: with two chips on, the
   * ones that are off still show what turning them on would add.
   */
  counts: Record<string, number>;
  /** True when the viewport held more records than the cap and the counts are a floor. */
  truncated: boolean;
}

/** A viewport this large is a mistake or an attack; the server used to refuse it. */
export const MAX_VIEWPORT_SPAN_DEG = 30;

/** Hard cap on how many records one viewport may return. */
const DEFAULT_LIMIT = 200;

/**
 * Filter, count and sort, entirely in the browser.
 *
 * This is the same logic the server used to run, minus the database. At seven
 * thousand records a linear pass is well under a millisecond, which is why
 * asking a server to do it was always the wrong trade — it cost a network round
 * trip and a slice of an account-wide quota to compute something the CPU does
 * for free.
 *
 * The counts are collected before the selection filter for the reason above;
 * the distance filter applies to both, because "dog parks within a kilometre of
 * me" should not count parks I am not near.
 */
export function searchPlaces(
  records: readonly PlaceRecord[],
  params: SearchParams,
): SearchResult {
  const [minLon, minLat, maxLon, maxLat] = params.bbox;
  const wanted = new Set(params.selections);
  const terms = tokenise(params.q);
  const centre = params.near ?? null;
  const radius = params.radius && params.radius > 0 ? params.radius : null;
  const limit = Math.min(500, Math.max(1, params.limit ?? DEFAULT_LIMIT));

  const counts: Record<string, number> = {};
  const scored: { rec: PlaceRecord; distance: number | null }[] = [];
  let scanned = 0;
  let truncated = false;

  for (const rec of records) {
    if (rec.lat < minLat || rec.lat > maxLat || rec.lon < minLon || rec.lon > maxLon) continue;

    scanned++;
    if (scanned > 5000) {
      truncated = true;
      break;
    }

    // Text first: it is the cheapest filter and the one that removes the most.
    if (terms.length && !matchesTerms(rec, terms)) continue;

    let distance: number | null = null;
    if (centre) {
      distance = distMetres(centre[1], centre[0], rec.lat, rec.lon);
      if (radius != null && distance > radius) continue;
    }

    for (const id of rec.selections) counts[id] = (counts[id] ?? 0) + 1;

    if (wanted.size && !rec.selections.some((id) => wanted.has(id))) continue;
    scored.push({ rec, distance });
  }

  scored.sort((a, b) => {
    const da = a.distance ?? 0;
    const db = b.distance ?? 0;
    if (da !== db) return da - db;
    // Equal distance means "alphabetical" beats "whatever the file order was",
    // which is what makes the list stable while panning.
    return (a.rec.name ?? "").localeCompare(b.rec.name ?? "");
  });

  return {
    places: scored.slice(0, limit).map(({ rec, distance }) =>
      distance === undefined ? rec : { ...rec, distance },
    ),
    total: scored.length,
    counts,
    truncated,
  };
}

/**
 * FTS5 is not available in a browser, and it was never the right tool for
 * seven thousand rows. Every word is matched against a lowercase haystack, with
 * `AND` between them, which is what FTS5 was configured to do.
 */
function tokenise(q: string | undefined): string[] {
  if (!q) return [];
  return q
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1)
    .slice(0, 8);
}

function matchesTerms(rec: PlaceRecord, terms: readonly string[]): boolean {
  const hay = `${rec.name ?? ""} ${rec.city ?? ""} ${rec.street ?? ""} ${rec.postcode ?? ""}`
    .toLowerCase();
  return terms.every((t) => hay.includes(t));
}

/** Great-circle metres. The same function the server used, so distances match. */
function distMetres(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dphi = p2 - p1;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Merges selections that were fetched separately, keeping one copy of each id. */
export function mergeRecords(batches: readonly (readonly PlaceRecord[])[]): PlaceRecord[] {
  const seen = new Map<string, PlaceRecord>();
  for (const batch of batches) {
    for (const rec of batch) if (!seen.has(rec.id)) seen.set(rec.id, rec);
  }
  return [...seen.values()];
}

/** The places in `records` that are in any of `selections`, for the map's source. */
export function filterBySelection(
  records: readonly PlaceRecord[],
  selections: readonly string[],
): PlaceRecord[] {
  if (!selections.length) return [];
  const wanted = new Set(selections);
  return records.filter((r) => r.selections.some((id) => wanted.has(id)));
}
