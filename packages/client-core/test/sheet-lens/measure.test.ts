import assert from "node:assert/strict";
import { test } from "vitest";
import { WorkspaceSheetLensEngine } from "../../src/sheet-lens.js";
import type { WorkspaceRuntimeTarget } from "../../src/runtime-target.js";
import type { Snapshot } from "../../src/sheet-lens/engine/types.js";
import { snapshot, num, text, type Cells } from "./support/lens-data.js";

function ledger(rows: number): Snapshot {
  const cells: Cells = {};
  for (let r = 0; r < rows; r++) {
    const row: Cells[number] = {};
    for (let c = 0; c < 10; c++)
      row[c] =
        r === 0
          ? text(`Column ${c}`, { s: { bl: 1 } })
          : c < 3
            ? text(`ledger-${c}-${r}`)
            : num((r * (c + 1)) / 100, c === 9 ? { f: `=G${r + 1}+H${r + 1}` } : {});
    cells[r] = row;
  }
  return snapshot({ name: "Ledger", cells, extra: { rowCount: rows, columnCount: 10 } });
}

const target: WorkspaceRuntimeTarget = {
  origin: "https://measure.example",
  unitId: "ledger",
  unitType: "sheet",
  revision: 1,
  scope: { kind: "trunk" },
};
const caller = { userId: "measure" };

async function measure(rows: number, sample: number) {
  assert.ok(global.gc, "run vitest with --pool=forks --execArgv=--expose-gc");
  let exports = 0;
  let jsonBytes = 0;
  const engine = new WorkspaceSheetLensEngine({
    maxCachedBytes: 2 ** 30,
    exportUnitData: async () => {
      exports++;
      const data = ledger(rows);
      jsonBytes = Buffer.byteLength(JSON.stringify(data));
      return data;
    },
  });
  global.gc();
  const before = process.memoryUsage().heapUsed;
  const result = await engine.run(target, caller, { op: "outline" });
  assert.equal(result.cache, "miss");
  assert.ok(!result.warnings.some((warning) => warning.code === "sheet-lens-not-cached"));
  assert.ok(result.text.includes("formulas="));
  global.gc();
  const heapBytes = process.memoryUsage().heapUsed - before;
  assert.ok(heapBytes > 0, "retained engine heap must increase");
  const hit = await engine.run(target, caller, {
    op: "find",
    terms: ["ledger-0-"],
    in: "values",
    caseSensitive: false,
    max: 1,
  });
  assert.equal(hit.cache, "hit");
  assert.equal(exports, 1);
  assert.ok(
    (hit.json as { total: number }).total === rows - 1,
    "all ledger rows were prepared and searched",
  );
  const factor = heapBytes / jsonBytes;
  process.stdout.write(
    `${JSON.stringify({ rows, sample, jsonBytes, heapBytes, factor, exports, cache: hit.cache })}\n`,
  );
  return factor;
}

test.skipIf(process.env.SHEET_LENS_MEASURE !== "1")(
  "forced-GC retained engine heap per UnitData JSON byte",
  async () => {
    const warm = new WorkspaceSheetLensEngine({
      exportUnitData: async () => ledger(10),
      maxCachedBytes: 1_000_000,
    });
    await warm.run(target, caller, { op: "outline" });
    await warm.run(target, caller, { op: "read", range: "A1:J2", content: "both" });
    await warm.run(target, caller, {
      op: "find",
      terms: ["ledger"],
      in: "values",
      caseSensitive: false,
    });
    const factors = new Map<number, number[]>();
    for (let sample = 1; sample <= 5; sample++) {
      for (const rows of [1000, 30000, 50000]) {
        const factor = await measure(rows, sample);
        factors.set(rows, [...(factors.get(rows) ?? []), factor]);
      }
    }
    for (const [rows, values] of factors) {
      const sorted = [...values].sort((a, b) => a - b);
      process.stdout.write(
        `${JSON.stringify({
          rows,
          samples: values.length,
          median: sorted[2],
          min: sorted[0],
          max: sorted[4],
          roundedUp: Math.ceil(Math.max(...values)),
        })}\n`,
      );
    }
  },
  300_000,
);
