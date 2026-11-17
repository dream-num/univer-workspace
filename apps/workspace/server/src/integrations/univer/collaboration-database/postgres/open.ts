import { Pool } from "pg";
import { PostgresS3DatabaseAdapter } from "@univerjs-pro/collaboration-database-postgres-s3";
import type { S3BlobStoreOptions } from "../../../blob/s3-blob-store.js";
import { sheetBlockStorage } from "./sheet-block-storage.js";
import { PostgresWorktreeDatabaseAdapter } from "@univerjs-pro/collaboration-worktree-database-postgres";
import { PostgresHistoryDatabaseAdapter } from "@univerjs-pro/collaboration-history-database-postgres";
import { PostgresCommentDatabaseAdapter } from "@univerjs-pro/collaboration-comment-database-postgres";
import { logger } from "../../../../logging/logger.js";
import type { CollaborationDatabase } from "../collaboration-database.js";

export async function openPostgresCollaborationDatabase(
  connectionString: string,
  storage: S3BlobStoreOptions,
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
    const s3 = sheetBlockStorage(storage);
    resources.defer(() => s3.client.destroy());
    const core = await PostgresS3DatabaseAdapter.create({ pool, s3 });
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
