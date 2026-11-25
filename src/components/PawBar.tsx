/**
 * The paw bar: the filter row that lives in the thumb's reach.
 *
 * It renders every selection from selections.yaml, not a hand-picked four —
 * the old bar hardcoded restaurants/cafés/pubs/dog-parks, so adding a
 * selection was a code change and the bar silently disagreed with the chips.
 * Now one yaml edit adds a paw, a chip, a layer and a tile, and this row is
 * last to know and first to show it.
 *
 * The row scrolls sideways and never wraps: a filter row that wraps pushes the
 * map off a phone. The leading paw is the way into search, so the bar is also
 * the shortest path to the one thing a filter row cannot express.
 */
import { For } from "solid-js";
import FurryPaw from "~/components/FurryPaw";
import { SelectionIcon } from "~/map/icons";
import type { ChipSelection } from "~/components/SelectionChips";

export default function PawBar(props: {
  chips: ChipSelection[];
  onToggle: (id: string) => void;
  onSearch: () => void;
}) {
  return (
    <div class="pawbar">
      <button
        type="button"
        class="pawbar-search"
        aria-label="Search places"
        onClick={props.onSearch}
      >
        <FurryPaw size={22} />
      </button>
      <nav class="pawbar-scroll" aria-label="Filter the map">
        <For each={props.chips}>
          {(c) => (
            <button
              type="button"
              class="pawbar-btn"
              classList={{ "pawbar-on": c.active }}
              aria-pressed={c.active}
              style={{ "--paw-colour": c.colour }}
              onClick={() => props.onToggle(c.id)}
            >
              <SelectionIcon name={c.icon} size={19} class="pawbar-icon" />
              <span class="pawbar-label">{c.short}</span>
              {c.count != null && <span class="pawbar-count">{c.count}</span>}
            </button>
          )}
        </For>
      </nav>
    </div>
  );
}