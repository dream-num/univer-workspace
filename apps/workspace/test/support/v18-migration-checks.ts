import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { WorkspaceDatabase } from "../../server/src/db/database.js";

export function verifyV18Migration(open: (filename: string) => WorkspaceDatabase): void {
  const root = mkdtempSync(join(tmpdir(), "workspace-v18-"));
  const schema = readFileSync(new URL("../../server/src/db/schema.sql", import.meta.url), "utf8");
  const fixture = (filename: string, seeded: boolean) => {
    const db = new DatabaseSync(filename);
    db.exec(schema);
    db.exec("DROP TABLE html_view_drafts; PRAGMA user_version = 18");
    if (seeded)
      db.exec(`
      INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ('u', 'owner', 'Owner', 1, 1);
      INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('s', 'personal', 'Personal', 'u', 1, 1);
      INSERT INTO nodes (id, space_id, name, created_by, created_at, updated_at) VALUES ('n', 's', 'Page.univer.html', 'u', 1, 1);
      INSERT INTO resources (id, node_id, kind, created_at, updated_at) VALUES ('r', 'n', 'blob', 1, 1);
      INSERT INTO blob_resources (resource_id, object_key, original_filename, media_type, byte_size, sha256, etag, availability, created_at, updated_at)
        VALUES ('r', 'published-object', 'Page.univer.html', 'text/plain', 3, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'etag', 'ready', 1, 1);
      INSERT INTO operations (id, kind, actor_user_id, step, state, payload_json, attempt_count, next_attempt_at, created_at, updated_at)
        VALUES ('op', 'create_resource', 'u', 'reserve', 'pending', '{}', 2, 3, 1, 2);
      INSERT INTO object_deletion_jobs (id, object_key, reason, next_attempt_at, created_at, updated_at)
        VALUES ('job', 'abandoned-object', 'blob_upload_abandoned', 3, 1, 2);
    `);
    return db;
  };
  const rows = (db: DatabaseSync) =>
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'html_view_drafts' ORDER BY name",
      )
      .all()
      .map(({ name }) => [name, db.prepare(`SELECT * FROM ${name}`).all()]);
  try {
    for (const seeded of [false, true]) {
      const filename = join(root, `case-${seeded}.sqlite`);
      const old = fixture(filename, seeded);
      const before = rows(old);
      old.close();
      const migrated = open(filename);
      assert.deepEqual(rows(migrated.connection), before);
      assert.equal(migrated.connection.prepare("PRAGMA user_version").get()?.user_version, 19);
      assert.equal(
        migrated.connection.prepare("SELECT count(*) AS n FROM html_view_drafts").get()?.n,
        0,
      );
      if (seeded) {
        migrated.connection
          .prepare(`INSERT INTO html_view_drafts (id, author_user_id, idempotency_key, kind, space_id, name, object_key, byte_size, sha256, state, expires_at, created_at, updated_at)
          VALUES ('d', 'u', 'key', 'create', 'missing-space', 'Page.univer.html', 'draft-object', 0, ?, 'receiving', 2, 1, 1)`)
          .run("a".repeat(64));
        migrated.connection.exec("UPDATE html_view_drafts SET state = 'expired' WHERE id = 'd'");
        assert.throws(
          () =>
            migrated.connection.exec(
              "UPDATE html_view_drafts SET state = 'published' WHERE id = 'd'",
            ),
          /CHECK/,
        );
      }
      assert.deepEqual(migrated.connection.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(
        migrated.connection.prepare("PRAGMA integrity_check").get()?.integrity_check,
        "ok",
      );
      migrated.close();
      const backups = () =>
        readdirSync(root).filter((name) => name.startsWith(`case-${seeded}.sqlite.v18-backup-`));
      assert.equal(backups().length, 1);
      const backup = new DatabaseSync(join(root, backups()[0]!), { readOnly: true });
      assert.equal(backup.prepare("PRAGMA user_version").get()?.user_version, 18);
      assert.deepEqual(rows(backup), before);
      assert.equal(backup.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      backup.close();
      open(filename).close();
      assert.equal(backups().length, 1);
    }
    const filename = join(root, "rollback.sqlite");
    const broken = fixture(filename, false);
    broken.exec(
      "PRAGMA foreign_keys = OFF; INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('orphan', 'team', 'Orphan', 'missing', 1, 1)",
    );
    broken.close();
    assert.throws(() => open(filename), /V18 to V19 migration failed.*rolled back.*backup/);
    for (const name of [
      "rollback.sqlite",
      readdirSync(root).find((name) => name.startsWith("rollback.sqlite.v18-backup-"))!,
    ]) {
      const preserved = new DatabaseSync(join(root, name), { readOnly: true });
      assert.equal(preserved.prepare("PRAGMA user_version").get()?.user_version, 18);
      assert.equal(
        preserved.prepare("SELECT name FROM sqlite_master WHERE name = 'html_view_drafts'").get(),
        undefined,
      );
      assert.equal(preserved.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      preserved.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
