import type { IDatabaseAdapter } from "@univerjs-pro/collaboration-service";
import type { IWorktreeDatabaseAdapter } from "@univerjs-pro/collaboration-worktree-service";
import type { IHistoryDatabaseAdapter } from "@univerjs-pro/collaboration-history-service";
import type { ICommentDatabaseAdapter } from "@univerjs-pro/collaboration-comment-service";

export interface CollaborationDatabase {
  readonly core: IDatabaseAdapter;
  readonly worktree: IWorktreeDatabaseAdapter;
  readonly history: IHistoryDatabaseAdapter;
  readonly comment: ICommentDatabaseAdapter;
  close(): Promise<void>;
}
