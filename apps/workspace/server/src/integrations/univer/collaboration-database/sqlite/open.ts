import { SQLiteDatabaseAdapter } from "@univerjs-pro/collaboration-database-sqlite";
import { SQLiteWorktreeDatabaseAdapter } from "@univerjs-pro/collaboration-worktree-database-sqlite";
import { SQLiteHistoryDatabaseAdapter } from "@univerjs-pro/collaboration-history-database-sqlite";
import { SQLiteCommentDatabaseAdapter } from "@univerjs-pro/collaboration-comment-database-sqlite";
import type { UnitCreationFactsReader } from "../../../../db/index.js";
import type { CollaborationDatabase } from "../collaboration-database.js";
import { prepareCollaborationDatabase } from "./migrations/prepare-collaboration-database.js";

export async function openSqliteCollaborationDatabase(
  filename: string,
  productFacts: UnitCreationFactsReader,
): Promise<CollaborationDatabase> {
  await prepareCollaborationDatabase(filename, productFacts);
  const resources = new AsyncDisposableStack();
  try {
    const core = new SQLiteDatabaseAdapter({ filename });
    resources.defer(() => core.dispose());
    const worktree = new SQLiteWorktreeDatabaseAdapter({ filename });
    resources.defer(() => worktree.dispose());
    const history = new SQLiteHistoryDatabaseAdapter({ filename });
    resources.defer(() => history.dispose());
    const comment = new SQLiteCommentDatabaseAdapter({ filename });
    resources.defer(() => comment.dispose());
    return { core, worktree, history, comment, close: () => resources.disposeAsync() };
  } catch (error) {
    await resources.disposeAsync();
    throw error;
  }
}
