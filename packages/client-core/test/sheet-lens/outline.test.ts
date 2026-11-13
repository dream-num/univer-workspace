// Ported from dream-num/unvdp@23446146d48cb948a61bef1f0a31ad0ef75a537d, packages/unvdp-core/test/lens/lens.test.ts
// (reference implementation, read-only). Tests of Lens.read are left out until `uxl read` (#19); expectations were adapted to uxl's
// outline (sheet counts, SheetLensError messages). Everything else is as in the reference.
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  createStandardHeadlessUniverFactory,
  createStandardHeadlessUniverFacade,
} from "@univer-cli/headless-univer";
import { UniverInstanceType } from "@univerjs/core";
import type { Snapshot as IWorkbookData } from "../../src/sheet-lens/engine/types.js";
import { workbookFromData } from "../../src/sheet-lens/lens/outline/cells.js";
import { allNodes, buildOutlineModel } from "../../src/sheet-lens/lens/outline/model.js";
import { renderOutline } from "../../src/sheet-lens/lens/outline/render.js";

/** A live Univer instance for the tests that compare the lens with `getDisplayValues()`. */
async function loadWorkbook(d: IWorkbookData) {
  const univer = await createStandardHeadlessUniverFactory({ license: "" })({
    unitId: d.id,
    unitType: UniverInstanceType.UNIVER_SHEET,
  });
  try {
    const workbook = createStandardHeadlessUniverFacade(univer).createWorkbook(structuredClone(d));
    return { workbook, dispose: () => univer.dispose() };
  } catch (error) {
    univer.dispose();
    throw error;
  }
}

const data = {
  id: "display-test",
  name: "Display",
  sheetOrder: ["sheet-id"],
  sheets: {
    "sheet-id": {
      id: "sheet-id",
      name: "Data",
      rowCount: 20,
      columnCount: 10,
      cellData: {
        0: { 0: { v: "Amount" }, 1: { v: "Enabled" }, 2: { v: "Message" } },
        1: {
          0: { v: 192.35, t: 2, s: { n: { pattern: "#,##0.0" } } },
          1: { v: 1, t: 3 },
          2: { v: "#DIV/0!", t: 1 },
        },
        2: { 0: { v: 5, t: 2 }, 1: { v: 0, t: 3 }, 2: { v: "#DIV/0!", t: 1, f: "=1/0" } },
        10: { 0: { f: '=""', v: "" } },
        19: { 9: { s: { bl: 1 } } },
      },
    },
  },
} as unknown as IWorkbookData;

test("display comes from Univer; stored types and formula-only extent remain truthful", async () => {
  const loaded = await loadWorkbook(structuredClone(data));
  try {
    const display = loaded.workbook.getActiveSheet().getRange("A1:J20").getDisplayValues();
    const wb = workbookFromData(data, "Display", (_sheet, r, c) => String(display[r]?.[c] ?? ""));
    const sc = wb.sheets[0]!;
    assert.equal(sc.cells.get(16384)!.text, String(display[1]![0]));
    assert.equal(sc.cells.get(16385)!.cls, "bool");
    assert.equal(sc.cells.get(16385)!.v, true);
    assert.equal(sc.cells.get(16386)!.cls, "text");
    assert.equal(sc.cells.get(32770)!.cls, "error");
    assert.deepEqual(sc.used, { r0: 0, c0: 0, r1: 10, c1: 2 });
    const model = buildOutlineModel(wb);
    const col = allNodes(model.root).find((n) => n.kind === "col" && n.name === "Amount")!;
    assert.equal((col.attrs.stat as any).max.display, String(display[1]![0]));
    assert.equal(model.root.ref, undefined);
  } finally {
    loaded.dispose();
  }
});

test("explicit regions precede detection and object refs retain native identity", () => {
  const wb = workbookFromData(
    data,
    "Display",
    (_s, r, c) => String((data.sheets["sheet-id"]!.cellData as any)[r]?.[c]?.v ?? ""),
    {
      sheets: [
        {
          id: "sheet-id",
          regions: [{ kind: "table", range: "A1:C3", name: "Entries" }],
          objects: [
            {
              type: "cf",
              id: "native-cf-1",
              ranges: [{ r0: 1, c0: 0, r1: 2, c1: 0 }],
              summary: "positive",
            },
          ],
        },
      ],
    },
  );
  const model = buildOutlineModel(wb);
  const region = allNodes(model.root).find((n) => n.via === "table")!;
  assert.equal(region.range, "A1:C3");
  assert.equal(region.name, "Entries");
  assert.ok(model.byRef.has("obj:cf/native-cf-1"));
  assert.deepEqual(model.rectOf.get(`${region.ref}.c1`)?.rect, { r0: 1, c0: 0, r1: 2, c1: 0 });
  const view = renderOutline(model, { depth: 0 });
  // depth 0 does not ask for regions, so none is "elided": the sheet line only says how many there are
  assert.match(view.text, /\[ref=s1, used=A1:C11, formulas=2, errors=1, regions=1\]/);
  assert.doesNotMatch(view.text, /more/);
  assert.ok(renderOutline(model, { ref: "s1" }).text.includes("Entries"));
});

import { patternStr, token, trunc } from "../../src/sheet-lens/lens/outline/format.js";
import { parseLine } from "./support/outline-grammar.js";
import { verifyClaims } from "./support/truthfulness.js";

test("grammar, Unicode limits, truthful statistics and small read caps", () => {
  const wb = workbookFromData(data, "Display", (_s, r, c) =>
    String((data.sheets["sheet-id"]!.cellData as any)[r]?.[c]?.v ?? ""),
  );
  const model = buildOutlineModel(wb);
  assert.ok(verifyClaims(data, model, "fixture") > 0);
  for (const depth of [0, 1, 2]) {
    const rendered = renderOutline(model, { depth });
    rendered.text.split("\n").forEach(parseLine);
    for (const node of allNodes(rendered.json))
      if (node.elided) {
        assert.ok(renderOutline(model, { ref: node.elided.zoom }).refs.length > 1);
      }
  }
  assert.equal(Array.from(trunc("😀".repeat(61), 60)).length, 60);
  assert.equal(patternStr("dd\\-mmm"), "dd\\-mmm");
  assert.equal(token("a b"), '"a b"');
});

