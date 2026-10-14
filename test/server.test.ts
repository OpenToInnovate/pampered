/**
 * The server query helpers that do not need a database.
 *
 * Full query tests run against the real local D1 through the preview server
 * (see test/e2e), because a mock of D1 is a second database to maintain and
 * would test the mock. What is tested here is the part that builds the SQL
 * text: quoting, AND-joining, and refusing to produce a syntax error from user
 * input.
 */
import { describe, expect, it } from "vitest";
import { toMatchExpression } from "../src/server/places";
import { parseFetchKey } from "../src/server/search-query";

describe("toMatchExpression", () => {
  it("quotes every term and ANDs them", () => {
    expect(toMatchExpression("dog friendly pub")).toBe('"dog" AND "friendly" AND "pub"');
  });

  it("strips FTS5 syntax characters rather than passing them through", () => {
    const expr = toMatchExpression('dogs":* (pub');
    expect(expr).not.toContain("*");
    expect(expr).not.toContain(":");
    expect(expr).not.toContain("(");
    expect(expr).not.toContain(")");
  });

  it("caps the term count so a pasted paragraph cannot bloat the query", () => {
    const expr = toMatchExpression("a b c d e f g h i j k l");
    expect(expr.split(" AND ")).toHaveLength(8);
  });

  it("produces a valid empty match for empty input", () => {
    expect(toMatchExpression("")).toBe('""');
    expect(toMatchExpression("   ")).toBe('""');
  });
});

describe("parseFetchKey", () => {
  it("parses a full key", () => {
    const parsed = parseFetchKey({
      bbox: "-0.5,51.3,0.3,51.7",
      sel: "cafes,pubs",
      q: "oat latte",
      near: "-0.1,51.5",
      radius: "2000",
    });
    expect(parsed.bbox).toEqual([-0.5, 51.3, 0.3, 51.7]);
    expect(parsed.selections).toEqual(["cafes", "pubs"]);
    expect(parsed.q).toBe("oat latte");
    expect(parsed.near).toEqual([-0.1, 51.5]);
    expect(parsed.radius).toBe(2000);
  });

  it("tolerates empties", () => {
    const parsed = parseFetchKey({ bbox: "0,0,1,1", sel: "", q: "", near: "", radius: "" });
    expect(parsed.selections).toEqual([]);
    expect(parsed.near).toBeNull();
    expect(parsed.radius).toBeNull();
  });
});