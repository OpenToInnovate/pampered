/**
 * Turns `content/selections.yaml` into the runtime registry the rest of the app
 * reads, and answers the two questions that are asked from three different
 * places: which selections are on, and what colour is this one.
 *
 * Nothing in here is cached or memoised beyond module scope. The file is a few
 * kilobytes and there is exactly one copy per process.
 */
import selectionsFile from "../../content/selections.yaml";
import regionsFile from "../../content/regions.yaml";
import type {
  DogPolicy,
  OsmQuerySpec,
  Region,
  Selection,
  SelectionFile,
} from "./types";

const file = selectionsFile as unknown as SelectionFile;
const regionData = regionsFile as unknown as { version: number; regions: Region[] };

export const selections: Selection[] = file.selections;
export const selectionGroups = file.groups;
export const regions: Region[] = regionData.regions;
export const refreshArea = file.area;
export const dogPolicyLabels: Record<string, string> = file.dog_policy;

const byId = new Map(selections.map((s) => [s.id, s]));

export function selection(id: string): Selection | undefined {
  return byId.get(id);
}

/** The ids that are on when somebody arrives with nothing in the URL. */
export const defaultSelectionIds: string[] = selections.filter((s) => s.default === true).map((s) => s.id);

/** Colour for a selection id, or a neutral grey for one that no longer exists. */
export function colourOf(id: string): string {
  return byId.get(id)?.colour ?? "#6B7280";
}

/** The human label for an OSM `dog=*` value. Anything unrecognised is honest about it. */
export function dogPolicyLabel(policy: DogPolicy | string | null | undefined): string {
  const value = policy ?? "unknown";
  return dogPolicyLabels[value] ?? "Not stated";
}

/** Colour for the little "dogs inside / dogs outside / no dogs" pill on a card. */
export function dogPolicyTone(policy: DogPolicy | string | null | undefined): "good" | "warn" | "bad" {
  const value = policy ?? "unknown";
  if (value === "no") return "bad";
  if (value === "unknown" || value === "leashed") return "warn";
  return "good";
}

/**
 * The colour a pin should take when it belongs to several selections at once.
 *
 * A venue tagged as a pub and a dog park has no honest single colour, so it gets
 * the first selection by render order rather than an invented blend. Order is
 * the order in `content/selections.yaml`, which is the order the legend uses.
 */
export function primarySelectionId(ids: readonly string[] | null | undefined): string | null {
  if (!ids?.length) return null;
  for (const s of selections) if (ids.includes(s.id)) return s.id;
  return ids[0] ?? null;
}

/** Which selections a set of OSM tags satisfies. Used by the import, not the UI. */
export function matchesOsm(spec: OsmQuerySpec, tags: Record<string, string | undefined>): boolean {
  const branches = spec.any ?? (spec.tags ? [{ tags: spec.tags }] : []);
  if (!branches.length) return false;
  return branches.some((branch) =>
    Object.entries(branch.tags).every(([key, values]) => {
      const actual = tags[key];
      return actual != null && values.includes(actual);
    }),
  );
}

/** Whether a selection can ever come from OpenStreetMap, as opposed to being curated-only. */
export function hasOsmSource(id: string): boolean {
  return byId.get(id)?.osm != null;
}