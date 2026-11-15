import { ApplicationError } from "../../middleware/errors.js";
import type { BaseFile, DraftRow } from "./drafts.types.js";

export function draftConflict(message: string): ApplicationError {
  return new ApplicationError("CONFLICT", 409, message);
}

export interface CurrentFile extends BaseFile {
  nodeId: string;
  objectKey: string;
  byteSize: number;
  mediaType: string;
}

export interface SkillTarget {
  folderNodeId: string | null;
  files: CurrentFile[];
  nonEmpty: boolean;
}

export interface SkillDraftsRepository {
  find(id: string): DraftRow | undefined;
  findKey(userId: string, key: string): DraftRow | undefined;
  target(spaceId: string, name: string): SkillTarget;
  personalNameConflict(userId: string, spaceId: string, name: string): boolean;
  reserve(
    input: Pick<
      DraftRow,
      | "author_user_id"
      | "idempotency_key"
      | "intent_sha256"
      | "space_id"
      | "name"
      | "target_folder_node_id"
      | "files"
      | "base"
      | "keep"
      | "scan"
      | "review"
      | "unverified_review_count"
      | "source"
    >,
    now: number,
  ): { row: DraftRow; created: boolean };
  markPending(id: string, now: number): DraftRow;
  decide(
    id: string,
    userId: string,
    action: "publish" | "reject",
    now: number,
    authorize?: (row: DraftRow, target: SkillTarget) => void,
  ): DraftRow;
  expireDue(now: number, limit: number, active?: readonly string[]): number;
}