test("overlapping names do not remove tables; headerless names include every row", () => {
  const numeric = structuredClone(data);
  numeric.sheets["sheet-id"]!.cellData = Object.fromEntries(
    Array.from({ length: 5 }, (_, r) => [
      r,
      { 0: { v: 1 + 3 * r, t: 2 }, 1: { v: 2 + 3 * r, t: 2 }, 2: { v: 3 + 3 * r, t: 2 } },
    ]),
  );
  const display = (_s: string, r: number, c: number) =>
    String((numeric.sheets["sheet-id"]!.cellData as any)[r]?.[c]?.v ?? "");
  const wb = workbookFromData(numeric, "Numeric", display, {
    sheets: [
      {
        id: "sheet-id",
        objects: [],
        regions: [{ kind: "definedName", range: "A1:C5", name: "Numbers" }],
      },
    ],
  });
  const model = buildOutlineModel(wb);
  const region = allNodes(model.root).find((n) => n.name === "Numbers")!;
  assert.equal(region.attrs.rows, 5);
  assert.equal(region.attrs.header, 0);
  wb.structure!.sheets[0]!.regions = [
    { kind: "table", range: "A1:C3" },
    { kind: "definedName", range: "A2:C5" },
  ];
  assert.equal(allNodes(buildOutlineModel(wb).root).find((n) => n.via === "table")!.range, "A1:C3");
});

test("an empty defined-name range is a block, not fabricated text", () => {
  const wb = workbookFromData(data, "Named", () => "", {
    sheets: [
      {
        id: "sheet-id",
        objects: [],
        regions: [{ kind: "definedName", name: "Empty", range: "J18" }],
      },
    ],
  });
  const node = allNodes(buildOutlineModel(wb).root).find((n) => n.name === "Empty")!;
  assert.equal(node.kind, "block");
});

import { objectRef } from "../../src/sheet-lens/lens/explicit.js";
import { parseNameRanges } from "../../src/sheet-lens/lens/ranges.js";

test("name unions preserve quoted commas and object identity includes native sheet scope", () => {
  assert.equal(parseNameRanges("'A,B'!$C$1:$D$3,'O''Brien'!A1")?.[0]?.sheetName, "A,B");
  assert.notEqual(objectRef("cf", "same", "sheet1"), objectRef("cf", "same", "sheet2"));
  assert.notEqual(objectRef("name", "/"), objectRef("name", "b64_Lw"));
});

