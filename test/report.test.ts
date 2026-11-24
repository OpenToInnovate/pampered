import { describe, expect, it } from "vitest";
import {
  composeNote,
  osmEditUrl,
  osmNoteUrl,
  validateReport,
} from "~/lib/report";

const base = {
  kind: "bowl",
  note: "There is a water bowl by the door.",
  placeId: "osm:node/10047419845",
  placeName: "Copper Coast Cafe",
  lat: 52.14251,
  lon: -7.36512,
};

describe("validateReport", () => {
  it("accepts a clean report and strips the honeypot", () => {
    const v = validateReport({ ...base, website: "" });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.value.kind).toBe("bowl");
      expect("website" in v.value).toBe(false);
      // Coordinates are rounded to the published precision.
      expect(v.value.lat).toBe(52.1425);
    }
  });

  it("turns away a filled honeypot without explanation", () => {
    const v = validateReport({ ...base, website: "http://spam.example" });
    expect(v).toEqual({ ok: false, error: "The report could not be accepted." });
  });

  it("rejects a note too short to be useful", () => {
    const v = validateReport({ ...base, note: "nice" });
    expect(v.ok).toBe(false);
  });

  it("rejects a note that is past the cap", () => {
    const v = validateReport({ ...base, note: "x".repeat(501) });
    expect(v.ok).toBe(false);
  });

  it("rejects an unknown kind", () => {
    const v = validateReport({ ...base, kind: "shout" });
    expect(v.ok).toBe(false);
  });

  it("rejects a position that is only half a position", () => {
    expect(validateReport({ ...base, lon: undefined }).ok).toBe(false);
    expect(validateReport({ ...base, lat: undefined }).ok).toBe(false);
  });

  it("rejects coordinates outside the planet", () => {
    expect(validateReport({ ...base, lat: 123 }).ok).toBe(false);
    expect(validateReport({ ...base, lon: 999 }).ok).toBe(false);
  });

  it("rejects a body that is not an object", () => {
    expect(validateReport("hello").ok).toBe(false);
    expect(validateReport(null).ok).toBe(false);
  });
});

describe("composeNote", () => {
  it("names the place, the osm id and the kind, in plain text", () => {
    const v = validateReport(base);
    if (!v.ok) throw new Error("fixture invalid");
    const note = composeNote(v.value);
    expect(note).toContain("[pampered.korg-e.com] Water bowl");
    expect(note).toContain("“Copper Coast Cafe” (osm:node/10047419845)");
    expect(note).toContain("There is a water bowl by the door.");
  });

  it("survives a place with no name and no osm id", () => {
    const v = validateReport({ kind: "new", note: "A new grooming van on the seafront." });
    if (!v.ok) throw new Error("fixture invalid");
    const note = composeNote(v.value);
    expect(note).toContain("A place");
    expect(note).not.toContain("undefined");
  });
});

describe("osmNoteUrl", () => {
  it("carries the note text and a map position", () => {
    const v = validateReport(base);
    if (!v.ok) throw new Error("fixture invalid");
    const url = osmNoteUrl(v.value);
    expect(url).not.toBeNull();
    expect(url).toMatch(/^https:\/\/www\.openstreetmap\.org\/note\/new\?/);
    expect(url).toContain("lat=52.1425");
    expect(url).toContain("lon=-7.3651");
    expect(url).toContain(encodeURIComponent("Water bowl"));
    expect(url).toContain("#map=18/");
  });

  it("is null without a position — a link that goes nowhere is worse than none", () => {
    const v = validateReport({ kind: "other", note: "The whole park is off-lead now." });
    if (!v.ok) throw new Error("fixture invalid");
    expect(osmNoteUrl(v.value)).toBeNull();
    expect(osmEditUrl(v.value)).toBeNull();
  });
});
