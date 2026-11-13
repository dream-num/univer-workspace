// Ported from dream-num/unvdp@23446146d48cb948a61bef1f0a31ad0ef75a537d, packages/unvdp-core/test/lens/outline-budget.test.ts
// (reference implementation, read-only). Tests of Lens.read are left out until `uxl read` (#19); expectations were adapted to uxl's
// outline (sheet counts, SheetLensError messages). Everything else is as in the reference.
// outline/0.6 budget semantics (RFC 04 section 6.1 and 7): budget per sheet, reading order, exact elision lines,
// continuation with `from`, and the sheets-only form of a workbook that is too large for one response.

import { test } from "vitest";
import assert from "node:assert/strict";
import type { Snapshot as IWorkbookData } from "../../src/sheet-lens/engine/types.js";
import { workbookFromData } from "../../src/sheet-lens/lens/outline/cells.js";
import {
  allNodes,
  buildOutlineModel,
  type OutlineModel,
  type OutlineNode,
} from "../../src/sheet-lens/lens/outline/model.js";
import { renderOutline } from "../../src/sheet-lens/lens/outline/render.js";
import { parseLine } from "./support/outline-grammar.js";

const REGION = new Set(["table", "matrix", "form", "text", "kpi", "block"]);

/** One sheet of stacked tables separated by two blank rows. `sizes[i]` = body rows of table i (so area differs per table). */
function stacked(
  sizes: number[],
  name = "S",
): Record<number, Record<number, unknown>> & { name: string } {
  const cells: Record<number, Record<number, unknown>> = {};
  let top = 0;
  sizes.forEach((size, b) => {
    cells[top] = {
      0: { v: `Item${b}`, t: 1, s: { bl: 1 } },
      1: { v: `Qty${b}`, t: 1, s: { bl: 1 } },
      2: { v: `Price${b}`, t: 1, s: { bl: 1 } },
    };
    for (let r = 1; r <= size; r++)
      cells[top + r] = { 0: { v: `x${b}-${r}`, t: 1 }, 1: { v: r, t: 2 }, 2: { v: r * 1.5, t: 2 } };
    top += size + 3;
  });
  return Object.assign(cells, { name });
}

function build(sheets: ReturnType<typeof stacked>[]): OutlineModel {
  const data = {
    id: "b",
    name: "Budget",
    sheetOrder: sheets.map((_, i) => `s${i}`),
    sheets: Object.fromEntries(
      sheets.map((cells, i) => {
        const { name, ...rows } = cells;
        return [`s${i}`, { id: `s${i}`, name, rowCount: 600, columnCount: 8, cellData: rows }];
      }),
    ),
  } as unknown as IWorkbookData;
  const wb = workbookFromData(data, "Budget", () => "");
  return buildOutlineModel(wb);
}

const regionsOf = (model: OutlineModel, sheetRef: string): OutlineNode[] =>
  model.byRef.get(sheetRef)!.children!.filter((n) => REGION.has(n.kind));
const printedRegions = (json: OutlineNode, sheetRef: string): string[] =>
  allNodes(json)
    .find((n) => n.ref === sheetRef)!
    .children!.filter((n) => REGION.has(n.kind) && !n.elided)
    .map((n) => n.ref!);
const size = (text: string) => text.length + 1; // budget counts one newline per line (RFC 04 section 6.1)
const parseAll = (text: string) =>
  text
    .split("\n")
    .filter((l) => /^ *- /.test(l))
    .forEach((l) => parseLine(l));

test("fixture: stacked tables are detected as separate regions in row-major order", () => {
  const model = build([stacked([3, 12, 2, 8, 4, 20, 2, 5])]);
  const rs = regionsOf(model, "s1");
  assert.equal(rs.length, 8);
  const tops = rs.map((r) => Number(/\d+/.exec(r.range!)![0]));
  assert.deepEqual(
    tops,
    [...tops].sort((a, b) => a - b),
  );
});

test("a sheet lists regions top to bottom: what is cut is a contiguous tail, never a small block in the middle", () => {
  const model = build([stacked([3, 12, 2, 8, 4, 20, 2, 5])]);
  const all = regionsOf(model, "s1").map((r) => r.ref!);
  for (const budget of [150, 250, 350, 500, 700]) {
    const r = renderOutline(model, { ref: "s1", depth: 1, budget });
    const shown = printedRegions(r.json, "s1");
    assert.deepEqual(shown, all.slice(0, shown.length), `budget ${budget}`);
    parseAll(r.text);
  }
});

