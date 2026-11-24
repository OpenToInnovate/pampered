/**
 * The paw, furry. One shape — pad and four toes — run through an SVG
 * displacement filter whose noise roughens the edges into fur. Nothing else in
 * the app draws a paw like this, so the filter lives here and nowhere else;
 * every paw on the page goes through this component and stays consistent.
 *
 * The filter id is unique per instance because ids are document-global and a
 * duplicated id makes only the first paw furry — the rest render smooth, which
 * is the kind of bug that takes a screenshot to notice.
 */
import { createUniqueId } from "solid-js";

export default function FurryPaw(props: {
  size?: number;
  class?: string;
  /** Draw the brand circle behind the paw, in this colour. */
  circle?: string;
  /** Paw fill; defaults to currentColor so CSS owns the colour. */
  paw?: string;
  title?: string;
}) {
  const filterId = `furry-paw-${createUniqueId()}`;
  const size = () => props.size ?? 22;
  return (
    <svg
      class={props.class}
      width={size()}
      height={size()}
      viewBox="0 0 24 24"
      role={props.title ? "img" : "presentation"}
      aria-hidden={props.title ? undefined : true}
      aria-label={props.title}
    >
      <defs>
        <filter id={filterId} x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.62"
            numOctaves="2"
            seed="7"
            result="fur"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="fur"
            scale="1.9"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
      {props.circle && <circle cx="12" cy="12" r="10.4" fill={props.circle} />}
      <g filter={`url(#${filterId})`} fill={props.paw ?? "currentColor"}>
        <ellipse cx="12" cy="15" rx="4.6" ry="3.6" />
        <circle cx="6.1" cy="10.2" r="2.05" />
        <circle cx="9.9" cy="7.2" r="2.2" />
        <circle cx="14.4" cy="7.4" r="2.2" />
        <circle cx="18" cy="10.4" r="2" />
      </g>
    </svg>
  );
}