test("a workbook listing counts objects; a sheet listing names them at depth 2; region and exact-object scopes retain native identity", () => {
  const wb = workbookFromData(
    data,
    "Objects",
    (_s, r, c) => String((data.sheets["sheet-id"]!.cellData as any)[r]?.[c]?.v ?? ""),
    {
      sheets: [
        {
          id: "sheet-id",
          regions: [{ kind: "table", range: "A1:C3", name: "Entries" }],
          objects: [
            ...Array.from({ length: 40 }, (_, i) => ({
              type: "cf" as const,
              id: `native-rule-${i}`,
              ranges: [{ r0: 1, c0: 0, r1: 2, c1: 0 }],
              summary: "positive",
            })),
            {
              type: "name",
              id: "native-name",
              ranges: [{ r0: 1, c0: 0, r1: 2, c1: 0 }],
              summary: "Amounts",
            },
            {
              type: "chart",
              id: "loose-chart",
              ranges: [{ r0: 5, c0: 4, r1: 9, c1: 8 }],
              summary: "column chart",
            },
          ],
        },
      ],
    },
  );
  const model = buildOutlineModel(wb);
  const objNodes = (r: ReturnType<typeof renderOutline>) =>
    allNodes(r.json).filter((n) => n.kind === "obj" && !n.elided);
  // workbook scope: counts only, at every depth
  for (const depth of [0, 1, 2]) {
    const result = renderOutline(model, { depth });
    assert.equal(objNodes(result).length, 0);
    assert.ok(!result.text.includes("ref=obj:"));
    if (depth > 0) assert.match(result.text, /cf=40, name=1, chart=1/);
    result.text.split("\n").forEach(parseLine);
  }
  // sheet scope: no object lines above depth 2 (the objects line has the counts), all of them at depth 2
  for (const depth of [0, 1])
    assert.equal(objNodes(renderOutline(model, { ref: "s1", depth })).length, 0);
  const sheet = renderOutline(model, { ref: "s1", depth: 2, budget: 20_000 });
  assert.equal(objNodes(sheet).length, 42);
  assert.ok(sheet.refs.includes("obj:chart/loose-chart"));
  assert.match(sheet.text, /- obj chart \[ref=obj:chart\/loose-chart, E6:I10, "column chart"\]/);
  sheet.text.split("\n").forEach(parseLine);
  // with a small budget the objects are cut like any other children, and the cut can be continued
  const cut = renderOutline(model, { ref: "s1", depth: 2, budget: 900 });
  assert.ok(cut.elided);
  assert.match(cut.text, /- … \d+ more obj \[zoom=s1\.t1, from=obj:cf\//);
  const region = allNodes(model.root).find((n) => n.name === "Entries")!;
  assert.ok(
    renderOutline(model, { ref: region.ref, budget: 20_000 }).refs.includes("obj:cf/native-rule-0"),
  );
  for (const ref of ["obj:cf/native-rule-39", "obj:name/native-name"]) {
    const result = renderOutline(model, { ref });
    assert.deepEqual(result.refs, [ref]);
    assert.equal(result.json.ref, ref);
    assert.ok(result.text.includes(ref));
  }
});

test("focused bounds expose header and totals candidates without changing default depth", () => {
  const input = structuredClone(data);
  input.sheets["sheet-id"]!.cellData = {
    0: { 0: { v: "Item" }, 1: { v: "Amount" } },
    1: { 0: { v: "A" }, 1: { v: 2 } },
    2: { 0: { v: "B" }, 1: { v: 3 } },
    3: { 0: { v: "Total" }, 1: { v: 5 } },
  };
  input.sheets["sheet-id"]!.hidden = 1;
  const wb = workbookFromData(
    input,
    "Bounds",
    (_s, r, c) => String((input.sheets["sheet-id"]!.cellData as any)[r]?.[c]?.v ?? ""),
    {
      sheets: [
        {
          id: "sheet-id",
          regions: [{ kind: "table", range: "A1:B4", headerRows: 1 }],
          objects: [{ type: "chart", id: "no-range", ranges: [], summary: "unknown output" }],
        },
      ],
    },
  );
  const model = buildOutlineModel(wb);
  const table = allNodes(model.root).find((n) => n.kind === "table")!;
  const col = table.children!.find((n) => n.kind === "col")!;
  assert.deepEqual(col.attrs.bounds, {
    data: "A2:A3",
    header: "A1",
    totals: "A4",
    headerSource: "table",
    totalsSource: "inferred",
  });
  assert.deepEqual(model.rectOf.get(col.ref!)!.rect, { r0: 1, r1: 2, c0: 0, c1: 0 });
  const focused = renderOutline(model, { ref: col.ref }).text;
  assert.match(focused, /data=A2:A3/);
  assert.match(focused, /totals-candidate=A4/);
  focused.split("\n").forEach(parseLine);
  assert.doesNotMatch(renderOutline(model).text, /header-range=/);
  assert.match(renderOutline(model, { ref: "obj:chart/no-range" }).text, /cell-ranges=0/);
  const inferred = buildOutlineModel({ ...wb, structure: null });
  for (const node of allNodes(inferred.root).filter((n) => n.kind === "table"))
    assert.equal((node.attrs.bounds as any).headerSource, "inferred");
});

// Merges: 2x5 title A1:E2, 1x2 header C3:D3, 4x1 body A4:A7 / A8:A11, 2x2 body B9:C10 (anchor B9), stale value under A5.
const mergeFixture = (): IWorkbookData => {
  const cities = [
    "Shanghai",
    "Hangzhou",
    "Nanjing",
    "Suzhou",
    "Ningbo",
    "Wuxi",
    "Fuzhou",
    "Xiamen",
  ];
  const cellData: Record<number, Record<number, unknown>> = {
    0: { 0: { v: "2025 Orders" } },
    2: { 0: { v: "Region" }, 1: { v: "City" }, 2: { v: "Sales" }, 4: { v: "Note" } },
  };
  cities.forEach((city, i) => {
    cellData[3 + i] = { 1: { v: city }, 2: { v: 100 + i }, 3: { v: 0.05 + i / 100 } };
  });
  cellData[3]![0] = { v: "East" };
  cellData[4]![0] = { v: "stale" }; // covered by A4:A7, still stored
  cellData[7]![0] = { v: "South" };
  cellData[3]![4] = { v: "late" };
  cellData[8]![1] = { v: "whole order refunded" };
  const m = (r0: number, r1: number, c0: number, c1: number) => ({
    startRow: r0,
    endRow: r1,
    startColumn: c0,
    endColumn: c1,
  });
  return {
    id: "merge",
    name: "Merge",
    sheetOrder: ["s"],
    sheets: {
      s: {
        id: "s",
        name: "Orders",
        rowCount: 30,
        columnCount: 8,
        cellData,
        mergeData: [m(0, 1, 0, 4), m(2, 2, 2, 3), m(3, 6, 0, 0), m(7, 10, 0, 0), m(8, 9, 1, 2)],
      },
    },
  } as unknown as IWorkbookData;
};

test("merge facts: full rectangles for 1xN, Mx1 and MxN merges, anchored by header or body; covered cells never inherit the anchor", () => {
  const wb = workbookFromData(mergeFixture(), "Merge", (_s, r, c) =>
    String((mergeFixture().sheets.s!.cellData as any)[r]?.[c]?.v ?? ""),
  );
  const model = buildOutlineModel(wb);
  const text = renderOutline(model, { depth: 2 }).text;
  assert.match(text, /text "2025 Orders" \[ref=s1\.x1, A1:E2, span=A1:E2\]/);
  const tableLine = text.split("\n").find((l) => l.includes("- table"))!;
  assert.match(tableLine, /merged=4\]/); // C3:D3, A4:A7, A8:A11, B9:C10; the title does not touch the table
  const cols = text.split("\n").filter((l) => l.includes("- col"));
  assert.equal(cols.length, 5);
  assert.ok(cols[2]!.includes("span=C3:D3") && cols[3]!.includes("span=C3:D3"));
  assert.ok(!/- col "[^"]*"/.test(cols[3]!)); // the covered header cell stays unnamed
  assert.ok(cols[0]!.includes("merges: A4:A7 A8:A11"));
  assert.ok(cols[1]!.includes("merges: B9:C10") && cols[2]!.includes("merges: B9:C10")); // one MxN merge listed on every column it covers
  assert.ok(!cols[4]!.includes("merges:") && !cols[4]!.includes("span="));
  const json = renderOutline(model, { depth: 2 }).json;
  assert.deepEqual(
    allNodes(json)
      .filter((n) => n.kind === "col")
      .map((n) => (n.attrs as any).span),
    [undefined, undefined, ["C3:D3"], ["C3:D3"], undefined],
  );
});

import { criteriaText } from "../../src/sheet-lens/lens/outline/cells.js";
// ---------------------------------------------------------------- signals beyond merge (outline/0.4), pure model level
import { numfmtScale } from "../../src/sheet-lens/lens/outline/format.js";

test("numfmtScale counts the commas after the last digit placeholder of the first section", () => {
  assert.equal(numfmtScale("#,##0"), 0);
  assert.equal(numfmtScale("#,##0,"), 3);
  assert.equal(numfmtScale('#,##0,"K"'), 3);
  assert.equal(numfmtScale('0.0,,"M"'), 6);
  assert.equal(numfmtScale("#,##0.00_);(#,##0.00)"), 0);
  assert.equal(numfmtScale('"a,b"0'), 0); // commas inside quoted text do not scale
  assert.equal(numfmtScale(undefined), 0);
});

test("filter criteria render as column=values, comparisons, or an honest kind marker", () => {
  assert.equal(criteriaText({ colId: 4, filters: { filters: ["open", "done"] } }), "E=open|done");
  assert.equal(
    criteriaText({ colId: 4, filters: { filters: ["a b"], blank: true } }),
    'E="a b"|(blank)',
  );
  assert.equal(
    criteriaText({
      colId: 2,
      customFilters: { customFilters: [{ operator: "greaterThan", val: 5 }] },
    }),
    "C>5",
  );
  assert.equal(
    criteriaText({
      colId: 2,
      customFilters: {
        and: 1,
        customFilters: [
          { operator: "greaterThanOrEqual", val: 1 },
          { operator: "lessThanOrEqual", val: 9 },
        ],
      },
    }),
    "C>=1 and C<=9",
  );
  assert.equal(criteriaText({ colId: 0, colorFilters: {} }), "A:color");
  assert.equal(
    criteriaText({
      colId: 0,
      filters: { filters: Array.from({ length: 8 }, (_, i) => String(i)) },
    }),
    "A=0|1|2|3|4…",
  );
});

// A plain 6-row table with full control over cell data and resources; display = stored text.
function plain(
  cellData: Record<number, Record<number, unknown>>,
  extra: Record<string, unknown> = {},
  resources: { name: string; data: string }[] = [],
) {
  const d = {
    id: "p",
    name: "P",
    sheetOrder: ["s"],
    sheets: { s: { id: "s", name: "S", rowCount: 30, columnCount: 8, cellData, ...extra } },
    resources,
  } as unknown as IWorkbookData;
  const model = buildOutlineModel(
    workbookFromData(d, "P", (_s, r, c) => String((cellData as any)[r]?.[c]?.v ?? "")),
  );
  return { model, text: renderOutline(model, { depth: 2 }).text };
}
const rows = (n: number, f: (i: number) => Record<number, unknown>) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, f(i)]));
const head = { 0: { 0: { v: "Item" }, 1: { v: "Amount" } } };

