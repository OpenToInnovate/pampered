/**
 * Colour maths for provider branding.
 *
 * A sponsor's colour arrives as a brand asset, not as a design choice: some are
 * very light (Creature Comforts' lilac is #F3E9FD), and white text on them is
 * unreadable. Rather than refuse the colour or quietly replace it, we keep it
 * as the tint and derive two readable partners from it:
 *
 *   textOn(colour)      — white or near-black, whichever reads on the tint
 *   readableInk(colour) — the tint darkened until it can carry white text
 *
 * Both stay in the brand's hue, so the card is still recognisably theirs.
 */

function channels(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1] ?? "", 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0")).join("")}`;
}

function linear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const rgb = channels(hex);
  if (!rgb) return 0;
  const r = linear(rgb[0]);
  const g = linear(rgb[1]);
  const b = linear(rgb[2]);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

const DARK_INK = "#1b1b1b";

/** Text colour that reads on `background`. */
export function textOn(background: string): string {
  return contrastRatio(background, DARK_INK) >= contrastRatio(background, "#ffffff")
    ? DARK_INK
    : "#ffffff";
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/**
 * The brand colour, darkened in HSL so white text clears 4.5:1 on it. A very
 * pale tint has almost no saturation, and darkening it in RGB would turn it
 * grey; lifting the saturation as we darken keeps the lilac recognisably lilac.
 */
export function readableInk(colour: string, against = "#ffffff"): string {
  const rgb = channels(colour);
  if (!rgb) return colour;
  const [h, s0, l0] = rgbToHsl(rgb);
  const s = Math.max(s0, 0.32);
  let l = l0;
  for (let i = 0; i < 30 && contrastRatio(toHex(hslToRgb([h, s, l])), against) < 4.5; i++) {
    l = Math.max(0, l - 0.04);
  }
  return toHex(hslToRgb([h, s, l]));
}
