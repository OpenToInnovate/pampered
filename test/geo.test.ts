/**
 * The projector is the fallback map. If it cannot round-trip a coordinate,
 * the SVG fallback draws pins in the wrong places on exactly the devices that
 * cannot run anything better — so this is tested to boredom.
 */
import { describe, expect, it } from "vitest";
import {
  bboxOf,
  bboxOfPoints,
  circleRing,
  clampBbox,
  distMetres,
  geomPath,
  makeProjector,
  pointOf,
} from "../src/lib/geo";

describe("makeProjector", () => {
  it("round-trips a point through project and invert", () => {
    const project = makeProjector([-0.5, 51.3, 0.5, 51.7], 800, 600);
    const [x, y] = project(-0.1276, 51.5074);
    const [lon, lat] = project.invert(x, y);
    expect(lon).toBeCloseTo(-0.1276, 8);
    expect(lat).toBeCloseTo(51.5074, 8);
  });

  it("centres the bbox in the viewport", () => {
    const project = makeProjector([-1, 50, 1, 52], 800, 600);
    const [x, y] = project(0, 51);
    expect(x).toBeCloseTo(400, 0);
    expect(y).toBeCloseTo(300, 0);
  });

  it("does not divide by zero on a degenerate bbox", () => {
    const project = makeProjector([0, 0, 0, 0], 800, 600);
    const [x, y] = project(0, 0);
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);
  });
});

describe("distMetres", () => {
  it("knows London from Paris", () => {
    // 344 km, give or take the ellipsoid. Good to 0.5%.
    const d = distMetres(51.5074, -0.1276, 48.8566, 2.3522);
    expect(d).toBeGreaterThan(340_000);
    expect(d).toBeLessThan(348_000);
  });

  it("is zero for the same point", () => {
    expect(distMetres(51.5, -0.1, 51.5, -0.1)).toBe(0);
  });

  it("measures a street in metres, not kilometres", () => {
    const d = distMetres(51.5074, -0.1276, 51.5084, -0.1276);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(125);
  });
});

describe("bboxOf", () => {
  it("finds the extent of mixed geometry", () => {
    const box = bboxOf([
      { geometry: { coordinates: [1, 2] } },
      { geometry: { coordinates: [[[0, 0], [3, 0], [3, 4], [0, 0]]] } },
    ]);
    expect(box).toEqual([0, 0, 3, 4]);
  });

  it("returns a zero box for nothing", () => {
    expect(bboxOf([])).toEqual([0, 0, 0, 0]);
    expect(bboxOf([{ geometry: null }])).toEqual([0, 0, 0, 0]);
  });
});

describe("clampBbox", () => {
  it("clamps latitude to the mercator range", () => {
    expect(clampBbox([-180, -90, 180, 90])).toEqual([-180, -85.051129, 180, 85.051129]);
  });
});

describe("geomPath", () => {
  it("draws a polygon as a closed path", () => {
    const project = makeProjector([0, 0, 10, 10], 800, 600, 0);
    const d = geomPath({ type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 0]]] }, project);
    expect(d).toMatch(/^M[\d.,-]+(?:L[\d.,-]+)+Z$/);
  });

  it("returns empty for nothing", () => {
    const project = makeProjector([0, 0, 10, 10], 800, 600, 0);
    expect(geomPath(null, project)).toBe("");
    expect(geomPath(undefined, project)).toBe("");
  });
});

describe("pointOf", () => {
  it("returns points directly", () => {
    expect(pointOf({ geometry: { type: "Point", coordinates: [1, 2] } })).toEqual([1, 2]);
  });

  it("averages polygon rings", () => {
    expect(pointOf({ geometry: { type: "Polygon", coordinates: [[[0, 0], [4, 0], [4, 4], [0, 0]]] } })).toEqual([
      2, 1,
    ]);
  });

  it("returns null without geometry", () => {
    expect(pointOf({})).toBeNull();
  });
});

describe("circleRing", () => {
  it("closes the ring", () => {
    const ring = circleRing(-0.1, 51.5, 1000, 16);
    expect(ring).toHaveLength(17);
    expect(ring[0]).toEqual(ring[16]);
  });

  it("is roughly a kilometre across", () => {
    const ring = circleRing(-0.1, 51.5, 1000, 64);
    const north = ring.reduce((a, b) => (b[1]! > a[1]! ? b : a));
    const south = ring.reduce((a, b) => (b[1]! < a[1]! ? b : a));
    const d = distMetres(north[1]!, north[0]!, south[1]!, south[0]!);
    expect(d).toBeGreaterThan(1950);
    expect(d).toBeLessThan(2050);
  });
});

describe("bboxOfPoints", () => {
  it("contains every point", () => {
    const box = bboxOfPoints([
      [-0.5, 51.0],
      [0.5, 52.0],
    ]);
    expect(box).toEqual([-0.5, 51, 0.5, 52]);
  });
});