test("subtotals: label rows, SUBTOTAL/AGGREGATE and same-column SUM above; a running total is not reported", () => {
  const body = rows(8, (i) => ({
    0: { v: i === 3 ? "Subtotal" : `r${i}` },
    1: i === 3 ? { f: "=SUM(B2:B4)", v: 6, t: 2 } : { v: i + 1, t: 2 },
  }));
  assert.match(
    plain({ ...head, ...body }).text,
    /- table \[ref=s1\.t1, A1:B9, rows=8, subtotals: A5\]/,
  );
  const agg = rows(8, (i) => ({
    0: { v: `r${i}` },
    1: i === 5 ? { f: "=AGGREGATE(9,5,B2:B6)", v: 15, t: 2 } : { v: i + 1, t: 2 },
  }));
  assert.match(plain({ ...head, ...agg }).text, /subtotals: A7\]/);
  const running = rows(8, (i) => ({
    0: { v: `r${i}` },
    1: i === 0 ? { v: 1, t: 2 } : { f: `=SUM(B$2:B${i + 1})`, v: i, t: 2 },
  }));
  assert.doesNotMatch(plain({ ...head, ...running }).text, /subtotals/);
  const none = rows(8, (i) => ({ 0: { v: `r${i}` }, 1: { v: i + 1, t: 2 } }));
  assert.doesNotMatch(plain({ ...head, ...none }).text, /subtotals/);
});

test("numtext counts text cells that look like numbers; ordinary text and real numbers do not", () => {
  const ids = rows(8, (i) => ({
    0: { v: i < 6 ? String(1000 + i) : "n/a", t: 1 },
    1: { v: i, t: 2 },
  }));
  assert.match(
    plain({ 0: { 0: { v: "Code" }, 1: { v: "N" } }, ...ids }).text,
    /col "Code" \[ref=s1\.t1\.c1, A, text unique, numtext=6\]|col "Code" \[ref=s1\.t1\.c1, A, text, [^\]]*numtext=6\]/,
  );
  const words = rows(8, (i) => ({ 0: { v: `w${i}`, t: 1 }, 1: { v: i, t: 2 } }));
  assert.doesNotMatch(plain({ 0: { 0: { v: "Code" }, 1: { v: "N" } }, ...words }).text, /numtext/);
});

test("invisible: white font on the default fill is flagged; a fill, a theme fill, or a visible colour is not", () => {
  const styled = (cl: unknown, bg?: unknown) => ({
    v: "x",
    t: 1,
    s: { cl, ...(bg ? { bg } : {}) },
  });
  const cellData = {
    ...head,
    ...rows(8, (i) => ({ 0: { v: `r${i}` }, 1: { v: i + 1, t: 2 } })),
  } as Record<number, Record<number, unknown>>;
  cellData[1]![0] = styled({ rgb: "#ffffff" }); // flagged
  cellData[2]![0] = styled({ rgb: "#FFF" }); // flagged: short form, case-insensitive
  cellData[3]![0] = styled({ rgb: "#FFFFFF" }, { rgb: "#000000" }); // white on black: visible
  cellData[4]![0] = styled({ rgb: "#FFFFFF" }, { th: 3 }); // white on a theme fill: unknown, never flagged
  cellData[5]![0] = styled({ rgb: "#FF0000" }); // red on white: visible
  cellData[6]![0] = styled({ rgb: "#00FF00" }, { rgb: "#00ff00" }); // same colour as the fill: flagged
  assert.match(plain(cellData).text, /col "Item" \[ref=s1\.t1\.c1, A, [^\]]*invisible: A2 A3 A7\]/);
});

test("groups render as row and column ranges; a collapsed group ends with +", () => {
  const resource = {
    name: "SHEET_OUTLINE_PLUGIN",
    data: JSON.stringify({
      s: {
        outlineList: [
          { axis: "row", start: 2, end: 4, collapsed: true },
          { axis: "column", start: 1, end: 2, collapsed: false },
        ],
      },
    }),
  };
  const cellData = { ...head, ...rows(8, (i) => ({ 0: { v: `r${i}` }, 1: { v: i + 1, t: 2 } })) };
  const { text } = plain(cellData, {}, [resource]);
  assert.match(text, /- table \[ref=s1\.t1, A1:B9, rows=8, groups: 3:5\+ B:C\]/);
  assert.match(text, /- objects \[groups=2\]/);
});

