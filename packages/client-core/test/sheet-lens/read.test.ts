// The pure part of `uxl read`: range text, pages, facts, styles, CSV. Snapshots are written by hand.
import { describe, expect, test } from "vitest";
import {
  parseRange,
  rangeText,
  readPage,
  renderCsv,
  renderGrid,
  resolveRect,
  sheetIndexOf,
} from "../../src/sheet-lens/lens/index.js";
import { normalizeCell } from "../../src/sheet-lens/lens/outline/value.js";
import { pageJson } from "../../src/sheet-lens/lens/read.js";
import { SheetLensError } from "../../src/sheet-lens/platform/errors.js";
import { type Cells, num, sheetOf, snapshot, text } from "./support/lens-data.js";

describe("normalizeCell: error literals without a formula (#108)", () => {
  // Exchange-node imports `<c t="e">` as t:4 (FORCE_STRING) and error-looking text as t:1 (univer-pro#5902).
  test("t:4 + error literal is an error, t:1 + error literal is text, other types are untouched", () => {
    expect(normalizeCell({ v: "#N/A", t: 4 })).toEqual({ value: "#N/A", type: "error" });
    expect(normalizeCell({ v: "#N/A", t: 1 })).toEqual({ value: "#N/A", type: "text" });
    expect(normalizeCell({ v: "#N/A" })).toEqual({ value: "#N/A", type: "text" });
    expect(normalizeCell({ v: "hello", t: 4 })).toEqual({ value: "hello", type: "text" });
    expect(normalizeCell({ f: "=1/0", v: "#DIV/0!" })).toEqual({ value: "#DIV/0!", type: "error" });
  });
});

describe("a constant error and error-looking text in the grid (#130)", () => {
  const data = snapshot({
    cells: {
      0: {
        0: { v: "#N/A", t: 4 },
        1: text("#N/A"),
        2: { f: "=1/0", v: "#DIV/0!", t: 1 },
        3: { v: "#REF!", t: 4, s: { bl: 1 } },
      },
    },
  });
  const sc = sheetOf(data);
  const row = (content: "both" | "display" | "formula" | "style" | "formula+style") =>
    renderGrid(
      data,
      sc,
      readPage(data, sc, { r0: 0, c0: 0, r1: 0, c1: 3 }, "", { content, maxCells: 500 }),
    )
      .split("\n")[2]
      ?.split("\t")
      .slice(1);

  test("the constant error is an object with its type, the text stays a string, in every content", () => {
    for (const content of ["both", "display", "formula"] as const)
      expect(row(content)?.slice(0, 2)).toEqual(['{"display":"#N/A","type":"error"}', '"#N/A"']);
  });
  test("a formula error keeps its shape", () => {
    expect(row("both")?.[2]).toBe('{"display":"#DIV/0!","formula":"=1/0"}');
    expect(row("display")?.[2]).toBe('"#DIV/0!"');
    expect(row("formula")?.[2]).toBe('"=1/0"');
  });
  test("a styled constant error keeps type before style", () => {
    expect(row("style")?.[3]).toBe('{"display":"#REF!","type":"error","style":{"bold":true}}');
    expect(row("formula+style")?.[0]).toBe('{"display":"#N/A","type":"error"}');
  });
  test("the cells of --json are unchanged", () => {
    const page = readPage(data, sc, { r0: 0, c0: 0, r1: 0, c1: 1 }, "", {
      content: "both",
      maxCells: 500,
    });
    expect(page.cells.map((c) => [c.type, c.display, c.value])).toEqual([
      ["error", "#N/A", "#N/A"],
      ["text", "#N/A", "#N/A"],
    ]);
  });
});

