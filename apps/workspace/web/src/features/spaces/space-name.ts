import type { components } from "../../../../generated/http/schema.js";

type Space = Pick<components["schemas"]["SpaceView"], "type" | "name">;

/**
 * Name shown for a Space in the repository view. GitHub names a personal
 * repository after its owner, so the stored `name` ("weimin 的个人空间") is only
 * used for team spaces; without a signed-in user the localized fallback shows.
 */
export function spaceDisplayName(
  space: Space | undefined,
  t: (key: "personalSpace") => string,
  username?: string | undefined,
): string | undefined {
  if (!space) return undefined;
  if (space.type !== "personal") return space.name;
  return username ?? t("personalSpace");
}
