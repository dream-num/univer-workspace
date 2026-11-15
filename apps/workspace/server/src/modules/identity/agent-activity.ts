import type { IdentityRepository, StoredPrincipal } from "./identity.repository.js";

export const AGENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ACTIVITY_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function recordAgentActivity(
  repository: IdentityRepository,
  target: Parameters<IdentityRepository["touchUnclaimedAgent"]>[0],
  at: number,
): void {
  repository.touchUnclaimedAgent(target, at, at - ACTIVITY_INTERVAL_MS, at + AGENT_TTL_MS);
}

/** A banned agent cannot authenticate. An expired unclaimed agent recovers on authentication. */
export function authenticateStoredPrincipal<T extends StoredPrincipal>(
  repository: IdentityRepository,
  stored: T | null,
  at: number,
): T | null {
  if (!stored || stored.banned) return null;
  if (stored.kind === "agent" && !stored.claimed) recordAgentActivity(repository, { userId: stored.id }, at);
  return stored;
}
