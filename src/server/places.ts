/**
 * Every read of the database goes through here.
 *
 * The shape of a search is deliberately two-stage. SQL does the part it is good
 * at — an index-backed bounding box and an FTS match — and JavaScript does the
 * part SQL is bad at, which is a great-circle sort across a few hundred rows.
 * SQLite has no haversine that is worth using, and a spatial extension is not
 * available on D1.
 *
 * At the size this table is expected to be (tens of thousands of rows) the
 * bounding-box scan is a couple of milliseconds and none of this needs to be
 * cleverer than it is.
 */
import { distMetres } from "~/lib/geo";
import type { Bbox, LonLat } from "~/lib/geo";
import { db } from "./db";

/** The most rows we will pull back for one viewport before giving up and sorting in the database. */
const MAX_SCAN = 5000;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

export interface SlimPlace {
  id: string;
  name: string | null;
  lat: number;
  lon: number;
  selections: string[];
  primary: string | null;
  dogPolicy: string | null;
  street: string | null;
  city: string | null;
  postcode: string | null;
  website: string | null;
  openingHours: string | null;
  source: string;
  verified: boolean;
  /** Metres from the search centre, or null when there was no centre. */
  distance: number | null;
}

export interface SearchParams {
  bbox: Bbox;
  /** Empty means "every selection", which is what a first-time visitor sees. */
  selections?: string[];
  q?: string;
  near?: LonLat | null;
  radius?: number | null;
  limit?: number;
}

export interface SearchResult {
  places: SlimPlace[];
  /** How many rows matched before the limit. */
  total: number;
  /** How many matched each selection in this viewport, before any selection filter. */
  counts: Record<string, number>;
  /** True when the viewport held more rows than MAX_SCAN and the counts are a floor, not a total. */
  truncated: boolean;
}

interface DbRow {
  id: string;
  source: string;
  verified: number;
  name: string | null;
  selections: string;
  primary_sel: string | null;
  lat: number;
  lon: number;
  street: string | null;
  city: string | null;
  postcode: string | null;
  website: string | null;
  opening_hours: string | null;
  dog_policy: string | null;
}

/**
 * Places inside a viewport, filtered by selection and text, sorted by distance.
 *
 * `counts` deliberately comes from the set *before* the selection filter. That is
 * what makes the legend useful: with two chips on, the chips that are off still
 * show how many places turning them on would add.
 */
export async function searchPlaces(params: SearchParams): Promise<SearchResult> {
  const [minLon, minLat, maxLon, maxLat] = params.bbox;
  const wanted = dedupe(params.selections ?? []).filter(Boolean);
  const q = params.q?.trim().slice(0, 120) ?? "";
  const limit = Math.min(MAX_LIMIT, Math.max(1, params.limit ?? DEFAULT_LIMIT));

  const sql = buildQuery(q, wanted.length > 0);
  const binds: (string | number)[] = [minLat, maxLat, minLon, maxLon];
  if (q) binds.push(toMatchExpression(q));
  if (wanted.length) binds.push(JSON.stringify(wanted));

  const { results } = await db()
    .prepare(sql)
    .bind(...binds)
    .all<DbRow>();

  const rows = results.slice(0, MAX_SCAN);
  const truncated = results.length > MAX_SCAN;
  const centre: LonLat | null = params.near ?? [params.bbox[0], params.bbox[1]];
  const radius = params.radius && params.radius > 0 ? params.radius : null;

  const scored: { row: DbRow; ids: string[]; distance: number | null }[] = [];
  const counts: Record<string, number> = {};

  for (const row of rows) {
    const ids = parseSelections(row.selections);
    for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
    if (wanted.length && !ids.some((id) => wanted.includes(id))) continue;
    const distance = distMetres(centre[1], centre[0], row.lat, row.lon);
    if (radius != null && distance > radius) continue;
    scored.push({ row, ids, distance });
  }

  scored.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));

  return {
    places: scored.slice(0, limit).map(({ row, ids, distance }) => toSlim(row, ids, distance)),
    total: scored.length,
    counts,
    truncated,
  };
}

function buildQuery(q: string, filterBySelection: boolean): string {
  const parts: string[] = [];
  const projection =
    "SELECT p.id, p.source, p.verified, p.name, p.selections, p.primary_sel, p.lat, p.lon, " +
    "p.street, p.city, p.postcode, p.website, p.opening_hours, p.dog_policy";

  parts.push("FROM places p");
  parts.push("WHERE p.lat BETWEEN ? AND ? AND p.lon BETWEEN ? AND ?");

  if (q) {
    // The FTS table is joined rather than subqueried so SQLite can use its own
    // ranking, and so an empty result is an empty result and not a full scan.
    parts.push("JOIN places_fts f ON f.place_id = p.id AND places_fts MATCH ?");
  }

  if (filterBySelection) {
    // json_each rather than LIKE '%"id"%': the LIKE version would match a
    // selection called `dog` when asked for `dog-parks`.
    parts.push(
      "AND EXISTS (SELECT 1 FROM json_each(p.selections) j WHERE j.value IN (SELECT value FROM json_each(?)))",
    );
  }

  // Cursor order for the rows we drop, distance order for the ones we keep.
  parts.push("ORDER BY p.lat, p.lon LIMIT " + MAX_SCAN);

  return `${projection} ${parts.join(" ")}`;
}

