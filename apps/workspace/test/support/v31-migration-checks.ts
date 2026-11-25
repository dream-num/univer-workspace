import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SqliteDatabase } from "../../server/src/db/sqlite/connection.js";
import { DROP_V32_SQL, withoutV32Columns } from "./v32-downgrade.js";

export function verifyV31Migration(open: (filename: string) => SqliteDatabase): void {
  const root = mkdtempSync(join(tmpdir(), "workspace-v31-"));
  const schema = readFileSync(new URL("../../server/src/db/sqlite/schema.sql", import.meta.url), "utf8");
  const fixture = (filename: string, seeded: boolean) => {
    const db = new DatabaseSync(filename);
    db.exec(schema);
    db.exec(DROP_V32_SQL);
    db.exec("PRAGMA user_version = 31");
    if (seeded) {
      db.exec(`
        INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ('u', 'owner', 'Owner', 1, 2);
        INSERT INTO spaces (id, type, name, slug, owner_user_id, created_at, updated_at, accept_after_hours) VALUES ('t', 'team', 'Team', 'team', 'u', 1, 2, 72);
        INSERT INTO issues (id, space_id, number, title, state, author_user_id, created_at, updated_at) VALUES ('i', 't', 1, 'Fix totals', 'open', 'u', 1, 2);
        INSERT INTO issue_verdicts (id, issue_id, kind, actor_user_id, body, created_at) VALUES ('v', 'i', 'submitted', 'u', 'Done', 3);
        INSERT INTO worktrees (id, name, creator_user_id, kind, team_space_id, visibility, created_at, updated_at, number, issue_id)
          VALUES ('w', 'Fix', 'u', 'team', 't', 'space', 1, 2, 2, 'i');
        INSERT INTO operations (id, kind, actor_user_id, step, state, payload_json, attempt_count, next_attempt_at, created_at, updated_at)
          VALUES ('op', 'merge_worktree', 'u', 'reserved', 'pending', '{"worktreeId":"w","pageDraftIds":[]}', 1, 3, 1, 2);
      `);
    }
    return db;
  };
  const snapshot = (db: DatabaseSync) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('worktree_checks', 'source_rate_events') ORDER BY name").all()
    .map(({ name }) => [name, withoutV32Columns(String(name), db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all())]);
  const version = (db: DatabaseSync) => db.prepare("PRAGMA user_version").get()?.user_version;
  const check = (db: DatabaseSync, values: string) =>
    db.exec(`INSERT INTO worktree_checks (worktree_id, content_key, name, reporter_user_id, state, summary, reported_at) VALUES ${values}`);
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
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM worktree_checks").get()?.n, 0);
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(db.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      if (seeded) {
        check(db, "('w', 'k1', 'totals-match', 'u', 'passed', 'B5 = SUM(B2:B4)', 4), ('w', 'k1', 'header-unchanged', 'u', 'failed', '', 5)");
        assert.throws(() => check(db, "('w', 'k1', 'totals-match', 'u', 'failed', '', 6)"), /UNIQUE constraint failed/);
        check(db, "('w', 'k2', 'totals-match', 'u', 'failed', '', 6)");
        assert.throws(() => check(db, "('w', 'k3', 'totals-match', 'u', 'skipped', '', 6)"), /CHECK constraint failed/);
        assert.throws(() => check(db, "('missing', 'k1', 'totals-match', 'u', 'passed', '', 6)"), /FOREIGN KEY constraint failed/);
        assert.throws(() => check(db, "('w', 'k1', 'totals-match', 'nobody', 'passed', '', 6)"), /FOREIGN KEY constraint failed/);
        db.exec("DELETE FROM worktrees WHERE id = 'w'");
        assert.equal(db.prepare("SELECT COUNT(*) AS n FROM worktree_checks").get()?.n, 0);
        db.exec(`INSERT INTO worktrees (id, name, creator_user_id, kind, team_space_id, visibility, created_at, updated_at, number, issue_id)
          VALUES ('w', 'Fix', 'u', 'team', 't', 'space', 1, 2, 2, 'i')`);
        assert.deepEqual(snapshot(db), before);
      }
      migrated.close();
      const backups = () => readdirSync(root).filter((name) => name.startsWith(`case-${seeded}.sqlite.v31-backup-`));
      assert.equal(backups().length, 1);
      const backup = new DatabaseSync(join(root, backups()[0]!), { readOnly: true });
      assert.equal(version(backup), 31);
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
    assert.throws(() => open(filename), /V31 to V35 migration failed.*rolled back.*backup/);
    const backup = readdirSync(root).find((name) => name.startsWith("rollback.sqlite.v31-backup-"))!;
    for (const name of ["rollback.sqlite", backup]) {
      const db = new DatabaseSync(join(root, name), { readOnly: true });
      assert.equal(version(db), 31);
      assert.deepEqual(snapshot(db), before);
      assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'worktree_checks'").get(), undefined);
      assert.equal(db.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
