/**
 * Formatting that a dog owner reads while standing on a pavement with one hand.
 * Every rule here was chosen to be short: a card shows three lines and a number
 * with a unit, never a paragraph.
 */

/** 340 m, 1.2 km, 14 km. Under a kilometre it is metres, because that is the useful unit. */
export function formatDistance(metres: number | null | undefined): string {
  if (metres == null || !Number.isFinite(metres)) return "";
  if (metres < 950) return `${Math.max(5, Math.round(metres / 5) * 5)} m`;
  if (metres < 10_000) return `${(metres / 1000).toFixed(1)} km`;
  if (metres < 100_000) return `${Math.round(metres / 1000)} km`;
  return "100 km+";
}

/**
 * Walking time at 4.8 km/h, which is a real unhurried adult pace on a pavement.
 * Rounded hard, because "7.42 minutes" is not a thing anybody says.
 */
export function formatWalkTime(metres: number | null | undefined): string {
  if (metres == null || !Number.isFinite(metres)) return "";
  const minutes = Math.max(1, Math.round(metres / 80));
  if (minutes < 60) return `${minutes} min walk`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min walk` : `${hours} h walk`;
}

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;

/**
 * The single most useful line on the whole site: is it open, and until when.
 *
 * OSM's `opening_hours` syntax is a rabbit hole and parsing all of it is a
 * library's worth of work. What we do instead is ask the parts that are simple
 * and answer them, and say nothing at all when we cannot tell — which is the
 * honest thing to do rather than guessing from a photo of the front door.
 */
export function openState(
  hours: string | null | undefined,
  at: Date = new Date(),
): { label: string; tone: "good" | "warn" | "bad" | "unknown" } | null {
  const text = hours?.trim();
  if (!text) return null;
  if (/^24\/7$/i.test(text)) return { label: "Open 24 hours", tone: "good" };
  if (/^closed\b/i.test(text)) return { label: "Closed", tone: "bad" };

  // 0 = Monday, matching OSM's Mo-Su order rather than JavaScript's Su-Sa.
  const dayIdx = at.getDay() === 0 ? 6 : at.getDay() - 1;
  const minutesNow = at.getHours() * 60 + at.getMinutes();

  // One rule per semicolon. The first rule whose days include today wins, which
  // is how OSM orders them ("Mo-Fr 09:00-17:00; Sa 10:00-14:00; Su off").
  for (const part of text.split(";")) {
    const rule = part.trim();
    if (!rule) continue;

    const off = /^([A-Za-z,-]+)\s+off$/i.exec(rule);
    if (off && dayMatches(off[1]!, dayIdx)) {
      return { label: "Closed today", tone: "bad" };
    }

    const m = /^([A-Za-z,-]+)?\s*([0-9]{1,2}:[0-9]{2})\s*-\s*([0-9]{1,2}:[0-9]{2})/.exec(rule);
    if (!m) continue;
    const [, dayPart, opens, closes] = m;
    if (dayPart && !dayMatches(dayPart, dayIdx)) continue;

    const from = toMinutes(opens!);
    const to = toMinutes(closes!);
    if (from == null || to == null) continue;

    // "22:00-02:00" is a bar, not a typo.
    const overnight = to <= from;
    const openNow = overnight
      ? minutesNow >= from || minutesNow <= to
      : minutesNow >= from && minutesNow <= to;

    if (openNow) return { label: `Open until ${closes}`, tone: "good" };
    const soon = !overnight && minutesNow < from && from - minutesNow <= 60;
    return { label: soon ? `Opens ${opens}` : `Closed · opens ${opens}`, tone: soon ? "warn" : "bad" };
  }
  return null;
}

/** "Mo", "Mo-Fr" and "Mo,We,Fr" against a 0=Moronday index. Anything unparseable
    is treated as not matching, because guessing a venue open is worse than silence. */
function dayMatches(part: string, dayIdx: number): boolean {
  for (const token of part.split(",")) {
    const range = token.trim().split("-").map((s) => s.trim());
    if (range.length === 1) {
      const idx = (WEEKDAYS as readonly string[]).indexOf(range[0]!);
      if (idx === dayIdx) return true;
    } else if (range.length === 2) {
      const a = (WEEKDAYS as readonly string[]).indexOf(range[0]!);
      const b = (WEEKDAYS as readonly string[]).indexOf(range[1]!);
      if (a === -1 || b === -1) continue;
      if (a <= b) {
        if (dayIdx >= a && dayIdx <= b) return true;
      } else if (dayIdx >= a || dayIdx <= b) {
        return true;
      }
    }
  }
  return false;
}

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** A two-line address. Postcode is the useful half and goes second so it is never truncated. */
export function formatAddress(p: {
  street?: string | null;
  city?: string | null;
  postcode?: string | null;
}): string {
  return [p.street, p.city].filter(Boolean).join(", ") + (p.postcode ? ` ${p.postcode}` : "");
}

/** "3 selections" -> "Cafés, Pubs". Used on the venue page to explain what a pin means. */
export function joinList(items: readonly string[], conjunction = "and"): string {
  if (!items.length) return "";
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items[items.length - 1]}`;
}

export function pluralise(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
}