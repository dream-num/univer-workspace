import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { WorkspaceApplicationError } from "../../src/errors.js";
import type { WorkspaceRuntimeTarget } from "../../src/runtime-target.js";
import { WorkspaceSheetLensEngine, type SheetLensRequest } from "../../src/sheet-lens.js";
import { allNodes, type OutlineNode } from "../../src/sheet-lens/lens/index.js";
import { snapshot, text, num, type Cells } from "./support/lens-data.js";

const target: WorkspaceRuntimeTarget = {
  origin: "https://workspace.example",
  scope: { kind: "trunk" },
  unitId: "unit",
  unitType: "sheet",
  revision: 1,
};
const caller = { userId: "alice", grant: { token: "opaque" } };
const read = { op: "read", range: "A1:B4", content: "both" } satisfies SheetLensRequest;
const find = {
  op: "find",
  terms: ["item"],
  in: "values",
  caseSensitive: false,
} satisfies SheetLensRequest;
const ledger = () =>
  snapshot({
    cells: {
      0: { 0: text("Item"), 1: text("Amount") },
      1: { 0: text("item one"), 1: num(2, { f: "=1+1" }) },
      2: { 0: text("item two"), 1: num(3) },
      3: { 0: text("item three"), 1: num(4) },
    },
  });

function setup(data = ledger(), maxCachedBytes = 1_000_000) {
  const exportUnitData = vi.fn(async () => data);
  const engine = new WorkspaceSheetLensEngine({
    exportUnitData,
    maxCachedBytes,
    bytesPerJsonByte: 1,
  });
  return { engine, exportUnitData };
}

test("same caller and revision hit without exporting; new revision misses and caller is passed intact", async () => {
  const { engine, exportUnitData } = setup();
  const first = await engine.run(target, caller, read);
  const second = await engine.run(target, caller, read);
  assert.equal(first.cache, "miss");
  assert.equal(second.cache, "hit");
  assert.equal(exportUnitData.mock.calls.length, 1);
  assert.deepEqual(exportUnitData.mock.calls[0], [{ target, caller }]);
  assert.equal(second.revision, 1);
  assert.deepEqual(second.json, first.json);
  assert.ok(!second.text.startsWith("unit "));
  assert.ok(Object.values(second.timings).every((ms) => ms >= 0));
  assert.equal((await engine.run({ ...target, revision: 2 }, caller, read)).cache, "miss");
  assert.equal(exportUnitData.mock.calls.length, 2);
});

test("caller IDs isolate entries; grants do not enter the cache identity", async () => {
  const { engine, exportUnitData } = setup();
  await engine.run(target, caller, read);
  assert.equal((await engine.run(target, { userId: "bob" }, read)).cache, "miss");
  assert.equal(
    (await engine.run(target, { userId: "alice", grant: Symbol("unserializable") }, read)).cache,
    "hit",
  );
  assert.equal(exportUnitData.mock.calls.length, 2);
});

test("origin, scope, worktree and Unit ID isolate entries", async () => {
  const { engine, exportUnitData } = setup();
  const targets: WorkspaceRuntimeTarget[] = [
    target,
    { ...target, origin: "https://other.example" },
    { ...target, unitId: "other" },
    { ...target, scope: { kind: "worktree", worktreeId: "one" } },
    { ...target, scope: { kind: "worktree", worktreeId: "two" } },
  ];
  for (const value of targets) assert.equal((await engine.run(value, caller, read)).cache, "miss");
  for (const value of targets) assert.equal((await engine.run(value, caller, read)).cache, "hit");
  assert.equal(exportUnitData.mock.calls.length, targets.length);
});

test("byte budget evicts the least recently used entry, including after a read hit", async () => {
  const data = ledger();
  const bytes = Buffer.byteLength(JSON.stringify(data));
  const { engine, exportUnitData } = setup(data, bytes * 2);
  const a = { ...target, unitId: "a" },
    b = { ...target, unitId: "b" },
    c = { ...target, unitId: "c" };
  await engine.run(a, caller, read);
  await engine.run(b, caller, read);
  assert.equal((await engine.run(a, caller, read)).cache, "hit");
  await engine.run(c, caller, read);
  assert.equal((await engine.run(a, caller, read)).cache, "hit");
  assert.equal((await engine.run(b, caller, read)).cache, "miss");
  assert.equal(exportUnitData.mock.calls.length, 4);
});

test("cache capacity follows JSON bytes times the configured factor, not entry count", async () => {
  const small = ledger();
  const large = { ...small, name: "x".repeat(3000) };
  const bytes = Buffer.byteLength(JSON.stringify(small));
  const exportUnitData = vi.fn(async ({ target }: { target: WorkspaceRuntimeTarget }) =>
    target.unitId === "large" ? large : small,
  );
  const engine = new WorkspaceSheetLensEngine({
    exportUnitData,
    maxCachedBytes: bytes * 4,
    bytesPerJsonByte: 2,
  });
  await engine.run(target, caller, read);
  const result = await engine.run({ ...target, unitId: "large" }, caller, read);
  assert.equal(result.warnings[0]?.code, "sheet-lens-not-cached");
  assert.equal((await engine.run(target, caller, read)).cache, "hit");
  assert.equal(exportUnitData.mock.calls.length, 2);
});

