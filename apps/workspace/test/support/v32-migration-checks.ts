import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SqliteDatabase } from "../../server/src/db/sqlite/connection.js";
import { DROP_V33_SQL, withoutV33Columns } from "./v33-downgrade.js";

export function verifyV32Migration(open: (filename: string) => SqliteDatabase): void {
  const root = mkdtempSync(join(tmpdir(), "workspace-v32-"));
  const schema = readFileSync(new URL("../../server/src/db/sqlite/schema.sql", import.meta.url), "utf8");
  const fixture = (filename: string, seeded: boolean) => {
    const db = new DatabaseSync(filename);
    db.exec(schema);
    db.exec(DROP_V33_SQL);
    db.exec("PRAGMA user_version = 32");
    if (seeded) {
      db.exec(`
        INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ('u', 'owner', 'Owner', 1, 2);
        INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('p', 'personal', 'Personal', 'u', 1, 2);
        INSERT INTO spaces (id, type, name, slug, owner_user_id, created_at, updated_at, proposals, accept_after_hours) VALUES ('t', 'team', 'Team', 'team', 'u', 1, 2, 'anyone', 72);
        INSERT INTO worktrees (id, name, creator_user_id, kind, team_space_id, visibility, created_at, updated_at, number)
          VALUES ('w', 'Fix', 'u', 'team', 't', 'space', 1, 2, 2);
        INSERT INTO worktree_checks (worktree_id, content_key, name, reporter_user_id, state, summary, reported_at)
          VALUES ('w', 'k1', 'totals-match', 'u', 'passed', 'B5 = SUM(B2:B4)', 4);
      `);
    }
    return db;
  };
  const snapshot = (db: DatabaseSync) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'source_rate_events' ORDER BY name").all()
    .map(({ name }) => [name, withoutV33Columns(String(name), db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all())]);
  const version = (db: DatabaseSync) => db.prepare("PRAGMA user_version").get()?.user_version;
  const landings = (db: DatabaseSync) => db.prepare("SELECT id, landing FROM spaces ORDER BY id").all().map((row) => `${row.id}:${row.landing}`);
  try {
    for (const seeded of [false, true]) {
      const filename = join(root, `case-${seeded}.sqlite`);
      const old = fixture(filename, seeded);
      const before = snapshot(old);
      old.close();
      const migrated = open(filename);
      const db = migrated.connection;
      assert.equal(version(db), 35);
      assert.deepEqual(snapshot(db), before);
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(db.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      if (seeded) {
        assert.deepEqual(landings(db), ["p:review", "t:review"]);
        db.exec("UPDATE spaces SET landing = 'checks' WHERE id = 't'");
        assert.deepEqual(landings(db), ["p:review", "t:checks"]);
        assert.throws(() => db.exec("UPDATE spaces SET landing = 'anyone' WHERE id = 't'"), /CHECK constraint failed/);
        assert.throws(() => db.exec("UPDATE spaces SET landing = NULL WHERE id = 't'"), /NOT NULL constraint failed/);
        db.exec("UPDATE spaces SET landing = 'review' WHERE id = 't'");
        assert.deepEqual(snapshot(db), before);
      }
      migrated.close();
      const backups = () => readdirSync(root).filter((name) => name.startsWith(`case-${seeded}.sqlite.v32-backup-`));
      assert.equal(backups().length, 1);
      const backup = new DatabaseSync(join(root, backups()[0]!), { readOnly: true });
      assert.equal(version(backup), 32);
      assert.deepEqual(snapshot(backup), before);
      backup.close();
      const restarted = open(filename);
      assert.deepEqual(snapshot(restarted.connection), before);
      assert.equal(version(restarted.connection), 35);
      restarted.close();
      assert.equal(backups().length, 1);
    }
    const filename = join(root, "rollback.sqlite");
    const broken = fixture(filename, true);
    broken.exec("PRAGMA foreign_keys = OFF; INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('orphan', 'team', 'Orphan', 'missing', 1, 2)");
    const before = snapshot(broken);
    broken.close();
    assert.throws(() => open(filename), /V32 to V35 migration failed.*rolled back.*backup/);
    const backup = readdirSync(root).find((name) => name.startsWith("rollback.sqlite.v32-backup-"))!;
    for (const name of ["rollback.sqlite", backup]) {
      const db = new DatabaseSync(join(root, name), { readOnly: true });
      assert.equal(version(db), 32);
      assert.deepEqual(snapshot(db), before);
      assert.equal(db.prepare("SELECT 1 FROM pragma_table_info('spaces') WHERE name = 'landing'").get(), undefined);
      assert.equal(db.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
