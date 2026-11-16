import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { expect, it } from "vitest";
import { loadConfig } from "../../server/src/config.js";
import { openCollaborationDatabase } from "../../server/src/integrations/univer/collaboration-database/open-collaboration-database.js";
import { createPostgresTestDatabase } from "../support/postgres/schema.js";

const url = process.env.WORKSPACE_TEST_POSTGRES_URL;

it.skipIf(!url)(
  "opens all four PostgreSQL adapters and upgrades an existing Core on restart",
  async () => {
    const database = await createPostgresTestDatabase(url!);
    const resources = new AsyncDisposableStack();
    resources.defer(database.close);
    try {
      const directory = await mkdtemp(join(tmpdir(), "univer-pg-collaboration-"));
      resources.defer(() => rm(directory, { recursive: true, force: true }));
      const config = loadConfig({
        DATABASE_PROVIDER: "postgres",
        DATABASE_URL: database.connectionString,
        COLLABORATION_DATABASE_FILE: join(directory, "unused.sqlite"),
      });
      const open = () =>
        openCollaborationDatabase(config.database, {
          async read() {
            throw new Error("Only legacy SQLite migrations need product creation facts");
          },
        });
      async function startAndStop() {
        const adapters = await open();
        await adapters.close();
      }
      await Promise.all([startAndStop(), startAndStop()]);
      const client = new Client({ connectionString: database.connectionString });
      await client.connect();
      resources.defer(() => client.end());
      await client.query(`
        ALTER TABLE collaboration.units DROP COLUMN metadata;
        ALTER TABLE collaboration.changesets DROP COLUMN metadata;
        UPDATE collaboration.schema_versions SET version = 1 WHERE component = 'core';
        INSERT INTO collaboration.units(unit_id, type, head_revision, creator_id, created_at_ms)
        VALUES ('existing-doc', 1, 2, 'author', 1700000000000);
      `);
      const reopened = await open();
      resources.defer(() => reopened.close());
      const versions = await client.query(
        "SELECT component, version FROM collaboration.schema_versions",
      );
      expect(Object.fromEntries(versions.rows.map((row) => [row.component, row.version]))).toEqual({
        core: 2,
        worktree: 1,
        history: 1,
        comment: 1,
      });
      const record = await reopened.core.getUnit(
        { userID: "author", customData: {}, request: {} },
        "existing-doc",
      );
      expect(record).toMatchObject({
        headRevision: 2,
        creatorID: "author",
        createdAt: 1700000000000,
        metadata: {},
      });
      await reopened.close();
      await client.query("UPDATE collaboration.schema_versions SET version = 99 WHERE component = 'comment'");
      await expect(open()).rejects.toThrow(/version|schema/i);
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await resources.disposeAsync();
    }
  },
);
