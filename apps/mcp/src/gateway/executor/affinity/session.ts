import { createHash } from "node:crypto";
import type { EpochStore } from "./epoch-store.js";

// Deterministic platform Session IDs for header session affinity.
// Design: docs/design/workspace-mcp/fc-headerfield.zh-CN.md sections 3.2 and 3.3.

/**
 * `k` + the first 32 hex characters of sha256(`<key>:<epoch>`), which fits FC's HeaderField value
 * rules (1-64 characters, letter first, `[A-Za-z0-9_-]`). Deterministic, so every gateway replica
 * derives the same Session for the same key and epoch.
 */
export function deriveSessionId(key: string, epoch: number): string {
  if (!Number.isSafeInteger(epoch) || epoch < 0)
    throw new Error("An affinity epoch must be a non-negative safe integer");
  return `k${createHash("sha256").update(`${key}:${epoch}`).digest("hex").slice(0, 32)}`;
}

export interface SessionRenewal {
  readonly epoch: number;
  readonly sessionId: string;
}

export interface SessionAffinity {
  /** The Session ID for the key's current epoch. */
  sessionId(key: string): Promise<string>;
  /**
   * Advances the key's epoch and returns the new Session ID. Concurrent callers on the same
   * key share one increment, so a burst of platform 401s converges on one new Session.
   */
  renew(key: string): Promise<SessionRenewal>;
}

export function createSessionAffinity(epochs: EpochStore): SessionAffinity {
  const renewing = new Map<string, Promise<SessionRenewal>>();

  const renew = (key: string): Promise<SessionRenewal> => {
    const pending = renewing.get(key);
    if (pending !== undefined) return pending;
    const started: Promise<SessionRenewal> = epochs
      .increment(key)
      .then((epoch) => ({ epoch, sessionId: deriveSessionId(key, epoch) }));
    const settled = started.finally(() => {
      if (renewing.get(key) === settled) renewing.delete(key);
    });
    renewing.set(key, settled);
    return settled;
  };

  return {
    async sessionId(key) {
      return deriveSessionId(key, await epochs.get(key));
    },
    renew,
  };
}
