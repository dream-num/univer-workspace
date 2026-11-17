import type { NodeSummary } from "../nodes/index.js";
import type { OperationView } from "../operations/index.js";
import type { WorktreeUnit } from "../worktrees/index.js";

/** The Unit types whose content, embedded Assets and ID references a copy is known to carry over. */
export type CopyableUnitType = "sheet" | "doc" | "slide";

/** What the requester asked for, compared when an Idempotency-Key is replayed. */
export interface CopyRequest {
  readonly name: string | null;
  readonly target:
    | { readonly kind: "personalSpace" }
    | {
        readonly kind: "worktree";
        readonly worktreeId: string;
        readonly spaceId: string;
        readonly parentNodeId: string | null;
      };
}

export interface CopiedObject {
  readonly sourceObjectKey: string;
  readonly objectKey: string;
  readonly originalFilename: string;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly etag: string;
}

export interface CopiedAsset extends CopiedObject {
  readonly sourceAssetId: string;
  readonly assetId: string;
}

/**
 * What a copy Operation keeps so that any process can finish or undo it: the request, the
 * identities reserved for the new file, and the metadata of the objects to duplicate. Unit content
 * is never stored here. Each attempt reads the source again at `sourceRevision`.
 */
export interface CopyPayload {
  readonly sourceNodeId: string;
  readonly request: CopyRequest;
  readonly name: string;
  readonly nodeId: string;
  readonly resourceId: string;
  readonly target:
    | { readonly kind: "space"; readonly spaceId: string }
    | {
        readonly kind: "worktree";
        readonly worktreeId: string;
        readonly spaceId: string;
        readonly parentNodeId: string | null;
      };
  readonly content:
    | {
        readonly kind: "univer";
        readonly unitType: CopyableUnitType;
        readonly sourceUnitId: string;
        readonly sourceRevision: number;
        readonly unitId: string;
        readonly assets: readonly CopiedAsset[];
      }
    | { readonly kind: "blob"; readonly object: CopiedObject };
}

/**
 * `reserved` → `objects_copied` → `unit_created` → completed. `abandoning` is entered from any of
 * them when the copy cannot finish; it removes the new Unit and then fails the Operation, which
 * queues the copied objects for deletion.
 */
export type CopyStep = "reserved" | "objects_copied" | "unit_created" | "abandoning" | "completed";

export type CopyResult =
  | { readonly status: 200 | 201; readonly body: { readonly operation: OperationView; readonly node: NodeSummary } }
  | { readonly status: 200 | 201; readonly body: { readonly operation: OperationView; readonly unit: WorktreeUnit } }
  | { readonly status: 202; readonly body: { readonly operation: OperationView } };
