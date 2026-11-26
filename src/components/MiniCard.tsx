/**
 * The card docked over the map when a pin or a list row is tapped.
 *
 * It is the same information as the list row, plus a Details link and a close
 * button, because the thing someone wants after tapping a pin is either "tell
 * me more" or "go away". Focus moves here on open and returns to the opener on
 * close; a mini-card that steals focus and never gives it back is a trap.
 */
import { A } from "@solidjs/router";
import { onCleanup, onMount } from "solid-js";
import FurryPaw from "~/components/FurryPaw";
import { dogPolicyLabel, dogPolicyTone, selection } from "~/content/selections";
import { formatAddress } from "~/lib/format";
import type { PlaceRecord as SlimPlace } from "~/lib/search";
import { SourceBadge } from "./PlaceCard";

export default function MiniCard(props: {
  place: SlimPlace;
  detailHref: string;
  onClose: () => void;
  onReport?: () => void;
  returnFocusTo?: HTMLElement | null;
}) {
  let card: HTMLDivElement | undefined;
  let closeBtn: HTMLButtonElement | undefined;

  onMount(() => closeBtn?.focus({ preventScroll: true }));
  onCleanup(() => props.returnFocusTo?.focus({ preventScroll: true }));

  const p = () => props.place;
  // The same fallback the list uses: an unnamed pin is still a dog park, not a
  // blank card with a "Place" label.
  const name = () => {
    const named = p().name;
    if (named) return named;
    const primary = p().primary ?? p().selections[0];
    return selection(primary ?? "")?.label ?? "Place";
  };

  return (
    <div ref={card} class="mini-card" role="dialog" aria-label={name()}>
      <div class="row mini-card-top">
        <strong class="mini-card-name">{name()}</strong>
        <span class="spacer" />
        <button
          ref={closeBtn}
          type="button"
          class="btn btn-quiet btn-icon"
          aria-label="Close place card"
          onClick={props.onClose}
        >
          ×
        </button>
      </div>
      <div class="row mini-card-pills">
        <span
          class={`pill ${dogPolicyTone(p().dogPolicy ?? "unknown") === "good" ? "pill-good" : dogPolicyTone(p().dogPolicy ?? "unknown") === "warn" ? "pill-warn" : "pill-bad"}`}
        >
          {dogPolicyLabel(p().dogPolicy)}
        </span>
        <SourceBadge source={p().source} verified={p().verified} />
      </div>
      {(p().street || p().city || p().postcode) && (
        <p class="muted tiny mini-card-address">
          {formatAddress({ street: p().street, city: p().city, postcode: p().postcode })}
        </p>
      )}
      <div class="row mini-card-actions">
        <A href={props.detailHref} class="btn btn-primary">
          Details
        </A>
        {props.onReport && (
          <button
            type="button"
            class="btn report-open"
            aria-label={`Add a detail about ${name()}`}
            onClick={props.onReport}
          >
            <FurryPaw size={16} />
            Add a detail
          </button>
        )}
        {p().website && (
          <a href={p().website!} class="btn" rel="noopener" target="_blank">
            Website
          </a>
        )}
      </div>
    </div>
  );
}