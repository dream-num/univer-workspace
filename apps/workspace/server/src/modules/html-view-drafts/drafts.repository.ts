import type { StoredBlob } from "../../integrations/blob/blob-store.js";
import { ApplicationError } from "../../middleware/errors.js";
import type { DraftRow } from "./drafts.types.js";

export interface HtmlViewDraftsRepository {
  find(id: string): DraftRow | undefined;
  findKey(userId: string, key: string): DraftRow | undefined;
  currentEtag(resourceId: string): string | undefined;
  reserve(
    input: Pick<
      DraftRow,
      | "author_user_id"
      | "idempotency_key"
      | "kind"
      | "space_id"
      | "parent_node_id"
      | "name"
      | "target_resource_id"
      | "base_etag"
      | "sha256"
      | "byte_size"
    >,
    now: number,
  ): DraftRow;
  markPending(id: string, stored: StoredBlob, now: number): DraftRow;
  decide(id: string, userId: string, action: "publish" | "reject", now: number): DraftRow;
  expireDue(now: number, limit: number, active?: readonly string[]): number;
}

export function draftConflict(message: string): ApplicationError {
  return new ApplicationError("CONFLICT", 409, message);
}
