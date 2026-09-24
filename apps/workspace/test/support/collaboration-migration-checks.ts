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
  const productFilename = createProductDatabase(join(directory, "product.sqlite"));
  const prepareWithProduct = (filename: string) => prepare(filename, productFilename);
  try {
    assert.deepEqual(await prepareWithProduct(join(directory, "fresh.sqlite")), {
      status: "fresh",
    });
    assert.deepEqual(await prepareWithProduct(":memory:"), { status: "fresh" });
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
        // Units without a History creation record take product creation facts.
        db.exec(`
          INSERT INTO collaboration_units VALUES ('product-doc', 1, 1, NULL);
          INSERT INTO collaboration_worktree_units
            (removed, worktree_id, unit_id, unit_order, type, source,
             baseline_trunk_revision, draft_head_revision)
          VALUES (0, 'pending-worktree', 'draft-doc', 1, 1, 'worktree', 1, 1);
        `);
      }
      const before = populated
        ? db.prepare("SELECT payload_json FROM collaboration_snapshots ORDER BY unit_id").all()
        : [];
      db.close();
      const result = await prepareWithProduct(filename);
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
      assert.equal(migrated.prepare("PRAGMA journal_mode").get()?.journal_mode, "wal");
      if (populated) {
        const unitCreation = (unitId: string) =>
          migrated
            .prepare(
              "SELECT creator_id, created_at_ms FROM collaboration_units WHERE unit_id = ?",
            )
            .get(unitId);
        const worktreeUnitCreation = (unitId: string) =>
          migrated
            .prepare(
              "SELECT creator_id, created_at_ms FROM collaboration_worktree_units WHERE unit_id = ?",
            )
            .get(unitId);
        // History remains the first source even when the product record differs.
        assert.deepEqual(
          { ...unitCreation("legacy-doc") },
          { creator_id: "legacy-owner", created_at_ms: 1700000000000 },
        );
        assert.deepEqual(
          { ...unitCreation("product-doc") },
          { creator_id: "product-owner", created_at_ms: 1690000000000 },
        );
        assert.deepEqual(
          { ...worktreeUnitCreation("legacy-doc") },
          { creator_id: "legacy-owner", created_at_ms: 1700000000000 },
        );
        assert.deepEqual(
          { ...worktreeUnitCreation("draft-doc") },
          { creator_id: "draft-owner", created_at_ms: 1695000000000 },
        );
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
          migrated
            .prepare("SELECT removed FROM collaboration_worktree_units WHERE unit_id = 'legacy-doc'")
            .get()?.removed,
          1,
        );
      }
      migrated.close();
      const files = readdirSync(directory).sort();
      assert.deepEqual(await prepareWithProduct(filename), { status: "current" });
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
      assert.equal((await prepareWithProduct(legacy.filename)).status, "migrated");
      const runtime = createRuntime(legacy.filename);
      await runtime.dispose();
      assert.equal((await prepareWithProduct(legacy.filename)).status, "current");
    }

    // A connection left open by an old instance blocks the upgrade before backup.
    const busy = createLegacy("busy.sqlite", true);
    busy.db.exec("PRAGMA journal_mode = WAL");
    busy.db.prepare("SELECT 1 FROM collaboration_units").get();
    await assert.rejects(prepareWithProduct(busy.filename), /database is in use/);
    assert.equal(busy.db.prepare("PRAGMA journal_mode").get()?.journal_mode, "wal");
    assert.deepEqual(versions(busy.db), { core: 1, worktree: 2, history: 1 });
    busy.db.close();
    assert.equal(
      readdirSync(directory).some((name) => name.startsWith("busy.sqlite.pre-")),
      false,
    );

    const unpreparedProduct = join(directory, "product-v6.sqlite");
    const v6 = new DatabaseSync(unpreparedProduct);
    v6.exec("CREATE TABLE nodes (id TEXT); PRAGMA user_version = 6");
    v6.close();
    const needsProduct = createLegacy("needs-product.sqlite", true);
    needsProduct.db.close();
    await assert.rejects(
      prepare(needsProduct.filename, unpreparedProduct),
      /Prepare the product database to V7/,
    );
    assert.equal(
      readdirSync(directory).some((name) => name.startsWith("needs-product.sqlite.pre-")),
      false,
    );

    const future = createLegacy("future.sqlite");
    future.db.exec(
      "UPDATE collaboration_schema_versions SET version = 99 WHERE component = 'core'",
    );
    future.db.close();
    await assert.rejects(
      prepareWithProduct(future.filename),
      /Unsupported Collaboration core schema 99/,
    );
    assert.equal(
      readdirSync(directory).some((name) => name.startsWith("future.sqlite.pre-")),
      false,
    );

    // Failure in the final component must not publish Core/Worktree upgrades.
    const failed = createLegacy("failed.sqlite", true);
    failed.db.exec("DROP TABLE collaboration_history_revisions");
    failed.db.close();
    const original = readFileSync(failed.filename);
    await assert.rejects(prepareWithProduct(failed.filename), /original database is unchanged/);
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

function createProductDatabase(filename: string): string {
  const db = new DatabaseSync(filename);
  try {
    db.exec(readFileSync(new URL("../../server/src/db/schema.sql", import.meta.url), "utf8"));
    db.exec(`
      INSERT INTO users VALUES
        ('product-owner', 'product-owner', 'Product Owner', NULL, 1, 1),
        ('product-legacy-owner', 'product-legacy-owner', 'Product Legacy Owner', NULL, 1, 1),
        ('draft-owner', 'draft-owner', 'Draft Owner', NULL, 1, 1);
      INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at)
      VALUES ('space', 'personal', 'Space', 'product-owner', 1, 1);
      INSERT INTO nodes VALUES
        ('legacy-node', 'space', NULL, 'Legacy', 'product-legacy-owner', NULL, 1680000000000, 1680000000000),
        ('product-node', 'space', NULL, 'Product', 'product-owner', NULL, 1690000000000, 1690000000000);
      INSERT INTO resources VALUES
        ('legacy-resource', 'legacy-node', 'univer', 1680000000000, 1680000000000),
        ('product-resource', 'product-node', 'univer', 1690000000000, 1690000000000);
      INSERT INTO univer_resources VALUES
        ('legacy-resource', 'legacy-doc', 'doc'),
        ('product-resource', 'product-doc', 'doc');
      INSERT INTO worktrees
        (id, name, creator_user_id, kind, visibility, created_at, updated_at)
      VALUES ('pending-worktree', 'Pending', 'product-owner', 'user', 'private', 1, 1);
      INSERT INTO worktree_units VALUES
        ('pending-worktree', 'draft-doc', 'draft-resource', 'worktree', 0, 1695000000000);
      INSERT INTO worktree_node_intents
        (worktree_id, unit_id, node_id, target_space_id, target_parent_node_id,
         name, unit_type, created_by, created_at, updated_at)
      VALUES ('pending-worktree', 'draft-doc', 'draft-node', 'space', NULL,
              'Draft', 'doc', 'draft-owner', 1695000000000, 1695000000000);
    `);
  } finally {
    db.close();
  }
  return filename;
}
