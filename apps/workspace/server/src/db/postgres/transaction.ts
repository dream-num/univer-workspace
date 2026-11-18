import type { Pool, PoolClient } from "pg";

const MAX_ATTEMPTS = 10;
const BACKOFF_BASE_MS = 5;
const BACKOFF_CAP_MS = 250;

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
    // An immediate replay meets the same concurrent transactions and loses again; random waits spread the losers out.
    const backoffMs = Math.random() * Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }
}

// A concurrent insert can report a unique violation before PostgreSQL detects a
// serialization conflict. Replay only allocations and idempotency lookups that
// can observe the winning row and recompute their result.
const retryableConstraints = new Set([
  "operations_pkey", "oauth_refresh_history_pkey", "issues_space_id_number_key", "worktrees_team_number", "worktrees_user_number",
  "issue_labels_space_name", "html_view_drafts_author_user_id_idempotency_key_key",
  "skill_drafts_author_user_id_idempotency_key_key",
]);

function isRetryable(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false;
  if (error.code === "40001" || error.code === "40P01") return true;
  return error.code === "23505" && "constraint" in error && retryableConstraints.has(String(error.constraint));
}
