import { isHtmlViewFilename } from "@univerjs-labs/html-view";
import type { BlobResourceAccess, NodeAccess, ResourceAccess, SpaceAccess } from "../access/index.js";
import type { StoredBlob } from "../../integrations/blob/blob-store.js";
import { ApplicationError } from "../../middleware/errors.js";
import type { DraftRow } from "./drafts.types.js";

export interface HtmlViewDraftsRepository {
  pendingForWorktree(worktreeId: string): Promise<DraftRow[]>;
  /** Every draft attached to the Worktree except receiving and superseded ones, oldest first. */
  listForWorktree(worktreeId: string): Promise<DraftRow[]>;
  find(id: string): Promise<DraftRow | undefined>;
  findKey(userId: string, key: string): Promise<DraftRow | undefined>;
  currentTarget(resourceId: string): Promise<{ readonly etag: string; readonly originalFilename: string } | undefined>;
  reserve(
    input: Pick<
      DraftRow,
      | "author_user_id"
      | "idempotency_key"
      | "kind"
      | "space_id"
      | "source_worktree_id"
      | "parent_node_id"
      | "name"
      | "target_resource_id"
      | "base_etag"
      | "sha256"
      | "byte_size"
    > & { revises_draft_id?: string | null },
    now: number,
  ): Promise<{ row: DraftRow; created: boolean }>;
  markPending(id: string, stored: StoredBlob, now: number): Promise<DraftRow>;
  /** Publishing checks destination access, quota and the expected ETag in the write transaction. */
  decide(id: string, userId: string, action: "publish" | "reject", now: number): Promise<DraftRow>;
  expireDue(now: number, limit: number, active?: readonly string[]): Promise<number>;
}

export function requirePendingDraft(row: DraftRow, now: number): void {
  const state = row.state === "pending" && row.expires_at <= now ? "expired" : row.state;
  if (state !== "pending")
    throw draftConflict(`Draft is ${state}.${row.superseded_by === null ? "" : ` Successor draft: ${row.superseded_by}.`}`);
}

export function draftConflict(message: string): ApplicationError {
  return new ApplicationError("CONFLICT", 409, message);
}

/** A proposed page needs only a destination its author can see; whoever merges it needs creation rights there. */
export function assertDraftDestination(target: NodeAccess | SpaceAccess | null, spaceId: string, proposes = false): void {
  if (!target || ("spaceId" in target && target.spaceId !== spaceId))
    throw new ApplicationError("NOT_FOUND", 404, "Draft destination not found.");
  const allowed = proposes || (
    "createAtRoot" in target.capabilities
      ? target.capabilities.createAtRoot
      : target.capabilities.createChildren);
  if (!allowed)
    throw new ApplicationError("FORBIDDEN", 403, "Cannot create at the draft destination.");
}

/**
 * Whether a draft changes a page rather than another file. A replacement changes a page when its target was one at
 * intake, by the name it recorded or by the target's original filename, which never changes after upload.
 */
export function changesPage(row: Pick<DraftRow, "kind" | "name">, originalFilename: string | undefined): boolean {
  return row.kind === "create" || isHtmlViewFilename(row.name) || (originalFilename !== undefined && isHtmlViewFilename(originalFilename));
}

/** A page draft needs a page target, and a file draft a target that is still not a page. Without `row` the target must be a page. */
export function requireDraftResource(
  target: ResourceAccess | null,
  capability: "editContent" | "openContent" = "editContent",
  row?: Pick<DraftRow, "kind" | "name">,
) {
  if (!target || target.kind !== "blob")
    throw new ApplicationError("NOT_FOUND", 404, "Draft target not found.");
  if (!target.capabilities[capability])
    throw new ApplicationError("FORBIDDEN", 403, "Cannot edit draft target.");
  const page = row === undefined || changesPage(row, target.originalFilename);
  if (target.availability !== "ready" || isPage(target) !== page)
    throw draftConflict(page ? "Draft target is not an available HTML View." : "Draft target is not an available file, or it became a page.");
  return target;
}

export function isPage(target: Pick<BlobResourceAccess, "node" | "originalFilename">): boolean {
  return isHtmlViewFilename(target.node.name) || isHtmlViewFilename(target.originalFilename);
}
