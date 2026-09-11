import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { runtimeSizeReport, verifySizeReport } from "../scripts/size-report.mjs";

test("release size report accounts for runtime files and rejects source maps", async () => {
  const root = await mkdtemp(join(tmpdir(), "uwa-size-"));
  try {
    await mkdir(join(root, "bootstrap"));
    await writeFile(join(root, "bootstrap", "app.js"), "test");
    let report = await runtimeSizeReport(root);
    assert.equal(report.bytes, 4);
    assert.equal(report.components.bootstrap, 4);
    verifySizeReport(report);
    await writeFile(join(root, "bootstrap", "app.js.map"), "map");
    report = await runtimeSizeReport(root);
    assert.throws(() => verifySizeReport(report), /source maps/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
