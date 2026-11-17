import type { StoredPrincipal } from "./identity.repository.js";

export const AGENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ACTIVITY_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function agentActivityWindow(at: number) {
  return { at, staleBefore: at - ACTIVITY_INTERVAL_MS, expiresAt: at + AGENT_TTL_MS };
}

/**
 * A banned agent cannot authenticate. Any other agent records the activity, so its owner sees when
 * it last worked, and an expired unclaimed agent recovers.
 */
export function authenticateStoredPrincipal<T extends StoredPrincipal>(stored: T | null, at: number) {
  if (!stored || stored.banned) return null;
  const activity = stored.kind === "agent" ? agentActivityWindow(at) : null;
  return { principal: stored, activity };
}
