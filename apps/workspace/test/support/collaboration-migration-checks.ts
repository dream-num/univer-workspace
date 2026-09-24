import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { prepareCollaborationDatabase } from "../../server/src/integrations/univer/migrations/prepare-collaboration-database.js";
import type { createCollaborationRuntime } from "../../server/src/integrations/univer/unit-store.js";

export async function verifyCollaborationMigration(
  prepare: typeof prepareCollaborationDatabase,
  createRuntime: typeof createCollaborationRuntime,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "workspace-sdk-migration-"));
  const schema = readFileSync(
    new URL("../fixtures/collaboration-rc/schema.sql", import.meta.url),
    "utf8",
  );
  const data = readFileSync(
    new URL("../fixtures/collaboration-rc/data.sql", import.meta.url),
    "utf8",
  );
  const versions = (db: DatabaseSync) =>
    Object.fromEntries(
      db
        .prepare("SELECT component, version FROM collaboration_schema_versions")
        .all()
        .map((row) => [row.component, row.version]),
    );
  const createLegacy = (name: string, populated = false) => {
    const filename = join(directory, name);
    const db = new DatabaseSync(filename);
    db.exec(schema);
    if (populated) db.exec(data);
    return { filename, db };
  };
  try {
    assert.deepEqual(await prepare(join(directory, "fresh.sqlite")), { status: "fresh" });
    assert.deepEqual(await prepare(":memory:"), { status: "fresh" });
    for (const populated of [false, true]) {
      const { filename, db } = createLegacy(`${populated}.sqlite`, populated);
      // Leave committed data in WAL, exercising a consistent backup of it.
      db.exec("PRAGMA journal_mode = WAL");
      if (populated) {
        const changeset = {
          unitID: "legacy-doc",
          type: 1,
          revision: 2,
          baseRev: 1,
          sid: "legacy-session",
          reqId: 1,
          userID: "legacy-owner",
          memberID: "legacy-member",
          createTime: 1700000001,
          mutations: [],
        };
        db.prepare("INSERT INTO collaboration_changesets VALUES (?, 2, 1, ?, 1, ?)").run(
          "legacy-doc",
          changeset.sid,
          JSON.stringify(changeset),
        );
        db.exec("UPDATE collaboration_units SET head_revision = 2 WHERE unit_id = 'legacy-doc'");
        db.prepare(
          "INSERT INTO collaboration_worktree_changesets VALUES ('pending-worktree', 'legacy-doc', 2, 1, 'draft-session', 1, ?)",
        ).run(JSON.stringify({ ...changeset, sid: "draft-session" }));
        db.exec(
          "UPDATE collaboration_worktree_units SET draft_head_revision = 2, ready_draft_head_revision = 2, removed = 1",
        );
      }
      const before = populated
        ? db.prepare("SELECT payload_json FROM collaboration_snapshots ORDER BY unit_id").all()
        : [];
      db.close();
      const result = await prepare(filename);
      assert.equal(result.status, "migrated");
      if (result.status !== "migrated") throw new Error("Expected backup");
      const backup = new DatabaseSync(result.backupFilename);
      assert.deepEqual(versions(backup), { core: 1, worktree: 2, history: 1 });
      assert.equal(backup.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      if (populated)
        assert.equal(
          backup.prepare("SELECT COUNT(*) AS n FROM collaboration_changesets").get()?.n,
          1,
        );
      backup.close();
      const migrated = new DatabaseSync(filename);
      assert.deepEqual(versions(migrated), { core: 2, worktree: 3, history: 2 });
      assert.deepEqual(migrated.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(migrated.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      if (populated) {
        assert.deepEqual(
          migrated
            .prepare("SELECT payload_json FROM collaboration_snapshots ORDER BY unit_id")
            .all(),
          before,
        );
        assert.equal(
          migrated
            .prepare("SELECT creator_id FROM collaboration_units WHERE unit_id = 'legacy-doc'")
            .get()?.creator_id,
          "legacy-owner",
        );
        assert.equal(
          migrated
            .prepare("SELECT created_at_ms FROM collaboration_units WHERE unit_id = 'legacy-doc'")
            .get()?.created_at_ms,
          1700000000000,
        );
        assert.equal(
          migrated.prepare("SELECT created_at_ms FROM collaboration_changesets").get()
            ?.created_at_ms,
          1700000001000,
        );
        assert.equal(
          migrated.prepare("SELECT created_at_ms FROM collaboration_worktree_changesets").get()
            ?.created_at_ms,
          1700000001000,
        );
        assert.ok(
          migrated
            .prepare(
              "SELECT soft_deleted_at_ms FROM collaboration_units WHERE unit_id = 'deleted-doc'",
            )
            .get()?.soft_deleted_at_ms,
        );
        assert.equal(
          migrated.prepare("SELECT status FROM collaboration_worktrees").get()?.status,
          "merging",
        );
        assert.equal(
          migrated.prepare("SELECT removed FROM collaboration_worktree_units").get()?.removed,
          1,
        );
      }
      migrated.close();
      const files = readdirSync(directory).sort();
      assert.deepEqual(await prepare(filename), { status: "current" });
      assert.deepEqual(readdirSync(directory).sort(), files);
      const runtime = createRuntime(filename);
      try {
        if (populated) {
          const history = await runtime.historyService.getHistoryList(
            { unitID: "legacy-doc", length: 20 },
            { userID: "legacy-owner", customData: {} },
          );
          assert.ok(history.historyIds.length > 0);
          const loaded = await runtime.service.getUnitLoadData(
            { unitID: "legacy-doc", type: 1, revision: 0 },
            { userID: "legacy-owner", customData: {} },
          );
          assert.equal(loaded.targetRevision, 2);
        }
      } finally {
        await runtime.dispose();
      }
    }

    // Older deployments may have no History yet, or Worktree V1.
    for (const variant of ["no-history", "worktree-v1"] as const) {
      const legacy = createLegacy(`${variant}.sqlite`);
      if (variant === "no-history") {
        legacy.db.exec(
          "DROP TABLE collaboration_history_revisions; DELETE FROM collaboration_schema_versions WHERE component = 'history'",
        );
      } else {
        legacy.db.exec(
          "ALTER TABLE collaboration_worktree_units DROP COLUMN removed; UPDATE collaboration_schema_versions SET version = 1 WHERE component = 'worktree'",
        );
      }
      legacy.db.close();
      assert.equal((await prepare(legacy.filename)).status, "migrated");
      const runtime = createRuntime(legacy.filename);
      await runtime.dispose();
      assert.equal((await prepare(legacy.filename)).status, "current");
    }

    const future = createLegacy("future.sqlite");
    future.db.exec(
      "UPDATE collaboration_schema_versions SET version = 99 WHERE component = 'core'",
    );
    future.db.close();
    await assert.rejects(prepare(future.filename), /Unsupported Collaboration core schema 99/);
    assert.equal(
      readdirSync(directory).some((name) => name.startsWith("future.sqlite.pre-")),
      false,
    );

    // Failure in the final component must not publish Core/Worktree upgrades.
    const failed = createLegacy("failed.sqlite", true);
    failed.db.exec("DROP TABLE collaboration_history_revisions");
    failed.db.close();
    const original = readFileSync(failed.filename);
    await assert.rejects(prepare(failed.filename), /original database is unchanged/);
    assert.deepEqual(readFileSync(failed.filename), original);
    const old = new DatabaseSync(failed.filename);
    assert.deepEqual(versions(old), { core: 1, worktree: 2, history: 1 });
    old.close();
    const failedBackup = readdirSync(directory).find(
      (name) => name.startsWith("failed.sqlite.pre-") && name.endsWith(".bak"),
    );
    assert.ok(failedBackup);
    const backup = new DatabaseSync(join(directory, failedBackup));
    assert.equal(backup.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
    backup.close();
    assert.equal(
      readdirSync(directory).some((name) => name.includes(".migrating")),
      false,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
