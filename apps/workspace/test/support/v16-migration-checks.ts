import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DOWNGRADE_TO_V16_SQL, DROP_V17_SQL } from "./v17-downgrade.js";

const PDF_CHECK = "unit_type IN ('sheet', 'doc', 'slide', 'board', 'base', 'pdf')";

export function verifyV16Migration(
  open: (filename: string) => { connection: DatabaseSync; close(): void },
): void {
  const root = mkdtempSync(join(tmpdir(), "workspace-v16-migration-"));
  const schema = readFileSync(new URL("../../server/src/db/schema.sql", import.meta.url), "utf8");
  const tableSql = (database: DatabaseSync, name: string) =>
    String(database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)?.sql);
  const createV16 = (filename: string) => {
    const database = new DatabaseSync(filename);
    database.exec(schema);
    database.exec(DOWNGRADE_TO_V16_SQL);
    assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 16);
    assert.ok(!tableSql(database, "univer_resources").includes("'pdf'"));
    assert.ok(!tableSql(database, "worktree_node_intents").includes("'pdf'"));
    return database;
  };
  try {
    for (const seeded of [false, true]) {
      const filename = join(root, `case-${seeded}.sqlite`);
      const original = createV16(filename);
      if (seeded) original.exec(`
        INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ('u', 'owner', 'Owner', 1, 1);
        INSERT INTO spaces (id, type, name, owner_user_id, public_read, created_at, updated_at) VALUES ('s', 'team', 'Repository', 'u', 1, 1, 1);
        INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('p', 'personal', 'Personal', 'u', 1, 1);
        INSERT INTO space_pins (user_id, space_id, position, created_at) VALUES ('u', 's', 0, 7);
        INSERT INTO nodes (id, space_id, name, created_by, created_at, updated_at) VALUES ('n', 's', 'Workbook', 'u', 1, 1);
        INSERT INTO nodes (id, space_id, name, created_by, created_at, updated_at) VALUES ('nb', 's', 'Attachment', 'u', 1, 1);
        INSERT INTO resources (id, node_id, kind, created_at, updated_at) VALUES ('r', 'n', 'univer', 1, 1);
        INSERT INTO resources (id, node_id, kind, created_at, updated_at) VALUES ('rb', 'nb', 'blob', 1, 1);
        INSERT INTO univer_resources (resource_id, unit_id, unit_type) VALUES ('r', 'unit-sheet', 'sheet');
        INSERT INTO blob_resources (resource_id, object_key, original_filename, media_type, byte_size, sha256, etag, availability, created_at, updated_at)
          VALUES ('rb', 'existing-object', 'file.pdf', 'application/pdf', 4, '${"a".repeat(64)}', 'old-etag', 'ready', 1, 1);
        INSERT INTO content_permission_objects (id, unit_id, object_type, creator_user_id, name, strategies_json, read_scope, edit_scope, created_at, updated_at)
          VALUES ('cpo', 'unit-sheet', 1, 'u', 'Range', '[]', 0, 1, 1, 1);
        INSERT INTO worktrees (id, name, creator_user_id, kind, team_space_id, visibility, created_at, updated_at) VALUES ('w', 'Draft', 'u', 'team', 's', 'space', 1, 1);
        INSERT INTO worktree_units (worktree_id, unit_id, resource_id, source, ordinal, added_at) VALUES ('w', 'unit-doc', 'reserved-doc', 'worktree', 0, 1);
        INSERT INTO worktree_node_intents (worktree_id, unit_id, node_id, target_space_id, target_parent_node_id, name, unit_type, created_by, activated_at, discarded_at, created_at, updated_at)
          VALUES ('w', 'unit-doc', 'intent-node', 's', NULL, 'Draft doc', 'doc', 'u', NULL, NULL, 1, 2);
        INSERT INTO operations (id, kind, actor_user_id, step, state, payload_json, attempt_count, next_attempt_at, created_at, updated_at)
          VALUES ('op', 'create_resource', 'u', 'reserve', 'pending', '{"unitType":"doc"}', 2, 3, 1, 2);
      `);
      const tables = original.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      ).all().map((row) => ({
        name: String(row.name),
        columns: original.prepare(`PRAGMA table_info(${row.name})`).all().map((column) => column.name).join(", "),
      }));
      const rows = (database: DatabaseSync) => tables.map(({ name, columns }) =>
        database.prepare(`SELECT ${columns} FROM ${name}`).all(),
      );
      const before = rows(original);
      original.close();
      const migrated = open(filename);
      const db = migrated.connection;
      assert.deepEqual(rows(db), before);
      assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, 18);
      assert.ok(tableSql(db, "univer_resources").includes(PDF_CHECK));
      assert.ok(tableSql(db, "worktree_node_intents").includes(PDF_CHECK));
      assert.deepEqual(
        db.prepare("PRAGMA foreign_key_list(content_permission_objects)").all().map((row) => row.table).sort(),
        ["univer_resources", "users"],
      );
      if (seeded) {
        db.exec("INSERT INTO nodes (id, space_id, name, created_by, created_at, updated_at) VALUES ('np', 's', 'Brochure', 'u', 1, 1)");
        db.exec("INSERT INTO resources (id, node_id, kind, created_at, updated_at) VALUES ('rp', 'np', 'univer', 1, 1)");
        db.exec("INSERT INTO univer_resources (resource_id, unit_id, unit_type) VALUES ('rp', 'unit-pdf', 'pdf')");
        assert.throws(() => db.exec("UPDATE univer_resources SET unit_type = 'bogus' WHERE unit_id = 'unit-pdf'"), /CHECK/);
        assert.throws(() => db.exec("INSERT INTO univer_resources (resource_id, unit_id, unit_type) VALUES ('rb', 'unit-blob', 'pdf')"), /kind=univer/);
        db.exec("INSERT INTO worktree_units (worktree_id, unit_id, resource_id, source, ordinal, added_at) VALUES ('w', 'unit-pdf-draft', 'reserved-pdf', 'worktree', 1, 1)");
        db.exec("INSERT INTO worktree_node_intents (worktree_id, unit_id, node_id, target_space_id, target_parent_node_id, name, unit_type, created_by, activated_at, discarded_at, created_at, updated_at) VALUES ('w', 'unit-pdf-draft', 'intent-pdf', 's', NULL, 'Draft brochure', 'pdf', 'u', NULL, NULL, 1, 1)");
        assert.throws(() => db.exec("UPDATE worktree_node_intents SET unit_type = 'bogus' WHERE unit_id = 'unit-pdf-draft'"), /CHECK/);
        db.exec("INSERT INTO content_permission_objects (id, unit_id, object_type, creator_user_id, name, strategies_json, read_scope, edit_scope, created_at, updated_at) VALUES ('cpo-pdf', 'unit-pdf', 1, 'u', 'Page', '[]', 0, 1, 1, 1)");
        db.exec("DELETE FROM resources WHERE id = 'rp'");
        assert.deepEqual(db.prepare("SELECT id FROM content_permission_objects").all().map((row) => row.id), ["cpo"]);
        db.exec("DELETE FROM nodes WHERE id = 'np'");
        db.exec("DELETE FROM worktree_units WHERE unit_id = 'unit-pdf-draft'");
        assert.deepEqual(db.prepare("SELECT unit_id, unit_type FROM worktree_node_intents").all().map((row) => ({ ...row })), [
          { unit_id: "unit-doc", unit_type: "doc" },
        ]);
      }
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(db.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      migrated.close();
      const backups = () => readdirSync(root).filter((name) => name.startsWith(`case-${seeded}.sqlite.v16-backup-`));
      assert.equal(backups().length, 1);
      const backup = new DatabaseSync(join(root, backups()[0]!), { readOnly: true });
      assert.equal(backup.prepare("PRAGMA user_version").get()?.user_version, 16);
      assert.deepEqual(rows(backup), before);
      assert.ok(!tableSql(backup, "univer_resources").includes("'pdf'"));
      assert.equal(backup.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      backup.close();
      const restarted = open(filename);
      assert.equal(restarted.connection.prepare("PRAGMA user_version").get()?.user_version, 18);
      assert.deepEqual(rows(restarted.connection), before);
      restarted.close();
      assert.equal(backups().length, 1);
    }
    const filename = join(root, "rollback.sqlite");
    const broken = createV16(filename);
    broken.exec("PRAGMA foreign_keys = OFF; INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('orphan', 'team', 'Orphan', 'missing', 1, 1)");
    broken.close();
    assert.throws(() => open(filename), /V16 to V18 migration failed.*rolled back.*backup/);
    for (const name of ["rollback.sqlite", readdirSync(root).find((name) => name.startsWith("rollback.sqlite.v16-backup-"))!]) {
      const preserved = new DatabaseSync(join(root, name), { readOnly: true });
      assert.equal(preserved.prepare("PRAGMA user_version").get()?.user_version, 16);
      assert.ok(!tableSql(preserved, "univer_resources").includes("'pdf'"));
      assert.ok(!tableSql(preserved, "worktree_node_intents").includes("'pdf'"));
      assert.deepEqual(preserved.prepare("SELECT name FROM sqlite_master WHERE name IN ('univer_resources_v17', 'worktree_node_intents_v17')").all(), []);
      assert.equal(preserved.prepare("SELECT owner_user_id FROM spaces").get()?.owner_user_id, "missing");
      assert.equal(preserved.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      preserved.close();
    }
    for (const damage of [DROP_V17_SQL]) {
      const invalid = join(root, `fingerprint-${Math.random()}.sqlite`);
      const mismatched = new DatabaseSync(invalid);
      mismatched.exec(schema);
      mismatched.exec(damage);
      mismatched.close();
      assert.throws(() => open(invalid), /V17 fingerprint mismatch/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
