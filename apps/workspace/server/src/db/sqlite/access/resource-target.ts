import { ApplicationError } from "../../../middleware/errors.js";
import type { SqliteAccessRepository } from "./access.repository.js";

type TargetAccess = Pick<SqliteAccessRepository, "readSpaceAccess" | "readNodeAccess">;

export function checkCreateTarget(access: TargetAccess, actorUserId: string, spaceId: string, parentNodeId: string | null) {
  if (parentNodeId === null) {
    const space = access.readSpaceAccess(actorUserId, spaceId);
    if (!space) return "notFound";
    return space.capabilities.createAtRoot ? "ok" : "forbidden";
  }
  const parent = access.readNodeAccess(actorUserId, parentNodeId);
  if (!parent || parent.spaceId !== spaceId) return "notFound";
  return parent.capabilities.createChildren ? "ok" : "forbidden";
}

/** A Team Worktree takes a proposal from anyone who may propose in its Space, so its target only has to exist there. */
export function checkProposalTarget(access: TargetAccess, actorUserId: string, spaceId: string, parentNodeId: string | null) {
  const space = access.readSpaceAccess(actorUserId, spaceId);
  if (!space) return "notFound";
  if (!space.capabilities.propose) return "forbidden";
  if (parentNodeId === null) return "ok";
  return access.readNodeAccess(actorUserId, parentNodeId)?.spaceId === spaceId ? "ok" : "notFound";
}

export function requireResourceTarget(access: TargetAccess, actorUserId: string, spaceId: string, parentNodeId: string | null, forbiddenMessage: string): void {
  const status = checkCreateTarget(access, actorUserId, spaceId, parentNodeId);
  if (status === "notFound") throw new ApplicationError("NOT_FOUND", 404, "The resource was not found.");
  if (status === "forbidden") throw new ApplicationError("FORBIDDEN", 403, forbiddenMessage);
}