test("the elision line says where the tail starts and which cells it covers", () => {
  const model = build([stacked([3, 12, 2, 8, 4, 20, 2, 5])]);
  const rs = regionsOf(model, "s1");
  const r = renderOutline(model, { ref: "s1", depth: 1, budget: 350 });
  const shown = printedRegions(r.json, "s1").length;
  assert.ok(shown > 0 && shown < rs.length);
  const tail = rs.slice(shown);
  const elision = allNodes(r.json).find((n) => n.elided)!.elided!;
  assert.equal(elision.count, tail.length);
  assert.equal(elision.zoom, "s1");
  assert.equal(elision.from, tail[0]!.ref);
  const first = /^([A-Z]+)(\d+)/.exec(tail[0]!.range!)!,
    last = /([A-Z]+)(\d+)$/.exec(tail[tail.length - 1]!.range!)!;
  assert.equal(elision.range, `${first[1]}${first[2]}:${last[1]}${last[2]}`);
  assert.match(
    r.text,
    new RegExp(
      `- … ${tail.length} more regions \\[zoom=s1, from=${tail[0]!.ref}, range=${elision.range}\\]`,
    ),
  );
  assert.match(r.text, new RegExp(`regions=${rs.length}`));
});

test("the output of a sheet fits its budget, and re-rendering with the size it used gives the same text", () => {
  const model = build([stacked([3, 12, 2, 8, 4, 20, 2, 5])]);
  for (const budget of [200, 300, 450, 600, 900, 3000]) {
    const r = renderOutline(model, { ref: "s1", depth: 2, budget });
    const shown = printedRegions(r.json, "s1").length;
    if (shown > 1) assert.ok(size(r.text) <= budget, `budget ${budget}: ${size(r.text)}`);
    assert.equal(
      renderOutline(model, { ref: "s1", depth: 2, budget: size(r.text) }).text,
      r.text,
      `budget ${budget}`,
    );
  }
});

test("from continues the listing: every region appears exactly once across the pages, each page makes progress", () => {
  const model = build([stacked(Array.from({ length: 30 }, (_, i) => 2 + (i % 7)))]);
  const all = regionsOf(model, "s1").map((r) => r.ref!);
  for (const budget of [1, 400, 900]) {
    const seen: string[] = [];
    let from: string | undefined;
    for (let pages = 0; pages < 100; pages++) {
      const r = renderOutline(model, { ref: "s1", depth: 1, budget, ...(from ? { from } : {}) });
      const shown = printedRegions(r.json, "s1");
      assert.ok(shown.length >= 1, "a page shows at least one region");
      if (from) assert.equal(shown[0], from);
      seen.push(...shown);
      parseAll(r.text);
      const next = allNodes(r.json).find((n) => n.elided)?.elided;
      if (!next) break;
      assert.equal(next.zoom, "s1");
      from = next.from;
    }
    assert.deepEqual(seen, all, `budget ${budget}`);
  }
});

test("budget is per sheet: a large first sheet does not take space from the sheets after it", () => {
  const model = build([
    stacked(
      Array.from({ length: 40 }, () => 6),
      "Big",
    ),
    stacked([3, 4], "Small A"),
    stacked([2], "Small B"),
  ]);
  const r = renderOutline(model, { depth: 1, budget: 1500 });
  assert.equal(printedRegions(r.json, "s2").length, 2);
  assert.equal(printedRegions(r.json, "s3").length, 1);
  const big = printedRegions(r.json, "s1").length;
  assert.ok(big > 0 && big < 40, `big sheet is cut by its own budget (${big})`);
  assert.doesNotMatch(
    r.text
      .split("\n")
      .filter((l) => l.includes("Small"))
      .join("\n"),
    /regions=/,
  );
  assert.equal(r.degraded, false);
  parseAll(r.text);
});

test("depth 1 does not print column elision lines; depth 2 does when the budget is the reason", () => {
  const model = build([stacked([3, 5])]);
  assert.doesNotMatch(renderOutline(model, { depth: 1 }).text, /more col/);
  const tight = renderOutline(model, { ref: "s1", depth: 2, budget: 330 });
  assert.match(tight.text, /- … \d+ more col \[zoom=s1\.t\d+, from=s1\.t\d+\.c\d+\]/);
  parseAll(tight.text);
  assert.ok(
    allNodes(renderOutline(model, { ref: "s1.t1", depth: 2, budget: 20000 }).json).filter(
      (n) => n.kind === "col",
    ).length === 3,
  );
});

test("from works on columns of a region, and is rejected where it makes no sense", () => {
  const model = build([stacked([3])]);
  const page = renderOutline(model, { ref: "s1.t1", depth: 2, budget: 1, from: "s1.t1.c2" });
  const cols = allNodes(page.json)
    .filter((n) => n.kind === "col" && !n.elided)
    .map((n) => n.ref);
  assert.deepEqual(cols, ["s1.t1.c2"]);
  assert.equal(allNodes(page.json).find((n) => n.elided)!.elided!.from, "s1.t1.c3");
  assert.throws(() => renderOutline(model, { ref: "s1.t1", from: "s1.t9" }), /not a child/);
  assert.throws(() => renderOutline(model, { from: "s1.t1" }), {
    message: "from needs at: it continues the listing of one sheet or region",
  });
  assert.throws(() => renderOutline(model, { ref: "s9.t1" }), {
    message: "no region or sheet with ref 's9.t1' in this Unit",
  });
  assert.throws(() => renderOutline(model, { sheet: "Nope" }), {
    message: "no sheet 'Nope' in this Unit",
  });
});

