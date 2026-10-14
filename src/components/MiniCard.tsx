/**
 * The card docked above the sheet when a pin or a list row is tapped.
 *
 * It is the same information as the list row, plus a Details link and a close
 * button, because the thing someone wants after tapping a pin is either "tell
 * me more" or "go away". Focus moves here on open and returns to the opener on
 * close; a mini-card that steals focus and never gives it back is a trap.
 */
import { A } from "@solidjs/router";
import { onCleanup, onMount } from "solid-js";
import { dogPolicyLabel, dogPolicyTone } from "~/content/selections";
import { formatAddress } from "~/lib/format";
import type { SlimPlace } from "~/server/places";
import { SourceBadge } from "./PlaceCard";

export default function MiniCard(props: {
  place: SlimPlace;
  detailHref: string;
  onClose: () => void;
  returnFocusTo?: HTMLElement | null;
}) {
  let card: HTMLDivElement | undefined;
  let closeBtn: HTMLButtonElement | undefined;

  onMount(() => closeBtn?.focus({ preventScroll: true }));
  onCleanup(() => props.returnFocusTo?.focus({ preventScroll: true }));

  const p = () => props.place;
  const name = () => p().name ?? "Place";

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
        {p().website && (
          <a href={p().website!} class="btn" rel="noopener" target="_blank">
            Website
          </a>
        )}
      </div>
    </div>
  );
}