/** A small RFC 4180 reader: quoted fields, doubled quotes, line breaks inside quotes. */
function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i] as string;
    if (quoted) {
      if (ch === '"' && csv[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) throw new Error("CSV does not end with a line break");
  return rows;
}

function fail(f: () => unknown): SheetLensError {
  try {
    f();
  } catch (e) {
    if (e instanceof SheetLensError) return e;
    throw e;
  }
  throw new Error("expected a SheetLensError");
}

describe("range text", () => {
  test.each([
    ["A1", { sheet: undefined, kind: "cells", a1: "A1" }],
    ["A1:C20", { sheet: undefined, kind: "cells", a1: "A1:C20" }],
    ["$A$1:$B$2", { sheet: undefined, kind: "cells", a1: "A1:B2" }],
    ["B2:A1", { sheet: undefined, kind: "cells", a1: "A1:B2" }],
    ["Sheet1!A1:B2", { sheet: "Sheet1", kind: "cells", a1: "A1:B2" }],
    ["'Q1 Data'!A1", { sheet: "Q1 Data", kind: "cells", a1: "A1" }],
    ["Q1 Data!A1", { sheet: "Q1 Data", kind: "cells", a1: "A1" }],
    ["'It''s'!A1", { sheet: "It's", kind: "cells", a1: "A1" }],
    ["Odd!Name!A1", { sheet: "Odd!Name", kind: "cells", a1: "A1" }],
    ["A:C", { sheet: undefined, kind: "cols", a1: "A1:C1048576" }],
    ["3:5", { sheet: undefined, kind: "rows", a1: "A3:XFD5" }],
    ["XFD1048576", { sheet: undefined, kind: "cells", a1: "XFD1048576" }],
  ] as [string, { sheet: string | undefined; kind: "cells" | "cols" | "rows"; a1: string }][])(
    "%s",
    (input, expected) => {
      const spec = parseRange(input);
      expect({ sheet: spec.sheet, kind: spec.kind }).toEqual({
        sheet: expected.sheet,
        kind: expected.kind,
      });
      const { r0, c0, r1, c1 } = spec.rect;
      expect(rangeText("S", { r0, c0, r1, c1 }).slice(2)).toBe(expected.a1);
    },
  );

  test.each([
    ["", "there is no cell range"],
    ["Sheet1!", "there is no cell range"],
    ["!A1", "sheet name before ! is empty"],
    ["A1:C", "same kind"],
    ["A:3", "same kind"],
    ["B", "single column"],
    ["5", "single row"],
    ["A0", "start at 1"],
    ["A1:B2:C3", "at most one colon"],
    ["A1:C2000000", "1048576 rows at most"],
    ["A1:ZZZ5", "XFD"],
    ["hello", "not a cell"],
  ])("%j is workspace-sheet-lens-range-invalid (%s)", (input, why) => {
    const e = fail(() => parseRange(input));
    expect(e.code).toBe("workspace-sheet-lens-range-invalid");
    expect(e.message).toContain(why);
    expect(e.hint).toContain("A1:C20");
  });
});

describe("the sheet of a range", () => {
  const wb = snapshot({ name: "Inputs" }, { name: "Q1 Data" }, { name: "s1" }, { name: "Summary" });
  test("a name wins over a ref; a ref is the position", () => {
    expect(sheetIndexOf(wb, "Q1 Data", "x")).toBe(1);
    expect(sheetIndexOf(wb, "s1", "x")).toBe(2); // a sheet is really called s1
    expect(sheetIndexOf(wb, "s2", "x")).toBe(1);
    expect(sheetIndexOf(wb, "s4", "x")).toBe(3);
  });
  test("no prefix is fine with one sheet and workspace-sheet-lens-range-invalid with several", () => {
    expect(sheetIndexOf(snapshot({}), undefined, "A1")).toBe(0);
    const e = fail(() => sheetIndexOf(wb, undefined, "A1:B2"));
    expect([e.code, e.message]).toEqual([
      "workspace-sheet-lens-range-invalid",
      "range 'A1:B2' has no sheet, and this workbook has 4 sheets (Inputs, Q1 Data, s1, Summary)",
    ]);
    expect(e.hint).toBe("name the sheet in front of the range, for example Inputs!A1:B2");
  });
  test("unknown sheets list at most ten names", () => {
    const many = snapshot(...Array.from({ length: 13 }, (_, i) => ({ name: `T${i}` })));
    const e = fail(() => sheetIndexOf(many, "Nope", "x"));
    expect(e.code).toBe("workspace-sheet-lens-sheet-not-found");
    expect(e.message).toBe(
      "no sheet 'Nope' in this Unit (sheets: T0, T1, T2, T3, T4, T5, T6, T7, T8, T9, …+3)",
    );
    expect(fail(() => sheetIndexOf(many, "s14", "x")).code).toBe(
      "workspace-sheet-lens-sheet-not-found",
    );
    expect(fail(() => sheetIndexOf(many, "s0", "x")).code).toBe(
      "workspace-sheet-lens-sheet-not-found",
    );
  });
  test("names that need quoting in a continuation", () => {
    const rect = { r0: 166, c0: 0, r1: 499, c1: 5 };
    expect(rangeText("Sheet1", rect)).toBe("Sheet1!A167:F500");
    expect(rangeText("Q1 Data", rect)).toBe("Q1 Data!A167:F500");
    expect(rangeText("It's", rect)).toBe("'It''s'!A167:F500");
  });
});

describe("open-ended ranges and empty sheets", () => {
  const data = snapshot({ cells: { 1: { 1: text("a") }, 4: { 3: num(1) } } });
  const sc = sheetOf(data);
  test("whole columns run from row 1 to the last used row; whole rows from column A to the last used column", () => {
    expect(resolveRect(parseRange("B:C"), sc)).toEqual({ r0: 0, c0: 1, r1: 4, c1: 2 });
    expect(resolveRect(parseRange("2:3"), sc)).toEqual({ r0: 1, c0: 0, r1: 2, c1: 3 });
  });
  test("an explicit rectangle is never trimmed", () => {
    expect(resolveRect(parseRange("A1:Z99"), sc)).toEqual({ r0: 0, c0: 0, r1: 98, c1: 25 });
  });
  test("an empty sheet gives an empty range and a title with `empty`", () => {
    const empty = snapshot({});
    const esc = sheetOf(empty);
    const spec = parseRange("A:C");
    expect(resolveRect(spec, esc)).toBeNull();
    const page = readPage(empty, esc, null, spec.area, { content: "both", maxCells: 500 });
    expect(renderGrid(empty, esc, page)).toBe("read Sheet1!A:C [ref=s1, both, empty]\n");
    expect(renderCsv(esc, page, false)).toBe("");
    expect(pageJson(page)).toMatchObject({
      range: null,
      requested: null,
      rows: 0,
      columns: 0,
      empty: true,
      cells: [],
    });
  });
});

describe("the grid", () => {
  test("control characters, quotes, tabs and a leading = cannot break a line or a field", () => {
    const nasty = [
      "a\nb",
      "tab\there",
      'say "hi"',
      "=SUM(A1)",
      "back\\slash",
      "ls\u2028ps",
      "nel\u0085x",
      "del\u007fx",
      "cr\rx",
    ];
    const data = snapshot({ cells: { 0: Object.fromEntries(nasty.map((s, i) => [i, text(s)])) } });
    const sc = sheetOf(data);
    const rect = { r0: 0, c0: 0, r1: 0, c1: nasty.length - 1 };
    const out = renderGrid(
      data,
      sc,
      readPage(data, sc, rect, "", { content: "both", maxCells: 500 }),
    );
    const lines = out.trimEnd().split("\n");
    expect(lines).toHaveLength(3); // title, header, one row
    const fields = (lines[2] as string).split("\t");
    expect(fields).toHaveLength(nasty.length + 1);
    expect(fields.slice(1).map((f) => JSON.parse(f))).toEqual(nasty);
    for (const c of ["\u2028", "\u0085", "\u007f", "\r"]) expect(out).not.toContain(c);
  });

  test('a formula whose result is empty keeps its formula; a cell with nothing is ""', () => {
    const data = snapshot({ cells: { 0: { 0: { f: '=""', v: "", t: 1 } } } });
    const sc = sheetOf(data);
    const page = readPage(data, sc, { r0: 0, c0: 0, r1: 0, c1: 1 }, "", {
      content: "both",
      maxCells: 500,
    });
    expect(renderGrid(data, sc, page).split("\n")[2]).toBe(
      '1\t{"display":"","formula":"=\\"\\""}\t""',
    );
    expect(page.cells).toHaveLength(1);
  });
});

describe("pages", () => {
  const rows = Object.fromEntries(
    Array.from({ length: 10 }, (_, r) => [r, { 0: num(r), 1: text(`r${r}`), 2: num(r * 2) }]),
  );
  const data = snapshot({ cells: rows });
  const sc = sheetOf(data);
  const whole = { r0: 0, c0: 0, r1: 9, c1: 2 };
  test("whole rows only: floor(max / columns) of them", () => {
    const p = readPage(data, sc, whole, "", { content: "both", maxCells: 10 });
    expect(p.shown).toEqual({ r0: 0, c0: 0, r1: 2, c1: 2 });
    expect([p.remaining, p.next]).toEqual([7, { r0: 3, c0: 0, r1: 9, c1: 2 }]);
  });
  test("a range that fits has no next page", () => {
    const p = readPage(data, sc, whole, "", { content: "both", maxCells: 30 });
    expect([p.remaining, p.next, p.shown]).toEqual([0, null, whole]);
  });
  test("following the pages covers every row once", () => {
    const seen: string[] = [];
    let rect: typeof whole | null = whole;
    while (rect) {
      const p = readPage(data, sc, rect, "", { content: "display", maxCells: 7 });
      for (const c of p.cells) seen.push(c.ref);
      rect = p.next as typeof whole | null;
    }
    expect(seen).toEqual(
      Array.from({ length: 10 }, (_, r) => ["A", "B", "C"].map((c) => `${c}${r + 1}`)).flat(),
    );
  });
  test("a row wider than the budget is workspace-sheet-lens-range-invalid, not a cut row", () => {
    const e = fail(() => readPage(data, sc, whole, "", { content: "both", maxCells: 2 }));
    expect([e.code, e.message]).toEqual([
      "workspace-sheet-lens-range-invalid",
      "row 1 of Sheet1!A1:C10 has 3 cells, more than --max 2",
    ]);
  });
});

describe("facts", () => {
  const merge = (r0: number, c0: number, r1: number, c1: number) => ({
    startRow: r0,
    startColumn: c0,
    endRow: r1,
    endColumn: c1,
  });
  test("a merge is listed in full even when the range cuts it; its covered values are listed and still in the grid", () => {
    const data = snapshot({
      cells: { 0: { 0: text("title"), 1: text("hidden under the merge") }, 1: { 1: num(5) } },
      extra: { mergeData: [merge(0, 0, 0, 2)] },
    });
    const sc = sheetOf(data);
    const out = renderGrid(
      data,
      sc,
      readPage(data, sc, { r0: 0, c0: 1, r1: 1, c1: 2 }, "", { content: "both", maxCells: 500 }),
    );
    expect(out).toContain('1\t"hidden under the merge"\t""');
    expect(out.trimEnd().split("\n").slice(-2)).toEqual(["merged: A1:C1", "covered: B1"]);
  });
  test("hidden rows are capped and say how many were left out; JSON keeps them all", () => {
    const many = (n: number, f: (i: number) => unknown) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [i, f(i)]));
    const data = snapshot({
      cells: many(12, (r) => ({ 1: text(`v${r}`) })) as Cells,
      extra: { rowData: many(12, () => ({ hd: 1 })), columnData: { 0: { hd: 1 } } },
    });
    const sc = sheetOf(data);
    const page = readPage(data, sc, { r0: 0, c0: 0, r1: 11, c1: 1 }, "", {
      content: "both",
      maxCells: 500,
    });
    expect(renderGrid(data, sc, page)).toContain(
      "hidden: rows 1 2 3 4 5 6 7 8 9 10 …+2; cols A (shown, not removed)",
    );
    expect((pageJson(page).hidden as { rows: number[] }).rows).toHaveLength(12);
  });
  test("merges beyond the cap: 20 and the rest counted", () => {
    const data = snapshot({
      cells: { 0: { 0: text("x") } },
      extra: { mergeData: Array.from({ length: 23 }, (_, i) => merge(i, 3, i, 4)) },
    });
    const sc = sheetOf(data);
    const out = renderGrid(
      data,
      sc,
      readPage(data, sc, { r0: 0, c0: 0, r1: 22, c1: 4 }, "", {
        content: "display",
        maxCells: 500,
      }),
    );
    expect(out.trimEnd().split("\n").at(-1)?.endsWith(" …+3")).toBe(true);
  });
  test("notes are cut at 40 characters and capped at five", () => {
    const notes = Object.fromEntries(
      Array.from({ length: 7 }, (_, r) => [r, { 0: { note: `n${r} ${"x".repeat(60)}` } }]),
    );
    const data = snapshot({ cells: { 0: { 0: text("a") } } });
    data.resources = [{ name: "SHEET_NOTE_PLUGIN", data: JSON.stringify({ id0: notes }) }];
    const sc = sheetOf(data);
    const page = readPage(data, sc, { r0: 0, c0: 0, r1: 6, c1: 0 }, "", {
      content: "display",
      maxCells: 500,
    });
    const line = renderGrid(data, sc, page).trimEnd().split("\n").at(-1) as string;
    expect(line.startsWith(`notes: A1="n0 ${"x".repeat(36)}…" A2=`)).toBe(true);
    expect(line.endsWith(" …+2")).toBe(true);
    expect((pageJson(page).notes as unknown[]).length).toBe(7);
    expect((pageJson(page).notes as { text: string }[])[0]?.text).toBe(`n0 ${"x".repeat(60)}`);
  });
});

