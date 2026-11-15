import type { NodeAccess, ResourceAccess, SpaceAccess } from "../access/index.js";
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
  find(id: string): Promise<DraftRow | undefined>;
  findKey(userId: string, key: string): Promise<DraftRow | undefined>;
  target(spaceId: string, name: string): Promise<SkillTarget>;
  personalNameConflict(userId: string, spaceId: string, name: string): Promise<boolean>;
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
  ): Promise<{ row: DraftRow; created: boolean }>;
  markPending(id: string, now: number): Promise<DraftRow>;
  /** Publishing rechecks the current target ACL, quota and replacement base in the write transaction. */
  decide(
    id: string,
    userId: string,
    action: "publish" | "reject",
    now: number,
  ): Promise<DraftRow>;
  expireDue(now: number, limit: number, active?: readonly string[]): Promise<number>;
}

export function assertSkillDestination(userId: string, space: SpaceAccess | null): void {
  if (!space) throw new ApplicationError("NOT_FOUND", 404, "Draft destination not found.");
  if ((space.type === "personal" && space.ownerUserId !== userId) || !space.capabilities.createAtRoot)
    throw new ApplicationError("FORBIDDEN", 403, "Cannot create Skills at this destination.");
}

export function assertSkillFolder(folder: NodeAccess | null): void {
  if (!folder?.capabilities.createChildren)
    throw new ApplicationError("FORBIDDEN", 403, "Cannot edit the Skill folder.");
}

export function assertSkillFile(resource: ResourceAccess | null, nodeId: string): void {
  if (!resource?.capabilities.editContent || resource.node.id !== nodeId || !resource.node.capabilities.trash)
    throw new ApplicationError("FORBIDDEN", 403, "Cannot replace Skill files.");
}
