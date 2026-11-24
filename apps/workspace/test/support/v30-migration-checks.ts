import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SqliteDatabase } from "../../server/src/db/sqlite/connection.js";
import { DROP_V31_SQL, withoutV31Columns } from "./v31-downgrade.js";

export function verifyV30Migration(open: (filename: string) => SqliteDatabase): void {
  const root = mkdtempSync(join(tmpdir(), "workspace-v30-"));
  const schema = readFileSync(new URL("../../server/src/db/sqlite/schema.sql", import.meta.url), "utf8");
  const fixture = (filename: string, seeded: boolean) => {
    const db = new DatabaseSync(filename);
    db.exec(schema);
    db.exec(DROP_V31_SQL);
    db.exec("PRAGMA user_version = 30");
    if (seeded) {
      db.exec(`
        INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ('u', 'owner', 'Owner', 1, 2);
        INSERT INTO spaces (id, type, name, slug, owner_user_id, created_at, updated_at) VALUES ('p', 'personal', 'Personal', NULL, 'u', 1, 2);
        INSERT INTO spaces (id, type, name, slug, owner_user_id, created_at, updated_at) VALUES ('t', 'team', 'Team', 'team', 'u', 1, 2);
        INSERT INTO issues (id, space_id, number, title, state, author_user_id, created_at, updated_at) VALUES ('i', 't', 1, 'Fix totals', 'open', 'u', 1, 2);
        INSERT INTO issue_assignees (issue_id, user_id) VALUES ('i', 'u');
        INSERT INTO issue_comments (id, issue_id, author_user_id, body, created_at, updated_at) VALUES ('c', 'i', 'u', 'Started', 2, 2);
        INSERT INTO worktrees (id, name, creator_user_id, kind, team_space_id, visibility, created_at, updated_at, number, issue_id)
          VALUES ('w', 'Fix', 'u', 'team', 't', 'space', 1, 2, 2, 'i');
        INSERT INTO operations (id, kind, actor_user_id, step, state, payload_json, attempt_count, next_attempt_at, created_at, updated_at)
          VALUES ('op', 'create_worktree', 'u', 'reserved', 'pending', '{"kind":"team","teamSpaceId":"t","worktreeId":"w-next"}', 2, 3, 1, 2);
      `);
    }
    return db;
  };
  const snapshot = (db: DatabaseSync) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('issue_verdicts', 'worktree_checks') ORDER BY name").all()
    .map(({ name }) => [name, withoutV31Columns(String(name), db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all())]);
  const version = (db: DatabaseSync) => db.prepare("PRAGMA user_version").get()?.user_version;
  const verdict = (db: DatabaseSync, values: string) => db.exec(`INSERT INTO issue_verdicts (id, issue_id, kind, actor_user_id, body, operation_id, created_at) VALUES ${values}`);
  try {
    for (const seeded of [false, true]) {
      const filename = join(root, `case-${seeded}.sqlite`);
      const old = fixture(filename, seeded);
      const before = snapshot(old);
      old.close();
      const migrated = open(filename);
      const db = migrated.connection;
      assert.equal(version(db), 33);
      assert.deepEqual(snapshot(db), before);
      assert.deepEqual(db.prepare("SELECT id, accept_after_hours FROM spaces ORDER BY id").all().map((row) => ({ ...row })),
        seeded ? [{ id: "p", accept_after_hours: null }, { id: "t", accept_after_hours: null }] : []);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM issue_verdicts").get()?.n, 0);
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(db.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      if (seeded) {
        verdict(db, "('v1', 'i', 'submitted', 'u', 'Done', NULL, 3), ('v2', 'i', 'accepted', NULL, '', NULL, 4)");
        assert.throws(() => verdict(db, "('v3', 'i', 'sent_back', NULL, 'Why', NULL, 5)"), /CHECK constraint failed/);
        assert.throws(() => verdict(db, "('v3', 'i', 'accepted', 'u', '', 'op', 5)"), /CHECK constraint failed/);
        assert.throws(() => verdict(db, "('v3', 'i', 'closed', 'u', '', NULL, 5)"), /CHECK constraint failed/);
        assert.throws(() => verdict(db, "('v3', 'missing', 'submitted', 'u', '', NULL, 5)"), /FOREIGN KEY constraint failed/);
        verdict(db, "('v3', 'i', 'reverted', 'u', '', 'op', 5)");
        assert.throws(() => db.exec("UPDATE spaces SET accept_after_hours = 0 WHERE id = 't'"), /CHECK constraint failed/);
        db.exec("UPDATE spaces SET accept_after_hours = 72 WHERE id = 't'");
        db.exec("UPDATE spaces SET accept_after_hours = NULL WHERE id = 't'");
        db.exec("DELETE FROM issues WHERE id = 'i'");
        assert.equal(db.prepare("SELECT COUNT(*) AS n FROM issue_verdicts").get()?.n, 0);
        db.exec(`
          INSERT INTO issues (id, space_id, number, title, state, author_user_id, created_at, updated_at) VALUES ('i', 't', 1, 'Fix totals', 'open', 'u', 1, 2);
          INSERT INTO issue_assignees (issue_id, user_id) VALUES ('i', 'u');
          INSERT INTO issue_comments (id, issue_id, author_user_id, body, created_at, updated_at) VALUES ('c', 'i', 'u', 'Started', 2, 2);
          UPDATE worktrees SET issue_id = 'i' WHERE id = 'w';
        `);
        assert.deepEqual(snapshot(db), before);
      }
      migrated.close();
      const backups = () => readdirSync(root).filter((name) => name.startsWith(`case-${seeded}.sqlite.v30-backup-`));
      assert.equal(backups().length, 1);
      const backup = new DatabaseSync(join(root, backups()[0]!), { readOnly: true });
      assert.equal(version(backup), 30);
      assert.deepEqual(snapshot(backup), before);
      backup.close();
      const restarted = open(filename);
      assert.deepEqual(snapshot(restarted.connection), before);
      assert.equal(version(restarted.connection), 33);
      restarted.close();
      assert.equal(backups().length, 1);
    }
    const filename = join(root, "rollback.sqlite");
    const broken = fixture(filename, true);
    broken.exec("PRAGMA foreign_keys = OFF; INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('orphan', 'team', 'Orphan', 'missing', 1, 2)");
    const before = snapshot(broken);
    broken.close();
    assert.throws(() => open(filename), /V30 to V33 migration failed.*rolled back.*backup/);
    const backup = readdirSync(root).find((name) => name.startsWith("rollback.sqlite.v30-backup-"))!;
    for (const name of ["rollback.sqlite", backup]) {
      const db = new DatabaseSync(join(root, name), { readOnly: true });
      assert.equal(version(db), 30);
      assert.deepEqual(snapshot(db), before);
      assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name IN ('issue_verdicts', 'issue_verdicts_issue')").get(), undefined);
      assert.equal(db.prepare("PRAGMA table_info(spaces)").all().some(({ name }) => name === "accept_after_hours"), false);
      assert.equal(db.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