test("an oversized Unit is returned with a warning and is never cached", async () => {
  const { engine, exportUnitData } = setup(ledger(), 1);
  const first = await engine.run(target, caller, read);
  const second = await engine.run(target, caller, read);
  assert.equal(first.cache, "miss");
  assert.equal(second.cache, "miss");
  assert.deepEqual(first.json, second.json);
  assert.ok(
    first.warnings.some(
      (w) => w.code === "sheet-lens-not-cached" && w.message.includes("not cached"),
    ),
  );
  assert.equal(exportUnitData.mock.calls.length, 2);
});

test("non-Sheet targets fail before export, naming their type and inspect", async () => {
  const { engine, exportUnitData } = setup();
  for (const unitType of ["doc", "slide", "base", "board"] as const)
    await assert.rejects(engine.run({ ...target, unitType }, caller, read), (error: unknown) => {
      assert.ok(error instanceof WorkspaceApplicationError);
      assert.equal(error.code, "workspace-sheet-lens-unit-type-unsupported");
      assert.ok(error.message.includes(unitType));
      assert.ok(error.message.includes("inspect"));
      return true;
    });
  assert.equal(exportUnitData.mock.calls.length, 0);
});

test("read and find reuse prepared views, including after outline builds its model", async () => {
  const data = ledger();
  const sheet = data.sheets.id0;
  assert.ok(sheet);
  const cells = sheet.cellData;
  let accesses = 0;
  Object.defineProperty(sheet, "cellData", {
    enumerable: true,
    get: () => {
      accesses++;
      return cells;
    },
  });
  const { engine, exportUnitData } = setup(data);
  await engine.run(target, caller, read);
  const preparedAccesses = accesses;
  await engine.run(target, caller, find);
  await engine.run(target, caller, { op: "outline" });
  await engine.run(target, caller, read);
  await engine.run(target, caller, find);
  assert.equal(accesses, preparedAccesses);
  assert.equal(exportUnitData.mock.calls.length, 1);
});

test("the unchanged 500,000-cell threshold yields a block and preserves the Lens note", async () => {
  const data = snapshot({
    cells: { 0: { 0: text("start") }, 50000: { 9: num(1) } },
    extra: { rowCount: 50001, columnCount: 10 },
  });
  const { engine } = setup(data);
  const result = await engine.run(target, caller, { op: "outline" });
  const root = result.json as OutlineNode;
  assert.ok(allNodes(root).some((node) => node.kind === "block"));
  assert.deepEqual(
    result.warnings.filter((w) => w.code === "sheet-lens-sheet-too-large"),
    [{
      code: "sheet-lens-sheet-too-large",
      message: "sheet s1 too large: rendered as one block; read it page by page with read, or locate cells with find",
    }],
  );
});

test("uncached direct and shared formulas are counted by sheet ID, with cached empty strings excluded", async () => {
  const data = snapshot(
    {
      name: "Same",
      cells: {
        0: {
          0: { f: "=1+1" },
          1: { f: "=A1+1", v: null },
          2: { si: "shared" },
          3: { f: '=IF(TRUE,"",1)', v: "" },
          4: num(2, { f: "=1+1" }),
        },
      },
    },
    { name: "Same", cells: { 0: { 0: { f: "=2+2" } } } },
  );
  const { engine } = setup(data);
  const result = await engine.run(target, caller, { op: "outline" });
  const root = result.json as OutlineNode;
  const sheets = allNodes(root).filter((node) => node.kind === "sheet");
  assert.deepEqual(
    sheets.map((node) => node.attrs.uncached),
    [3, 1],
  );
  assert.ok(result.text.includes("uncached=3"));
  assert.equal(result.warnings.filter((w) => w.code === "sheet-lens-uncached-formulas").length, 2);
  assert.ok(
    result.warnings
      .filter((w) => w.code === "sheet-lens-uncached-formulas")
      .every((w) => w.message.includes("execute")),
  );
});

test("malformed structure notes become warnings and repeat without accumulation", async () => {
  const data = ledger();
  data.resources = [{ name: "SHEET_DRAWING_PLUGIN", data: "{" }];
  const { engine } = setup(data);
  const first = await engine.run(target, caller, { op: "outline" });
  assert.ok(
    first.warnings.some(
      (w) => w.code === "sheet-lens-structure-unreadable" && w.message.includes("malformed JSON"),
    ),
  );
  assert.deepEqual((await engine.run(target, caller, { op: "outline" })).warnings, first.warnings);
  first.warnings.length = 0;
  assert.ok((await engine.run(target, caller, read)).warnings.length > 0);
});

