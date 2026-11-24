import { DROP_V26_SQL, withoutV26Columns } from "./v26-downgrade.js";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SqliteDatabase } from "../../server/src/db/sqlite/connection.js";

const tags = (text: string) => [...text].map((letter) => String.fromCodePoint(0xE0000 + letter.codePointAt(0)!)).join("");

const REWRITTEN = [
  ["r1", "Al\uFFF9i\uFFFAc\uFFFBe", "Alice"],
  ["r2", "Ra\u{13430}m\u{13439}s\u{1343F}es", "Ramses"],
  ["r3", `\u{1F3F4}${tags("hello")}\u{E007F}`, "\u{1F3F4}"],
  ["r4", `\u{1F3F4}${tags("gbengx")}\u{E007F} Eng`, "\u{1F3F4} Eng"],
  ["r5", "alice@example\u2024com", "alice"],
  ["r6", "alice\uFF20example\uFE52com", "alice"],
] as const;
const KEPT = [
  "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466} Smith",
  `A \u{1F3F4}${tags("gbeng")}\u{E007F} B`,
  "\u0646\u0627\u0645\u0647\u200C\u0627\u06CC",
  "\u0D15\u0D41\u0D2E\u0D3E\u0D30\u0D4D\u200D \u0D05\u0D35\u0D28\u0D4D\u200D",
  "\u0D05\u0D35\u0D28\u0D4D",
  "\u0915\u094D",
  "\u0600\u0661\u0662 Noor",
  "Team @acme\u2024io",
] as const;

export function verifyV24Migration(open: (filename: string) => SqliteDatabase): void {
  const root = mkdtempSync(join(tmpdir(), "workspace-v24-"));
  const schema = readFileSync(new URL("../../server/src/db/sqlite/schema.sql", import.meta.url), "utf8");
  const fixture = (filename: string, seeded: boolean) => {
    const db = new DatabaseSync(filename);
    db.exec(schema);
    db.exec(DROP_V26_SQL);
    db.exec("PRAGMA user_version = 24");
    if (seeded) {
      const user = db.prepare("INSERT INTO users (id, username, display_name, created_at, updated_at) VALUES (?, ?, ?, 1, 2)");
      const space = db.prepare("INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES (?, 'personal', ?, ?, 3, 4)");
      for (const [id, stored] of REWRITTEN) {
        user.run(id, id, stored);
        space.run(`space-${id}`, `${stored} 的个人空间`, id);
      }
      KEPT.forEach((name, index) => {
        user.run(`kept-${index}`, `kept${index}`, name);
        space.run(`space-kept-${index}`, `${name} 的个人空间`, `kept-${index}`);
      });
      db.exec(`
        INSERT INTO users (id, username, display_name, created_at, updated_at, kind) VALUES ('agent', 'claude-code-ab12', 'Claude Code \u00B7 ab12', 1, 2, 'agent');
        INSERT INTO agents (user_id, origin_label, created_at, last_active_at, expires_at) VALUES ('agent', 'bot@example\u2024com', 1, 1, 9);
        INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('space-agent', 'personal', 'Claude Code \u00B7 ab12 的个人空间', 'agent', 3, 4);
        UPDATE spaces SET name = 'Annotated drafts' WHERE id = 'space-r1';
        INSERT INTO spaces (id, type, name, owner_user_id, slug, created_at, updated_at) VALUES ('team', 'team', 'Al\uFFF9ice 的个人空间', 'r2', 'team', 5, 6);
        INSERT INTO nodes (id, space_id, name, created_by, created_at, updated_at) VALUES ('n', 'space-r2', 'Budget', 'r2', 1, 1);
        INSERT INTO node_link_sharing (node_id, enabled, role, created_by, updated_by, created_at, updated_at) VALUES ('n', 1, 'viewer', 'r2', 'r2', 1, 1);
        INSERT INTO login_sessions (id, secret_hash, user_id, created_at, expires_at, write_source) VALUES ('session', 'hash', 'r2', 1, 999, 'browser');
        INSERT INTO executor_access (user_id, granted_at) VALUES ('r5', 5);
        INSERT INTO operations (id, kind, actor_user_id, step, state, payload_json, attempt_count, next_attempt_at, created_at, updated_at)
          VALUES ('op', 'create_resource', 'r3', 'reserve', 'pending', '{}', 2, 3, 1, 2);
      `);
    }
    return db;
  };
  const table = (db: DatabaseSync, name: string) => withoutV26Columns(name, db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all());
  const tables = (db: DatabaseSync) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'forks' ORDER BY name").all()
      .map(({ name }) => [String(name), table(db, String(name))] as const);
  const converged = (before: ReturnType<typeof tables>) =>
    before.map(([name, rows]) => [name, rows.map((row) => {
      const user = name === "users" && REWRITTEN.find(([id]) => row.id === id);
      if (user) return { ...row, display_name: user[2] };
      const space = name === "spaces" && row.name !== "Annotated drafts" && REWRITTEN.find(([id]) => row.id === `space-${id}`);
      return space ? { ...row, name: `${space[2]} 的个人空间` } : row;
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
      assert.equal(version(db), 29);
      assert.deepEqual(tables(db), converged(before));
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(db.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      const after = tables(db);
      migrated.close();

      const backups = () => readdirSync(root).filter((name) => name.startsWith(`case-${seeded}.sqlite.v24-backup-`));
      assert.equal(backups().length, 1);
      const backup = new DatabaseSync(join(root, backups()[0]!), { readOnly: true });
      assert.equal(version(backup), 24);
      assert.deepEqual(tables(backup), before);
      backup.close();

      const restarted = open(filename);
      assert.deepEqual(tables(restarted.connection), after);
      restarted.close();
      assert.equal(backups().length, 1);

      const rerun = join(root, `rerun-${seeded}.sqlite`);
      copyFileSync(filename, rerun);
      const reset = new DatabaseSync(rerun);
      reset.exec(DROP_V26_SQL);
      reset.exec("PRAGMA user_version = 24");
      reset.close();
      const second = open(rerun);
      assert.equal(version(second.connection), 29);
      assert.deepEqual(tables(second.connection), after);
      second.close();
    }

    const filename = join(root, "rollback.sqlite");
    const broken = fixture(filename, true);
    broken.exec("PRAGMA foreign_keys = OFF; INSERT INTO spaces (id, type, name, owner_user_id, created_at, updated_at) VALUES ('orphan', 'team', 'Orphan', 'missing', 1, 1)");
    const original = tables(broken);
    broken.close();
    assert.throws(() => open(filename), /V24 to V29 migration failed.*rolled back.*backup/);
    for (const name of ["rollback.sqlite", readdirSync(root).find((name) => name.startsWith("rollback.sqlite.v24-backup-"))!]) {
      const preserved = new DatabaseSync(join(root, name), { readOnly: true });
      assert.equal(version(preserved), 24);
      assert.deepEqual(tables(preserved), original);
      assert.equal(preserved.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      preserved.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
