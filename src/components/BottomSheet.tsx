/**
 * The bottom sheet. On a phone this is the interface: the map is behind it and
 * the list is in it. On a desktop it is a side panel instead, because a sheet
 * that covers half a 27-inch monitor is a joke.
 *
 * Three detents — peek, half, full — and a drag handle. Tapping the handle
 * cycles them, for the visitors who never discover drag. The sheet never closes
 * fully; peek always shows the count, because an empty-looking map with no list
 * reads as broken.
 *
 * Focus is left alone on drag (moving focus while someone reads is hostile),
 * but opening a place from the list moves focus to the mini-card, and closing
 * it returns focus to the card that opened it.
 */
import { createEffect, createSignal, onCleanup } from "solid-js";
import type { JSX } from "solid-js";

type Detent = "peek" | "half" | "full";
const ORDER: Detent[] = ["peek", "half", "full"];

export default function BottomSheet(props: {
  title: string;
  count: string;
  children: JSX.Element;
  onDetent?: (d: Detent) => void;
}) {
  const [detent, setDetent] = createSignal<Detent>("peek");
  let sheet: HTMLDivElement | undefined;
  let handle: HTMLDivElement | undefined;
  let startY = 0;
  let startDetent: Detent = "peek";
  let dragging = false;

  const cycle = () => {
    const next = ORDER[(ORDER.indexOf(detent()) + 1) % ORDER.length]!;
    setDetent(next);
    props.onDetent?.(next);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragging = true;
    startY = e.clientY;
    startDetent = detent();
    handle?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging || !sheet) return;
    const dy = startY - e.clientY; // up is positive
    const idx = ORDER.indexOf(startDetent);
    // 90px of travel commits to the next detent. Less than that snaps back,
    // because a sheet that changes size under a resting thumb is nauseating.
    if (dy > 90 && idx < ORDER.length - 1) {
      const next = ORDER[idx + 1]!;
      setDetent(next);
      props.onDetent?.(next);
      dragging = false;
    } else if (dy < -90 && idx > 0) {
      const next = ORDER[idx - 1]!;
      setDetent(next);
      props.onDetent?.(next);
      dragging = false;
    }
  };

  const onPointerUp = () => {
    dragging = false;
  };

  createEffect(() => {
    const h = handle;
    if (!h) return;
    h.addEventListener("pointerdown", onPointerDown);
    h.addEventListener("pointermove", onPointerMove);
    h.addEventListener("pointerup", onPointerUp);
    h.addEventListener("pointercancel", onPointerUp);
    onCleanup(() => {
      h.removeEventListener("pointerdown", onPointerDown);
      h.removeEventListener("pointermove", onPointerMove);
      h.removeEventListener("pointerup", onPointerUp);
      h.removeEventListener("pointercancel", onPointerUp);
    });
  });

  return (
    <section
      ref={sheet}
      class="sheet"
      data-detent={detent()}
      aria-label={`${props.title}. ${props.count}`}
    >
      <div
        ref={handle}
        class="sheet-handle"
        role="button"
        tabindex={0}
        aria-label={`Results ${detent()}. Activate to ${detent() === "full" ? "collapse" : "expand"}.`}
        onClick={cycle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            cycle();
          }
        }}
      >
        <span class="sheet-grip" aria-hidden="true" />
        <span class="sheet-title">
          <strong>{props.title}</strong>
          <span class="muted tiny">{props.count}</span>
        </span>
      </div>
      <div class="sheet-body">{props.children}</div>
    </section>
  );
}