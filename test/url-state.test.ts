/**
 * The URL is the share button, the back button and the API to the map state.
 * If parse and serialise disagree, shared links open the wrong view — so the
 * round-trip is the test that matters, plus a refusal to believe malicious or
 * nonsense input.
 */
import { describe, expect, it } from "vitest";
import { bboxForCamera, parseView, serialiseView } from "../src/lib/url-state";

const IDS = new Set(["food-drink", "vet", "dog-parks"]);

describe("parseView", () => {
  it("reads a full URL", () => {
    const v = parseView("?q=pub&at=-0.12,51.5,14&sel=food-drink,taxi-scam&p=abc&near=-0.1,51.5&radius=2000", IDS);
    expect(v.q).toBe("pub");
    expect(v.at).toEqual([-0.12, 51.5]);
    expect(v.zoom).toBe(14);
    expect(v.sel).toEqual(["food-drink"]);
    expect(v.place).toBe("abc");
    expect(v.near).toEqual([-0.1, 51.5]);
    expect(v.radius).toBe(2000);
  });

  it("falls back to defaults on an empty search", () => {
    const v = parseView("", IDS);
    expect(v.q).toBe("");
    expect(v.sel.length).toBeGreaterThan(0);
    expect(v.place).toBeNull();
    expect(v.zoom).toBeGreaterThan(2);
  });

  it("drops unknown selection ids rather than trusting them", () => {
    const v = parseView("?sel=food-drink,taxi-scam", IDS);
    expect(v.sel).toEqual(["food-drink"]);
  });

  it("falls back to defaults when every selection is unknown", () => {
    const v = parseView("?sel=nope", IDS);
    expect(v.sel.length).toBeGreaterThan(0);
  });

  it("ignores a camera outside the planet", () => {
    const v = parseView("?at=0,95,10", IDS);
    expect(v.at?.[1]).toBeLessThanOrEqual(85.1);
  });

  it("clamps zoom, radius and trims long queries", () => {
    const v = parseView(`?at=0,51,99&q=${"x".repeat(200)}&radius=999999`, IDS);
    expect(v.zoom).toBeLessThanOrEqual(19);
    expect(v.radius).toBeLessThanOrEqual(50_000);
    expect(v.q.length).toBeLessThanOrEqual(120);
  });

  it("normalises bearing into 0–360", () => {
    const v = parseView("?at=0,51,10,-45", IDS);
    expect(v.bearing).toBe(315);
  });

  it("reads the open-now and order flags", () => {
    const v = parseView("?at=-0.12,51.5,14&open=1&order=near", IDS);
    expect(v.order).toBe("near");
    expect(v.openNow).toBe(true);
    const v2 = parseView("?at=-0.12,51.5,14", IDS);
    expect(v2.openNow).toBe(false);
  });
});

describe("serialiseView", () => {
  it("round-trips", () => {
    const original = "?q=pub&at=-0.12,51.5,14&sel=food-drink,vet&p=abc";
    const v = parseView(original, IDS);
    const back = parseView(serialiseView(v).slice(1), IDS);
    expect(back.q).toBe("pub");
    expect(back.at?.[0]).toBeCloseTo(-0.12, 4);
    expect(back.sel).toEqual(["food-drink", "vet"]);
    expect(back.place).toBe("abc");
  });

  it("writes open-now and order when set", () => {
    const original =
      "?at=" + encodeURIComponent("-0.12,51.5,14") + "&open=1&order=near";
    const v = parseView(original, IDS);
    expect(serialiseView(v)).toBe(original);
  });

  it("omits open-now and order until they differ from defaults", () => {
    const v = parseView("", IDS);
    // Defaults round to 5 dp lon/lat and 2 dp zoom; open/order are left out.
    expect(serialiseView(v)).toBe(
      "?at=" + encodeURIComponent("-0.1276,51.5074,10.6"),
    );
  });
});

describe("serialiseView", () => {
  it("round-trips", () => {
    const original = "?q=pub&at=-0.12,51.5,14&sel=food-drink,vet&p=abc";
    const v = parseView(original, IDS);
    const back = parseView(serialiseView(v).slice(1), IDS);
    expect(back.q).toBe("pub");
    expect(back.at?.[0]).toBeCloseTo(-0.12, 4);
    expect(back.sel).toEqual(["food-drink", "vet"]);
    expect(back.place).toBe("abc");
  });

  it("omits defaults for a short URL", () => {
    const v = parseView("", IDS);
    const s = serialiseView({ ...v, at: [-0.1276, 51.5074] });
    expect(s).not.toContain("sel=");
    expect(s).not.toContain("q=");
  });
});

describe("bboxForCamera", () => {
  it("produces a sane box around London at zoom 11", () => {
    const [w, s, e, n] = bboxForCamera([-0.1276, 51.5074], 11);
    expect(w).toBeLessThan(-0.1276);
    expect(e).toBeGreaterThan(-0.1276);
    expect(s).toBeLessThan(51.5074);
    expect(n).toBeGreaterThan(51.5074);
    // At zoom 11 a degree-ish across, not a planet and not a street.
    expect(e - w).toBeGreaterThan(0.1);
    expect(e - w).toBeLessThan(5);
  });
});