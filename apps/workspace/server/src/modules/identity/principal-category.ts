import type { PrincipalCategory, PrincipalKind } from "./identity.types.js";

/** The one derivation of a principal's category. A requester without a User row is the anonymous reader. */
export function principalCategory(principal: PrincipalKind | null): PrincipalCategory {
  if (!principal) return "anonymous";
  if (principal.kind === "human") return "human";
  return principal.claimed ? "agent_claimed" : "agent_unclaimed";
}
