import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SqliteDatabase } from "../../server/src/db/sqlite/connection.js";
import { DROP_V27_SQL, withoutV27Columns } from "./v27-downgrade.js";

export function verifyV26Migration(open: (filename: string) => SqliteDatabase): void {
  const root = mkdtempSync(join(tmpdir(), "workspace-v26-"));
  const schema = readFileSync(new URL("../../server/src/db/sqlite/schema.sql", import.meta.url), "utf8");
  const fixture = (filename: string, seeded: boolean) => {
    const db = new DatabaseSync(filename);
    db.exec(schema);
    db.exec(DROP_V27_SQL);
    db.exec("PRAGMA user_version = 26");
    if (seeded) {
      db.exec(`
        INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ('u', 'owner', 'Owner', 1, 2);
        INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('s', 'personal', 'Personal', 'u', 1, 2);
        INSERT INTO worktrees (id, name, creator_user_id, kind, visibility, created_at, updated_at) VALUES ('w', 'Draft', 'u', 'user', 'private', 1, 2);
        INSERT INTO operations (id, kind, actor_user_id, step, state, payload_json, attempt_count, next_attempt_at, created_at, updated_at)
          VALUES ('op', 'create_blob_resource', 'u', 'reserved', 'pending', '{}', 2, 3, 1, 2);
        INSERT INTO blob_upload_sessions (id, operation_id, actor_user_id, target_space_id, node_id, resource_id, object_key, node_name, original_filename, byte_size, state, expires_at, created_at, updated_at)
          VALUES ('upload', 'op', 'u', 's', 'node', 'resource', 'upload-object', 'File', 'File', 3, 'waiting_for_upload', 999, 1, 2);
        INSERT INTO object_deletion_jobs (id, object_key, reason, next_attempt_at, created_at, updated_at)
          VALUES ('job', 'abandoned-object', 'blob_upload_abandoned', 3, 1, 2);
      `);
      for (const state of ["receiving", "pending", "published", "rejected", "expired", "conflicted"]) {
        db.prepare(`INSERT INTO html_view_drafts (id, author_user_id, idempotency_key, kind, space_id, name, object_key, byte_size, sha256,
          media_type, stored_etag, state, result_resource_id, expires_at, created_at, updated_at)
          VALUES (?, 'u', ?, 'create', 's', 'Page.univer.html', ?, 3, ?, 'text/html', 'etag', ?, ?, 999, 1, 2)`)
          .run(state, state, `object-${state}`, "a".repeat(64), state, state === "published" ? "published-resource" : null);
      }
    }
    if (seeded) {
      db.exec("UPDATE html_view_drafts SET source_worktree_id = 'w'; UPDATE html_view_drafts SET kind = 'replace', target_resource_id = 'target', base_etag = 'base' WHERE id = 'pending'");
    }
    return db;
  };
  const snapshot = (db: DatabaseSync) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'forks' ORDER BY name").all()
    .map(({ name }) => [name, withoutV27Columns(String(name), db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all())]);
  const version = (db: DatabaseSync) => db.prepare("PRAGMA user_version").get()?.user_version;
  try {
    for (const seeded of [false, true]) {
      const filename = join(root, `case-${seeded}.sqlite`);
      const old = fixture(filename, seeded);
      const before = snapshot(old);
      old.close();
      const migrated = open(filename);
      const db = migrated.connection;
      assert.equal(version(db), 29);
      assert.deepEqual(snapshot(db), before);
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(db.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM html_view_drafts WHERE superseded_by IS NOT NULL OR revises_draft_id IS NOT NULL").get()?.n, 0);
      if (seeded) {
        db.prepare("UPDATE html_view_drafts SET state = 'superseded', superseded_by = 'published' WHERE id = 'pending'").run();
        assert.equal(db.prepare("SELECT superseded_by FROM html_view_drafts WHERE id = 'pending'").get()?.superseded_by, "published");
        db.prepare("UPDATE html_view_drafts SET state = 'pending', superseded_by = NULL WHERE id = 'pending'").run();
      }
      migrated.close();
      const backups = () => readdirSync(root).filter((name) => name.startsWith(`case-${seeded}.sqlite.v26-backup-`));
      assert.equal(backups().length, 1);
      const backup = new DatabaseSync(join(root, backups()[0]!), { readOnly: true });
      assert.equal(version(backup), 26);
      assert.deepEqual(snapshot(backup), before);
      backup.close();
      const restarted = open(filename);
      assert.deepEqual(snapshot(restarted.connection), before);
      assert.equal(version(restarted.connection), 29);
      restarted.close();
      assert.equal(backups().length, 1);
    }
    const filename = join(root, "rollback.sqlite");
    const broken = fixture(filename, true);
    broken.exec("PRAGMA foreign_keys = OFF; INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('orphan', 'team', 'Orphan', 'missing', 1, 2)");
    const before = snapshot(broken);
    broken.close();
    assert.throws(() => open(filename), /V26 to V29 migration failed.*rolled back.*backup/);
    const backup = readdirSync(root).find((name) => name.startsWith("rollback.sqlite.v26-backup-"))!;
    for (const name of ["rollback.sqlite", backup]) {
      const db = new DatabaseSync(join(root, name), { readOnly: true });
      assert.equal(version(db), 26);
      assert.deepEqual(snapshot(db), before);
      assert.equal(db.prepare("PRAGMA table_info(html_view_drafts)").all().some(({ name }) => name === "superseded_by"), false);
      assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'html_view_drafts_v26'").get(), undefined);
      assert.equal(db.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
