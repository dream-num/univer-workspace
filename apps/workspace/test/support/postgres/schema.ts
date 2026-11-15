import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";

export async function createPostgresTestSchema(connectionString: string) {
  const schema = `uvw_test_${randomUUID().replaceAll("-", "")}`;
  const scoped = new URL(connectionString);
  // The startup option applies to every connection opened by the pool.
  scoped.searchParams.set("options", `-c search_path=${schema}`);
  const admin = new Client({ connectionString });
  const pool = new Pool({ connectionString: scoped.href });
  let created = false;
  async function close() {
    try {
      await pool.end();
    } finally {
      try {
        if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await admin.end();
      }
    }
  }

  try {
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    const { rows } = await pool.query<{ name: string }>("SELECT current_schema() AS name");
    if (rows[0]?.name !== schema) throw new Error("PostgreSQL fixture search_path was not applied");
    return { connectionString: scoped.href, pool, close };
  } catch (error) {
    await close();
    throw error;
  }
}
