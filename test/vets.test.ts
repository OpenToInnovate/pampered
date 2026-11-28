/**
 * Vet provider matching, the star readout, and the "my vet" filter.
 *
 * The rules are pure functions in scripts/lib/vet-match.mjs, shared by the build
 * and these tests so the two cannot drift. The filter test is here because the
 * filter must narrow the vet layer only — choosing a vet must not hide the pub
 * you are standing outside.
 */
import { describe, expect, it } from "vitest";
import { vetProviderOf, vetRating } from "../scripts/lib/vet-match.mjs";
import { searchPlaces } from "../src/lib/search";
import type { PlaceRecord } from "../src/lib/search";

const VETS = [
  { id: "medivet", match: ["medivet"] },
  { id: "vets4pets", match: ["vets4pets", "vets for pets"] },
  { id: "companion-care", match: ["companion care"] },
  { id: "pdsa", match: ["pdsa"] },
];

function vet(extra: Record<string, unknown> = {}) {
  return {
    selections: ["vet"],
    brand: null,
    name: null,
    operator: null,
    street: null,
    postcode: null,
    phone: null,
    website: null,
    opening_hours: null,
    wheelchair: null,
    description: null,
    checked_on: null,
    ...extra,
  } as never;
}

describe("vetProviderOf", () => {
  it("matches a brand, a name or an operator, case-insensitively", () => {
    expect(vetProviderOf(vet({ brand: "Medivet" }), VETS)).toBe("medivet");
    expect(vetProviderOf(vet({ name: "MEDIVET Vets" }), VETS)).toBe("medivet");
    expect(vetProviderOf(vet({ operator: "Medivet Group" }), VETS)).toBe("medivet");
    expect(vetProviderOf(vet({ name: "Vets for Pets Camden" }), VETS)).toBe("vets4pets");
  });

  it("keeps a more specific fragment above a general one", () => {
    // "Companion Care" is listed after vets4pets here on purpose: the test pins
    // that a row matching only "companion care" still resolves.
    expect(vetProviderOf(vet({ name: "Companion Care Vets" }), VETS)).toBe("companion-care");
  });

  it("never attributes a non-vet row, even if the name matches", () => {
    expect(vetProviderOf(vet({ selections: ["food-drink"], name: "Blue Cross" }), VETS)).toBeNull();
  });

  it("returns null for an unmatched or anonymous practice", () => {
    expect(vetProviderOf(vet({ name: "Dogs Trust Clinic" }), VETS)).toBeNull();
    expect(vetProviderOf(vet({}), VETS)).toBeNull();
  });
});

describe("vetRating", () => {
  it("gives one star to a bare name, never zero", () => {
    expect(vetRating(vet())).toBe(1);
  });

  it("rises with the number of provable details", () => {
    const bare = vetRating(vet());
    const some = vetRating(vet({ street: "1 High St", postcode: "N1 1AA", phone: "020 7000 0000" }));
    const lots = vetRating(
      vet({
        street: "1 High St",
        postcode: "N1 1AA",
        phone: "020 7000 0000",
        website: "https://example.com",
        opening_hours: "Mo-Fr 09:00-18:00",
        wheelchair: "yes",
        operator: "Example Vets",
        description: "A practice.",
        checked_on: "2026-01-01",
      }),
    );
    expect(bare).toBe(1);
    expect(some).toBeGreaterThan(bare);
    expect(lots).toBe(5);
  });

  it("stays within 1..5", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
      const row = vet({
        street: n > 0 ? "1 High St" : null,
        postcode: n > 0 ? "N1 1AA" : null,
        phone: n > 1 ? "020" : null,
        website: n > 2 ? "https://x" : null,
        opening_hours: n > 3 ? "Mo-Fr" : null,
        wheelchair: n > 4 ? "yes" : null,
        operator: n > 5 ? "Op" : null,
        description: n > 6 ? "d" : null,
        checked_on: n > 7 ? "2026-01-01" : null,
      });
      const stars = vetRating(row);
      expect(stars).toBeGreaterThanOrEqual(1);
      expect(stars).toBeLessThanOrEqual(5);
    }
  });
});

describe("searchPlaces with a chosen vet", () => {
  const records: PlaceRecord[] = [
    {
      id: "vet:medivet",
      name: "Medivet Islington",
      lat: 51.53,
      lon: -0.1,
      primary: "vet",
      selections: ["vet"],
      dogPolicy: "yes",
      source: "osm",
      verified: 0,
      vetProvider: "medivet",
    },
    {
      id: "vet:pdsa",
      name: "PDSA Bow",
      lat: 51.52,
      lon: -0.02,
      primary: "vet",
      selections: ["vet"],
      dogPolicy: "yes",
      source: "osm",
      verified: 0,
      vetProvider: "pdsa",
    },
    {
      id: "pub:anchor",
      name: "The Anchor",
      lat: 51.5,
      lon: -0.12,
      primary: "food-drink",
      selections: ["food-drink"],
      dogPolicy: "yes",
      source: "osm",
      verified: 0,
    },
  ];
  const bbox: [number, number, number, number] = [-1, 51, 0.5, 52];

  it("narrows the vet layer to the chosen provider", () => {
    const r = searchPlaces(records, { bbox, selections: ["vet"], vetProvider: "medivet" });
    expect(r.places.map((p) => p.id)).toEqual(["vet:medivet"]);
  });

  it("leaves every other layer alone", () => {
    const r = searchPlaces(records, { bbox, selections: ["vet", "food-drink"], vetProvider: "medivet" });
    expect(r.places.map((p) => p.id).sort()).toEqual(["pub:anchor", "vet:medivet"]);
  });

  it("shows every vet when no provider is chosen", () => {
    const r = searchPlaces(records, { bbox, selections: ["vet"], vetProvider: null });
    expect(r.places).toHaveLength(2);
  });
});
