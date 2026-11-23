import { ApplicationError } from "../../../middleware/errors.js";
import type { PostgresAccessRepository } from "./access.repository.js";

type TargetAccess = Pick<PostgresAccessRepository, "readSpaceAccess" | "readNodeAccess">;

export async function checkCreateTarget(access: TargetAccess, actorUserId: string, spaceId: string, parentNodeId: string | null) {
  if (parentNodeId === null) {
    const space = await access.readSpaceAccess(actorUserId, spaceId);
    if (!space) return "notFound";
    return space.capabilities.createAtRoot ? "ok" : "forbidden";
  }
  const parent = await access.readNodeAccess(actorUserId, parentNodeId);
  if (!parent || parent.spaceId !== spaceId) return "notFound";
  return parent.capabilities.createChildren ? "ok" : "forbidden";
}

/** A Team Worktree takes a proposal from any Space Member, so its target only has to exist in the Space. */
export async function checkProposalTarget(access: TargetAccess, actorUserId: string, spaceId: string, parentNodeId: string | null) {
  const space = await access.readSpaceAccess(actorUserId, spaceId);
  if (!space) return "notFound";
  if (!space.member) return "forbidden";
  if (parentNodeId === null) return "ok";
  return (await access.readNodeAccess(actorUserId, parentNodeId))?.spaceId === spaceId ? "ok" : "notFound";
}

export async function requireResourceTarget(access: TargetAccess, actorUserId: string, spaceId: string, parentNodeId: string | null, forbiddenMessage: string): Promise<void> {
  const status = await checkCreateTarget(access, actorUserId, spaceId, parentNodeId);
  if (status === "notFound") throw new ApplicationError("NOT_FOUND", 404, "The resource was not found.");
  if (status === "forbidden") throw new ApplicationError("FORBIDDEN", 403, forbiddenMessage);
}
