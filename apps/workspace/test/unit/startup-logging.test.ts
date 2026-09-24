import { spawnSync } from "node:child_process";
import { it, expect } from "vitest";

it.each(["info", "error", "silent"])(
  "uses the shared logger at %s and preserves diagnostics on abrupt exit",
  (level) => {
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
    const { logger } = await import("./server/src/logging.ts");
    const { logger: httpLogger } = await import("./server/src/middleware/logging.ts");
    assert.equal(logger, httpLogger);
    logger.info({ event: "application.test" }, "shared logger");
    const value = {};
    assert.equal(startupStage("sync", () => value), value);
    assert.equal(await startupStageAsync("async", async () => value), value);
    const error = new Error("migration failed", { cause: new Error("database unavailable") });
    assert.throws(() => startupStage("sync.failure", () => { throw error; }), e => e === error);
    await assert.rejects(startupStageAsync("async.failure", async () => { throw error; }), e => e === error);
    startupStage("abrupt", () => process.exit(23));
  `,
      ],
      {
        cwd: new URL("../../", import.meta.url),
        encoding: "utf8",
        env: { ...process.env, LOG_LEVEL: level },
        timeout: 10_000,
      },
    );
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(23);
    const allRecords = child.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const records = allRecords.filter((record) => record.event === "workspace.startup");
    expect(allRecords.filter((record) => record.event === "application.test")).toHaveLength(
      level === "info" ? 1 : 0,
    );
    const expected = [
      ["sync", "started"],
      ["sync", "completed"],
      ["async", "started"],
      ["async", "completed"],
      ["sync.failure", "started"],
      ["sync.failure", "failed"],
      ["async.failure", "started"],
      ["async.failure", "failed"],
      ["abrupt", "started"],
    ];
    expect(records.map(({ stage, status }) => [stage, status])).toEqual(
      level === "info"
        ? expected
        : level === "error"
          ? expected.filter(([, status]) => status === "failed")
          : [],
    );
    expect(new Set(records.map((record) => record.startupId)).size).toBe(
      level === "silent" ? 0 : 1,
    );
    for (const record of records) {
      expect(record.event).toBe("workspace.startup");
      expect(record.memory.rss).toBeGreaterThan(0);
      expect(record.memory.heapUsed).toBeGreaterThan(0);
      expect(record.heapSizeLimit).toBeGreaterThan(0);
      expect(record.elapsedMs).toBeGreaterThanOrEqual(0);
    }
    for (const record of records.filter((record) => record.status === "failed")) {
      expect(record.level).toBe(50);
      expect(record.err.type).toBe("Error");
      expect(record.err.message).toContain("migration failed");
      expect(record.err.stack).toContain("database unavailable");
    }
  },
);
