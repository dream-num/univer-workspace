import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import { loadConfig } from "../config.js";
import { initializePostgresSchema } from "../db/postgres/initialize.js";
import { openPostgresCollaborationDatabase } from "../integrations/univer/collaboration-database/postgres/open.js";
import { importCollaboration } from "./collaboration.js";
import { copyObjects } from "./objects.js";
import { importProduct } from "./product.js";
import { identifier } from "./rows.js";
import { prepareSource } from "./source.js";

async function requireEmptyTarget(client: PoolClient, schema: string, lockTables: boolean) {
  const { rows } = await client.query<{ schema: string; name: string }>(
    `SELECT n.nspname AS schema, c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r','p') AND n.nspname IN ($1, 'collaboration') ORDER BY 1, 2`,
    [schema],
  );
  for (const row of rows) {
    if (
      row.name === (row.schema === "collaboration" ? "schema_versions" : "workspace_product_schema")
    )
      continue;
    const table = identifier(row.schema) + "." + identifier(row.name);
    if (lockTables) await client.query(`LOCK TABLE ${table} IN EXCLUSIVE MODE NOWAIT`);
    if ((await client.query(`SELECT 1 FROM ${table} LIMIT 1`)).rowCount) {
      throw new Error(`Target already contains data in ${table}`);
    }
  }
}

async function migrate() {
  if (process.argv.length === 3 && process.argv[2] === "--help") {
    console.log(
      "Offline SQLite + local → PostgreSQL + S3 migration. Stop all Workspace writers first.",
    );
    console.log(
      "Source: V21 SQLite product database required. DATABASE_FILE, COLLABORATION_DATABASE_FILE, BLOB_DIRECTORY (normal SQLite/local defaults).",
    );
    console.log(
      "Target: DATABASE_PROVIDER=postgres, DATABASE_URL, BLOB_STORE=s3 and BLOB_S3_* settings.",
    );
    return;
  }
  if (process.argv.length !== 2)
    throw new Error(
      "Configure the source paths and target with environment variables. See the Workspace configuration guide.",
    );
  const { database, s3BlobStore } = loadConfig();
  if (database.provider !== "postgres" || !s3BlobStore) {
    throw new Error("Migration requires DATABASE_PROVIDER=postgres and BLOB_STORE=s3");
  }
  await using resources = new AsyncDisposableStack();
  const directory = await mkdtemp(join(tmpdir(), "workspace-storage-migration-"));
  resources.defer(() => rm(directory, { recursive: true, force: true }));
  const source = await prepareSource(
    directory,
    resolve(process.env.DATABASE_FILE ?? ".data/univer-workspace.sqlite"),
    resolve(process.env.COLLABORATION_DATABASE_FILE ?? ".data/univer-collaboration.sqlite"),
    resources,
  );
  const pool = new Pool({ connectionString: database.connectionString });
  resources.defer(() => pool.end());
  const client = await pool.connect();
  resources.defer(() => client.release(true));
  const {
    rows: [target],
  } = await client.query(
    "SELECT current_schema() AS schema, pg_try_advisory_lock(hashtext('workspace-storage-migration')) AS locked",
  );
  if (!target.locked) throw new Error("Another storage migration is running");
  if (!target.schema || target.schema === "collaboration")
    throw new Error("A separate product schema is required");
  await requireEmptyTarget(client, target.schema, false);
  await initializePostgresSchema(pool);
  const adapters = await openPostgresCollaborationDatabase(database.connectionString);
  await adapters.close();

  const objects = await copyObjects(
    source.product,
    resolve(process.env.BLOB_DIRECTORY ?? ".data/univer-workspace-blobs"),
    s3BlobStore,
  );
  console.log(`Verified ${objects} S3 objects. Importing product and collaboration rows.`);
  await client.query("BEGIN");
  try {
    await requireEmptyTarget(client, target.schema, true);
    const product = await importProduct(source.product, client, target.schema);
    const collaboration = await importCollaboration(source, client);
    await source.checkSourceStopped();
    await client.query("COMMIT");
    console.log(
      `Migration committed: ${product} product rows, ${collaboration} collaboration rows, ${objects} objects.`,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

migrate().catch((error: unknown) => {
  console.error(
    "Storage migration failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
