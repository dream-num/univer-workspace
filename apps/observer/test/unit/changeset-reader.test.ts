import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { queryChangesets } from "../../server/src/modules/observation/changeset-reader.js";

describe("Observer changeset reader", () => {
  it("queries Trunk and Worktree activity in a read-only Worker", async () => {
    const directory = mkdtempSync(join(tmpdir(), "changeset-reader-"));
    const filename = join(directory, "collaboration.sqlite");
    const database = new DatabaseSync(filename);
    database.exec(`
      CREATE TABLE collaboration_changesets (unit_id TEXT, payload_json TEXT);
      CREATE TABLE collaboration_worktree_changesets (worktree_id TEXT, unit_id TEXT, payload_json TEXT);
    `);
    const timestamp = Date.now();
    database.prepare("INSERT INTO collaboration_changesets VALUES (?, ?)").run(
      "unit-1",
      JSON.stringify({ userID: "user-1", createTime: Math.floor(timestamp / 1000), mutations: [{ id: "a" }], mutationSize: 12 })
    );
    database.prepare("INSERT INTO collaboration_worktree_changesets VALUES (?, ?, ?)").run(
      "worktree-1",
      "unit-2",
      JSON.stringify({ userID: "user-1", createTime: Math.floor(timestamp / 1000), mutations: [{ id: "b" }, { id: "c" }] })
    );
    database.prepare("INSERT INTO collaboration_changesets VALUES (?, ?)").run(
      "legacy-unit",
      JSON.stringify({ userID: "legacy", mutations: [] })
    );
    database.close();

    try {
      const result = await queryChangesets(filename, {
        from: timestamp - 60_000,
        to: timestamp + 60_000,
        userId: null,
        unitId: null,
        scope: "all",
        measure: "mutationCount",
      }, 5_000);
      expect(result.totals).toEqual({ changesetCount: 2, mutationCount: 3, mutationSize: 12 });
      expect(result.mutationSizePresentCount).toBe(1);
      expect(result.mutationSizeMissingCount).toBe(1);
      expect(result.missingCreateTimeCount).toBe(1);
      expect(result.users[0]).toMatchObject({ id: "user-1", mutationCount: 3 });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
