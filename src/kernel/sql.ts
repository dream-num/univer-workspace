/**
 * Rows produced by one {@link SqlExec.exec} call.
 *
 * @typeParam T Shape of each result row.
 */
export type SqlQueryResult<T> = {
  /** Materialize the cursor as a plain array (copies rows). */
  toArray(): T[];
};

/**
 * Cloudflare Durable Object SQLite limit: max bytes in a LIKE or GLOB pattern.
 * @see https://developers.cloudflare.com/durable-objects/platform/limits/
 */
export const SQL_LIKE_GLOB_PATTERN_MAX_BYTES = 50;

/**
 * Reject a LIKE/GLOB pattern that exceeds the Durable Object SQLite 50-byte cap.
 *
 * @param pattern Bound or literal pattern (`NULL` is skipped).
 * @throws {Error} When UTF-8 byte length is greater than {@link SQL_LIKE_GLOB_PATTERN_MAX_BYTES}.
 */
export function assertSqlLikeGlobPattern(pattern: unknown): void {
  if (pattern == null) return;
  const text = String(pattern);
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > SQL_LIKE_GLOB_PATTERN_MAX_BYTES) {
    throw new Error(
      `LIKE or GLOB pattern too long (${bytes} bytes; max ${SQL_LIKE_GLOB_PATTERN_MAX_BYTES})`
    );
  }
}

/**
 * SQLite-like executor used by the kernel (`plugin_tree`) and host SQL.
 * Production uses Durable Object storage SQL; tests use in-memory SQLite.
 */
export type SqlExec = {
  /**
   * Run one statement with `?` bind parameters.
   *
   * @typeParam T Shape of each result row.
   * @param query SQL text (single statement).
   * @param binds Values substituted for `?` placeholders, in order.
   * @returns A cursor whose {@link SqlQueryResult.toArray} yields rows.
   * @throws {Error} When the statement is invalid or constraints fail.
   */
  exec<T = Record<string, unknown>>(
    query: string,
    ...binds: unknown[]
  ): SqlQueryResult<T>;
  /**
   * Run a synchronous function within an atomic transaction.
   * On Durable Objects, delegates to `state.storage.transactionSync`.
   */
  transactionSync?<T>(fn: () => T): T;
};
