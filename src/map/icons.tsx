/**
 * The glyphs for the selections, drawn to survive at sixteen pixels.
 *
 * Every icon is a couple of primitives in a 24x24 box, stroked at 1.9 with
 * round caps, except the paw which is filled circles and an ellipse because a
 * stroked paw reads as a flower. No icon carries meaning on its own: the chip
 * next to it always has the word. That is deliberate; a glyph that only ever
 * appears beside its label is allowed to be simple.
 *
 * `paths` is exported separately so the map can turn the same drawings into
 * MapLibre images without mounting a component. Same strokes, no second source
 * of truth.
 */
import type { JSX } from "solid-js";

export const ICON_NAMES = [
  "fork",
  "cup",
  "pint",
  "glass",
  "cone",
  "scissors",
  "cross",
  "bag",
  "paw",
  "paw-off",
  "drop",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

interface IconDef {
  /** Stroked paths, drawn with currentColor. */
  stroke?: string;
  /** Filled shapes, drawn with currentColor. Paw and paw-off only. */
  fill?: string;
}

export const ICON_PATHS: Record<IconName, IconDef> = {
  fork: {
    stroke:
      "M7 3v7 M12 3v9 M17 3v7 M7 10c0 2 2.2 3 5 3s5-1 5-3 M12 13v8",
  },
  cup: {
    stroke: "M5 9h14l-1.4 10.4a1 1 0 0 1-1 .6H7.4a1 1 0 0 1-1-.6L5 9z M19 10.5h.8a2.6 2.6 0 0 1 0 5.2H19",
  },
  pint: {
    stroke: "M6.5 3h11L16.4 19.7a1 1 0 0 1-1 .8H8.6a1 1 0 0 1-1-.8L6.5 3z M6.8 6.5h10.4",
  },
  glass: {
    stroke: "M4 4.5h16c0 4.2-3.6 7-8 7s-8-2.8-8-7z M12 11.5V19 M8.5 21h7",
  },
  cone: {
    stroke: "M7 10.5h10L12 20.5 7 10.5z M7 10.5a5 5 0 0 1 10 0",
  },
  scissors: {
    stroke:
      "M6 6.5a2.6 2.6 0 1 0 .1 0 M6 17.5a2.6 2.6 0 1 0 .1 0 M8.2 8.1L20 19 M8.2 15.9L20 5",
  },
  cross: {
    stroke: "M12 5.5v13 M5.5 12h13",
  },
  bag: {
    stroke: "M6 8.5h12l-.9 11a1 1 0 0 1-1 .9H7.9a1 1 0 0 1-1-.9L6 8.5z M9 8.5V6.8a3 3 0 0 1 6 0v1.7",
  },
  paw: {
    fill:
      "M12 13.2c-2.6 0-4.6 2-4.6 4 0 1.5 1.1 2.5 2.6 2.5.9 0 1.4-.3 2-.3s1.1.3 2 .3c1.5 0 2.6-1 2.6-2.5 0-2-2-4-4.6-4z" +
      "M6.4 9.4m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M9.7 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0" +
      "M14.3 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M17.6 9.4m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
  },
  "paw-off": {
    fill:
      "M12 13.2c-2.6 0-4.6 2-4.6 4 0 1.5 1.1 2.5 2.6 2.5.9 0 1.4-.3 2-.3s1.1.3 2 .3c1.5 0 2.6-1 2.6-2.5 0-2-2-4-4.6-4z" +
      "M6.4 9.4m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M9.7 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0" +
      "M14.3 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M17.6 9.4m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
    stroke: "M4.5 4.5l15 15",
  },
  drop: {
    stroke: "M12 3.5c3.4 4.4 5.8 7.7 5.8 11a5.8 5.8 0 0 1-11.6 0c0-3.3 2.4-6.6 5.8-11z",
  },
};

export function isIconName(value: string): value is IconName {
  return (ICON_NAMES as readonly string[]).includes(value);
}

/** An SVG string, for MapLibre `addImage` and anywhere a component cannot go. */
export function iconSvg(name: IconName, stroke = "currentColor", size = 24): string {
  const def = ICON_PATHS[name];
  const inner = [
    def.fill ? `<path d="${def.fill}" fill="${stroke}" stroke="none"/>` : "",
    def.stroke
      ? `<path d="${def.stroke}" fill="none" stroke="${stroke}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>`
      : "",
  ].join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}">${inner}</svg>`;
}

export function Icon(props: { name: IconName; size?: number; class?: string; title?: string }) {
  const size = () => props.size ?? 20;
  const def = () => ICON_PATHS[props.name];
  return (
    <svg
      class={props.class}
      width={size()}
      height={size()}
      viewBox="0 0 24 24"
      role="img"
      aria-label={props.title ?? props.name}
    >
      {def().fill && <path d={def().fill} fill="currentColor" stroke="none" />}
      {def().stroke && (
        <path
          d={def().stroke}
          fill="none"
          stroke="currentColor"
          stroke-width="1.9"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      )}
    </svg>
  );
}

/** The component, behind a name lookup so a chip can render an icon from a string. */
export function SelectionIcon(props: { name: string; size?: number; class?: string }) {
  if (!isIconName(props.name)) return null;
  return <Icon name={props.name} size={props.size} class={props.class} title={props.name} />;
}

// Re-export the JSX type for callers that build icon lists.
export type { JSX };
