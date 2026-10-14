/**
 * The map on the page. A thin Solid shell around `controller.ts`.
 *
 * The shell does three things and nothing else: it creates the controller once
 * the container exists, it translates prop changes into controller calls, and
 * it translates controller events into prop callbacks. All data fetching, URL
 * writing and selection state live in the parent — the map never fetches and
 * never writes the URL, because a component that both moves and reports where
 * it moved is a feedback loop waiting for a reason.
 *
 * Accessibility: the map container is `aria-hidden`. The result list is the
 * interface for screen readers and keyboards, and every pin has a list twin.
 * Hiding the map is not hiding information; it is refusing to present a
 * canvas of coloured dots as if it were navigable content.
 */
import { createEffect, onCleanup, onMount } from "solid-js";
import { primarySelectionId } from "~/content/selections";
import type { Bbox } from "~/lib/geo";
import { createMap, toPinFeatures } from "./controller";
import type { Camera, MapHandle, PinFeature, SelectionStyle } from "./controller";

const primarySelectionFallback = (ids: readonly string[]): string | null =>
  primarySelectionId(ids);

export interface MapPlace {
  id: string;
  name: string | null;
  lat: number;
  lon: number;
  primary: string | null;
  selections: string[];
}

interface Props {
  camera: Camera;
  places: MapPlace[];
  activeSelections: readonly string[];
  selectedId: string | null;
  styles: SelectionStyle[];
  onViewport: (bbox: Bbox, camera: Camera) => void;
  onSelect: (id: string | null) => void;
  onFailed: (reason: string) => void;
}

export default function MapView(props: Props) {
  let container: HTMLDivElement | undefined;
  let handle: MapHandle | null = null;
  let appliedCamera: Camera | null = null;
  let lastEmitted: Camera | null = null;
  let ro: ResizeObserver | undefined;

  const sameCamera = (a: Camera | null, b: Camera): boolean => {
    if (!a) return false;
    return (
      Math.abs(a.centre[0] - b.centre[0]) < 1e-7 &&
      Math.abs(a.centre[1] - b.centre[1]) < 1e-7 &&
      Math.abs(a.zoom - b.zoom) < 1e-6 &&
      Math.abs(a.bearing - b.bearing) < 1e-6
    );
  };

  onMount(() => {
    if (!container) {
      props.onFailed("no container");
      return;
    }
    let cancelled = false;

    // The controller is dynamically imported with the map itself: there is no
    // reason to ship MapLibre to a visitor whose device has already told us it
    // cannot run it, and none to ship it for the server render either.
    void createMap(container, props.camera, props.styles, {
      onMoveEnd: (bbox, camera) => {
        lastEmitted = camera;
        props.onViewport(bbox, camera);
      },
      onSelect: (id) => props.onSelect(id),
      onFailed: (reason) => {
        if (!cancelled) props.onFailed(reason);
      },
      onReady: () => {
        if (cancelled || !handle) return;
        const bbox = handle.getBbox();
        const camera = handle.getCamera();
        if (bbox && camera) {
          lastEmitted = camera;
          props.onViewport(bbox, camera);
        }
      },
    }).then((h) => {
      if (cancelled) {
        h?.destroy();
        return;
      }
      handle = h;
      if (!h) return; // onFailed already fired
      appliedCamera = { ...props.camera };
      h.setAllFeatures(toPinFeatures(props.places, primarySelectionFallback));
      h.setActiveSelections(props.activeSelections);
      h.setSelected(props.selectedId);
    });

    ro = new ResizeObserver(() => handle?.resize());
    if (container) ro.observe(container);

    onCleanup(() => {
      cancelled = true;
      ro?.disconnect();
      handle?.destroy();
      handle = null;
    });
  });

  // Places in, pins out. Runs on every fetch; the controller diffs nothing and
  // just sets the data, which for a few hundred points is cheaper than diffing.
  createEffect(() => {
    const places = props.places;
    if (handle) handle.setAllFeatures(toPinFeatures(places, primarySelectionFallback));
  });

  createEffect(() => {
    if (handle) handle.setActiveSelections(props.activeSelections);
  });

  createEffect(() => {
    const id = props.selectedId;
    if (!handle) return;
    handle.setSelected(id);
    if (!id) return;
    // A tap on the map is already looking at the pin. A tap in the list usually
    // is not. Flying only when the pin is off-screen tells the two apart
    // without the parent having to say which one it was.
    const pin = props.places.find((p) => p.id === id);
    if (!pin) return;
    const bbox = handle.getBbox();
    const camera = handle.getCamera();
    if (!bbox || !camera) return;
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const inside =
      pin.lon >= minLon && pin.lon <= maxLon && pin.lat >= minLat && pin.lat <= maxLat;
    if (!inside) {
      handle.flyToCamera({ centre: [pin.lon, pin.lat], zoom: Math.max(camera.zoom, 14), bearing: 0, pitch: 0 });
    }
  });

  // The URL is the source of truth for the camera, but the map is the source of
  // truth for where it actually is. When they disagree and the disagreement did
  // not come from the map itself — a region jump, back/forward, a shared link —
  // the map moves. `lastEmitted` is how we know the change was ours.
  createEffect(() => {
    const wanted = props.camera;
    if (!handle) return;
    if (sameCamera(appliedCamera, wanted)) return;
    if (sameCamera(lastEmitted, wanted)) {
      appliedCamera = { ...wanted };
      return;
    }
    appliedCamera = { ...wanted };
    lastEmitted = { ...wanted };
    handle.flyToCamera(wanted);
  });

  return (
    <div
      ref={container}
      class="map-container"
      aria-hidden="true"
      data-testid="map"
    />
  );
}

// Re-exported so routes can name the types without importing the controller.
export type { Bbox, Camera, SelectionStyle };
export type { PinFeature };
