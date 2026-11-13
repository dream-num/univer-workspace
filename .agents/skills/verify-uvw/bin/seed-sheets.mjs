#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

assert(process.argv.length === 2, "Usage: seed-sheets.mjs");
assert(process.env.VERIFY_UVW_RUN && process.env.UNIVER_HOME, "Run eval \"$($V env)\" first");
const helper = fileURLToPath(new URL("./verify-uvw", import.meta.url));
const uvw = (...args) => JSON.parse(execFileSync(helper, ["uvw", ...args, "--json"], {
  encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 16 * 1024 * 1024,
}));
const repositories = uvw("repo", "list", "--owner", "@me", "--type", "personal");
assert.equal(repositories.length, 1, "Expected the signed-in user's personal repository");
const { id: space, fullName: repo } = repositories[0];
const directory = mkdtempSync(join(tmpdir(), "uvw-seed-sheets-"));
try {
  const salesFile = join(directory, "sales.xlsx");
  execFileSync("python3", [fileURLToPath(new URL("./seed-sales.py", import.meta.url)), salesFile, "1000"], { stdio: "inherit" });
  const { id: worktree } = uvw("pr", "create", "-R", repo, "-t", "Sheet lens fixtures");
  assert.equal(typeof worktree, "string", "pr create must return a Worktree ID");
  const scope = ["--worktree", worktree];
  const execute = (unit, code) => uvw("execute", ...scope, "--unit", unit, "-e", code);
  const ids = { repo, space, worktree };
  for (const [key, file] of [
    ["sales", salesFile],
    ["elements", fileURLToPath(new URL("../fixtures/elements.xlsx", import.meta.url))],
  ]) {
    console.error(`Importing ${key}`);
    ids[key] = uvw("import", ...scope, "--space", space, "--file", file, "--name", `${key}.xlsx`).unitId;
    assert.equal(typeof ids[key], "string", "import must return a Unit ID");
  }
  execute(ids.sales, `
    const calculated = api.getFormula().onCalculationResultApplied();
    api.getFormula().executeCalculation();
    await calculated;
  `);
  const calculated = uvw("inspect", "range", "A3:I8", ...scope, "--unit", ids.sales, "--worksheet", "name:Summary")
    .ranges[0].cellData.map((row) => row.map((cell) => cell?.v));
  for (let row = 1; row < 6; row++) {
    for (let col = 1; col < 6; col++) assert.equal(typeof calculated[row][col], "number", "Summary must contain calculated SUMIFS/SUM results");
  }
  assert.equal(calculated[0][8], 1000, "COUNTA must count 1,000 orders");
  assert.equal(calculated[1][8], 60, "COUNTIF must count 60 returned orders");
  assert.equal(typeof calculated[2][8], "number", "AVERAGE must be calculated");
  const ledger = readFileSync(new URL("./seed-ledger.js", import.meta.url), "utf8");
  for (const [key, rows] of [["ledger30k", 30000], ["ledger50k", 50000]]) {
    const { unit } = uvw("unit", "create", ...scope, "--space", space, "--type", "sheet", "--name", key);
    ids[key] = unit.unitId;
    assert.equal(typeof ids[key], "string", "unit create must return a Unit ID");
    for (let start = 1; start <= rows; start += 1000) {
      console.error(`${key}: ${start}-${start + 999}`);
      const result = execute(ids[key], ledger.replaceAll("__START__", String(start)).replaceAll("__COUNT__", "1000"));
      assert.equal(result.committed, true, "Ledger batch must be committed");
      assert.deepEqual(result.value, { wrote: 1000, last: start + 1000 });
    }
    const result = execute(ids[key], `
      const ws = workbook.getSheetByName("Ledger");
      return [ws.getMaxRows(), ws.getRange("A1:J1").getValues()[0], ws.getRange("A${rows + 1}").getValue()];
    `).value;
    assert.equal(result[0], rows + 1);
    assert.equal(result[1].length, 10);
    assert.equal(result[1][0], "Txn ID");
    assert.equal(result[2], `T-${1000000 + rows}`);
  }
  ids.doc = uvw("unit", "create", ...scope, "--space", space, "--type", "doc", "--name", "Sheet lens notes").unit.unitId;
  const document = execute(ids.doc, `
    const heading = doc.getParagraphs()[0];
    heading.setText("Sheet lens fixtures");
    if (!heading.setStyle({ namedStyleType: api.Enum.NamedStyleType.HEADING_1 })) throw new Error("Heading style update failed");
    doc.appendParagraph("Synthetic sales, elements, and ledger data for repeatable Sheet verification.");
    return doc.getParagraphs().map((paragraph) => paragraph.getText());
  `);
  assert.equal(document.committed, true);
  assert.equal(document.value.length, 2);
  assert.equal(document.value[0], "Sheet lens fixtures");
  process.stdout.write(`${JSON.stringify(ids)}\n`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
