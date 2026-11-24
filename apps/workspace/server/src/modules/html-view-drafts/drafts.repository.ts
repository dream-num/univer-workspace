import { isHtmlViewFilename } from "@univerjs-labs/html-view";
import type { NodeAccess, ResourceAccess, SpaceAccess } from "../access/index.js";
import type { StoredBlob } from "../../integrations/blob/blob-store.js";
import { ApplicationError } from "../../middleware/errors.js";
import type { DraftRow } from "./drafts.types.js";

export interface HtmlViewDraftsRepository {
  pendingForWorktree(worktreeId: string): Promise<DraftRow[]>;
  /** Every draft attached to the Worktree except receiving and superseded ones, oldest first. */
  listForWorktree(worktreeId: string): Promise<DraftRow[]>;
  find(id: string): Promise<DraftRow | undefined>;
  findKey(userId: string, key: string): Promise<DraftRow | undefined>;
  currentEtag(resourceId: string): Promise<string | undefined>;
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

export function assertDraftDestination(target: NodeAccess | SpaceAccess | null, spaceId: string): void {
  if (!target || ("spaceId" in target && target.spaceId !== spaceId))
    throw new ApplicationError("NOT_FOUND", 404, "Draft destination not found.");
  const allowed =
    "createAtRoot" in target.capabilities
      ? target.capabilities.createAtRoot
      : target.capabilities.createChildren;
  if (!allowed)
    throw new ApplicationError("FORBIDDEN", 403, "Cannot create at the draft destination.");
}

export function requireDraftResource(target: ResourceAccess | null) {
  if (!target || target.kind !== "blob")
    throw new ApplicationError("NOT_FOUND", 404, "Draft target not found.");
  if (!target.capabilities.editContent)
    throw new ApplicationError("FORBIDDEN", 403, "Cannot edit draft target.");
  if (
    target.availability !== "ready" ||
    !(isHtmlViewFilename(target.node.name) || isHtmlViewFilename(target.originalFilename))
  )
    throw draftConflict("Draft target is not an available HTML View.");
  return target;
}
