/**
 * The card shown above the vet results when a visitor has chosen their vet.
 *
 * It carries the provider's mark and colour, says plainly that it is sponsored
 * when the provider is a sponsor, and offers the one action that matters: open
 * their health-plan or booking page. The brand colour stays inside this card —
 * it never tints the map, the chips or the rest of the interface, and a sponsor
 * is never ranked above another practice.
 */
import { A } from "@solidjs/router";
import { Show } from "solid-js";
import { ProviderMark } from "~/components/VetPicker";
import type { VetProvider, VetRegistry } from "~/content/vets";

export default function SponsorCard(props: {
  provider: VetProvider;
  policy: VetRegistry["policy"] | undefined;
  onClear: () => void;
  /** Fallback when the provider has no plan or site of its own. */
  placeWebsite?: string | null;
}) {
  const p = () => props.provider;
  const href = () => p().planUrl ?? p().website ?? props.placeWebsite ?? null;
  const label = () => (p().planUrl ? "Manage your plan" : p().website ? `Visit ${p().name}` : "Website");

  return (
    <section
      class="sponsor-card"
      style={{ "--vet-colour": p().colour }}
      aria-label={`${p().name}${p().sponsor ? ", sponsor" : ""}`}
    >
      <div class="row sponsor-card-top">
        <ProviderMark provider={p()} size={34} />
        <div class="sponsor-card-title">
          <Show
            when={p().sponsor}
            fallback={<span class="sponsor-card-kicker">Your vet</span>}
          >
            <span class="sponsor-card-kicker">{props.policy?.disclosure ?? "Sponsored by"}</span>
          </Show>
          <strong class="sponsor-card-name">{p().name}</strong>
        </div>
        <span class="spacer" />
        <button type="button" class="btn btn-quiet tiny" onClick={props.onClear}>
          Change
        </button>
      </div>

      <Show when={!p().confirmed}>
        <p class="tiny sponsor-card-draft">
          Draft preview — this provider has not yet confirmed its colour, logo and links.
        </p>
      </Show>

      <div class="row sponsor-card-actions">
        <Show
          when={href()}
          fallback={<span class="tiny muted">No plan or booking page recorded for this provider.</span>}
        >
          {(url) => (
            <a
              class="btn btn-primary"
              href={url()}
              rel="noopener noreferrer"
              target="_blank"
              style={{ "background-color": p().colour, "border-color": p().colour }}
            >
              {label()} ↗
            </a>
          )}
        </Show>
        <A href={`/about#sponsorship`} class="tiny muted sponsor-card-policy">
          How sponsorship works
        </A>
      </div>

      <Show when={p().count === 0}>
        <p class="tiny muted">
          No practices for this provider are in the current map view. Zoom out or move the map.
        </p>
      </Show>
    </section>
  );
}