test("notes: comment threads count once per cell; replies are ignored; a note wins over a thread on the same cell", () => {
  const thread = (ref: string, text: string, parentId?: string) => ({
    ref,
    parentId,
    text: { dataStream: `${text}\r\n` },
  });
  const resources = [
    { name: "SHEET_NOTE_PLUGIN", data: JSON.stringify({ s: { 1: { 0: { note: "from note" } } } }) },
    {
      name: "SHEET_UNIVER_THREAD_COMMENT_PLUGIN",
      data: JSON.stringify({
        s: [thread("A2", "thread on A2"), thread("B3", "thread on B3"), thread("B3", "reply", "x")],
      }),
    },
  ];
  const cellData = { ...head, ...rows(8, (i) => ({ 0: { v: `r${i}` }, 1: { v: i + 1, t: 2 } })) };
  const { text } = plain(cellData, {}, resources);
  assert.match(text, /col "Item" \[ref=s1\.t1\.c1, A, [^\]]*notes: A2\]/);
  assert.match(text, /col "Amount" \[ref=s1\.t1\.c2, B, [^\]]*notes: B3\]/);
  assert.match(text, /- objects \[note=2\]/);
});

test("hrows and hcols count hidden lines inside a region once; a fully hidden region says hidden instead", () => {
  const cellData = { ...head, ...rows(8, (i) => ({ 0: { v: `r${i}` }, 1: { v: i + 1, t: 2 } })) };
  const { text } = plain(cellData, { rowData: { 2: { hd: 1 }, 3: { hd: 1 } } });
  assert.match(text, /- table \[ref=s1\.t1, A1:B9, rows=8, hrows=2\]/);
  const all = plain(cellData, {
    rowData: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [i, { hd: 1 }])),
  }).text;
  assert.match(all, /- table \[ref=s1\.t1, A1:B9, rows=8, hidden\]/);
  assert.doesNotMatch(
    all.split("\n").find((l) => l.includes("- table"))!,
    /hrows=/,
  );
});

test("dv and cf attach to the columns whose body they touch, one summary each, extra rules counted", () => {
  const rect = (r0: number, r1: number, c: number) => ({ r0, r1, c0: c, c1: c });
  const cellData = { ...head, ...rows(8, (i) => ({ 0: { v: `r${i}` }, 1: { v: i + 1, t: 2 } })) };
  const wb = workbookFromData(
    {
      id: "p",
      name: "P",
      sheetOrder: ["s"],
      sheets: { s: { id: "s", name: "S", rowCount: 30, columnCount: 8, cellData } },
    } as unknown as IWorkbookData,
    "P",
    (_s, r, c) => String((cellData as any)[r]?.[c]?.v ?? ""),
    {
      sheets: [
        {
          id: "s",
          regions: [],
          objects: [
            { type: "cf", id: "c1", ranges: [rect(1, 8, 1)], summary: "cellIs gt 5" },
            { type: "cf", id: "c2", ranges: [rect(1, 8, 1)], summary: "duplicate" },
            { type: "dv", id: "d1", ranges: [rect(1, 8, 0)], summary: "list: a,b" },
            { type: "cf", id: "c3", ranges: [rect(0, 0, 0)], summary: "header only" },
          ],
        },
      ],
    },
  );
  const text = renderOutline(buildOutlineModel(wb), { depth: 2 }).text;
  assert.match(text, /col "Item" \[ref=s1\.t1\.c1, A, [^\]]*dv="list: a,b"\]/); // header-only cf does not touch the body
  assert.doesNotMatch(text, /col "Item"[^\n]*cf=/);
  assert.match(text, /col "Amount" \[ref=s1\.t1\.c2, B, [^\]]*cf="cellIs gt 5" …\+1\]/);
});

test("invisible respects inherited fills and cell overrides, matching Univer composed styles", async () => {
  const white = { cl: { rgb: "#FFFFFF" } };
  const d = {
    id: "inherited",
    name: "Inherited",
    styles: { dark: { bg: { rgb: "#000000" } } },
    sheetOrder: ["s"],
    sheets: {
      s: {
        id: "s",
        name: "S",
        rowCount: 20,
        columnCount: 8,
        columnData: { 0: { s: "dark" } },
        rowData: { 2: { s: "dark" }, 3: { s: { bg: { rgb: "#FFFFFF" } } } },
        cellData: {
          0: { 0: { v: "A" }, 1: { v: "B" } },
          1: { 0: { v: "visible", s: white }, 1: { v: "hidden", s: white } },
          2: {
            0: { v: "override", s: { ...white, bg: { rgb: "#FFFFFF" } } },
            1: { v: "visible", s: white },
          },
          3: { 0: { v: "row wins", s: white }, 1: { v: "plain" } },
        },
      },
    },
  } as unknown as IWorkbookData;
  const loaded = await loadWorkbook(d);
  try {
    const sheet = loaded.workbook.getActiveSheet();
    assert.equal(sheet.getSheet().getComposedCellStyle(1, 0).bg?.rgb, "#000000");
    assert.equal(sheet.getSheet().getComposedCellStyle(2, 1).bg?.rgb, "#000000");
    const display = sheet.getRange("A1:B4").getDisplayValues();
    const model = buildOutlineModel(
      workbookFromData(d, "Inherited", (_s, r, c) => String(display[r]?.[c] ?? "")),
    );
    assert.doesNotMatch(renderOutline(model, { depth: 2 }).text, /invisible: A2|invisible: B3/);
  } finally {
    loaded.dispose();
  }
});

test("Chinese subtotal labels work without formulas, including terminal totals", () => {
  for (const label of ["小计", "合计", "总计"]) {
    const body = rows(8, (i) => ({ 0: { v: i === 3 ? label : `r${i}` }, 1: { v: i + 1 } }));
    assert.match(plain({ ...head, ...body }).text, /subtotals: A5/);
    body[8]![0] = { v: label };
    assert.match(plain({ ...head, ...body }).text, /totals=9/);
  }
});

test("format exceptions agree with the dominant family format shown in the column", () => {
  const body = rows(10, (i) => ({
    0: { v: `r${i}` },
    1: {
      v: i < 4 ? 45000 + i : i,
      s: { n: { pattern: i < 4 ? "yyyy-mm-dd" : i < 7 ? "0.0" : "0.00" } },
    },
  }));
  const d = {
    id: "formats",
    name: "Formats",
    sheetOrder: ["s"],
    sheets: {
      s: { id: "s", name: "S", rowCount: 20, columnCount: 2, cellData: { ...head, ...body } },
    },
  } as unknown as IWorkbookData;
  const model = buildOutlineModel(
    workbookFromData(
      d,
      "Formats",
      (_s, r, c) => String((d.sheets.s!.cellData as any)[r]?.[c]?.v ?? ""),
      {
        sheets: [{ id: "s", regions: [{ kind: "table", range: "A1:B11" }], objects: [] }],
      },
    ),
  );
  const col = allNodes(model.root).find((n) => n.kind === "col" && n.name === "Amount")!;
  assert.equal((col.attrs.type as any).numfmt, "0.0");
  assert.deepEqual(col.attrs.fmts, { items: ["B2", "B3", "B4", "B5", "B9"], more: 2 });
});

