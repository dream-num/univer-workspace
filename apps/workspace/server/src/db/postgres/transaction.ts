import type { Pool, PoolClient } from "pg";

const MAX_ATTEMPTS = 5;

/** The callback can be replayed. All its reads and writes must use this client. */
export async function withPostgresTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const client = await pool.connect();
    let discard = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        discard = true;
        throw new AggregateError([error, rollbackError], "PostgreSQL transaction rollback failed");
      }
      if (attempt >= MAX_ATTEMPTS || !isRetryable(error)) throw error;
    } finally {
      client.release(discard);
    }
  }
}

function isRetryable(error: unknown): boolean {
  return error instanceof Error && "code" in error &&
    (error.code === "40001" || error.code === "40P01");
}
