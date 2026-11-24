/**
 * The paw bar. A phone's thumb lives at the bottom of the screen, so the
 * quickest actions do too: search, near-me, and the four selections people ask
 * for by name. Hidden from 720px up, where the chips row already does the job
 * without covering any map.
 *
 * Every button is a furry paw in the colour of what it opens, and every target
 * is at least 44px tall — the bar is 56px of it. The bar never hides the
 * attribution: map.css lifts MapLibre's controls above it on phones, and the
 * credit stays visible because it is a legal requirement, not decoration.
 */
import { For } from "solid-js";
import FurryPaw from "./FurryPaw";

export interface PawAction {
  id: string;
  label: string;
  colour: string;
  /** Toggles carry pressed state; plain actions (search) do not. */
  pressed?: boolean;
  disabled?: boolean;
  count?: number | null;
  onPress: () => void;
}

export default function PawBar(props: { actions: PawAction[] }) {
  return (
    <nav class="pawbar" aria-label="Quick access">
      <For each={props.actions}>
        {(a) => (
          <button
            type="button"
            class="pawbar-btn"
            style={{ "--paw-colour": a.colour }}
            aria-pressed={a.pressed === undefined ? undefined : !!a.pressed}
            disabled={a.disabled}
            aria-label={
              a.pressed === undefined
                ? a.label
                : `${a.label}, ${a.pressed ? "on" : "off"}`
            }
            onClick={() => a.onPress()}
          >
            <FurryPaw size={22} class="pawbar-paw" />
            <span class="pawbar-label">{a.label}</span>
            {a.count != null && <span class="pawbar-count">{a.count}</span>}
          </button>
        )}
      </For>
    </nav>
  );
}