// ---------------------------------------------------------------- formatting-only cells continue a region (gold rule R2)
const BOX = { bd: { t: { s: 1 }, b: { s: 1 }, l: { s: 1 }, r: { s: 1 } } };
const HEAD = { bl: 1, bg: { rgb: "#156082" }, ...BOX };
const styledSheet = (cellData: Record<number, Record<number, unknown>>) =>
  ({
    id: "styled",
    name: "Styled",
    sheetOrder: ["s"],
    sheets: { s: { id: "s", name: "S", rowCount: 120, columnCount: 40, cellData } },
  }) as unknown as IWorkbookData;
const put = (
  cells: Record<number, Record<number, unknown>>,
  r: number,
  c: number,
  cell: unknown,
) => {
  (cells[r] ??= {})[c] = cell;
};
const ranges = async (wb: IWorkbookData) => {
  const { detectRegions, featureSheetOf } = await import("../../src/sheet-lens/lens/index.js");
  return detectRegions(featureSheetOf(wb, "styled.xlsx", 0)).regions.map(
    (r) => `${r.range} ${r.kind}`,
  );
};

test("a header over a bordered empty template body is one table, not a text line over a narrow table", async () => {
  const cells: Record<number, Record<number, unknown>> = {};
  ["ITEM", "NAME", "REF"].forEach((v, j) => put(cells, 0, 5 + j, { v, t: 1, s: HEAD }));
  for (let r = 1; r <= 10; r++) {
    put(cells, r, 5, { v: r, t: 2, s: BOX });
    put(cells, r, 6, { s: BOX });
    put(cells, r, 7, { s: BOX });
  }
  assert.deepEqual(await ranges(styledSheet(cells)), ["F1:H11 table"]);
  // without the borders the header still spans its sparsely filled body: one region, not a header line over a column
  const bare: Record<number, Record<number, unknown>> = {};
  ["ITEM", "NAME", "REF"].forEach((v, j) => put(bare, 0, 5 + j, { v, t: 1, s: HEAD }));
  for (let r = 1; r <= 10; r++) put(bare, r, 5, { v: r, t: 2 });
  assert.deepEqual(
    (await ranges(styledSheet(bare))).map((r) => r.split(" ")[0]),
    ["F1:H11"],
  );
  // a line whose columns the block below leaves empty, outside the header's span, still overhangs
  const off: Record<number, Record<number, unknown>> = {};
  ["ITEM", "NAME", "REF"].forEach((v, j) => put(off, 0, 5 + j, { v, t: 1, s: HEAD }));
  for (let r = 1; r <= 10; r++) {
    put(off, r, 4, { v: `k${r}`, t: 1 });
    put(off, r, 5, { v: r, t: 2 });
  }
  assert.deepEqual(await ranges(styledSheet(off)), ["F1:H1 text", "E2:F11 table"]);
});

test("a bordered empty block below and beside the values extends the table; header, body and total line join", async () => {
  const cells: Record<number, Record<number, unknown>> = {};
  ["Region", "Q1", "Q2", "Q3"].forEach((v, j) => put(cells, 2, j, { v, t: 1, s: HEAD }));
  for (let r = 3; r <= 5; r++)
    for (let c = 0; c <= 3; c++)
      put(cells, r, c, c ? { v: r * 10 + c, t: 2, s: BOX } : { v: `R${r}`, t: 1, s: BOX });
  for (let r = 6; r <= 14; r++) for (let c = 0; c <= 4; c++) put(cells, r, c, { s: BOX }); // empty template rows, one column wider
  for (let r = 2; r <= 5; r++) put(cells, r, 4, { s: BOX });
  ["Total", 1, 2, 3].forEach((v, j) =>
    put(cells, 15, j, {
      v,
      t: typeof v === "number" ? 2 : 1,
      s: { bl: 1, bg: { rgb: "#ffff00" }, ...BOX },
    }),
  );
  put(cells, 15, 4, { s: BOX });
  assert.deepEqual(await ranges(styledSheet(cells)), ["A3:E16 table"]);
});

test("sheet-wide borders and stray fill bands do not stretch a region", async () => {
  const cells: Record<number, Record<number, unknown>> = {};
  for (let r = 0; r <= 40; r++) for (let c = 0; c <= 12; c++) put(cells, r, c, { s: BOX }); // every cell bordered
  ["Name", "Qty"].forEach((v, j) => put(cells, 0, j, { v, t: 1, s: HEAD }));
  for (let r = 1; r <= 4; r++) {
    put(cells, r, 0, { v: `n${r}`, t: 1, s: BOX });
    put(cells, r, 1, { v: r, t: 2, s: BOX });
  }
  for (let c = 20; c <= 25; c++) put(cells, 60, c, { s: { bg: { rgb: "#ffff00" } } }); // a fill band touching no value
  assert.deepEqual(await ranges(styledSheet(cells)), ["A1:B5 table"]);
});

test("a run of merged cells is not blank space: side-by-side 2x2 merges stay one region; a merged title covers its merge", async () => {
  const cells: Record<number, Record<number, unknown>> = {};
  const mergeData: unknown[] = [];
  put(cells, 0, 0, { v: "Weekly plan", t: 1, s: { bl: 1 } });
  mergeData.push({ startRow: 0, endRow: 0, startColumn: 0, endColumn: 7 });
  ["Mon", "Tue", "Wed", "Thu"].forEach((v, j) => {
    put(cells, 2, 2 * j, { v, t: 1, s: { bl: 1 } });
    mergeData.push({ startRow: 2, endRow: 3, startColumn: 2 * j, endColumn: 2 * j + 1 });
  });
  for (let r = 4; r <= 7; r++)
    for (let c = 0; c <= 7; c++) put(cells, r, c, { v: r * 10 + c, t: 2 });
  const wb = styledSheet(cells);
  (wb.sheets as any).s.mergeData = mergeData;
  assert.deepEqual(await ranges(wb), ["A1:H1 text", "A3:H8 table"]);
});