describe("styles", () => {
  const data = snapshot({
    cells: {
      0: {
        0: text("plain"),
        1: text("bold", { s: "bold" }),
        2: text("own fill", { s: { bg: { rgb: "#00ff00" } } }),
        3: text("default font", {
          s: { fs: 11, ff: "Calibri", n: { pattern: "General" }, tb: 0, ht: 0 },
        }),
        4: text("big", {
          s: {
            fs: 14,
            ff: "Arial",
            ht: 2,
            vt: 3,
            tb: 3,
            ul: { s: 1 },
            st: { s: 1 },
            n: { pattern: "0.0%" },
          },
        }),
      },
      1: { 2: text("in a red column") },
    },
    extra: {
      defaultStyle: { fs: 11, ff: "Calibri" },
      columnData: { 2: { s: "red" } },
      rowData: { 0: { s: { it: 1 } } },
    },
  });
  const sc = sheetOf(data);
  const page = readPage(data, sc, { r0: 0, c0: 0, r1: 1, c1: 4 }, "", {
    content: "style",
    maxCells: 500,
  });
  const styleOf = (ref: string) => page.cells.find((c) => c.ref === ref)?.style;

  test("cell, row and column layers inherit per property", () => {
    expect(styleOf("A1")).toEqual({ italic: true }); // the row
    expect(styleOf("B1")).toEqual({ bold: true, italic: true }); // the cell, and the row for what the cell leaves open
    expect(styleOf("C1")).toEqual({ italic: true, color: "#0000FF", fill: "#00FF00" }); // the cell's fill beats the column's
    expect(styleOf("C2")).toEqual({ color: "#0000FF", fill: "#FF0000" }); // the column
  });
  test("what equals the sheet default is not reported; the rest is, in a fixed order", () => {
    expect(styleOf("D1")).toEqual({ italic: true });
    expect(Object.keys(styleOf("E1") ?? {})).toEqual([
      "italic",
      "underline",
      "strike",
      "size",
      "font",
      "halign",
      "valign",
      "wrap",
      "format",
    ]);
    expect(styleOf("E1")).toMatchObject({
      size: 14,
      font: "Arial",
      halign: "center",
      valign: "bottom",
      wrap: true,
      format: "0.0%",
    });
  });
  test("an empty cell with a style is a cell of the page; unstyled empty cells are not", () => {
    expect(page.cells.map((c) => c.ref)).toEqual(["A1", "B1", "C1", "D1", "E1", "C2"]);
    const second = readPage(data, sc, { r0: 1, c0: 0, r1: 1, c1: 3 }, "", {
      content: "style",
      maxCells: 500,
    });
    expect(second.cells).toEqual([
      {
        ref: "C2",
        type: "text",
        display: "in a red column",
        value: "in a red column",
        style: { color: "#0000FF", fill: "#FF0000" },
      },
    ]);
    const onlyStyle = snapshot({ extra: { columnData: { 1: { s: "red" } } } });
    const osc = sheetOf(onlyStyle);
    const blank = readPage(onlyStyle, osc, { r0: 0, c0: 0, r1: 0, c1: 2 }, "", {
      content: "style",
      maxCells: 500,
    });
    expect(blank.cells).toEqual([
      {
        ref: "B1",
        type: "empty",
        display: "",
        value: null,
        style: { color: "#0000FF", fill: "#FF0000" },
      },
    ]);
  });
  test("formulas and styles together: display, formula and style, the style only when there is one", () => {
    const d = snapshot({
      cells: {
        0: {
          0: num(3, { f: "=1+2", s: "bold" }),
          1: num(4, { f: "=2+2" }),
          2: text("bold", { s: "bold" }),
          3: text("plain"),
        },
      },
    });
    const both = readPage(d, sheetOf(d), { r0: 0, c0: 0, r1: 0, c1: 3 }, "", {
      content: "formula+style",
      maxCells: 500,
    });
    expect(renderGrid(d, sheetOf(d), both).split("\n").slice(0, 3)).toEqual([
      "read Sheet1!A1:D1 [ref=s1, formula+style]",
      "row\tA\tB\tC\tD",
      '1\t{"display":"3","formula":"=1+2","style":{"bold":true}}\t{"display":"4","formula":"=2+2"}\t{"display":"bold","style":{"bold":true}}\t"plain"',
    ]);
    expect(both.cells.map((c) => c.style)).toEqual([
      { bold: true },
      undefined,
      { bold: true },
      undefined,
    ]);
    expect(pageJson(both).content).toBe("formula+style");
  });
  test("the cells of every other content carry no style", () => {
    const plain = readPage(data, sc, { r0: 0, c0: 0, r1: 1, c1: 4 }, "", {
      content: "both",
      maxCells: 500,
    });
    expect(plain.cells.some((c) => c.style)).toBe(false);
  });
});

