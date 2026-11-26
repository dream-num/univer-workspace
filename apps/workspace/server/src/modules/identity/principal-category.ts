import type { Principal, PrincipalCategory, PrincipalKind } from "./identity.types.js";

/** The one derivation of a principal's category. A requester without a User row is the anonymous reader. */
export function principalCategory(principal: PrincipalKind): Exclude<PrincipalCategory, "anonymous">;
export function principalCategory(principal: PrincipalKind | null): PrincipalCategory;
export function principalCategory(principal: PrincipalKind | null): PrincipalCategory {
  if (!principal) return "anonymous";
  if (principal.kind === "human") return "human";
  return principal.claimed ? "agent_claimed" : "agent_unclaimed";
}

/** A person in the Browser. The kind decides, because an agent session issued by the earlier guest card also has the browser write source. */
export function personInBrowser(principal: Principal): boolean {
  return principal.user.kind === "human" && principal.writeSource === "browser" && !principal.tokenIssued;
}
