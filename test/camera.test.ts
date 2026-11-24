/**
 * The snap loop, as a unit test. The map reports a camera, the URL stores it
 * rounded, and the URL's rounded copy must still be recognised as the map's own
 * echo. If it is not, the map flies back to where it was and the user sees the
 * zoom snap. Both halves are here: an echo is ignored, a real external move is not.
 *
 * The URL stores lon/lat to 5 dp and zoom to 2 dp. `sameCamera` compares in that
 * same precision, so a viewpoint that the URL already knows is never flown to.
 */
import { describe, expect, it } from "vitest";
import { sameCamera, stored } from "../src/map/camera";
import type { CameraLike } from "../src/map/camera";
import { cameraForCommit, parseView, serialiseView, toggleSelection } from "../src/lib/url-state";

const KNOWN = new Set(["cafes", "pubs", "dog-parks"]);

describe("sameCamera (the snap-loop guard)", () => {
  it("treats a camera stored at URL precision as the same camera", () => {
    const live: CameraLike = { centre: [-0.1276123456, 51.5074987654], zoom: 11.3456789, bearing: 12.7 };
    expect(sameCamera(stored(live), live)).toBe(true);
  });

  it("does not match a camera the user has genuinely moved away from", () => {
    const a: CameraLike = { centre: [-0.1276, 51.5074], zoom: 11, bearing: 0 };
    const b: CameraLike = { centre: [-0.1, 51.5], zoom: 11, bearing: 0 };
    expect(sameCamera(a, b)).toBe(false);
  });

  it("does not match a different zoom, even by a little", () => {
    const a: CameraLike = { centre: [0, 51], zoom: 11, bearing: 0 };
    const b: CameraLike = { centre: [0, 51], zoom: 11.5, bearing: 0 };
    expect(sameCamera(a, b)).toBe(false);
  });

  it("is stable under repeated URL conversion", () => {
    const c: CameraLike = { centre: [-2.2426543, 53.4808123], zoom: 12.3456, bearing: 45.6 };
    expect(sameCamera(stored(c), stored(c))).toBe(true);
  });

  it("treats a missing last-emitted camera as different, so the first URL value is applied", () => {
    expect(sameCamera(null, { centre: [0, 51], zoom: 10, bearing: 0 })).toBe(false);
  });
});

describe("cameraForCommit (controls must not snap the map back)", () => {
  const stale = parseView("?at=-0.1,51.5,10", KNOWN);

  it("uses the live camera over the URL's, which lags the pan", () => {
    const v = cameraForCommit(stale, { centre: [-2.24, 53.48], zoom: 13, bearing: 0 });
    expect(v.at).toEqual([-2.24, 53.48]);
    expect(v.zoom).toBe(13);
  });

  it("falls back to the URL when the map has not reported a camera yet", () => {
    expect(cameraForCommit(stale, null)).toBe(stale);
  });

  it("does not change anything the camera does not own", () => {
    const withQuery = { ...stale, q: "pub", sel: ["pubs"] };
    const v = cameraForCommit(withQuery, { centre: [0, 51], zoom: 12, bearing: 0 });
    expect(v.q).toBe("pub");
    expect(v.sel).toEqual(["pubs"]);
  });
});

describe("toggleSelection", () => {
  it("adds a known selection at the end, keeping the visitor's order", () => {
    expect(toggleSelection(["pubs", "cafes"], "dog-parks", KNOWN)).toEqual(["pubs", "cafes", "dog-parks"]);
  });

  it("removes a selection that is already on", () => {
    expect(toggleSelection(["pubs", "cafes"], "pubs", KNOWN)).toEqual(["cafes"]);
  });

  it("ignores an unknown id rather than adding it to the URL", () => {
    expect(toggleSelection(["pubs"], "taxi-scam", KNOWN)).toEqual(["pubs"]);
  });

  it("does not mutate its input", () => {
    const input = ["pubs"];
    toggleSelection(input, "cafes", KNOWN);
    expect(input).toEqual(["pubs"]);
  });

  it("allows switching every selection off, so the list can say why it is empty", () => {
    expect(toggleSelection(["pubs"], "pubs", KNOWN)).toEqual([]);
  });
});
