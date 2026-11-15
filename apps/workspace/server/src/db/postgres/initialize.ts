import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Pool, PoolClient } from "pg";

async function fingerprint(client: PoolClient): Promise<string> {
  const { rows } = await client.query<{ definition: string }>(`
    SELECT definition FROM (
      SELECT concat_ws('|', 'column', table_name, column_name, data_type, is_nullable,
                       column_default, is_identity) AS definition
      FROM information_schema.columns WHERE table_schema = current_schema()
      UNION ALL
      SELECT concat_ws('|', 'constraint', conrelid::regclass::text, conname, pg_get_constraintdef(oid))
      FROM pg_constraint WHERE connamespace = current_schema()::regnamespace
      UNION ALL
      SELECT concat_ws('|', 'index', indexname, indexdef) FROM pg_indexes WHERE schemaname = current_schema()
      UNION ALL
      SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE c.relnamespace = current_schema()::regnamespace AND NOT t.tgisinternal
      UNION ALL
      SELECT pg_get_functiondef(oid) FROM pg_proc WHERE pronamespace = current_schema()::regnamespace AND prokind = 'f'
    ) AS structure ORDER BY definition COLLATE "C"`);
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

export async function initializePostgresSchema(pool: Pool): Promise<void> {
  const sql = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Concurrent first starts must inspect the schema after the winning creator commits.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('univer-workspace-product'), hashtext(current_schema()))");
    const tables = await client.query<{ relname: string }>(
      "SELECT relname FROM pg_class WHERE relnamespace = current_schema()::regnamespace AND relkind IN ('r','p','v','m','S','f')",
    );
    if (!tables.rowCount) {
      await client.query(sql);
      await client.query("CREATE TABLE workspace_product_schema (version integer PRIMARY KEY, fingerprint text NOT NULL)");
      await client.query("INSERT INTO workspace_product_schema VALUES (1, $1)", [await fingerprint(client)]);
    } else {
      if (!tables.rows.some((row) => row.relname === "workspace_product_schema")) {
        throw new Error("PostgreSQL product database requires an empty schema or an initialized Workspace schema");
      }
      const { rows } = await client.query("SELECT version, fingerprint FROM workspace_product_schema");
      if (rows.length !== 1 || rows[0].version !== 1 || rows[0].fingerprint !== await fingerprint(client)) {
        throw new Error("Unsupported or modified PostgreSQL product schema");
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
