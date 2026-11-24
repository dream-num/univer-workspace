import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SqliteDatabase } from "../../server/src/db/sqlite/connection.js";
import { DROP_V28_SQL, withoutV28Columns } from "./v28-downgrade.js";

export function verifyV27Migration(open: (filename: string) => SqliteDatabase): void {
  const root = mkdtempSync(join(tmpdir(), "workspace-v27-"));
  const schema = readFileSync(new URL("../../server/src/db/sqlite/schema.sql", import.meta.url), "utf8");
  const fixture = (filename: string, seeded: boolean) => {
    const db = new DatabaseSync(filename);
    db.exec(schema);
    db.exec(DROP_V28_SQL);
    db.exec("PRAGMA user_version = 27");
    if (seeded) {
      db.exec(`
        INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ('u', 'owner', 'Owner', 1, 2);
        INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('s', 'personal', 'Personal', 'u', 1, 2);
        INSERT INTO spaces (id, type, name, slug, owner_user_id, created_at, updated_at) VALUES ('t', 'team', 'Team', 'team', 'u', 1, 2);
        INSERT INTO worktrees (id, name, creator_user_id, kind, visibility, created_at, updated_at, number, created_via)
          VALUES ('w-user', 'Mine', 'u', 'user', 'private', 1, 2, 1, 'browser');
        INSERT INTO worktrees (id, name, creator_user_id, kind, team_space_id, visibility, created_at, updated_at, number, created_via)
          VALUES ('w-team', 'Open', 'u', 'team', 't', 'space', 1, 2, 1, 'agent');
        INSERT INTO worktrees (id, name, creator_user_id, kind, team_space_id, visibility, processed_at, created_at, updated_at, number)
          VALUES ('w-done', 'Merged', 'u', 'team', 't', 'private', 5, 1, 5, 2);
        INSERT INTO worktree_units (worktree_id, unit_id, resource_id, source, ordinal, added_at) VALUES ('w-team', 'unit', 'resource', 'trunk', 0, 1);
        INSERT INTO operations (id, kind, actor_user_id, step, state, payload_json, attempt_count, next_attempt_at, created_at, updated_at)
          VALUES ('op', 'create_worktree', 'u', 'reserved', 'pending', '{"kind":"team","teamSpaceId":"t","worktreeId":"w-next"}', 2, 3, 1, 2);
      `);
    }
    return db;
  };
  const snapshot = (db: DatabaseSync) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'forks' ORDER BY name").all()
    .map(({ name }) => [name, withoutV28Columns(String(name), db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all())]);
  const version = (db: DatabaseSync) => db.prepare("PRAGMA user_version").get()?.user_version;
  const forkIds = (db: DatabaseSync) => db.prepare("SELECT id, fork_id FROM worktrees ORDER BY id").all().map((row) => ({ ...row }));
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
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM forks").get()?.n, 0);
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(db.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      if (seeded) {
        db.exec("INSERT INTO forks (id, owner_user_id, upstream_space_id, name, created_at) VALUES ('f', 'u', 't', 'fix', 3)");
        assert.throws(() => db.exec("INSERT INTO forks (id, owner_user_id, upstream_space_id, name, created_at) VALUES ('g', 'u', 't', 'FIX', 3)"), /UNIQUE constraint failed: forks.owner_user_id, forks.name/);
        assert.throws(() => db.exec("UPDATE worktrees SET fork_id = 'f' WHERE id = 'w-user'"), /CHECK constraint failed/);
        assert.throws(() => db.exec("UPDATE worktrees SET fork_id = 'missing' WHERE id = 'w-team'"), /FOREIGN KEY constraint failed/);
        db.exec("UPDATE worktrees SET fork_id = 'f' WHERE id IN ('w-team', 'w-done')");
        db.exec(`INSERT INTO worktrees (id, name, creator_user_id, kind, team_space_id, visibility, created_at, updated_at)
          VALUES ('w-second', 'Second', 'u', 'team', 't', 'private', 6, 6)`);
        assert.throws(() => db.exec("UPDATE worktrees SET fork_id = 'f' WHERE id = 'w-second'"), /UNIQUE constraint failed: worktrees.fork_id/);
        db.exec("UPDATE worktrees SET processed_at = 7 WHERE id = 'w-team'; UPDATE worktrees SET fork_id = 'f' WHERE id = 'w-second'");
        db.exec("DELETE FROM forks WHERE id = 'f'");
        assert.deepEqual(forkIds(db), ["w-done", "w-second", "w-team", "w-user"].map((id) => ({ id, fork_id: null })));
        assert.equal(db.prepare("SELECT COUNT(*) AS n FROM worktree_units WHERE worktree_id = 'w-team'").get()?.n, 1);
        db.exec("DELETE FROM worktrees WHERE id = 'w-second'; UPDATE worktrees SET processed_at = NULL WHERE id = 'w-team'");
        assert.deepEqual(snapshot(db), before);
      }
      migrated.close();
      const backups = () => readdirSync(root).filter((name) => name.startsWith(`case-${seeded}.sqlite.v27-backup-`));
      assert.equal(backups().length, 1);
      const backup = new DatabaseSync(join(root, backups()[0]!), { readOnly: true });
      assert.equal(version(backup), 27);
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
    assert.throws(() => open(filename), /V27 to V29 migration failed.*rolled back.*backup/);
    const backup = readdirSync(root).find((name) => name.startsWith("rollback.sqlite.v27-backup-"))!;
    for (const name of ["rollback.sqlite", backup]) {
      const db = new DatabaseSync(join(root, name), { readOnly: true });
      assert.equal(version(db), 27);
      assert.deepEqual(snapshot(db), before);
      assert.equal(db.prepare("PRAGMA table_info(worktrees)").all().some(({ name }) => name === "fork_id"), false);
      assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name IN ('forks', 'worktrees_open_fork')").get(), undefined);
      assert.equal(db.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
