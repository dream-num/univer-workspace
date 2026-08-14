import type { UnitType } from "../access/index.js";
import type { NodeSummary } from "../nodes/index.js";
import type { PublicUser } from "../permissions/index.js";

export type TrashBlocker =
  | {
      readonly code: "RESTORE_PARENT_IN_TRASH";
      readonly trashBatchId: string;
    }
  | {
      readonly code: "NESTED_TRASH_BATCH";
      readonly trashBatchId: string;
    }
  | {
      readonly code: "ACTIVE_WORKTREE_RESOURCE_REFERENCE";
    };

export interface TrashBatchView {
  readonly id: string;
  readonly spaceId: string;
  readonly root: {
    readonly id: string;
    readonly name: string;
    readonly resource:
      | {
          readonly id: string;
          readonly kind: "univer";
          readonly unitType: UnitType;
        }
      | {
          readonly id: string;
          readonly kind: "blob";
          readonly mediaType: string;
          readonly byteSize: number;
        }
      | null;
  };
  readonly originalLocation: {
    readonly breadcrumbs: readonly {
      readonly id: string;
      readonly name: string;
    }[];
  };
  readonly trashedBy: PublicUser;
  readonly trashedAt: string;
  readonly nodeCount: number;
  readonly capabilities: {
    readonly restore: boolean;
    readonly removePermanently: boolean;
  };
  readonly restoreBlockedBy: TrashBlocker | null;
  readonly removeBlockedBy: TrashBlocker | null;
}

export interface TrashList {
  readonly items: readonly TrashBatchView[];
  readonly nextCursor: string | null;
}

export interface TrashModule {
  trashNode(userId: string, nodeId: string): TrashBatchView;
  list(
    userId: string,
    spaceId: string,
    page: { readonly cursor: unknown; readonly limit: unknown }
  ): TrashList;
  restore(userId: string, trashBatchId: string): NodeSummary;
  removePermanently(userId: string, trashBatchId: string): void;
}
