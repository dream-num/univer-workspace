import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SqliteDatabase } from "../../server/src/db/sqlite/connection.js";
import { DROP_V30_SQL, withoutV30Columns } from "./v30-downgrade.js";

export function verifyV29Migration(open: (filename: string) => SqliteDatabase): void {
  const root = mkdtempSync(join(tmpdir(), "workspace-v29-"));
  const schema = readFileSync(new URL("../../server/src/db/sqlite/schema.sql", import.meta.url), "utf8");
  const fixture = (filename: string, seeded: boolean) => {
    const db = new DatabaseSync(filename);
    db.exec(schema);
    db.exec(DROP_V30_SQL);
    db.exec("PRAGMA user_version = 29");
    if (seeded) {
      db.exec(`
        INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ('u', 'owner', 'Owner', 1, 2);
        INSERT INTO spaces (id, type, name, slug, owner_user_id, created_at, updated_at) VALUES ('t', 'team', 'Team', 'team', 'u', 1, 2);
        INSERT INTO issues (id, space_id, number, title, state, author_user_id, created_at, updated_at) VALUES ('i', 't', 1, 'Fix totals', 'open', 'u', 1, 2);
        INSERT INTO forks (id, owner_user_id, upstream_space_id, name, created_at) VALUES ('f', 'u', 't', 'fix', 3);
        INSERT INTO worktrees (id, name, creator_user_id, kind, visibility, created_at, updated_at, number)
          VALUES ('w-user', 'Mine', 'u', 'user', 'private', 1, 2, 1);
        INSERT INTO worktrees (id, name, creator_user_id, kind, team_space_id, visibility, created_at, updated_at, number, fork_id)
          VALUES ('w-team', 'Open', 'u', 'team', 't', 'private', 1, 2, 2, 'f');
        INSERT INTO worktrees (id, name, creator_user_id, kind, team_space_id, visibility, processed_at, created_at, updated_at, number)
          VALUES ('w-done', 'Merged', 'u', 'team', 't', 'space', 5, 1, 5, 3);
        INSERT INTO operations (id, kind, actor_user_id, step, state, payload_json, attempt_count, next_attempt_at, created_at, updated_at)
          VALUES ('op', 'create_worktree', 'u', 'reserved', 'pending', '{"kind":"team","teamSpaceId":"t","worktreeId":"w-next"}', 2, 3, 1, 2);
      `);
    }
    return db;
  };
  const snapshot = (db: DatabaseSync) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('issue_verdicts', 'worktree_checks', 'source_rate_events', 'sign_in_codes') ORDER BY name").all()
    .map(({ name }) => [name, withoutV30Columns(String(name), db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all())]);
  const version = (db: DatabaseSync) => db.prepare("PRAGMA user_version").get()?.user_version;
  const links = (db: DatabaseSync) => db.prepare("SELECT id, issue_id FROM worktrees ORDER BY id").all().map((row) => ({ ...row }));
  try {
    for (const seeded of [false, true]) {
      const filename = join(root, `case-${seeded}.sqlite`);
      const old = fixture(filename, seeded);
      const before = snapshot(old);
      old.close();
      const migrated = open(filename);
      const db = migrated.connection;
      assert.equal(version(db), 36);
      assert.deepEqual(snapshot(db), before);
      assert.deepEqual(links(db), seeded ? ["w-done", "w-team", "w-user"].map((id) => ({ id, issue_id: null })) : []);
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(db.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      if (seeded) {
        db.exec("UPDATE worktrees SET issue_id = 'i' WHERE id IN ('w-team', 'w-done')");
        assert.throws(() => db.exec("UPDATE worktrees SET issue_id = 'missing' WHERE id = 'w-team'"), /FOREIGN KEY constraint failed/);
        assert.throws(() => db.exec("UPDATE worktrees SET issue_id = 'i' WHERE id = 'w-user'"), /CHECK constraint failed/);
        assert.deepEqual(
          db.prepare("SELECT id FROM worktrees WHERE issue_id = 'i' ORDER BY id").all().map((row) => row.id),
          ["w-done", "w-team"],
        );
        db.exec("DELETE FROM issues WHERE id = 'i'");
        assert.deepEqual(links(db), ["w-done", "w-team", "w-user"].map((id) => ({ id, issue_id: null })));
        db.exec("INSERT INTO issues (id, space_id, number, title, state, author_user_id, created_at, updated_at) VALUES ('i', 't', 1, 'Fix totals', 'open', 'u', 1, 2)");
        assert.deepEqual(snapshot(db), before);
      }
      migrated.close();
      const backups = () => readdirSync(root).filter((name) => name.startsWith(`case-${seeded}.sqlite.v29-backup-`));
      assert.equal(backups().length, 1);
      const backup = new DatabaseSync(join(root, backups()[0]!), { readOnly: true });
      assert.equal(version(backup), 29);
      assert.deepEqual(snapshot(backup), before);
      backup.close();
      const restarted = open(filename);
      assert.deepEqual(snapshot(restarted.connection), before);
      assert.equal(version(restarted.connection), 36);
      restarted.close();
      assert.equal(backups().length, 1);
    }
    const filename = join(root, "rollback.sqlite");
    const broken = fixture(filename, true);
    broken.exec("PRAGMA foreign_keys = OFF; INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('orphan', 'team', 'Orphan', 'missing', 1, 2)");
    const before = snapshot(broken);
    broken.close();
    assert.throws(() => open(filename), /V29 to V36 migration failed.*rolled back.*backup/);
    const backup = readdirSync(root).find((name) => name.startsWith("rollback.sqlite.v29-backup-"))!;
    for (const name of ["rollback.sqlite", backup]) {
      const db = new DatabaseSync(join(root, name), { readOnly: true });
      assert.equal(version(db), 29);
      assert.deepEqual(snapshot(db), before);
      assert.equal(db.prepare("PRAGMA table_info(worktrees)").all().some(({ name }) => name === "issue_id"), false);
      assert.equal(db.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
