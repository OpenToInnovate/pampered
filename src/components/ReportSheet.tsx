/**
 * The paw report sheet. A couple of clicks from any place: pick what changed,
 * say it in a sentence, send. No account, no cookies, nothing collected but
 * the words the visitor typed and where they typed them about.
 *
 * Two publication channels, both visible in the sheet:
 *   - the inbox (POST /report), reviewed by us and published through the
 *     curated pipeline once somebody checks it;
 *   - a prefilled OpenStreetMap note, where OSM volunteers review it and every
 *     OSM consumer benefits. The OSM link is offered in every state — success,
 *     failure, offline — because a report that can dead-end is a report lost.
 *
 * Errors say what went wrong and what to do instead; "say what went wrong" is
 * the rule the empty-page outage taught this repo.
 */
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import FurryPaw from "~/components/FurryPaw";
import {
  NOTE_MAX,
  NOTE_MIN,
  REPORT_KINDS,
  osmEditUrl,
  osmNoteUrl,
  validateReport,
} from "~/lib/report";
import type { ReportInput } from "~/lib/report";

export interface ReportPlace {
  id?: string;
  name?: string | null;
  lat?: number;
  lon?: number;
}

export default function ReportSheet(props: { place: ReportPlace; onClose: () => void }) {
  const [kind, setKind] = createSignal<string>(REPORT_KINDS[0].id);
  const [note, setNote] = createSignal("");
  const [sending, setSending] = createSignal(false);
  const [done, setDone] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [copied, setCopied] = createSignal(false);
  let firstChip: HTMLButtonElement | undefined;
  let honeypot: HTMLInputElement | undefined;

  onMount(() => firstChip?.focus({ preventScroll: true }));
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  const asReport = (): ReportInput => ({
    kind: kind(),
    note: note(),
    placeId: props.place.id,
    placeName: props.place.name ?? undefined,
    lat: props.place.lat,
    lon: props.place.lon,
    // The honeypot's value rides along so the shared validator can trip on it.
    website: honeypot?.value ?? "",
  });

  const osmNote = () => osmNoteUrl(asReport());
  const osmEditor = () => osmEditUrl(asReport());

  const copyReport = async () => {
    const body = [
      osmNote() ?? "No map position — say where in the text.",
      "",
      note(),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const answer = window.prompt("Copy this report:", body);
      if (answer != null) setCopied(true);
    }
  };

  const submit = async () => {
    setError(null);
    const verdict = validateReport(asReport());
    if (!verdict.ok) {
      setError(verdict.error);
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(asReport()),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && body?.ok) {
        setDone(true);
      } else {
        setError(body?.error ?? "The inbox did not accept the report. The OpenStreetMap link below always works.");
      }
    } catch {
      setError("Could not reach the inbox. The OpenStreetMap link below always works.");
    } finally {
      setSending(false);
    }
  };

  const placeLabel = () => props.place.name ?? "this place";

  return (
    <div class="report-backdrop" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <section class="report-sheet" role="dialog" aria-modal="true" aria-labelledby="report-title">
        <div class="row report-head">
          <FurryPaw size={20} class="report-paw" />
          <strong id="report-title">
            {done() ? "Paw stamp received" : `Report ${placeLabel()}`}
          </strong>
          <span class="spacer" />
          <button
            type="button"
            class="btn btn-quiet btn-icon"
            aria-label="Close report form"
            onClick={props.onClose}
          >
            ×
          </button>
        </div>

        <Show
          when={!done()}
          fallback={
            <div class="report-done stack">
              <FurryPaw size={44} class="report-paw-big" />
              <p>
                Thank you. The report is in the inbox, and a human will check it before anything
                changes on the map.
              </p>
              <p class="muted tiny">
                Faster for everyone: send the same report to OpenStreetMap, where volunteers
                review it and every dog walker benefits.
              </p>
              <Show when={osmNote()}>
                {(url) => (
                  <a class="btn btn-primary" href={url()} rel="noopener" target="_blank">
                    Send it to OpenStreetMap ↗
                  </a>
                )}
              </Show>
              <button type="button" class="btn" onClick={props.onClose}>
                Done
              </button>
            </div>
          }
        >
          <p class="muted tiny">
            Checked facts reach everyone; nothing is published unchecked. Two minutes, no account.
          </p>

          <div class="report-kinds" role="group" aria-label="What kind of report">
            {REPORT_KINDS.map((k) => (
              <button
                ref={k.id === REPORT_KINDS[0].id ? firstChip : undefined}
                type="button"
                class="chip"
                classList={{ "chip-active": kind() === k.id }}
                aria-pressed={kind() === k.id}
                style={{ "--chip-colour": "var(--accent)" }}
                onClick={() => setKind(k.id)}
              >
                {k.label}
              </button>
            ))}
          </div>

          <label class="stack report-note-label">
            <span class="sr-only">What did you see?</span>
            <textarea
              aria-label="What did you see?"
              placeholder={
                kind() === "new"
                  ? "Name, street, and why a dog walker would care…"
                  : "What did you see? Say what is true now — bowls, seating, policy…"
              }
              value={note()}
              onInput={(e) => setNote(e.currentTarget.value)}
              maxlength={NOTE_MAX + 50}
            />
            <span class="tiny muted report-count" aria-live="polite">
              {note().trim().length} / {NOTE_MAX} characters — at least {NOTE_MIN}
            </span>
          </label>

          {/* The honeypot: invisible, untitled, and ignored by people. */}
          <input
            ref={honeypot}
            class="sr-only"
            type="text"
            name="website"
            tabindex={-1}
            autocomplete="off"
            aria-hidden="true"
          />

          <Show when={error()}>
            {(msg) => (
              <p class="tiny report-error" role="alert">
                {msg()}
              </p>
            )}
          </Show>

          <div class="row report-actions">
            <button type="button" class="btn btn-primary" disabled={sending()} onClick={submit}>
              <FurryPaw size={16} paw="currentColor" />
              {sending() ? "Sending…" : "Send it"}
            </button>
            <button type="button" class="btn btn-quiet" onClick={copyReport}>
              {copied() ? "Copied ✓" : "Copy the report"}
            </button>
            <span class="spacer" />
            <Show when={osmNote()}>
              {(url) => (
                <a class="btn btn-quiet" href={url()} rel="noopener" target="_blank">
                  OpenStreetMap ↗
                </a>
              )}
            </Show>
          </div>

          <Show when={kind() === "new" && osmEditor()}>
            {(url) => (
              <p class="tiny muted">
                Adding a place?{" "}
                <a href={url()} rel="noopener" target="_blank">
                  Open the OSM editor at this spot
                </a>{" "}
                — and send the report above so we know to check it.
              </p>
            )}
          </Show>
        </Show>
      </section>
    </div>
  );
}