test("two merged titles one empty column apart are two regions; adjacent merged group headers stay one header row", async () => {
  const cells: Record<number, Record<number, unknown>> = {};
  const mergeData: unknown[] = [];
  put(cells, 2, 0, { v: "TABLE 1", t: 1, s: { bl: 1 } });
  mergeData.push({ startRow: 2, endRow: 2, startColumn: 0, endColumn: 2 });
  put(cells, 2, 4, { v: "TABLE 2", t: 1, s: { bl: 1 } });
  mergeData.push({ startRow: 2, endRow: 2, startColumn: 4, endColumn: 6 });
  ["Pair", "Rate", "Date"].forEach((v, j) => {
    put(cells, 3, j, { v, t: 1, s: { bl: 1 } });
    put(cells, 3, 4 + j, { v, t: 1, s: { bl: 1 } });
  });
  for (let r = 4; r <= 9; r++)
    for (const c0 of [0, 4]) {
      put(cells, r, c0, { v: `P${r}`, t: 1 });
      put(cells, r, c0 + 1, { v: r / 3, t: 2 });
      put(cells, r, c0 + 2, { v: 45000 + r, t: 2 });
    }
  const wb = styledSheet(cells);
  (wb.sheets as any).s.mergeData = mergeData;
  assert.deepEqual(await ranges(wb), ["A3:C3 text", "E3:G3 text", "A4:C10 table", "E4:G10 table"]);
});

test("detected regions never overlap (seeded random sheets with values, borders, fills and merges)", async () => {
  const { detectRegions, featureSheetOf } = await import("../../src/sheet-lens/lens/index.js");
  let seed = 20261023;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let n = 0; n < 300; n++) {
    const cells: Record<number, Record<number, unknown>> = {};
    const mergeData: unknown[] = [];
    for (let r = 0; r < 10; r++)
      for (let c = 0; c < 8; c++) {
        const x = rand();
        if (x < 0.25)
          put(cells, r, c, {
            v: x < 0.12 ? "w" : Math.floor(x * 100),
            t: x < 0.12 ? 1 : 2,
            ...(rand() < 0.4 ? { s: BOX } : {}),
          });
        else if (x < 0.45) put(cells, r, c, { s: rand() < 0.5 ? BOX : { bg: { rgb: "#ffff00" } } });
      }
    if (rand() < 0.5) {
      const r = Math.floor(rand() * 9),
        c = Math.floor(rand() * 6);
      put(cells, r, c, { v: "m", t: 1 });
      mergeData.push({
        startRow: r,
        endRow: r + Math.floor(rand() * 2),
        startColumn: c,
        endColumn: c + 1 + Math.floor(rand() * 2),
      });
    }
    const wb = styledSheet(cells);
    (wb.sheets as any).s.mergeData = mergeData;
    const rects = detectRegions(featureSheetOf(wb, "random.xlsx", 0)).regions.map(
      (r: any) => r.rect,
    );
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i],
          b = rects[j];
        assert.ok(
          a.r1 < b.r0 || b.r1 < a.r0 || a.c1 < b.c0 || b.c1 < a.c0,
          `sheet ${n}: ${JSON.stringify(a)} overlaps ${JSON.stringify(b)}`,
        );
      }
  }
});

test("emphasised body rows (zebra stripes, a bold subtotal in a label/value list) do not start a new table", async () => {
  const zebra: Record<number, Record<number, unknown>> = {};
  ["Date", "Rate"].forEach((v, j) => put(zebra, 0, j, { v, t: 1, s: HEAD }));
  for (let r = 1; r <= 12; r++) {
    const s = r % 2 ? { bg: { rgb: "#f5f5f5" }, ...BOX } : BOX;
    put(zebra, r, 0, { v: 45000 + r * 30, t: 2, s: { ...s, n: { pattern: "yyyy-mm-dd" } } });
    put(zebra, r, 1, { v: 0.03 + r / 1000, t: 2, s });
  }
  assert.deepEqual(await ranges(styledSheet(zebra)), ["A1:B13 table"]);
  const list: Record<number, Record<number, unknown>> = {};
  [
    ["Revenue", 1200],
    ["(-) Costs", 700],
    ["EBITDA", 500],
    ["(-) Tax", 100],
    ["Net income", 400],
  ].forEach(([label, value], i) => {
    const s =
      label === "EBITDA" || label === "Net income"
        ? { bl: 1, bd: { t: { s: 1 }, b: { s: 1 } } }
        : {};
    put(list, 2 + i, 1, { v: label, t: 1, s });
    put(list, 2 + i, 2, { v: value, t: 2, s });
  });
  assert.equal((await ranges(styledSheet(list))).length, 1);
});

test("a header or filled row running through empty columns keeps one table; a gap formatted on every row still separates", async () => {
  const cells: Record<number, Record<number, unknown>> = {};
  put(cells, 0, 0, { v: "Date", t: 1, s: HEAD });
  for (let c = 1; c <= 3; c++) put(cells, 0, c, { s: HEAD });
  put(cells, 0, 4, { v: "Price", t: 1, s: HEAD });
  for (let r = 1; r <= 8; r++) {
    put(cells, r, 0, { v: 45000 + r, t: 2, s: { n: { pattern: "yyyy-mm-dd" } } });
    put(cells, r, 4, { v: 100 + r, t: 2 });
  }
  assert.deepEqual(
    (await ranges(styledSheet(cells))).map((r) => r.split(" ")[0]),
    ["A1:E9"],
  );
  // the same gap filled on every row is a shading column between two blocks
  const shaded: Record<number, Record<number, unknown>> = {};
  for (let r = 0; r <= 8; r++) {
    put(shaded, r, 0, r ? { v: `k${r}`, t: 1 } : { v: "Key", t: 1, s: { bl: 1 } });
    for (let c = 1; c <= 3; c++) put(shaded, r, c, { s: { bg: { rgb: "#d9d9d9" } } });
    put(shaded, r, 4, r ? { v: r, t: 2 } : { v: "Qty", t: 1, s: { bl: 1 } });
  }
  assert.equal((await ranges(styledSheet(shaded))).length, 2);
});

