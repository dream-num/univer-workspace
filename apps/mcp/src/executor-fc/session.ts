import { deriveSessionId } from "./affinity.js";
import type { EpochStore } from "./epoch-store.js";

/**
 * Deterministic FC Session IDs for HeaderField affinity.
 * Design: docs/design/workspace-mcp/fc-headerfield.zh-CN.md section 3.3.
 */
export interface SessionRenewal {
  readonly epoch: number;
  readonly sessionId: string;
}

export interface SessionAffinity {
  /** The Session ID for the key's current epoch. */
  sessionId(key: string): Promise<string>;
  epoch(key: string): Promise<number>;
  /**
   * Advances the key's epoch and returns the new Session ID. Concurrent callers on the same
   * key share one increment, so a burst of platform 401s converges on one new Session.
   */
  renew(key: string): Promise<SessionRenewal>;
}

export interface SessionAffinityOptions {
  readonly epochs: EpochStore;
  /** Override for tests or for a future derivation change. Defaults to `deriveSessionId`. */
  readonly derive?: (key: string, epoch: number) => string;
}

export function createSessionAffinity(options: SessionAffinityOptions): SessionAffinity {
  const derive = options.derive ?? deriveSessionId;
  const renewing = new Map<string, Promise<SessionRenewal>>();

  const renew = (key: string): Promise<SessionRenewal> => {
    const pending = renewing.get(key);
    if (pending !== undefined) return pending;
    const started: Promise<SessionRenewal> = options.epochs
      .increment(key)
      .then((epoch) => ({ epoch, sessionId: derive(key, epoch) }));
    const settled = started.finally(() => {
      if (renewing.get(key) === settled) renewing.delete(key);
    });
    renewing.set(key, settled);
    return settled;
  };

  return {
    async epoch(key) {
      return await options.epochs.get(key);
    },
    async sessionId(key) {
      return derive(key, await options.epochs.get(key));
    },
    renew,
  };
}
