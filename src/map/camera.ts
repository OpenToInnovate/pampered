/**
 * Camera comparison in the precision the URL stores it at.
 *
 * Pure, with no map, Solid or DOM in it, so this file holds the rule that stops
 * the snap loop and can be tested directly. See `MapView` for why this matters:
 *
 *   The URL stores the camera rounded (lon/lat to 5 dp, zoom to 2 dp). Any
 *   comparison against the live camera has to happen in that same rounded space,
 *   otherwise the URL's echo of a pan never matches, and the map is flown back
 *   to where it was a moment ago. `MapView` only flies on values the URL does not
 *   already hold, which makes the echo loop impossible by construction: the map
 *   can never be told to fly to something the URL already knows about.
 *
 * Position is the only part of the camera this interface exposes, so it is the
 * only thing that can drift and trigger a fly. Bearing is not user-settable
 * through this UI, so it is deliberately not part of the comparison.
 */

import type { LonLat } from "~/lib/geo";

/** The fields the URL actually carries. */
export interface UrlCamera {
  centre: LonLat;
  zoom: number;
}

/** The shape of a controller `Camera` with an optional pitch. */
export interface CameraLike {
  centre: LonLat;
  zoom: number;
  bearing: number;
  pitch?: number;
}

const round = (n: number, places: number): number => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

/** The value of a camera exactly as the URL would store it. */
export function cameraToUrl(c: CameraLike): UrlCamera {
  return {
    centre: [round(c.centre[0], 5), round(c.centre[1], 5)],
    zoom: round(c.zoom, 2),
  };
}

/** A camera already at URL precision, for assertions in tests. */
export function stored(c: CameraLike): CameraLike {
  return {
    centre: cameraToUrl(c).centre,
    zoom: cameraToUrl(c).zoom,
    bearing: 0,
    pitch: 0,
  };
}

/**
 * True when two cameras occupy the same rounded position the URL would store.
 *
 * A missing `a` means nothing has been written to the URL yet, so it is never
 * the same as anything: the first URL value for a new viewpoint always flies.
 */
export function sameCamera(a: CameraLike | null, b: CameraLike): boolean {
  if (!a) return false;
  const qa = cameraToUrl(a);
  const qb = cameraToUrl(b);
  return qa.centre[0] === qb.centre[0] && qa.centre[1] === qb.centre[1] && qa.zoom === qb.zoom;
}
