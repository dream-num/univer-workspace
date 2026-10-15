import type { components } from "../../../../generated/http/schema.js";

type Space = Pick<components["schemas"]["SpaceView"], "type" | "name"> &
  Partial<Pick<components["schemas"]["SpaceView"], "owner">>;

/**
 * Name shown for a Space in the repository view. GitHub names a personal
 * Space after its owner, so the stored `name` ("weimin 的个人空间") is only
 * used for team spaces. Never substitute the viewer for a known owner.
 */
export function spaceDisplayName(
  space: Space | undefined,
  t: (key: "personalSpace") => string,
  username?: string | undefined,
): string | undefined {
  if (!space) return undefined;
  if (space.type !== "personal") return space.name;
  return space.owner?.username ?? username ?? t("personalSpace");
}
