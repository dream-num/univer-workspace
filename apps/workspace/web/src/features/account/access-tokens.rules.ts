import type { components } from "../../../../generated/http/schema.js";

export type AccessTier = components["schemas"]["AccessTier"];
type McpScope = components["schemas"]["McpScope"];

/** The same table as the server's `ACCESS_TIER_SCOPES`; the token API still takes explicit scopes. */
export const accessTierScopes = {
  read: ["read"],
  read_write: ["read", "write", "publish", "worktree:merge"],
} satisfies Record<AccessTier, McpScope[]>;

export const defaultAccessTier: AccessTier = "read_write";

export function isAccessTokenExpired(expiresAt: number | null, now: number): boolean {
  return expiresAt !== null && expiresAt < now;
}

/** Counts code points like the server, so 100 emoji fit where 100 UTF-16 units would not. */
export function isAccessTokenName(name: string): boolean {
  const length = [...name.trim()].length;
  return length > 0 && length <= 100;
}
