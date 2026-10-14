/**
 * One row in the result list. Three lines and a pill, never a paragraph:
 *
 *   Name                                  340 m
 *   Dogs welcome inside · Open until 17:00
 *   1 Example Street, London
 *
 * A venue with no name shows its selection label ("Dog park") instead of
 * nothing, because an unnamed pin that opens an unnamed card is a dead end.
 */
import { A } from "@solidjs/router";
import { dogPolicyLabel, dogPolicyTone, selection } from "~/content/selections";
import { formatDistance, openState } from "~/lib/format";
import type { SlimPlace } from "~/server/places";

function toneClass(tone: string): string {
  return tone === "good" ? "pill-good" : tone === "warn" ? "pill-warn" : tone === "bad" ? "pill-bad" : "pill-unknown";
}

export function SourceBadge(props: { source: string; verified: boolean }) {
  if (props.source === "curated" && props.verified) {
    return <span class="pill pill-good">Checked by us</span>;
  }
  if (props.source === "curated") {
    return <span class="pill pill-unknown">Curated</span>;
  }
  if (props.source === "manual") {
    return <span class="pill pill-unknown">Not checked yet</span>;
  }
  return null;
}

export default function PlaceCard(props: {
  place: SlimPlace;
  selected: boolean;
  href: string;
  onSelect: (id: string) => void;
}) {
  const p = () => props.place;
  const displayName = () => {
    if (p().name) return p().name;
    const primary = p().primary ?? p().selections[0];
    return selection(primary ?? "")?.label ?? "Place";
  };
  const open = () => openState(p().openingHours);
  const policy = () => p().dogPolicy ?? "unknown";

  return (
    <li>
      <A
        href={props.href}
        class="place-card"
        classList={{ "place-card-selected": props.selected }}
        aria-current={props.selected ? "true" : undefined}
        onClick={() => props.onSelect(p().id)}
      >
        <span class="place-card-main">
          <span class="row place-card-top">
            <strong class="place-card-name">{displayName()}</strong>
            <span class="spacer" />
            {p().distance != null && (
              <span class="place-card-distance muted">{formatDistance(p().distance)}</span>
            )}
          </span>
          <span class="row place-card-pills">
            <span class={`pill ${toneClass(dogPolicyTone(policy()))}`}>
              {dogPolicyLabel(policy())}
            </span>
            {open() && <span class={`pill ${toneClass(open()!.tone)}`}>{open()!.label}</span>}
            <SourceBadge source={p().source} verified={p().verified} />
          </span>
          {(p().street || p().city || p().postcode) && (
            <span class="place-card-address muted tiny">
              {[p().street, p().city].filter(Boolean).join(", ")}
              {p().postcode ? ` ${p().postcode}` : ""}
            </span>
          )}
        </span>
        <span class="place-card-go" aria-hidden="true">
          ›
        </span>
      </A>
    </li>
  );
}

/** The empty list. Says what is empty and what would fill it, not just "nothing found". */
export function EmptyList(props: { q: string; selectionCount: number }) {
  return (
    <div class="empty-list">
      <p>
        <strong>Nothing here{props.q ? ` for “${props.q}”` : ""}.</strong>
      </p>
      <p class="muted tiny">
        {props.selectionCount === 0
          ? "Every selection is switched off. Switch one back on to see its places."
          : "Try zooming out, clearing the search, or switching on another selection."}
      </p>
    </div>
  );
}
