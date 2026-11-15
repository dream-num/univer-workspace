import type { NodeAccess, UnitType } from "../access/index.js";

export interface TrashCursor {
  readonly createdAt: number;
  readonly id: string;
}

export interface TrashBatchRow {
  readonly id: string;
  readonly space_id: string;
  readonly root_node_id: string;
  readonly created_by: string;
  readonly created_at: number;
  readonly restored_at: number | null;
  readonly root_resource_id: string | null;
  readonly root_resource_kind: "univer" | "blob" | null;
  readonly root_name: string;
  readonly root_unit_type: UnitType | null;
  readonly root_media_type: string | null;
  readonly root_byte_size: number | null;
  readonly creator_username: string;
  readonly creator_display_name: string;
  readonly creator_avatar_url: string | null;
  readonly node_count: number;
}

export interface TrashBreadcrumbRow {
  readonly id: string;
  readonly name: string;
}

export interface TrashBlockers {
  readonly parentBatchId: string | null;
  readonly nestedBatchId: string | null;
  readonly activeWorktreeReference: boolean;
}

export interface TrashRepository {
  trashNode(input: {
    readonly batchId: string;
    readonly nodeId: string;
    readonly createdBy: string;
    readonly createdAt: number;
  }): Promise<void>;
  findBatch(batchId: string): Promise<TrashBatchRow | null>;
  listBatches(
    spaceId: string,
    cursor: TrashCursor | null,
    limit: number
  ): Promise<TrashBatchRow[]>;
  originalBreadcrumbs(rootNodeId: string): Promise<TrashBreadcrumbRow[]>;
  blockers(batch: TrashBatchRow): Promise<TrashBlockers>;
  /** Returns the restored root Node, or null when the parent is still in Trash. */
  restore(batchId: string, userId: string, restoredAt: number): Promise<NodeAccess | null>;
  removePermanently(batchId: string, userId: string, deletedAt: number): Promise<"removed" | "nestedBatch" | "activeWorktreeReference">;
}