test("read JSON preserves numeric formula values and paginates whole rows with no overlap", async () => {
  const { engine } = setup();
  const request = { ...read, max: 4 };
  const first = await engine.run(target, caller, request);
  assert.deepEqual(first.next, { op: "read", range: "Sheet1!A3:B4", remaining: 2 });
  assert.equal(first.next?.op, "read");
  if (first.next?.op !== "read") assert.fail("missing continuation");
  const second = await engine.run(target, caller, { ...request, ...first.next });
  assert.equal(second.next, undefined);
  assert.deepEqual(first.json, expectReadFirst());
  const cellsOf = (json: unknown) =>
    (json as { cells: { ref: string }[] }).cells.map((cell) => cell.ref);
  const combined = [...cellsOf(first.json), ...cellsOf(second.json)];
  assert.equal(new Set(combined).size, 8);
  assert.deepEqual(combined, cellsOf((await engine.run(target, caller, read)).json));
});

function expectReadFirst() {
  return {
    sheet: "Sheet1",
    ref: "s1",
    range: "A1:B2",
    requested: "A1:B4",
    content: "both",
    rows: 2,
    columns: 2,
    empty: false,
    cells: [
      { ref: "A1", type: "text", display: "Item", value: "Item" },
      { ref: "B1", type: "text", display: "Amount", value: "Amount" },
      { ref: "A2", type: "text", display: "item one", value: "item one" },
      { ref: "B2", type: "number", display: "2", value: 2, formula: "=1+1" },
    ],
  };
}

test("find applies sheet names and refs, then continues at the first omitted hit without overlap", async () => {
  const data = ledger();
  const other = snapshot({ name: "Other's ! sheet", cells: { 0: { 0: text("item other") } } })
    .sheets.id0;
  assert.ok(other);
  data.sheets.other = other;
  data.sheetOrder.push("other");
  const { engine } = setup(data);
  const request = { ...find, sheets: ["Sheet1", "s1"], max: 2 };
  const first = await engine.run(target, caller, request);
  assert.deepEqual(first.next, { op: "find", from: "Sheet1!A3", remaining: 2 });
  if (first.next?.op !== "find") assert.fail("missing continuation");
  const second = await engine.run(target, caller, { ...request, ...first.next });
  assert.equal(second.next, undefined);
  const hits = (json: unknown) => (json as { cells: { ref: string; sheet: string }[] }).cells;
  assert.deepEqual(
    [...hits(first.json), ...hits(second.json)].map((cell) => `${cell.sheet}!${cell.ref}`),
    ["Sheet1!A1", "Sheet1!A2", "Sheet1!A3", "Sheet1!A4"],
  );
  const selected = await engine.run(target, caller, { ...find, sheets: ["s2"] });
  assert.deepEqual(
    hits(selected.json).map((cell) => cell.sheet),
    ["Other's ! sheet"],
  );
  const all = await engine.run(target, caller, { ...find, max: 4 });
  if (all.next?.op !== "find") assert.fail("missing quoted continuation");
  assert.equal(all.next.from, "'Other''s ! sheet'!A1");
  assert.equal(hits((await engine.run(target, caller, { ...find, ...all.next })).json).length, 1);
});

test("a small outline budget returns the rest of the regions without overlap", async () => {
  const cells: Cells = {};
  for (let table = 0; table < 8; table++) {
    const top = table * 6;
    cells[top] = { 0: text(`Item${table}`, { s: { bl: 1 } }), 1: text("Qty", { s: { bl: 1 } }) };
    for (let r = 1; r <= 3; r++) cells[top + r] = { 0: text(`x${table}-${r}`), 1: num(r) };
  }
  const { engine } = setup(snapshot({ cells }));
  const request = { op: "outline", at: "s1", depth: 1, budget: 250 } satisfies SheetLensRequest;
  const regions = (json: unknown) =>
    (json as OutlineNode).children
      ?.filter((node) => node.ref && !node.elided)
      .map((node) => node.ref) ?? [];
  const full = await engine.run(target, caller, { ...request, budget: 10000 });
  let page = await engine.run(target, caller, request);
  const seen = regions(page.json);
  assert.equal(page.next?.op, "outline");
  let pages = 1;
  while (page.next) {
    if (page.next.op !== "outline") assert.fail("wrong continuation");
    assert.equal(page.next.at, "s1");
    assert.equal(page.next.unit, "regions");
    assert.ok(page.next.remaining > 0);
    page = await engine.run(target, caller, { ...request, ...page.next });
    seen.push(...regions(page.json));
    assert.ok(++pages <= 8, "continuation must advance");
  }
  assert.deepEqual(seen, regions(full.json));
  assert.equal(new Set(seen).size, 8);
});

test("invalid limits fail before export", async () => {
  const { engine, exportUnitData } = setup();
  for (const max of [0, -1, 1.5, NaN, Infinity]) {
    await assert.rejects(engine.run(target, caller, { ...read, max }), {
      code: "workspace-argument-invalid",
    });
    await assert.rejects(engine.run(target, caller, { ...find, max }), {
      code: "workspace-argument-invalid",
    });
  }
  await assert.rejects(engine.run(target, caller, { op: "outline", budget: 0 }), {
    code: "workspace-argument-invalid",
  });
  await assert.rejects(engine.run(target, caller, { ...find, terms: [] }), {
    code: "workspace-argument-invalid",
  });
  assert.equal(exportUnitData.mock.calls.length, 0);
});
