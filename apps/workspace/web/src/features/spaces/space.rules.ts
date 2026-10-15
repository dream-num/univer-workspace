import type { components } from "../../../../generated/http/schema.js";

type Space = Pick<components["schemas"]["SpaceView"], "type">;

export function spaceSupportsIssues(space: Space): boolean {
  return space.type === "team";
}

export function spaceSupportsMembers(space: Space): boolean {
  return space.type === "team";
}
