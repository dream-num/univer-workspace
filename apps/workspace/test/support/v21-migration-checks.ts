import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SqliteDatabase } from "../../server/src/db/sqlite/connection.js";

const OWNERS = [
  { id: "google", username: "alice", stored: "alice@example.com", space: "alice@example.com 的个人空间", repaired: "alice", repairedSpace: "alice 的个人空间" },
  { id: "renamed", username: "bob", stored: "Bob", space: "bob@example.com 的个人空间", repaired: "Bob", repairedSpace: "Bob 的个人空间" },
  { id: "hostile", username: "carol", stored: "Carol\u202Eevil\nname", space: "Carol\u202Eevil\nname 的个人空间", repaired: "Carolevil name", repairedSpace: "Carolevil name 的个人空间" },
  { id: "filler", username: "dave", stored: "\u3164\u2800", space: "\u3164\u2800 的个人空间", repaired: "dave", repairedSpace: "dave 的个人空间" },
  { id: "custom", username: "erin", stored: "Erin <erin@example.com>", space: "Erin's drafts", repaired: "Erin <erin>", repairedSpace: "Erin's drafts" },
  { id: "stale", username: "frank", stored: "Frank", space: "Old Frank 的个人空间", repaired: "Frank", repairedSpace: "Old Frank 的个人空间" },
  { id: "plain", username: "grace", stored: "Grace", space: "Grace 的个人空间", repaired: "Grace", repairedSpace: "Grace 的个人空间" },
  {
    id: "agent", username: "claude-code-ab12", stored: "Claude\uFFFDCode · ab12", space: "Claude\uFFFDCode · ab12 的个人空间",
    repaired: "ClaudeCode · ab12", repairedSpace: "ClaudeCode · ab12 的个人空间",
  },
] as const;

export function verifyV21Migration(open: (filename: string) => SqliteDatabase): void {
  const root = mkdtempSync(join(tmpdir(), "workspace-v21-"));
  const schema = readFileSync(new URL("../../server/src/db/sqlite/schema.sql", import.meta.url), "utf8");
  const fixture = (filename: string, seeded: boolean) => {
    const db = new DatabaseSync(filename);
    db.exec(schema);
    db.exec("PRAGMA user_version = 21");
    if (seeded) {
      const user = db.prepare("INSERT INTO users (id, username, display_name, created_at, updated_at, kind) VALUES (?, ?, ?, 1, 2, ?)");
      const space = db.prepare("INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES (?, 'personal', ?, ?, 3, 4)");
      for (const { id, username, stored, space: spaceName } of OWNERS) {
        user.run(id, username, stored, id === "agent" ? "agent" : "human");
        space.run(`space-${id}`, spaceName, id);
      }
      db.exec(`
        INSERT INTO agents (user_id, origin_label, created_at, last_active_at, expires_at) VALUES ('agent', 'Claude Code', 1, 1, 9);
        INSERT INTO spaces (id, type, name, owner_user_id, slug, created_at, updated_at) VALUES ('team', 'team', 'alice@example.com 的个人空间', 'google', 'team', 5, 6);
        INSERT INTO nodes (id, space_id, name, created_by, created_at, updated_at) VALUES ('n', 'space-google', 'Budget', 'google', 1, 1);
        INSERT INTO node_link_sharing (node_id, enabled, role, created_by, updated_by, created_at, updated_at) VALUES ('n', 1, 'viewer', 'google', 'google', 1, 1);
        INSERT INTO login_sessions (id, secret_hash, user_id, created_at, expires_at, write_source) VALUES ('session', 'hash', 'google', 1, 999, 'browser');
        INSERT INTO operations (id, kind, actor_user_id, step, state, payload_json, attempt_count, next_attempt_at, created_at, updated_at)
          VALUES ('op', 'create_resource', 'hostile', 'reserve', 'pending', '{}', 2, 3, 1, 2);
      `);
    }
    return db;
  };
  const table = (db: DatabaseSync, name: string) => db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all().map((row) => ({ ...row }));
  const tables = (db: DatabaseSync) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
      .map(({ name }) => [String(name), table(db, String(name))] as const);
  const repaired = (before: ReturnType<typeof tables>) =>
    before.map(([name, rows]) => [name, rows.map((row) => {
      if (name === "users") {
        const owner = OWNERS.find(({ id }) => id === row.id);
        return owner ? { ...row, display_name: owner.repaired } : row;
      }
      if (name === "spaces") {
        const owner = OWNERS.find(({ id }) => `space-${id}` === row.id);
        return owner ? { ...row, name: owner.repairedSpace } : row;
      }
      return row;
    })] as const);
  const version = (db: DatabaseSync) => db.prepare("PRAGMA user_version").get()?.user_version;
  try {
    for (const seeded of [false, true]) {
      const filename = join(root, `case-${seeded}.sqlite`);
      const old = fixture(filename, seeded);
      const before = tables(old);
      old.close();

      const migrated = open(filename);
      const db = migrated.connection;
      assert.equal(version(db), 22);
      assert.deepEqual(tables(db), repaired(before));
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(db.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      const after = tables(db);
      migrated.close();

      const backups = () => readdirSync(root).filter((name) => name.startsWith(`case-${seeded}.sqlite.v21-backup-`));
      assert.equal(backups().length, 1);
      const backup = new DatabaseSync(join(root, backups()[0]!), { readOnly: true });
      assert.equal(version(backup), 21);
      assert.deepEqual(tables(backup), before);
      backup.close();

      const restarted = open(filename);
      assert.deepEqual(tables(restarted.connection), after);
      restarted.close();
      assert.equal(backups().length, 1);

      const rerun = join(root, `rerun-${seeded}.sqlite`);
      copyFileSync(filename, rerun);
      const reset = new DatabaseSync(rerun);
      reset.exec("PRAGMA user_version = 21");
      reset.close();
      const second = open(rerun);
      assert.equal(version(second.connection), 22);
      assert.deepEqual(tables(second.connection), after);
      second.close();
    }

    const filename = join(root, "rollback.sqlite");
    const broken = fixture(filename, true);
    broken.exec("PRAGMA foreign_keys = OFF; INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('orphan', 'team', 'Orphan', 'missing', 1, 1)");
    const original = tables(broken);
    broken.close();
    assert.throws(() => open(filename), /V21 to V22 migration failed.*rolled back.*backup/);
    for (const name of ["rollback.sqlite", readdirSync(root).find((name) => name.startsWith("rollback.sqlite.v21-backup-"))!]) {
      const preserved = new DatabaseSync(join(root, name), { readOnly: true });
      assert.equal(version(preserved), 21);
      assert.deepEqual(tables(preserved), original);
      assert.equal(preserved.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      preserved.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
