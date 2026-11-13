// The pure part of `uxl convert` to csv/tsv: a whole sheet as delimited text.
import { describe, expect, test } from "vitest";
import { renderSheetText } from "../../src/sheet-lens/lens/index.js";
import { num, sheetOf, snapshot, text } from "./support/lens-data.js";

describe("renderSheetText", () => {
  test("quoting: csv wraps commas, quotes and line breaks; tsv wraps tabs, quotes and line breaks", () => {
    const data = snapshot({
      cells: {
        0: {
          0: text("a,b"),
          1: text('say "hi"'),
          2: text("multi\nline"),
          3: text("a\tb"),
          4: text(" lead space "),
          5: text("cr\rhere"),
        },
      },
    });
    const sc = sheetOf(data);
    expect(renderSheetText(sc, "csv")).toBe(
      '"a,b","say ""hi""","multi\nline",a\tb, lead space ,"cr\rhere"\n',
    );
    expect(renderSheetText(sc, "tsv")).toBe(
      'a,b\t"say ""hi"""\t"multi\nline"\t"a\tb"\t lead space \t"cr\rhere"\n',
    );
  });

  test("every record spans A to the last used column and starts at row 1; empty rows in between are written", () => {
    const data = snapshot({
      cells: { 1: { 0: text("x"), 3: num(4) }, 3: { 1: text("y") } },
    });
    const sc = sheetOf(data);
    expect(renderSheetText(sc, "csv")).toBe(",,,\nx,,,4\n,,,\n,y,,\n");
    const fields = renderSheetText(sc, "tsv")
      .slice(0, -1)
      .split("\n")
      .map((l) => l.split("\t").length);
    expect(fields).toEqual([4, 4, 4, 4]);
  });

  test("the text shown is written, not the stored value", () => {
    const data = snapshot({ cells: { 0: { 0: num(0.075) } } });
    const sc = sheetOf(data, 0, () => "8%");
    expect(renderSheetText(sc, "csv")).toBe("8%\n");
  });

  test("a sheet without values is an empty string; cells holding only a style do not extend the sheet", () => {
    expect(renderSheetText(sheetOf(snapshot({})), "csv")).toBe("");
    const styled = snapshot({ cells: { 0: { 0: text("a") }, 5: { 5: { s: "bold" } } } });
    expect(renderSheetText(sheetOf(styled), "csv")).toBe("a\n");
  });

  test("a formula whose result is empty counts as a value", () => {
    const data = snapshot({ cells: { 0: { 0: text("a") }, 1: { 2: { v: "", t: 1, f: '=""' } } } });
    expect(renderSheetText(sheetOf(data), "csv")).toBe("a,,\n,,\n");
  });
});
