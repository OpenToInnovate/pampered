/**
 * The results drawer. On a phone it slides in from the right, closed until the
 * reader asks for it; on a desk it is the permanent right panel.
 *
 * The old bottom sheet always covered part of the map and the paw bar covered
 * the rest, so a phone showed a map with buttons on top of it. This one gives
 * the map the whole screen and keeps the controls one tap away behind a tab
 * that says how many places are there.
 *
 * Closed by default is a deliberate choice, not an oversight: the map is the
 * product, the list is the index. Selecting a place closes the drawer so the
 * mini-card gets a map worth looking at. Opening it again while a place is
 * selected is allowed — the close-on-select only fires on the transition.
 */
import { createEffect, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import type { JSX } from "solid-js";
import FurryPaw from "~/components/FurryPaw";

export default function SideDrawer(props: {
  title: string;
  count: string;
  /** A short number for the edge tab, not the full "1,234 places in view". */
  tabCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: JSX.Element;
  /** Selection chips. Hidden on desktop, where the overlay owns them. */
  filters?: JSX.Element;
  /** Open-now / sort / share. Hidden on desktop, where the overlay owns them. */
  toolbar?: JSX.Element;
  /** "Which vet are you with?" Shown on both layouts: it is a preference, not a filter. */
  vetPicker?: JSX.Element;
  /** True when a place card opened; the drawer gets out of the map's way. */
  closeWhen?: boolean;
}) {
  let panel: HTMLDivElement | undefined;
  let tab: HTMLButtonElement | undefined;
  let closeButton: HTMLButtonElement | undefined;
  let grip: HTMLDivElement | undefined;

  const [isDesktop, setIsDesktop] = createSignal(false);
  let startX = 0;
  let dragging = false;

  onMount(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    onCleanup(() => mq.removeEventListener("change", update));
  });

  // Close on the transition into "a place is selected", never while it stays
  // true: reopening the drawer to browse while a card is up is legitimate.
  createEffect(
    on(
      () => !!props.closeWhen,
      (selected) => {
        if (selected) props.onOpenChange(false);
      },
    ),
  );

  // Move focus in when the drawer opens, and back to the tab when it closes.
  createEffect(
    on(
      () => props.open,
      (open, previous) => {
        if (isDesktop()) return;
        if (open) queueMicrotask(() => closeButton?.focus());
        else if (previous) tab?.focus();
      },
    ),
  );

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isDesktop()) return;
      if (e.key === "Escape" && props.open) {
        e.preventDefault();
        props.onOpenChange(false);
        return;
      }
      if (e.key !== "Tab" || !props.open || !panel) return;
      const focusable = [
        ...panel.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  // Drag the left edge leftwards to dismiss. Live transform so the drawer
  // follows the thumb; a short drag snaps back, a long one closes.
  const onGripDown = (e: PointerEvent) => {
    if (isDesktop()) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragging = true;
    startX = e.clientX;
    grip?.setPointerCapture(e.pointerId);
  };
  const onGripMove = (e: PointerEvent) => {
    if (!dragging || !panel) return;
    const dx = Math.min(0, e.clientX - startX);
    panel.style.transition = "none";
    panel.style.transform = `translateX(${dx}px)`;
  };
  const onGripUp = (e: PointerEvent) => {
    if (!dragging || !panel) return;
    dragging = false;
    panel.style.transition = "";
    panel.style.transform = "";
    if (e.clientX - startX < -70) props.onOpenChange(false);
  };

  const tabLabel = () => {
    const n = props.tabCount;
    return `Open results: ${n.toLocaleString("en-GB")} ${n === 1 ? "place" : "places"} in view`;
  };

  return (
    <>
      <div
        class="drawer-scrim"
        data-open={props.open ? "true" : "false"}
        aria-hidden="true"
        onClick={() => props.onOpenChange(false)}
      />
      <button
        ref={tab}
        type="button"
        class="drawer-tab"
        aria-controls="results-drawer"
        aria-expanded={props.open}
        aria-label={tabLabel()}
        onClick={() => props.onOpenChange(true)}
      >
        <FurryPaw size={20} class="drawer-tab-paw" />
        <span class="drawer-tab-count">
          {props.tabCount > 999 ? `${Math.round(props.tabCount / 100) / 10}k` : props.tabCount}
        </span>
      </button>
      <aside
        ref={panel}
        id="results-drawer"
        class="drawer"
        data-open={props.open ? "true" : "false"}
        role={isDesktop() ? "region" : "dialog"}
        aria-modal={!isDesktop() && props.open ? "true" : undefined}
        aria-label={`${props.title}. ${props.count}`}
        inert={!isDesktop() && !props.open ? true : undefined}
      >
        <div
          ref={grip}
          class="drawer-grip"
          aria-hidden="true"
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          onPointerCancel={onGripUp}
        />
        <div class="drawer-head">
          <FurryPaw size={88} class="drawer-ghost" />
          <span class="drawer-title">
            <FurryPaw size={16} class="drawer-paw" />
            <strong>{props.title}</strong>
          </span>
          <span class="drawer-count muted tiny">{props.count}</span>
          <button
            ref={closeButton}
            type="button"
            class="drawer-close"
            aria-label="Close results"
            onClick={() => props.onOpenChange(false)}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <Show when={props.filters}>
          <div class="drawer-filters">{props.filters}</div>
        </Show>
        <Show when={props.toolbar}>
          <div class="drawer-tools">{props.toolbar}</div>
        </Show>
        <Show when={props.vetPicker}>
          <div class="drawer-vet">{props.vetPicker}</div>
        </Show>
        <div class="drawer-body">{props.children}</div>
      </aside>
    </>
  );
}
