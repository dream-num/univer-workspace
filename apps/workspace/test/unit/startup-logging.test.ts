import { spawnSync } from "node:child_process";
import { it, expect } from "vitest";

it("keeps stage diagnostics on abrupt exit and preserves operation results and errors", () => {
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import assert from "node:assert/strict";
    import { startupStage, startupStageAsync } from "./server/src/startup-logging.ts";
    const value = {};
    assert.equal(startupStage("sync", () => value), value);
    assert.equal(await startupStageAsync("async", async () => value), value);
    const error = new Error("private configuration must not appear in diagnostics");
    assert.throws(() => startupStage("sync.failure", () => { throw error; }), e => e === error);
    await assert.rejects(startupStageAsync("async.failure", async () => { throw error; }), e => e === error);
    startupStage("abrupt", () => process.exit(23));
  `,
    ],
    {
      cwd: new URL("../../", import.meta.url),
      encoding: "utf8",
      env: { ...process.env, LOG_LEVEL: "silent" },
      timeout: 10_000,
    },
  );
  expect(child.error).toBeUndefined();
  expect(child.status).toBe(23);
  const records = child.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(records.map(({ stage, status }) => [stage, status])).toEqual([
    ["sync", "started"],
    ["sync", "completed"],
    ["async", "started"],
    ["async", "completed"],
    ["sync.failure", "started"],
    ["sync.failure", "failed"],
    ["async.failure", "started"],
    ["async.failure", "failed"],
    ["abrupt", "started"],
  ]);
  expect(new Set(records.map((record) => record.startupId)).size).toBe(1);
  for (const record of records) {
    expect(record.event).toBe("workspace.startup");
    expect(record.memory.rss).toBeGreaterThan(0);
    expect(record.memory.heapUsed).toBeGreaterThan(0);
    expect(record.heapSizeLimit).toBeGreaterThan(0);
    expect(record.elapsedMs).toBeGreaterThanOrEqual(0);
  }
  expect(child.stdout).not.toContain("private configuration");
});
