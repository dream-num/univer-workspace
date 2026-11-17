import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseError, Pool, type PoolClient } from "pg";
import { loadConfig } from "../config.js";
import { initializePostgresSchema } from "../db/postgres/initialize.js";
import { openPostgresCollaborationDatabase } from "../integrations/univer/collaboration-database/postgres/open.js";
import { importCollaboration } from "./collaboration.js";
import { copySheetBlocks } from "./sheet-blocks.js";
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

let phase = "configuration";
let outcome: "uncommitted" | "unconfirmed" | "committed" = "uncommitted";

function startPhase(name: string) {
  phase = name;
  console.log(`Migration phase: ${name}`);
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
  startPhase("copy and validate SQLite sources");
  const directory = await mkdtemp(join(tmpdir(), "workspace-storage-migration-"));
  resources.defer(() => rm(directory, { recursive: true, force: true }));
  const source = await prepareSource(
    directory,
    resolve(process.env.DATABASE_FILE ?? ".data/univer-workspace.sqlite"),
    resolve(process.env.COLLABORATION_DATABASE_FILE ?? ".data/univer-collaboration.sqlite"),
    resources,
  );
  startPhase("prepare PostgreSQL target");
  const pool = new Pool({ connectionString: database.connectionString });
  resources.defer(() => pool.end());
  const client = await pool.connect();
  resources.defer(() => client.release(true));
  client.on("error", (error: Error) => console.error(`PostgreSQL connection error during ${phase}: ${error.message}`));
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
  const adapters = await openPostgresCollaborationDatabase(database.connectionString, s3BlobStore);
  await adapters.close();

  startPhase("verify S3 files");
  const objects = await copyObjects(
    source.product,
    resolve(process.env.BLOB_DIRECTORY ?? ".data/univer-workspace-blobs"),
    s3BlobStore,
  );
  startPhase("verify S3 Sheet blocks");
  const blocks = await copySheetBlocks(source, s3BlobStore);
  console.log(`Verified ${objects} files and ${blocks} Sheet blocks in S3. Importing product and collaboration rows.`);
  startPhase("import PostgreSQL rows");
  await client.query("BEGIN");
  let product: number;
  let collaboration: number;
  try {
    await requireEmptyTarget(client, target.schema, true);
    product = await importProduct(source.product, client, target.schema);
    collaboration = await importCollaboration(source, client);
    await source.checkSourceStopped();
  } catch (error) {
    // Destroying this connection during disposal also aborts the transaction if rollback fails.
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
  startPhase("commit PostgreSQL transaction");
  outcome = "unconfirmed";
  const result = await client.query("COMMIT").catch((error: unknown) => {
    // Constraint and rollback SQLSTATE classes are definitive server rejections,
    // except 40003 (statement completion unknown).
    if (error instanceof DatabaseError && error.code !== "40003" && /^(23|40)/.test(error.code ?? "")) {
      outcome = "uncommitted";
    }
    throw error;
  });
  if (result.command !== "COMMIT") {
    outcome = "uncommitted";
    throw new Error(`PostgreSQL returned ${result.command} for COMMIT`);
  }
  outcome = "committed";
  console.log(
    `Migration committed: ${product} product rows, ${collaboration} collaboration rows, ${objects} files, ${blocks} Sheet blocks.`,
  );
  phase = "release migration resources";
}

migrate().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  if (outcome === "unconfirmed") {
    console.error(`Migration commit unconfirmed: ${reason}. Inspect the PostgreSQL target before retrying.`);
    process.exitCode = 2;
  } else if (outcome === "committed") {
    console.error(`Migration committed, but cleanup failed: ${reason}. Do not rerun the import.`);
    process.exitCode = 3;
  } else {
    console.error(`Storage migration failed during ${phase}: ${reason}. This run did not commit the database import.`);
    process.exitCode = 1;
  }
});