/** The full record for a venue page. */
export async function getPlace(id: string): Promise<FullPlace | null> {
  const row = await db()
    .prepare(
      `SELECT id, source, verified, name, selections, primary_sel, lat, lon, street, city, region,
              postcode, phone, website, instagram, image, opening_hours, dog_policy,
              outdoor_seating, wheelchair, cuisine, booking_url, booking_label, notes,
              provenance, osm_updated, created_at, updated_at
         FROM places WHERE id = ?1 LIMIT 1`,
    )
    .bind(id)
    .first<DbRow & Record<string, unknown>>();

  if (!row) return null;
  return {
    ...(row as unknown as FullPlace),
    selections: parseSelections(row.selections),
    verified: row.verified === 1,
    primary: row.primary_sel,
    dogPolicy: (row["dog_policy"] as string | null) ?? null,
    openingHours: (row["opening_hours"] as string | null) ?? null,
    booking: row["booking_url"]
      ? { url: String(row["booking_url"]), label: String(row["booking_label"] ?? "Book") }
      : null,
  };
}

export interface FullPlace {
  id: string;
  source: string;
  verified: boolean;
  name: string;
  selections: string[];
  primary: string | null;
  lat: number;
  lon: number;
  street: string | null;
  city: string | null;
  region: string | null;
  postcode: string | null;
  phone: string | null;
  website: string | null;
  instagram: string | null;
  image: string | null;
  openingHours: string | null;
  dogPolicy: string | null;
  outdoorSeating: string | null;
  wheelchair: string | null;
  cuisine: string | null;
  booking: { url: string; label: string } | null;
  notes: string | null;
  provenance: string;
  osmUpdated: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The busiest places in a selection, for the `/s/<selection>` pages. */
export async function topBySelection(selectionId: string, limit = 40): Promise<SlimPlace[]> {
  const { results } = await db()
    .prepare(
      `SELECT id, source, verified, name, selections, primary_sel, lat, lon, street, city,
              postcode, website, opening_hours, dog_policy
         FROM places
        WHERE EXISTS (SELECT 1 FROM json_each(selections) j WHERE j.value = ?1)
        ORDER BY verified DESC, source ASC, name ASC
        LIMIT ?2`,
    )
    .bind(selectionId, limit)
    .all<DbRow>();
  return results.map((row) => toSlim(row, parseSelections(row.selections), null));
}

/** Every selection id that currently has at least one place. */
export async function populatedSelections(): Promise<string[]> {
  const { results } = await db()
    .prepare("SELECT DISTINCT primary_sel AS id FROM places WHERE primary_sel IS NOT NULL")
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

/** Row count by source, for /api/health and for the footer. */
export async function sourceCounts(): Promise<Record<string, number>> {
  const { results } = await db()
    .prepare("SELECT source, COUNT(*) AS n FROM places GROUP BY source")
    .all<{ source: string; n: number }>();
  return Object.fromEntries(results.map((r) => [r.source, r.n]));
}

/**
 * Turn a person's typed words into an FTS5 MATCH expression.
 *
 * Everything is quoted, because an unquoted `dogs` next to a `*` is a syntax
 * error for FTS5 and an attacker is a syntax error for everybody. `AND` is added
 * so "dog friendly pub" narrows rather than widening.
 */
export function toMatchExpression(q: string): string {
  const terms = q
    .split(/\s+/)
    .map((t) => t.replace(/["*():^]/g, " ").trim())
    .filter(Boolean)
    .slice(0, 8);
  if (!terms.length) return '""';
  return terms.map((t) => `"${t}"`).join(" AND ");
}

function toSlim(row: DbRow, ids: string[], distance: number | null): SlimPlace {
  return {
    id: row.id,
    name: row.name,
    lat: row.lat,
    lon: row.lon,
    selections: ids,
    primary: row.primary_sel,
    dogPolicy: row.dog_policy ?? null,
    street: row.street ?? null,
    city: row.city ?? null,
    postcode: row.postcode ?? null,
    website: row.website ?? null,
    openingHours: row.opening_hours ?? null,
    source: row.source,
    verified: row.verified === 1,
    distance,
  };
}

function parseSelections(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    // A row whose selections column is corrupt should still render. It loses its
    // pin colour and its chip membership, which is a degradation and not a crash.
    return [];
  }
}

function dedupe(list: readonly string[]): string[] {
  return [...new Set(list)];
}