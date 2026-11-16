import { Pool } from "pg";
import {
  migratePostgresCore,
  PostgresDatabaseAdapter,
} from "@univerjs-pro/collaboration-database-postgres";
import { PostgresWorktreeDatabaseAdapter } from "@univerjs-pro/collaboration-worktree-database-postgres";
import { PostgresHistoryDatabaseAdapter } from "@univerjs-pro/collaboration-history-database-postgres";
import { PostgresCommentDatabaseAdapter } from "@univerjs-pro/collaboration-comment-database-postgres";
import { logger } from "../../../../logging/logger.js";
import type { CollaborationDatabase } from "../collaboration-database.js";

export async function openPostgresCollaborationDatabase(
  connectionString: string,
): Promise<CollaborationDatabase> {
  const pool = new Pool({ connectionString });
  pool.on("error", (error) =>
    logger.warn(
      { code: "code" in error ? error.code : undefined },
      "Idle PostgreSQL collaboration connection lost",
    ),
  );
  const resources = new AsyncDisposableStack();
  resources.defer(() => pool.end());
  try {
    // The SDK migrator accepts initialized Core schemas. create() handles first startup.
    const versions = await pool.query(
      "SELECT to_regclass('collaboration.schema_versions') AS registry",
    );
    if (versions.rows[0].registry) {
      const existing = await pool.query(
        "SELECT 1 FROM collaboration.schema_versions WHERE component = 'core'",
      );
      if (existing.rowCount) await migratePostgresCore({ pool });
    }
    const core = await PostgresDatabaseAdapter.create({ pool });
    const worktree = await PostgresWorktreeDatabaseAdapter.create({ pool });
    resources.defer(() => worktree.dispose());
    const history = await PostgresHistoryDatabaseAdapter.create({ pool });
    resources.defer(() => history.dispose());
    const comment = await PostgresCommentDatabaseAdapter.create({ pool });
    resources.defer(() => comment.dispose());
    return { core, worktree, history, comment, close: () => resources.disposeAsync() };
  } catch (error) {
    await resources.disposeAsync();
    throw error;
  }
}