test("older segmentation rules: each is pinned by the smallest sheet it decides", async () => {
  // S1: a blank row inside one table (same columns, same value types above and below) is not a cut
  const gap: Record<number, Record<number, unknown>> = {};
  ["Item", "Qty"].forEach((v, j) => put(gap, 0, j, { v, t: 1 }));
  for (const r of [1, 2, 3, 4, 6, 7, 8, 9]) {
    put(gap, r, 0, { v: `i${r}`, t: 1 });
    put(gap, r, 1, { v: r, t: 2 });
  }
  assert.deepEqual(
    (await ranges(styledSheet(gap))).map((r) => r.split(" ")[0]),
    ["A1:B10"],
  );
  // S2: below a plain header row, an emphasised first record is body, not the header of a new table
  const plain: Record<number, Record<number, unknown>> = {};
  ["Name", "Dept", "City"].forEach((v, j) => put(plain, 0, j, { v, t: 1 }));
  for (let r = 1; r <= 5; r++)
    ["n", "d", "c"].forEach((v, j) =>
      put(plain, r, j, { v: `${v}${r}`, t: 1, ...(r === 1 ? { s: { bl: 1 } } : {}) }),
    );
  assert.deepEqual(
    (await ranges(styledSheet(plain))).map((r) => r.split(" ")[0]),
    ["A1:C6"],
  );
  // S2: a style change that the next row continues starts a styled body run (regression 22-47: a one-column list)
  const list: Record<number, Record<number, unknown>> = {};
  put(list, 0, 0, { v: "LIST", t: 1, s: { bl: 1, bg: { rgb: "#ffc000" } } });
  ["HASSAN", "HAMAN", "HAMMED"].forEach((v, i) =>
    put(list, 1 + i, 0, { v, t: 1, s: { bg: { rgb: "#ffff00" }, ...BOX } }),
  );
  assert.deepEqual(
    (await ranges(styledSheet(list))).map((r) => r.split(" ")[0]),
    ["A1:A4"],
  );
  // S3: a long single text cell under a wider body is a note of its own
  const note: Record<number, Record<number, unknown>> = {};
  ["Item", "Qty"].forEach((v, j) => put(note, 0, j, { v, t: 1, s: { bl: 1 } }));
  for (let r = 1; r <= 4; r++) {
    put(note, r, 0, { v: `i${r}`, t: 1 });
    put(note, r, 1, { v: r, t: 2 });
  }
  put(note, 5, 0, { v: "Source: internal inventory export, refreshed weekly", t: 1 });
  assert.deepEqual(
    (await ranges(styledSheet(note))).map((r) => r.split(" ")[0]),
    ["A1:B5", "A6"],
  );
  // S5: a border grid shared by two tables is neither's: growth that stops at the neighbour leaves a formatted ring
  const grid: Record<number, Record<number, unknown>> = {};
  for (let r = 0; r < 20; r++) for (let c = 0; c < 6; c++) put(grid, r, c, { s: BOX });
  for (const top of [1, 11]) {
    ["Item", "Qty"].forEach((v, j) => put(grid, top, 1 + j, { v, t: 1, s: { bl: 1, ...BOX } }));
    for (let r = top + 1; r <= top + 3; r++) {
      put(grid, r, 1, { v: `i${r}`, t: 1, s: BOX });
      put(grid, r, 2, { v: r, t: 2, s: BOX });
    }
  }
  assert.deepEqual(
    (await ranges(styledSheet(grid))).map((r) => r.split(" ")[0]),
    ["B2:C5", "B12:C15"],
  );
});

test("a pivot region prints via=pivot with header-source=pivot, and a pivot obj prints its summary and src=", () => {
  const t = (v: string) => ({ v, t: 1 }),
    n = (v: number) => ({ v, t: 2 });
  // source Store/Sales at A1:B3; the pivot output at E1:F4 (a header, two groups and a Grand Total row)
  const cellData = {
    0: { 0: t("Store"), 1: t("Sales"), 4: t("Store"), 5: t("Sum of Sales") },
    1: { 0: t("North"), 1: n(10), 4: t("North"), 5: n(10) },
    2: { 0: t("South"), 1: n(20), 4: t("South"), 5: n(20) },
    3: { 4: t("Grand Total"), 5: n(30) },
  };
  const book = {
    id: "pv",
    name: "Pivot",
    sheetOrder: ["s"],
    sheets: { s: { id: "s", name: "Sales", rowCount: 30, columnCount: 10, cellData } },
  } as unknown as IWorkbookData;
  const object = {
    type: "pivot" as const,
    id: "P1",
    ranges: [{ r0: 0, c0: 4, r1: 3, c1: 5 }],
    summary: "rows=Store · values=sum(Sales)",
    source: "s1!A1:B3",
  };
  const wb = workbookFromData(
    book,
    "Pivot",
    (_s, r, c) => String((cellData as any)[r]?.[c]?.v ?? ""),
    {
      sheets: [{ id: "s", regions: [{ kind: "pivot", range: "E1:F4" }], objects: [object] }],
    },
  );
  const model = buildOutlineModel(wb);
  const region = allNodes(model.root).find((n) => n.via === "pivot")!;
  assert.equal(region.range, "E1:F4");
  assert.equal(region.kind, "table");
  assert.equal(region.attrs.headerSource, "pivot");
  const text = renderOutline(model, { ref: region.ref, depth: 2 }).text;
  assert.match(
    text,
    /^- table \[ref=s1\.t\d, E1:F4, rows=2, totals=4, .*header-source=pivot.*, via=pivot\]$/m,
  );
  assert.match(
    text,
    /^ {2}- obj pivot \[ref=obj:pivot\/P1, E1:F4, "rows=Store · values=sum\(Sales\)", src=s1!A1:B3\]$/m,
  );
  for (const l of text.split("\n").filter((l) => /^ *- /.test(l))) parseLine(l);
  assert.match(renderOutline(model, { depth: 1 }).text, /- objects \[pivot=1\]/);
  // an object without a source prints no src= (output for the other objects is unchanged)
  object.source = undefined as never;
  assert.doesNotMatch(
    renderOutline(buildOutlineModel(wb), { ref: region.ref, depth: 2 }).text,
    /src=/,
  );
});
