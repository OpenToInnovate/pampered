/**
 * The selection chips. This is the legend, the filter and the layer switch in
 * one row, because splitting those three across three different controls is how
 * a map ends up with a legend nobody reads and filters nobody finds.
 *
 * Each chip shows the selection's icon in its colour, its short label, and how
 * many places are in view. Tapping toggles the selection on the map. The row
 * scrolls horizontally and never wraps, because a filter row that wraps pushes
 * the map off a phone screen.
 */
import { For } from "solid-js";
import { SelectionIcon } from "~/map/icons";

export interface ChipSelection {
  id: string;
  short: string;
  icon: string;
  colour: string;
  count: number | null;
  active: boolean;
}

export default function SelectionChips(props: {
  chips: ChipSelection[];
  onToggle: (id: string) => void;
}) {
  return (
    <div class="chips" role="group" aria-label="Show on the map">
      <For each={props.chips}>
        {(chip) => (
          <button
            type="button"
            class="chip"
            classList={{ "chip-active": chip.active }}
            aria-pressed={chip.active}
            style={{ "--chip-colour": chip.colour }}
            onClick={() => props.onToggle(chip.id)}
          >
            <SelectionIcon name={chip.icon} size={17} />
            <span class="chip-label">{chip.short}</span>
            {chip.count != null && (
              <span class="chip-count" aria-label={`${chip.count} in view`}>
                {chip.count > 999 ? `${Math.round(chip.count / 100) / 10}k` : chip.count}
              </span>
            )}
          </button>
        )}
      </For>
    </div>
  );
}