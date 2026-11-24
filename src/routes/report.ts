/**
 * POST /report — the paw inbox.
 *
 * A write-only endpoint: it stores a visitor report in KV and returns an id.
 * It never reads anything to serve a page, and it never touches D1 — the
 * outage that took two sites down was D1 *reads* per request, and the account
 * quota that died was shared. KV writes are a different quota and a different
 * magnitude: one small record per human who chose to write something. The
 * serving path is untouched; browse the site and this route does nothing.
 *
 * It is deliberately NOT under src/routes/api/, because that directory is the
 * shape of the thing the guard exists to prevent, and "an api directory that
 * only writes" is a distinction a future regression will not respect. The
 * guard's check and this route's header comment say the same thing: the
 * browser may POST a report, and nothing else may travel to a server tier.
 *
 * Abuse budget, in order: a honeypot field (see validateReport), a per-device
 * hourly cap and a global daily cap in KV, hard length caps, and text-only
 * storage. No cookies, no sign-in, no third-party challenge widget. The inbox
 * is read by a human with `npm run inbox`; garbage costs a few hundred bytes
 * of KV with a 90-day TTL and nothing else.
 *
 * Every failure says what went wrong, and the client always offers the
 * OpenStreetMap note as the fallback, so a report can never dead-end.
 */
import type { APIEvent } from "@solidjs/start/server";
import { validateReport, composeNote } from "~/lib/report";

/** The slice of the KV namespace this route is allowed to use. */
interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

const PER_DEVICE_PER_HOUR = 5;
const GLOBAL_PER_DAY = 400;
const TTL_REPORT = 60 * 60 * 24 * 90; // 90 days, then it evaporates
const TTL_HOUR = 60 * 60;
const TTL_DAY = 60 * 60 * 24;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function inboxOf(event: APIEvent): KvLike | undefined {
  // Nitro's cloudflare_module handler parks the env on globalThis; the event
  // context carries it too. Either is fine — both are the same object.
  const ctx = event as unknown as {
    context?: { cloudflare?: { env?: Record<string, unknown> } };
  };
  const env =
    (globalThis as unknown as { __env__?: Record<string, unknown> }).__env__ ??
    ctx.context?.cloudflare?.env;
  const inbox = env?.INBOX;
  if (!inbox || typeof (inbox as KvLike).get !== "function") return undefined;
  return inbox as KvLike;
}

async function countOf(inbox: KvLike, key: string): Promise<number> {
  const raw = await inbox.get(key);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export async function POST(event: APIEvent): Promise<Response> {
  const inbox = inboxOf(event);
  if (!inbox) {
    return json(
      {
        ok: false,
        error:
          "The inbox is not available right now. Your report still matters — use the OpenStreetMap link, or try again later.",
      },
      503,
    );
  }

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json(
      { ok: false, error: "The report did not arrive as readable text. Try again." },
      400,
    );
  }

  const verdict = validateReport(body);
  if (!verdict.ok) {
    return json({ ok: false, error: verdict.error }, 400);
  }

  const request = event.request;
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const hourBucket = Math.floor(Date.now() / (TTL_HOUR * 1000));
  const dayBucket = Math.floor(Date.now() / (TTL_DAY * 1000));

  // KV is eventually consistent, so these caps are approximate by nature.
  // That is the right trade: a limiter that occasionally lets one extra report
  // through is fine; a limiter that makes the site serve pages from a database
  // is not, and this one never touches the serving path.
  //
  // Note for the test rig: wrangler dev emulates cf-connecting-ip, so the caps
  // apply locally too and local KV persists between runs. Start a preview for
  // e2e against a wiped state (`rm -rf .wrangler/state` before serving), or a
  // run within the hour of a previous one will rate-limit its own happy path.
  const [deviceCount, globalCount] = await Promise.all([
    countOf(inbox, `rl:dev:${ip}:${hourBucket}`),
    countOf(inbox, `rl:all:${dayBucket}`),
  ]);
  if (deviceCount >= PER_DEVICE_PER_HOUR || globalCount >= GLOBAL_PER_DAY) {
    return json(
      {
        ok: false,
        error:
          "Too many reports from here for now. Try again later — or send it to OpenStreetMap with the link below.",
      },
      429,
    );
  }

  const value = verdict.value;
  const id = `rep:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
  const record = {
    id,
    receivedAt: new Date().toISOString(),
    ...value,
    noteText: composeNote(value),
    userAgent: (request.headers.get("user-agent") ?? "").slice(0, 200),
  };

  await inbox.put(id, JSON.stringify(record), { expirationTtl: TTL_REPORT });
  await Promise.all([
    inbox.put(`rl:dev:${ip}:${hourBucket}`, String(deviceCount + 1), { expirationTtl: TTL_HOUR }),
    inbox.put(`rl:all:${dayBucket}`, String(globalCount + 1), { expirationTtl: TTL_DAY }),
  ]);

  return json({ ok: true, id }, 201);
}
