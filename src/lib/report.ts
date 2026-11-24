/**
 * The report contract, shared by the form and the inbox endpoint.
 *
 * One module, used on both sides of the POST, so the browser cannot submit
 * something the server will reject and the server cannot invent a rule the
 * form never showed. Pure functions only: no fetch, no DOM, no env — which is
 * also what makes it unit-testable and keeps the guard happy, because none of
 * the strings it forbids in browser code can ever appear here.
 *
 * The theme: a "paw report" is a couple of clicks, no account, no cookies.
 * Publication is still moderated — reports reach OpenStreetMap's note queue
 * (where OSM volunteers review them, and every OSM consumer benefits) and the
 * maintainer's KV inbox (drained by `npm run inbox` into yaml drafts). Nothing
 * lands on the shared map unchecked, because "never mark verified that nobody
 * checked" outranks "instant content".
 */

export const REPORT_KINDS = [
  { id: "policy", label: "Dogs policy changed" },
  { id: "closed", label: "It has closed" },
  { id: "bowl", label: "Water bowl" },
  { id: "new", label: "Suggest a new place" },
  { id: "other", label: "Something else" },
] as const;

export type ReportKind = (typeof REPORT_KINDS)[number]["id"];

export const NOTE_MIN = 10;
export const NOTE_MAX = 500;

export interface ReportInput {
  kind: string;
  note: string;
  /** The honeypot. A filled honeypot is a bot; the error is deliberately vague. */
  website?: string;
  placeId?: string;
  placeName?: string;
  lat?: number;
  lon?: number;
}

export interface CleanReport {
  kind: ReportKind;
  note: string;
  placeId?: string;
  placeName?: string;
  lat?: number;
  lon?: number;
}

export type Verdict = { ok: true; value: CleanReport } | { ok: false; error: string };

function kindIs(value: string): value is ReportKind {
  return (REPORT_KINDS as readonly { id: string }[]).some((k) => k.id === value);
}

export function validateReport(input: unknown): Verdict {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "The report arrived empty. Try again." };
  }
  const raw = input as Record<string, unknown>;

  // The honeypot field is invisible to people and irresistible to form spam.
  // A filled one is turned away without explanation, on purpose.
  if (typeof raw.website === "string" && raw.website.trim() !== "") {
    return { ok: false, error: "The report could not be accepted." };
  }

  const kind = typeof raw.kind === "string" ? raw.kind : "";
  if (!kindIs(kind)) {
    return { ok: false, error: "Pick what kind of report this is." };
  }

  const note = typeof raw.note === "string" ? raw.note.trim() : "";
  if (note.length < NOTE_MIN) {
    return { ok: false, error: `Add a little detail — at least ${NOTE_MIN} characters.` };
  }
  if (note.length > NOTE_MAX) {
    return { ok: false, error: `Keep it under ${NOTE_MAX} characters — the essentials travel further.` };
  }

  const placeId =
    typeof raw.placeId === "string" && raw.placeId.trim() !== ""
      ? raw.placeId.trim().slice(0, 90)
      : undefined;
  const placeName =
    typeof raw.placeName === "string" && raw.placeName.trim() !== ""
      ? raw.placeName.trim().slice(0, 120)
      : undefined;

  const hasLat = raw.lat !== undefined && raw.lat !== null;
  const hasLon = raw.lon !== undefined && raw.lon !== null;
  if (hasLat !== hasLon) {
    return { ok: false, error: "The map position arrived incomplete. Submit without it and say where in the note." };
  }
  let lat: number | undefined;
  let lon: number | undefined;
  if (hasLat && hasLon) {
    lat = Number(raw.lat);
    lon = Number(raw.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return { ok: false, error: "The map position does not look like a position. Submit without it and say where in the note." };
    }
    lat = Math.round(lat * 10_000) / 10_000;
    lon = Math.round(lon * 10_000) / 10_000;
  }

  return { ok: true, value: { kind, note, placeId, placeName, lat, lon } };
}

/** The plain-text note that travels to OpenStreetMap and into the yaml draft.
    Takes the looser ReportInput because the form composes previews before
    validation runs; kind is treated as opaque here either way. */
export function composeNote(value: ReportInput): string {
  const kindLabel = REPORT_KINDS.find((k) => k.id === value.kind)?.label ?? value.kind;
  const subject = value.placeName ? `“${value.placeName}”` : "A place";
  const ref = value.placeId ? ` (${value.placeId})` : "";
  return [
    `[pampered.korg-e.com] ${kindLabel}`,
    `${subject}${ref}`,
    value.note,
    "— visitor report from pampered.korg-e.com",
  ].join("\n");
}

/** A prefilled OpenStreetMap note, positioned on the place. Null without coords. */
export function osmNoteUrl(value: ReportInput): string | null {
  if (value.lat === undefined || value.lon === undefined) return null;
  const text = encodeURIComponent(composeNote(value));
  return `https://www.openstreetmap.org/note/new?lat=${value.lat}&lon=${value.lon}&text=${text}#map=18/${value.lat}/${value.lon}`;
}

/** The OSM editor at the spot, for "suggest a new place". Null without coords. */
export function osmEditUrl(value: ReportInput): string | null {
  if (value.lat === undefined || value.lon === undefined) return null;
  return `https://www.openstreetmap.org/edit?lat=${value.lat}&lon=${value.lon}&zoom=18#map=18/${value.lat}/${value.lon}`;
}
