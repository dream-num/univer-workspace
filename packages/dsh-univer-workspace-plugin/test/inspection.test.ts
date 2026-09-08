import { describe, expect, it } from "vitest";
import { inspectionQuery } from "../src/provider/inspection.ts";

describe("Office-compatible content inspection selectors", () => {
  it("builds a workbook overview for a Sheet", () => {
    expect(inspectionQuery("sheet", undefined)).toEqual({ kind: "workbook" });
  });

  it("builds a named worksheet range and unquotes doubled apostrophes", () => {
    expect(inspectionQuery("sheet", "'Sales'' 2026'! A1:D20 ")).toEqual({
      kind: "worksheet-range",
      ranges: [{ range: "A1:D20", worksheet: { name: "Sales' 2026" } }],
    });
  });

  it("uses the first worksheet for an unqualified range", () => {
    expect(inspectionQuery("sheet", "B2:C4")).toEqual({
      kind: "worksheet-range",
      ranges: [{ range: "B2:C4", worksheet: { index: 0 } }],
    });
  });

  it("maps Doc and Slide to their structured overview", () => {
    expect(inspectionQuery("doc", undefined)).toEqual({ kind: "document" });
    expect(inspectionQuery("slide", undefined)).toEqual({ kind: "presentation" });
  });

  it("rejects ranges for non-Sheet Units and unsupported overviews", () => {
    expect(() => inspectionQuery("doc", "A1")).toThrow(/Sheet Unit/);
    expect(() => inspectionQuery("base", undefined)).toThrow(/structured inspection/);
    expect(() => inspectionQuery("board", undefined)).toThrow(/structured inspection/);
    expect(() => inspectionQuery("sheet", "Sheet1!")).toThrow(/must not be empty/);
  });
});
