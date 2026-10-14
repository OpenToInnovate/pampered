/**
 * The registry is the file every other file reads. If the defaults are empty,
 * first-time visitors see a blank map; if a colour lookup throws, pins vanish.
 * Both are tested because both have happened in other projects.
 */
import { describe, expect, it } from "vitest";
import {
  colourOf,
  defaultSelectionIds,
  dogPolicyLabel,
  dogPolicyTone,
  primarySelectionId,
  selection,
  selections,
} from "../src/content/selections";

describe("selections", () => {
  it("loads every selection from the YAML", () => {
    expect(selections.length).toBeGreaterThanOrEqual(11);
    for (const s of selections) {
      expect(s.id).toMatch(/^[a-z0-9-]+$/);
      expect(s.colour).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("has at least one default so the map is never born empty", () => {
    expect(defaultSelectionIds.length).toBeGreaterThan(0);
    for (const id of defaultSelectionIds) expect(selection(id)).toBeDefined();
  });

  it("ids are unique", () => {
    const ids = selections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("colourOf", () => {
  it("returns the selection colour", () => {
    expect(colourOf("cafes")).toBe(selection("cafes")?.colour);
  });

  it("returns grey for a renamed selection rather than throwing", () => {
    expect(colourOf("taxi-scam")).toBe("#6B7280");
  });
});

describe("primarySelectionId", () => {
  it("picks the first in registry order", () => {
    const ids = [selections[3]!.id, selections[0]!.id];
    expect(primarySelectionId(ids)).toBe(selections[0]!.id);
  });

  it("returns null for nothing", () => {
    expect(primarySelectionId([])).toBeNull();
    expect(primarySelectionId(null)).toBeNull();
  });
});

describe("dogPolicyLabel", () => {
  it("labels the known values", () => {
    expect(dogPolicyLabel("yes")).toBe("Dogs welcome inside");
    expect(dogPolicyLabel("outside")).toBe("Outside seating only");
    expect(dogPolicyLabel("no")).toBe("No dogs");
  });

  it("is honest about the unknown", () => {
    expect(dogPolicyLabel(null)).toBe("Not stated");
    expect(dogPolicyLabel("our_side")).toBe("Not stated");
  });
});

describe("dogPolicyTone", () => {
  it("grades severity", () => {
    expect(dogPolicyTone("yes")).toBe("good");
    expect(dogPolicyTone("no")).toBe("bad");
    expect(dogPolicyTone("unknown")).toBe("warn");
  });
});