describe("CSV", () => {
  test("only fields with a comma, a quote or a line break are quoted; numbers are 15 significant digits", () => {
    const data = snapshot({
      cells: {
        0: {
          0: text("a,b"),
          1: text('say "hi"'),
          2: text("two\nlines"),
          3: text(" padded "),
          4: text(""),
        },
        1: {
          0: num(0.1 + 0.2),
          1: num(1234.5, { s: { n: { pattern: "#,##0.00" } } }),
          2: { v: 1, t: 3 },
          3: { f: "=1/0", v: "#DIV/0!", t: 1 },
        },
      },
    });
    const sc = sheetOf(data);
    const page = readPage(data, sc, { r0: 0, c0: 0, r1: 1, c1: 4 }, "", {
      content: "both",
      maxCells: 500,
    });
    expect(renderCsv(sc, page, false)).toBe(
      '"a,b","say ""hi""","two\nlines", padded ,\n0.3,1234.5,1,#DIV/0!,\n',
    );
    expect(renderCsv(sc, page, true).trimEnd().split("\n").at(-1)).toBe("0.3,1234.5,1,=1/0,");
  });

  test("an RFC 4180 reader gets back exactly the displayed fields, whatever the cells hold", () => {
    const nasty = [
      "a,b",
      'say "hi"',
      "two\nlines",
      "cr\r\nlf",
      " padded ",
      "",
      '"',
      ",",
      "=SUM(A1)",
      "日本語",
    ];
    const data = snapshot({
      cells: {
        0: Object.fromEntries(nasty.map((v, i) => [i, text(v)])),
        1: { 0: text("next row") },
      },
    });
    const sc = sheetOf(data);
    const page = readPage(data, sc, { r0: 0, c0: 0, r1: 1, c1: nasty.length - 1 }, "", {
      content: "both",
      maxCells: 500,
    });
    expect(parseCsv(renderCsv(sc, page, false))).toEqual([
      nasty,
      ["next row", ...Array(nasty.length - 1).fill("")],
    ]);
  });
});
