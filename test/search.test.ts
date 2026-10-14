/**
 * The browser-side search, tested against the same behaviour the server used.
 *
 * This module replaced a database query that cost a network round trip and a
 * slice of an account-wide quota to compute something a linear pass does for
 * free. These tests exist because the replacement is now load-bearing: if the
 * ordering or the counting drifts, nobody notices until the map looks wrong.
 */
import { describe, expect, it } from "vitest";
import { settleSelectionLoads } from "../src/lib/dataset";
import { filterBySelection, mergeRecords, searchPlaces } from "../src/lib/search";
import type { PlaceRecord } from "../src/lib/search";

function place(id: string, lat: number, lon: number, extra: Partial<PlaceRecord> = {}): PlaceRecord {
  return {
    id,
    name: extra.name ?? `Place ${id}`,
    lat,
    lon,
    primary: extra.primary ?? "dog-parks",
    selections: extra.selections ?? ["dog-parks"],
    dogPolicy: extra.dogPolicy ?? "designated",
    source: extra.source ?? "osm",
    verified: extra.verified ?? 0,
    ...extra,
  };
}

const LONDON = place("a", 51.5074, -0.1276, { name: "The Anchor", city: "London" });
const SHOREDITCH = place("b", 51.5245, -0.0786, { name: "The Crown", city: "London" });
const EDINBURGH = place("c", 55.9533, -3.1883, { name: "The Kibble", city: "Edinburgh" });
const BOTH = place("d", 51.51, -0.1, {
  name: "The Both",
  selections: ["dog-parks", "pubs"],
  primary: "dog-parks",
});

const ALL = [LONDON, SHOREDITCH, EDINBURGH, BOTH];
const GB: [number, number, number, number] = [-8.65, 49.85, 1.85, 60.9];

describe("searchPlaces", () => {
  it("returns everything in the viewport", () => {
    const r = searchPlaces(ALL, { bbox: GB, selections: [] });
    expect(r.total).toBe(4);
  });

  it("excludes places outside the viewport", () => {
    const r = searchPlaces(ALL, { bbox: [-0.5, 51.3, 0.3, 51.7], selections: [] });
    expect(r.places.map((p) => p.id).sort()).toEqual(["a", "b", "d"]);
    expect(r.places.map((p) => p.id)).not.toContain("c");
  });

  it("filters by selection", () => {
    const r = searchPlaces(ALL, { bbox: GB, selections: ["pubs"] });
    expect(r.places.map((p) => p.id)).toEqual(["d"]);
  });

  it("counts each selection before the selection filter, so a chip shows what switching it on adds", () => {
    const r = searchPlaces(ALL, { bbox: GB, selections: ["pubs"] });
    expect(r.places).toHaveLength(1);
    expect(r.counts["dog-parks"]).toBe(4);
    expect(r.counts["pubs"]).toBe(1);
  });

  it("sorts by distance from the search centre", () => {
    const r = searchPlaces(ALL, { bbox: GB, selections: [], near: [-0.1276, 51.5074] });
    expect(r.places[0]?.id).toBe("a");
    expect(r.places[r.places.length - 1]?.id).toBe("c");
  });

  it("measures distance in metres", () => {
    const r = searchPlaces(ALL, { bbox: GB, selections: [], near: [-0.1276, 51.5074] });
    const byId = Object.fromEntries(r.places.map((p) => [p.id, p.distance]));
    expect(byId["a"]).toBeLessThan(1); // itself
    expect(byId["d"]!).toBeLessThan(5000); // a couple of kilometres
    expect(byId["c"]!).toBeGreaterThan(400_000); // London to Edinburgh
  });

  it("applies a radius", () => {
    const r = searchPlaces(ALL, {
      bbox: GB,
      selections: [],
      near: [-0.1276, 51.5074],
      radius: 10_000,
    });
    expect(r.places.map((p) => p.id)).not.toContain("c");
    expect(r.total).toBe(3);
  });

  it("does not count places outside the radius", () => {
    const r = searchPlaces(ALL, {
      bbox: GB,
      selections: [],
      near: [-0.1276, 51.5074],
      radius: 10_000,
    });
    expect(r.counts["dog-parks"]).toBe(3);
  });

  it("searches name, city, street and postcode with AND", () => {
    expect(searchPlaces(ALL, { bbox: GB, selections: [], q: "anchor" }).total).toBe(1);
    expect(searchPlaces(ALL, { bbox: GB, selections: [], q: "edinburgh" }).total).toBe(1);
    expect(searchPlaces(ALL, { bbox: GB, selections: [], q: "anchor edinburgh" }).total).toBe(0);
  });

  it("ignores one-letter terms, because they match everything", () => {
    expect(searchPlaces(ALL, { bbox: GB, selections: [], q: "a" }).total).toBe(4);
  });

  it("treats an empty selection list as every selection", () => {
    const r = searchPlaces(ALL, { bbox: GB, selections: [] });
    expect(r.places.length).toBeGreaterThan(0);
    expect(r.total).toBe(4);
  });

  it("honours the limit but reports the true total", () => {
    const r = searchPlaces(ALL, { bbox: GB, selections: [], limit: 1 });
    expect(r.places).toHaveLength(1);
    expect(r.total).toBe(4);
  });

  it("does not mutate the records it was given", () => {
    const before = JSON.stringify(LONDON);
    searchPlaces(ALL, { bbox: GB, selections: [], near: [0, 51] });
    expect(JSON.stringify(LONDON)).toBe(before);
  });
});

describe("mergeRecords", () => {
  it("keeps one copy of a place that is in two selections", () => {
    const pubs = [LONDON, BOTH];
    const parks = [LONDON, EDINBURGH];
    expect(mergeRecords([pubs, parks])).toHaveLength(3);
  });
});

describe("filterBySelection", () => {
  it("keeps only the wanted selections", () => {
    expect(filterBySelection(ALL, ["pubs"]).map((p) => p.id)).toEqual(["d"]);
  });

  it("returns nothing when nothing is selected", () => {
    expect(filterBySelection(ALL, [])).toHaveLength(0);
  });
});

describe("settleSelectionLoads", () => {
  const ok = (n: string) =>
    ({ status: "fulfilled", value: [{ id: n } as PlaceRecord] }) as PromiseSettledResult<PlaceRecord[]>;
  const bad = () =>
    ({ status: "rejected", reason: new Error("offline") }) as PromiseSettledResult<PlaceRecord[]>;

  it("throws when every selection failed, rather than reporting an empty directory", () => {
    expect(() => settleSelectionLoads([bad(), bad()], 2)).toThrow(/offline/);
  });

  it("keeps what loaded when only some selections failed", () => {
    const merged = settleSelectionLoads([ok("a"), bad(), ok("b")], 3);
    expect(merged.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("does not throw on a partial failure even when only one succeeded", () => {
    expect(() => settleSelectionLoads([bad(), ok("a")], 2)).not.toThrow();
  });

  it("merges normally when everything loaded", () => {
    expect(settleSelectionLoads([ok("a"), ok("b")], 2).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("does not throw when nothing was asked for", () => {
    expect(settleSelectionLoads([], 0)).toEqual([]);
  });
});
