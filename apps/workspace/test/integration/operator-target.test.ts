import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createPostgresTestSchema } from "../support/postgres/schema.js";

interface Backend {
  readonly env: Record<string, string>;
  query(sql: string): Promise<readonly Record<string, unknown>[]>;
  close(): Promise<void>;
}

function openSqlite(): Backend {
  const directory = mkdtempSync(join(tmpdir(), "workspace-operator-target-"));
  const filename = join(directory, "workspace.sqlite");
  let database: DatabaseSync | undefined;
  return {
    env: { DATABASE_FILE: filename },
    async query(sql) {
      database ??= new DatabaseSync(filename);
      return database.prepare(sql).all();
    },
    async close() {
      database?.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

async function openPostgres(url: string): Promise<Backend> {
  const schema = await createPostgresTestSchema(url);
  return {
    env: { DATABASE_PROVIDER: "postgres", DATABASE_URL: schema.connectionString, BLOB_STORE: "s3", BLOB_S3_BUCKET: "unused" },
    async query(sql) {
      return (await schema.pool.query(sql)).rows;
    },
    close: schema.close,
  };
}

const postgresUrl = process.env.WORKSPACE_TEST_POSTGRES_URL;
const backends = [
  { name: "SQLite", open: async () => openSqlite() },
  { name: "PostgreSQL", open: postgresUrl ? () => openPostgres(postgresUrl) : undefined },
];
const hubert = "22222222-bbbb-4bbb-8bbb-222222222222";
const robot = "33333333-cccc-4ccc-8ccc-333333333333";

for (const { name, open } of backends) {
  describe.skipIf(!open)(`${name} operator commands`, () => {
    it("refuse a target that is one User's ID and another's username, and act on an exact ID or username", async ({ onTestFinished }) => {
      const backend = await open!();
      onTestFinished(backend.close);
      const run = (command: string, ...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", `server/src/db/${command}.ts`, ...args], {
        cwd: new URL("../../", import.meta.url),
        encoding: "utf8",
        env: { ...process.env, ...backend.env },
        timeout: 30_000,
      });
      const granted = async () => (await backend.query("SELECT user_id FROM executor_access ORDER BY user_id")).map((row) => row.user_id);
      const banned = async () => (await backend.query(`SELECT banned_at FROM agents WHERE user_id = '${robot}'`))[0]?.banned_at != null;

      expect(run("executor-access", "list")).toMatchObject({ status: 0, stdout: "", stderr: expect.stringContaining("No users have executor access") });
      // Rows a rename made before usernames shaped like user IDs were refused; one differs from the ID only in case.
      await backend.query(`
        INSERT INTO users (id, username, display_name, kind, created_at, updated_at) VALUES
          ('${hubert}', 'hubert', 'Hubert', 'human', 1, 1), ('mallory-id', '${hubert.toUpperCase()}', 'Mallory', 'human', 1, 1),
          ('${robot}', 'robot-0a1b', 'Robot', 'agent', 1, 1), ('eve-id', '${robot}', 'Eve', 'human', 1, 1)`);
      await backend.query(`INSERT INTO agents (user_id, origin_label, created_at, last_active_at, expires_at) VALUES ('${robot}', 'robot', 1, 1, 8000000000000)`);
      const hubertAmbiguity = `${hubert} is the user ID of hubert (${hubert}) and the username of ${hubert.toUpperCase()} (mallory-id). Nothing changed`;

      expect(run("executor-access", "grant", hubert)).toMatchObject({ status: 1, stdout: "", stderr: expect.stringContaining(hubertAmbiguity) });
      expect(await granted()).toEqual([]);
      await backend.query(`INSERT INTO executor_access (user_id, granted_at) VALUES ('${hubert}', 5)`);
      expect(run("executor-access", "revoke", hubert)).toMatchObject({ status: 1, stdout: "", stderr: expect.stringContaining(hubertAmbiguity) });
      expect(run("executor-access", "revoke", hubert.toUpperCase())).toMatchObject({
        status: 1,
        stdout: "",
        stderr: expect.stringContaining(`${hubert.toUpperCase()} is the user ID of hubert (${hubert}) and the username of ${hubert.toUpperCase()} (mallory-id). Nothing changed`),
      });
      expect(await granted()).toEqual([hubert]);

      expect(run("executor-access", "revoke", "HUBERT")).toMatchObject({ status: 0, stdout: `hubert (${hubert}) no longer has executor access\n` });
      expect(run("executor-access", "grant", "mallory-id")).toMatchObject({ status: 0, stdout: `${hubert.toUpperCase()} (mallory-id) now has executor access\n` });
      expect(await granted()).toEqual(["mallory-id"]);

      expect(run("ban-agent", robot)).toMatchObject({
        status: 1,
        stdout: "",
        stderr: expect.stringContaining(`${robot} is the user ID of robot-0a1b (${robot}) and the username of ${robot} (eve-id). Nothing changed`),
      });
      expect(run("ban-agent", robot.toUpperCase())).toMatchObject({
        status: 1,
        stdout: "",
        stderr: expect.stringContaining(`${robot.toUpperCase()} is the user ID of robot-0a1b (${robot}) and the username of ${robot} (eve-id). Nothing changed`),
      });
      expect(await banned()).toBe(false);
      expect(run("ban-agent", "eve-id")).toMatchObject({ status: 1, stderr: expect.stringContaining(`${robot} is not an agent`) });
      expect(run("ban-agent", "ROBOT-0A1B")).toMatchObject({ status: 0, stdout: `Banned agent robot-0a1b (${robot})\n` });
      expect(await banned()).toBe(true);
    }, 120_000);
  });
}
