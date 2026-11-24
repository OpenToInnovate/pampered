/**
 * Formatting is read on a pavement with one hand. Wrong here means "340 m"
 * becoming "0.34 km" or a closed pub claiming to be open — both tested.
 */
import { describe, expect, it } from "vitest";
import {
  formatAddress,
  formatCheckedDate,
  formatDistance,
  formatWalkTime,
  joinList,
  openState,
  pluralise,
} from "../src/lib/format";

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

describe("formatCheckedDate", () => {
  it("writes the date as text, so no timezone can move it", () => {
    expect(formatCheckedDate("2023-10-16")).toBe("16 Oct 2023");
    expect(formatCheckedDate("2026-01-01")).toBe("1 Jan 2026");
  });

  it("returns nothing for a date it cannot read", () => {
    expect(formatCheckedDate(null)).toBeNull();
    expect(formatCheckedDate("16/10/2023")).toBeNull();
    expect(formatCheckedDate("2023-13-01")).toBeNull();
  });
});

describe("openState", () => {
  // Wednesdays, so Mo-Fr rules match. Built as British time (BST, +01:00 in
  // October) so the test means the same thing on every machine.
  const wed = (h: number, m = 0) =>
    new Date(`2026-10-14T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+01:00`);

  it("reads the hours in British time, whatever the visitor's clock says", () => {
    // 08:30 in London is 09:30 in Berlin. The pub opens at 09:00 by London's clock.
    expect(openState("Mo-Fr 09:00-17:00", wed(8, 30))?.tone).toBe("warn");
    // 16:30 in London is 17:30 in Tokyo. Still open by London's clock.
    expect(openState("Mo-Fr 09:00-17:00", wed(16, 30))?.tone).toBe("good");
  });

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

  it("reads the day in British time too", () => {
    // Monday 00:30 in London is Sunday 23:30 in UTC. A Sunday-only rule must not match.
    const mondayEarly = new Date("2026-10-12T00:30:00+01:00");
    // No rule covers a Monday, so the honest answer is silence, not "closed".
    expect(openState("Su 10:00-16:00", mondayEarly)).toBeNull();
    expect(openState("Mo 00:00-09:00", mondayEarly)?.tone).toBe("good");
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