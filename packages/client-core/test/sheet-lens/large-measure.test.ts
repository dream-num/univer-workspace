import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { test } from "vitest";
import { WorkspaceSheetLensEngine } from "../../src/sheet-lens.js";
import type { WorkspaceRuntimeTarget } from "../../src/runtime-target.js";
import type { Snapshot } from "../../src/sheet-lens/engine/types.js";
import { snapshot, num, text, type Cells } from "./support/lens-data.js";

function ledger(cells: number): Snapshot {
  assert.equal(cells % 10, 0);
  const rows = cells / 10;
  const values: Cells = {};
  for (let r = 0; r < rows; r++) {
    const row: Cells[number] = {};
    for (let c = 0; c < 10; c++)
      row[c] =
        r === 0
          ? text(`Column ${c}`, { s: { bl: 1 } })
          : c < 3
            ? text(`ledger-${c}-${r}`)
            : num((r * (c + 1)) / 100, c === 9 ? { f: `=G${r + 1}+H${r + 1}` } : {});
    values[r] = row;
  }
  return snapshot({ name: "Ledger", cells: values, extra: { rowCount: rows, columnCount: 10 } });
}

const target: WorkspaceRuntimeTarget = {
  origin: "https://measure.example",
  unitId: "ledger",
  unitType: "sheet",
  revision: 1,
  scope: { kind: "trunk" },
};
const caller = { userId: "measure" };
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function measure(cells: number, sample: number) {
  assert.ok(global.gc, "run with --pool=forks --execArgv=--expose-gc");
  let exports = 0;
  let jsonBytes = 0;
  const engine = new WorkspaceSheetLensEngine({
    maxCachedBytes: 2 ** 31,
    maxBoxCells: cells,
    exportUnitData: async () => {
      exports++;
      const data = ledger(cells);
      jsonBytes = Buffer.byteLength(JSON.stringify(data));
      return data;
    },
  });
  global.gc();
  await setImmediate();
  global.gc();
  const before = process.memoryUsage();
  const result = await engine.run(target, caller, {
    op: "outline",
    at: "s1.t1",
    depth: 2,
    budget: 20_000,
  });
  assert.equal(result.cache, "miss");
  assert.deepEqual(result.warnings, []);
  assert.equal((result.text.match(/\bcol /g) ?? []).length, 10, "all ten columns must be modelled");
  assert.ok(result.text.includes(`A1:J${cells / 10}`), "the table covers the full ledger");
  global.gc();
  await setImmediate();
  global.gc();
  const after = process.memoryUsage();
  const heapBytes = after.heapUsed - before.heapUsed;
  const arrayBufferBytes = after.arrayBuffers - before.arrayBuffers;
  assert.ok(heapBytes > 0);
  assert.ok(
    arrayBufferBytes >= 0,
    "previous entry backing stores must be released before baseline",
  );
  const hit = await engine.run(target, caller, {
    op: "find",
    terms: ["ledger-0-"],
    in: "values",
    caseSensitive: false,
    max: 1,
  });
  assert.equal(hit.cache, "hit");
  assert.equal(exports, 1);
  assert.equal((hit.json as { total: number }).total, cells / 10 - 1);
  const row = {
    cells,
    sample,
    jsonBytes,
    heapBytes,
    arrayBufferBytes,
    residentBytes: heapBytes + arrayBufferBytes,
    estimatedBytes: jsonBytes * 12,
    modelMs: result.timings.operationMs ?? 0,
    requestMs: result.timings.totalMs ?? 0,
    exportMs: result.timings.exportMs ?? 0,
    buildMs: (result.timings.prepareMs ?? 0) + (result.timings.operationMs ?? 0),
    exports,
    cache: hit.cache,
  };
  process.stdout.write(`${JSON.stringify(row)}\n`);
  return row;
}

test.skipIf(process.env.SHEET_LENS_LARGE_MEASURE !== "1")(
  "measure fully modelled ledger build time and retained cache heap",
  async () => {
    const extra = Number(process.env.SHEET_LENS_EXTRA_CELLS ?? 0);
    const sizes = [100_000, 300_000, 500_000, 1_000_000, 2_000_000];
    if (extra) {
      assert.ok(Number.isSafeInteger(extra) && extra > 0 && extra <= 8_000_000);
      sizes.push(extra);
    }
    for (const cells of sizes) await measure(cells, 0);
    const rows: Awaited<ReturnType<typeof measure>>[] = [];
    for (let sample = 1; sample <= 3; sample++)
      for (const cells of sample % 2 ? sizes : [...sizes].reverse())
        rows.push(await measure(cells, sample));
    for (const cells of sizes) {
      const samples = rows.filter((row) => row.cells === cells);
      process.stdout.write(
        `${JSON.stringify({
          cells,
          samples: samples.length,
          buildMs: median(samples.map((row) => row.buildMs)),
          buildRangeMs: [
            Math.min(...samples.map((row) => row.buildMs)),
            Math.max(...samples.map((row) => row.buildMs)),
          ],
          modelMs: median(samples.map((row) => row.modelMs)),
          requestMs: median(samples.map((row) => row.requestMs)),
          heapBytes: median(samples.map((row) => row.heapBytes)),
          residentBytes: median(samples.map((row) => row.residentBytes)),
          maxResidentBytes: Math.max(...samples.map((row) => row.residentBytes)),
          estimatedBytes: samples[0]?.estimatedBytes,
        })}\n`,
      );
    }
  },
  600_000,
);
