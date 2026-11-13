import assert from "node:assert/strict";
import { test } from "vitest";
import { WorkspaceSheetLensEngine } from "../../src/sheet-lens.js";
import type { WorkspaceRuntimeTarget } from "../../src/runtime-target.js";
import { workbookFromData } from "../../src/sheet-lens/lens/outline/cells.js";
import { allNodes, buildOutlineModel } from "../../src/sheet-lens/lens/outline/model.js";
import { snapshot, num, text } from "./support/lens-data.js";

const target: WorkspaceRuntimeTarget = {
  origin: "https://limit.example",
  unitId: "ledger",
  unitType: "sheet",
  revision: 1,
  scope: { kind: "trunk" },
};
const dense = snapshot({
  cells: {
    0: { 0: text("Item", { s: { bl: 1 } }), 1: text("Amount", { s: { bl: 1 } }) },
    1: { 0: text("one"), 1: num(1) },
    2: { 0: text("two"), 1: num(2) },
    3: { 0: text("three"), 1: num(3) },
  },
});
const sparse = snapshot({
  cells: { 0: { 0: text("start") }, 19999: { 25: num(1) } },
  extra: { rowCount: 20000, columnCount: 26 },
});

for (const [name, data, boxCells] of [
  ["dense", dense, 8],
  ["sparse A1:Z20000", sparse, 520_000],
] as const) {
  test.each([boxCells - 1, boxCells, boxCells + 1])(
    `${name} respects maxBoxCells=%i, including equality`,
    async (maxBoxCells) => {
      const engine = new WorkspaceSheetLensEngine({
        exportUnitData: async () => data,
        maxCachedBytes: 1_000_000,
        maxBoxCells,
      });
      const result = await engine.run(target, { userId: "limit" }, { op: "outline", depth: 2 });
      assert.equal(
        result.warnings.some((warning) => warning.code === "sheet-lens-sheet-too-large"),
        maxBoxCells < boxCells,
      );
      const workbook = workbookFromData(
        data,
        "limit",
        (id, r, c) => String(data.sheets[id]?.cellData?.[r]?.[c]?.v ?? ""),
        null,
        { maxBoxCells },
      );
      const model = buildOutlineModel(workbook, { maxBoxCells });
      const nodes = allNodes(model.root);
      if (maxBoxCells < boxCells) {
        assert.equal(nodes.filter((node) => node.kind === "block").length, 1);
        assert.equal(nodes.filter((node) => node.kind === "col").length, 0);
        assert.ok(result.text.includes("block"));
      } else if (name === "dense") {
        assert.equal(nodes.filter((node) => node.kind === "table").length, 1);
        assert.equal(nodes.filter((node) => node.kind === "col").length, 2);
        assert.ok(result.text.includes('"Amount"'));
      } else {
        assert.ok(!workbook.sheets[0]?.fs.tooLarge);
        assert.equal(model.notes.filter((note) => note.includes("too large")).length, 0);
        assert.ok(nodes.some((node) => node.range === "A1"));
        assert.ok(nodes.some((node) => node.range === "Z20000"));
      }
    },
  );
}

test("buildOutlineModel can lower the prepared workbook limit without mutating it", () => {
  const workbook = workbookFromData(dense, "limit", () => "visible");
  const limited = buildOutlineModel(workbook, { maxBoxCells: 7 });
  assert.equal(allNodes(limited.root).filter((node) => node.kind === "block").length, 1);
  assert.ok(limited.notes.some((note) => note.includes("too large")));
  assert.equal(
    allNodes(buildOutlineModel(workbook).root).filter((node) => node.kind === "col").length,
    2,
  );
});

test.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
  "the engine rejects invalid maxBoxCells=%s",
  (maxBoxCells) => {
    assert.throws(
      () =>
        new WorkspaceSheetLensEngine({
          exportUnitData: async () => dense,
          maxCachedBytes: 1_000_000,
          maxBoxCells,
        }),
      /maxBoxCells must be a positive safe integer/,
    );
  },
);