test("a workbook too large for one response is listed as sheets only, each with its region count", () => {
  const model = build([
    stacked(
      Array.from({ length: 10 }, () => 3),
      "A",
    ),
    stacked(
      Array.from({ length: 12 }, () => 3),
      "B",
    ),
  ]);
  const whole = renderOutline(model, { depth: 1, budget: 6000 });
  assert.equal(whole.degraded, false);
  const r = renderOutline(model, { depth: 1, budget: 6000, workbookCap: 500 });
  assert.equal(r.degraded, true);
  assert.equal(allNodes(r.json).filter((n) => REGION.has(n.kind)).length, 0);
  assert.match(r.text, /sheet "A" \[ref=s1, used=[A-Z0-9:]+, regions=10\]/);
  assert.match(r.text, /sheet "B" \[ref=s2, used=[A-Z0-9:]+, regions=12\]/);
  parseAll(r.text);
  assert.equal(renderOutline(model, { ref: "s2", depth: 1, budget: 6000 }).refs.length, 13);
});

test("the objects summary of a sheet is always printed, even when the regions are cut", () => {
  const cells = stacked([3, 3, 3, 3, 3, 3]);
  const data = {
    id: "o",
    name: "O",
    sheetOrder: ["s"],
    sheets: {
      s: {
        id: "s",
        name: "S",
        rowCount: 100,
        columnCount: 8,
        mergeData: [{ startRow: 0, endRow: 0, startColumn: 3, endColumn: 4 }],
        cellData: (({ name, ...rows }) => rows)(cells),
      },
    },
  } as unknown as IWorkbookData;
  const model = buildOutlineModel(workbookFromData(data, "O", () => ""));
  const r = renderOutline(model, { ref: "s1", depth: 1, budget: 200 });
  assert.match(r.text, /- objects \[merged=1\]/);
  assert.ok(printedRegions(r.json, "s1").length < 6);
  const next = allNodes(r.json).find((n) => n.elided)!.elided!;
  assert.doesNotMatch(
    renderOutline(model, { ref: "s1", depth: 1, budget: 200, from: next.from }).text,
    /- objects/,
  );
});

test("formula cells that render blank are reported with where they are (D6)", () => {
  const cells: Record<number, Record<number, unknown>> = {
    0: { 0: { v: "Item", t: 1 }, 1: { v: "Qty", t: 1 } },
    1: { 0: { v: "a", t: 1 }, 1: { v: 1, t: 2 } },
    2: { 0: { v: "b", t: 1 }, 1: { v: 2, t: 2 } },
  };
  for (let r = 10; r < 13; r++)
    cells[r] = { 3: { f: '=IFERROR(VLOOKUP(A2,B:C,2,0),"")', v: "" }, 4: { f: '=""', v: "" } };
  const data = {
    id: "bf",
    name: "BF",
    sheetOrder: ["s"],
    sheets: { s: { id: "s", name: "Tpl", rowCount: 30, columnCount: 8, cellData: cells } },
  } as unknown as IWorkbookData;
  const model = buildOutlineModel(workbookFromData(data, "BF", () => ""));
  assert.deepEqual(model.notes, [
    "Tpl: 6 blank-rendering formula/whitespace cells treated as empty (within D11:E13)",
  ]);
});

test("identifiers are printed as they are (sheet names, explicit regions); labels from cell text collapse runs of spaces", () => {
  const cells = {
    0: { 0: { v: "Net  Income", t: 1 }, 1: { v: "Qty", t: 1 } },
    1: { 0: { v: 5, t: 2 }, 1: { v: 6, t: 2 } },
    2: { 0: { v: 7, t: 2 }, 1: { v: 8, t: 2 } },
  };
  const data = {
    id: "n",
    name: "N",
    sheetOrder: ["s"],
    sheets: {
      s: { id: "s", name: "Crude Oil  Brent", rowCount: 10, columnCount: 4, cellData: cells },
    },
  } as unknown as IWorkbookData;
  const wb = workbookFromData(data, "N", (_s, r, c) => String((cells as any)[r]?.[c]?.v ?? ""), {
    sheets: [
      { id: "s", regions: [{ kind: "table", range: "A1:B3", name: "My  Table" }], objects: [] },
    ],
  });
  const r = renderOutline(buildOutlineModel(wb), { depth: 2 });
  assert.match(r.text, /- sheet "Crude Oil {2}Brent" \[/);
  assert.match(r.text, /- table "My {2}Table" \[/);
  assert.match(r.text, /- col "Net Income" \[/);
  assert.equal(r.json.children![0]!.name, "Crude Oil  Brent");
  assert.equal(r.json.children![0]!.children![0]!.name, "My  Table");
});
