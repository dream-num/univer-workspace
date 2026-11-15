import { ApplicationError } from "../../middleware/errors.js";
import type { NodeAccess, SpaceAccess } from "../access/index.js";

export function requireTeam(space: SpaceAccess | null): SpaceAccess {
  if (!space || space.type !== "team") throw notFound();
  return space;
}

export function requireManageMembers(space: SpaceAccess | null): SpaceAccess {
  const team = requireTeam(space);
  if (!team.capabilities.manageMembers) throw forbidden();
  return team;
}

export function requireShare(node: NodeAccess | null): NodeAccess {
  if (!node || node.spaceType !== "personal") throw notFound();
  if (!node.capabilities.share) throw forbidden();
  return node;
}

export function forbidden(): ApplicationError {
  return new ApplicationError(
    "FORBIDDEN",
    403,
    "The current user cannot perform this action."
  );
}

export function notFound(): ApplicationError {
  return new ApplicationError(
    "NOT_FOUND",
    404,
    "The resource was not found."
  );
}

export function conflict(message: string): ApplicationError {
  return new ApplicationError("CONFLICT", 409, message);
}
