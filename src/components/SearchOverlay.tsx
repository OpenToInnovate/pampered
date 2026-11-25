/**
 * The search overlay. A phone's keyboard belongs to a full screen, not to a
 * box floating over a map: the map is the product, and a search that covers it
 * is a search that has to end before the map can be used.
 *
 * Opened from the header pill (and from the paw bar's search paw), it gives
 * the thumb three things in one place: the input, every selection as a tappable
 * tile (the same yaml the chips read — adding a selection adds a tile), and the
 * city jump. Tapping a tile filters and closes, so the map answers immediately.
 */
import { createEffect, For, Show } from "solid-js";
import FurryPaw from "~/components/FurryPaw";
import { SelectionIcon } from "~/map/icons";
import { regions } from "~/content/selections";
import type { ChipSelection } from "~/components/SelectionChips";

export default function SearchOverlay(props: {
  open: boolean;
  chips: ChipSelection[];
  near: boolean;
  locating: boolean;
  onClose: () => void;
  onToggle: (id: string) => void;
  onSearch: (q: string) => void;
  onNear: () => void;
}) {
  let input: HTMLInputElement | undefined;
  let text = "";

  createEffect(() => {
    if (props.open) {
      // Focus after the overlay is in the tree, or the keyboard never opens.
      requestAnimationFrame(() => input?.focus());
    }
  });

  const jump = (id: string) => {
    const region = regions.find((r) => r.id === id);
    if (!region) return;
    window.dispatchEvent(
      new CustomEvent("pampered:jump", {
        detail: { lon: region.centre[0], lat: region.centre[1], zoom: region.zoom },
      }),
    );
    props.onClose();
  };

  return (
    <Show when={props.open}>
      <div class="search-overlay" role="dialog" aria-modal="true" aria-label="Search and filter">
        <form
          class="overlay-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            props.onSearch(text.trim());
            props.onClose();
          }}
        >
          <button
            type="button"
            class="btn btn-quiet btn-icon"
            aria-label="Close search"
            onClick={props.onClose}
          >
            ←
          </button>
          <label class="sr-only" for="overlay-search-input">
            Search dog-friendly places
          </label>
          <input
            ref={input}
            id="overlay-search-input"
            type="search"
            autocomplete="off"
            placeholder="Search pubs, cafés, parks…"
            value={text}
            onInput={(e) => (text = e.currentTarget.value)}
          />
          <button type="submit" class="btn btn-primary">
            Search
          </button>
        </form>

        <div class="overlay-scroll">
          <h2 class="overlay-title">
            <FurryPaw size={16} class="sheet-paw" />
            Browse
          </h2>
          <div class="overlay-grid" role="group" aria-label="Show on the map">
            <For each={props.chips}>
              {(c) => (
                <button
                  type="button"
                  class="overlay-tile"
                  classList={{ "overlay-tile-on": c.active }}
                  aria-pressed={c.active}
                  style={{ "--chip-colour": c.colour }}
                  onClick={() => {
                    props.onToggle(c.id);
                    props.onClose();
                  }}
                >
                  <SelectionIcon name={c.icon} size={20} />
                  <span class="overlay-tile-label">{c.short}</span>
                  <Show when={c.count != null}>
                    <span class="overlay-tile-count">{c.count}</span>
                  </Show>
                </button>
              )}
            </For>
          </div>

          <h2 class="overlay-title">Near you</h2>
          <button
            type="button"
            class="btn overlay-near"
            aria-pressed={props.near}
            disabled={props.locating}
            onClick={() => {
              props.onNear();
              props.onClose();
            }}
          >
            <FurryPaw size={18} />
            {props.locating ? "Locating…" : props.near ? "Clear nearby search" : "Use my location"}
          </button>

          <h2 class="overlay-title">Jump to a city</h2>
          <div class="overlay-cities">
            <For each={regions}>
              {(r) => (
                <button type="button" class="chip" onClick={() => jump(r.id)}>
                  {r.label}
                </button>
              )}
            </For>
          </div>
          <p class="tiny muted overlay-note">
            A report is not a check: new places are verified before they are published.
          </p>
        </div>
      </div>
    </Show>
  );
}