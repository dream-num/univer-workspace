import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SqliteDatabase } from "../../server/src/db/sqlite/connection.js";
import { DROP_V29_SQL, withoutV29Columns } from "./v29-downgrade.js";

export function verifyV28Migration(open: (filename: string) => SqliteDatabase): void {
  const root = mkdtempSync(join(tmpdir(), "workspace-v28-"));
  const schema = readFileSync(new URL("../../server/src/db/sqlite/schema.sql", import.meta.url), "utf8");
  const fixture = (filename: string, seeded: boolean) => {
    const db = new DatabaseSync(filename);
    db.exec(schema);
    db.exec(DROP_V29_SQL);
    db.exec("PRAGMA user_version = 28");
    if (seeded) {
      db.exec(`
        INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES ('u', 'owner', 'Owner', 1, 2);
        INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('s', 'personal', 'Personal', 'u', 1, 2);
        INSERT INTO spaces (id, type, name, slug, public_read, owner_user_id, created_at, updated_at) VALUES ('t', 'team', 'Team', 'team', 1, 'u', 1, 2);
        INSERT INTO spaces (id, type, name, slug, owner_user_id, created_at, updated_at) VALUES ('p', 'team', 'Private', 'private', 'u', 1, 2);
        INSERT INTO forks (id, owner_user_id, upstream_space_id, name, created_at) VALUES ('f', 'u', 't', 'fix', 3);
        INSERT INTO worktrees (id, name, creator_user_id, kind, team_space_id, visibility, created_at, updated_at, number, fork_id)
          VALUES ('w-team', 'Open', 'u', 'team', 't', 'private', 1, 2, 1, 'f');
        INSERT INTO operations (id, kind, actor_user_id, step, state, payload_json, attempt_count, next_attempt_at, created_at, updated_at)
          VALUES ('op', 'create_worktree', 'u', 'reserved', 'pending', '{"kind":"team","teamSpaceId":"t","worktreeId":"w-next"}', 2, 3, 1, 2);
      `);
    }
    return db;
  };
  const snapshot = (db: DatabaseSync) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map(({ name }) => [name, withoutV29Columns(String(name), db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all())]);
  const version = (db: DatabaseSync) => db.prepare("PRAGMA user_version").get()?.user_version;
  const proposals = (db: DatabaseSync) => db.prepare("SELECT id, proposals FROM spaces ORDER BY id").all().map((row) => ({ ...row }));
  try {
    for (const seeded of [false, true]) {
      const filename = join(root, `case-${seeded}.sqlite`);
      const old = fixture(filename, seeded);
      const before = snapshot(old);
      old.close();
      const migrated = open(filename);
      const db = migrated.connection;
      assert.equal(version(db), 30);
      assert.deepEqual(snapshot(db), before);
      assert.deepEqual(proposals(db), seeded ? ["p", "s", "t"].map((id) => ({ id, proposals: "members" })) : []);
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(db.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      if (seeded) {
        db.exec("UPDATE spaces SET proposals = 'accountable' WHERE id = 't'; UPDATE spaces SET proposals = 'anyone' WHERE id = 'p'");
        assert.throws(() => db.exec("UPDATE spaces SET proposals = 'everyone' WHERE id = 't'"), /CHECK constraint failed/);
        assert.throws(() => db.exec("UPDATE spaces SET proposals = NULL WHERE id = 't'"), /NOT NULL constraint failed: spaces.proposals/);
        db.exec("INSERT INTO spaces (id, type, name, slug, owner_user_id, created_at, updated_at) VALUES ('n', 'team', 'New', 'new', 'u', 4, 4)");
        assert.deepEqual(proposals(db), [{ id: "n", proposals: "members" }, { id: "p", proposals: "anyone" }, { id: "s", proposals: "members" }, { id: "t", proposals: "accountable" }]);
        db.exec("DELETE FROM spaces WHERE id = 'n'; UPDATE spaces SET proposals = 'members'");
        assert.deepEqual(snapshot(db), before);
      }
      migrated.close();
      const backups = () => readdirSync(root).filter((name) => name.startsWith(`case-${seeded}.sqlite.v28-backup-`));
      assert.equal(backups().length, 1);
      const backup = new DatabaseSync(join(root, backups()[0]!), { readOnly: true });
      assert.equal(version(backup), 28);
      assert.deepEqual(snapshot(backup), before);
      backup.close();
      const restarted = open(filename);
      assert.deepEqual(snapshot(restarted.connection), before);
      assert.equal(version(restarted.connection), 30);
      restarted.close();
      assert.equal(backups().length, 1);
    }
    const filename = join(root, "rollback.sqlite");
    const broken = fixture(filename, true);
    broken.exec("PRAGMA foreign_keys = OFF; INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('orphan', 'team', 'Orphan', 'missing', 1, 2)");
    const before = snapshot(broken);
    broken.close();
    assert.throws(() => open(filename), /V28 to V30 migration failed.*rolled back.*backup/);
    const backup = readdirSync(root).find((name) => name.startsWith("rollback.sqlite.v28-backup-"))!;
    for (const name of ["rollback.sqlite", backup]) {
      const db = new DatabaseSync(join(root, name), { readOnly: true });
      assert.equal(version(db), 28);
      assert.deepEqual(snapshot(db), before);
      assert.equal(db.prepare("PRAGMA table_info(spaces)").all().some(({ name }) => name === "proposals"), false);
      assert.equal(db.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
