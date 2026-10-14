/**
 * The shape of `content/selections.yaml`, `content/regions.yaml` and
 * `content/places/*.yaml`, described once.
 *
 * These types are not documentation. `scripts/validate.mjs` cannot import them,
 * but it is generated from the same field list, and `npm run check` runs both,
 * so a shape that drifts in one place fails in the other.
 */

/** OpenStreetMap's `dog=*` values we recognise, plus what we display. */
export const DOG_POLICIES = [
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
] as const;

export type DogPolicy = (typeof DOG_POLICIES)[number];

/**
 * What we know about where a place's data came from. `manual` means nobody has
 * checked it. The UI is not allowed to describe a `manual` row as verified, and
 * `scripts/validate.mjs` fails the build if it tries.
 */
export const PLACE_SOURCES = ["osm", "curated", "manual"] as const;
export type PlaceSource = (typeof PLACE_SOURCES)[number];

/** One branch of a selection's OSM query. Branches are OR'd, keys within are AND'd. */
export interface OsmTagMatch {
  tags: Record<string, string[]>;
}

export interface OsmQuerySpec {
  /** Branches are OR'd together. A spec with `tags` only is a single branch. */
  tags?: Record<string, string[]>;
  any?: OsmTagMatch[];
}

export interface Selection {
  /** Stable slug. Appears in URLs, in D1, and in every curated venue's `selections`. */
  id: string;
  /** Full sentence for legends, tooltips and page copy. */
  label: string;
  /** Two or three characters, for a chip that has to fit on a phone. */
  short: string;
  group: string;
  /** Name of a glyph in `src/map/icons.tsx`. Not decorative: the chip renders it. */
  icon: string;
  /** Must reach 4.5:1 against `--map-land`. `npm run check` measures it. */
  colour: string;
  /** Shown before a visitor narrows anything down. Absent means off. */
  default?: boolean;
  /** Below this zoom the layer is hidden, so a country-wide view is not a solid block. */
  minzoom: number;
  /** One sentence on where this data comes from and what it does not say. */
  blurb: string;
  /**
   * Keep elements with no name. Only for utility layers like water bowls, where
   * a dot is useful and a list row falls back to the selection label. Absent
   * means unnamed elements are skipped, because a pin with no name is noise.
   */
  allowUnnamed?: boolean;
  /** Absent for selections that only ever come from curated files. */
  osm?: OsmQuerySpec;
}

export interface SelectionGroup {
  id: string;
  label: string;
}

export interface DogPolicyLabels {
  [value: string]: string;
}

export interface SelectionFile {
  version: number;
  area: { name: string; bbox: [number, number, number, number] };
  groups: SelectionGroup[];
  dog_policy: DogPolicyLabels;
  selections: Selection[];
}

export interface Region {
  id: string;
  label: string;
  centre: [number, number];
  zoom: number;
}

export interface RegionFile {
  version: number;
  regions: Region[];
}

export interface PlaceBooking {
  url: string;
  label: string;
}

/** A row in `content/places/*.yaml`. Underscore-prefixed files are never loaded. */
export interface CuratedPlace {
  id: string;
  name: string;
  source: Exclude<PlaceSource, "osm">;
  verified?: boolean;
  selections: string[];
  lat: number;
  lon: number;
  region?: string;
  street?: string;
  city?: string;
  postcode?: string;
  phone?: string;
  website?: string;
  instagram?: string;
  opening_hours?: string;
  dog_policy?: DogPolicy;
  notes?: string;
  booking?: PlaceBooking;
  image?: string;
}