/**
 * Formatting is read on a pavement with one hand. Wrong here means "340 m"
 * becoming "0.34 km" or a closed pub claiming to be open — both tested.
 */
import { describe, expect, it } from "vitest";
import { formatAddress, formatDistance, formatWalkTime, joinList, openState, pluralise } from "../src/lib/format";

describe("formatDistance", () => {
  it("uses metres under a kilometre", () => {
    expect(formatDistance(340)).toBe("340 m");
    expect(formatDistance(3)).toBe("5 m");
  });

  it("uses kilometres above", () => {
    expect(formatDistance(1500)).toBe("1.5 km");
    expect(formatDistance(14_000)).toBe("14 km");
    expect(formatDistance(200_000)).toBe("100 km+");
  });

  it("says nothing when there is nothing to say", () => {
    expect(formatDistance(null)).toBe("");
    expect(formatDistance(undefined)).toBe("");
    expect(formatDistance(NaN)).toBe("");
  });
});

describe("formatWalkTime", () => {
  it("rounds hard", () => {
    expect(formatWalkTime(80)).toBe("1 min walk");
    expect(formatWalkTime(800)).toBe("10 min walk");
    expect(formatWalkTime(5000)).toBe("1 h 3 min walk");
  });
});

describe("openState", () => {
  // Wednesdays, so Mo-Fr rules match.
  const wed = (h: number, m = 0) => new Date(2026, 9, 14, h, m);

  it("understands 24/7", () => {
    expect(openState("24/7", wed(3))).toEqual({ label: "Open 24 hours", tone: "good" });
  });

  it("understands a weekday range", () => {
    expect(openState("Mo-Fr 09:00-17:00", wed(12))).toEqual({ label: "Open until 17:00", tone: "good" });
    expect(openState("Mo-Fr 09:00-17:00", wed(8))?.tone).toBe("warn");
    expect(openState("Mo-Fr 09:00-17:00", wed(20))?.tone).toBe("bad");
  });

  it("understands overnight hours are a bar, not a typo", () => {
    expect(openState("Mo-Su 18:00-02:00", wed(23))?.tone).toBe("good");
    expect(openState("Mo-Su 18:00-02:00", wed(12))?.tone).toBe("bad");
  });

  it("says nothing it cannot prove", () => {
    expect(openState(null)).toBeNull();
    expect(openState("")).toBeNull();
    expect(openState("by appointment")).toBeNull();
  });
});

describe("formatAddress", () => {
  it("puts the postcode last so it survives truncation", () => {
    expect(formatAddress({ street: "1 Example St", city: "London", postcode: "E1 6AN" })).toBe(
      "1 Example St, London E1 6AN",
    );
  });
});

describe("joinList", () => {
  it("joins like a person", () => {
    expect(joinList([])).toBe("");
    expect(joinList(["Cafés"])).toBe("Cafés");
    expect(joinList(["Cafés", "Pubs"])).toBe("Cafés and Pubs");
    expect(joinList(["Cafés", "Pubs", "Bars"])).toBe("Cafés, Pubs and Bars");
  });
});

describe("pluralise", () => {
  it("counts in British English", () => {
    expect(pluralise(1, "place")).toBe("1 place");
    expect(pluralise(1200, "place")).toBe("1,200 places");
  });
});