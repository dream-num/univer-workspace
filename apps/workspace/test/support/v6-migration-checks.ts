import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** The same preserved-data/rollback matrix runs against source and production startup. */
export function verifyV6Migration(
  open: (filename: string) => { connection: DatabaseSync; close(): void },
): void {
  const root = mkdtempSync(join(tmpdir(), "workspace-v6-migration-"));
  try {
    for (const seeded of [false, true]) {
      const filename = join(root, `case-${seeded}.sqlite`);
      const original = new DatabaseSync(filename);
      original.exec(readFileSync(new URL("../fixtures/schema-v6.sql", import.meta.url), "utf8"));
      if (seeded)
        original.exec(`
        INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ('u', 'owner', 'Owner', 1, 1);
        INSERT INTO spaces (id, type, name, owner_user_id, public_read, created_at, updated_at) VALUES ('s', 'personal', 'Personal', 'u', 1, 1, 1);
        INSERT INTO nodes (id, space_id, name, created_by, created_at, updated_at) VALUES ('n', 's', 'Published', 'u', 1, 1);
        INSERT INTO resources (id, node_id, kind, created_at, updated_at) VALUES ('r', 'n', 'blob', 1, 1);
        INSERT INTO blob_resources (resource_id, object_key, original_filename, media_type, byte_size, sha256, etag, availability, created_at, updated_at)
          VALUES ('r', 'existing-object', 'file.txt', 'text/plain', 4, '${"a".repeat(64)}', 'old-etag', 'ready', 1, 1);
        INSERT INTO operations (id, kind, actor_user_id, step, state, payload_json, attempt_count, next_attempt_at, created_at, updated_at)
          VALUES ('op', 'create_blob_resource', 'u', 'awaiting_upload', 'pending', '{"objectKey":"pending-object"}', 2, 3, 1, 2);
        INSERT INTO blob_upload_sessions (id, operation_id, actor_user_id, target_space_id, node_id, resource_id, object_key, node_name, original_filename, byte_size, state, expires_at, created_at, updated_at)
          VALUES ('upload', 'op', 'u', 's', 'reserved-node', 'reserved-resource', 'pending-object', 'Pending', 'pending.bin', 9, 'verifying', 9999999999999, 1, 2);
        INSERT INTO object_deletion_jobs (id, object_key, reason, attempt_count, next_attempt_at, lease_owner, lease_expires_at, created_at, updated_at)
          VALUES ('job', 'abandoned-object', 'blob_upload_abandoned', 3, 99, 'worker', 999, 1, 2);
      `);
      const tables = [
        "users",
        "spaces",
        "nodes",
        "resources",
        "blob_resources",
        "operations",
        "blob_upload_sessions",
        "object_deletion_jobs",
      ];
      const before = tables.map((table) => original.prepare(`SELECT * FROM ${table}`).all());
      original.close();
      const migrated = open(filename);
      assert.deepEqual(
        tables.map((table) => migrated.connection.prepare(`SELECT * FROM ${table}`).all()),
        before,
      );
      assert.equal(migrated.connection.prepare("PRAGMA user_version").get()?.user_version, 7);
      assert.deepEqual(migrated.connection.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(
        migrated.connection.prepare("PRAGMA integrity_check").get()?.integrity_check,
        "ok",
      );
      migrated.close();
      const backupNames = () =>
        readdirSync(root).filter((name) => name.startsWith(`case-${seeded}.sqlite.v6-backup-`));
      assert.equal(backupNames().length, 1);
      const backup = new DatabaseSync(join(root, backupNames()[0]!), { readOnly: true });
      assert.equal(backup.prepare("PRAGMA user_version").get()?.user_version, 6);
      assert.deepEqual(
        tables.map((table) => backup.prepare(`SELECT * FROM ${table}`).all()),
        before,
      );
      backup.close();
      open(filename).close();
      assert.equal(backupNames().length, 1);
    }
    const filename = join(root, "rollback.sqlite");
    const broken = new DatabaseSync(filename);
    broken.exec(readFileSync(new URL("../fixtures/schema-v6.sql", import.meta.url), "utf8"));
    // Force failure after operations has already been rebuilt inside the transaction.
    broken.exec("CREATE TABLE object_deletion_jobs_v7 (collision TEXT)");
    broken.close();
    assert.throws(() => open(filename), /rolled back.*backup/);
    const preserved = new DatabaseSync(filename);
    assert.equal(preserved.prepare("PRAGMA user_version").get()?.user_version, 6);
    assert.ok(
      !String(
        preserved.prepare("SELECT sql FROM sqlite_master WHERE name = 'operations'").get()?.sql,
      ).includes("replace_blob_content"),
    );
    assert.equal(preserved.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
    preserved.close();
    const backupName = readdirSync(root).find((name) =>
      name.startsWith("rollback.sqlite.v6-backup-"),
    )!;
    const backup = new DatabaseSync(join(root, backupName), { readOnly: true });
    assert.equal(backup.prepare("PRAGMA user_version").get()?.user_version, 6);
    assert.equal(backup.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
    backup.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
