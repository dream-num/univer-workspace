/**
 * Browser-local session state partitioned by Workspace user id.
 *
 * The harness list deliberately does NOT trust the Host session list as its
 * content: it shows only sessions this user created in THIS browser plus the
 * template forks this user materialized HERE. State lives in `localStorage`
 * under `univer-workspace-harness:v1:<userId>`.
 *
 * These helpers are pure over a minimal {@link StorageLike} so they are
 * unit-testable without jsdom.
 * @module @univerjs/univer-workspace-harness/client/local-state
 */

import {
  emptyUwhState,
  UWH_STATE_VERSION,
  stateKeyFor,
  type UwhState,
} from "../contract.ts";

/** Minimal storage surface (satisfied by `window.localStorage` and by tests). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Read and validate one user's browser-local state. */
export function readLocalState(storage: StorageLike, userId: string): UwhState {
  const raw = storage.getItem(stateKeyFor(userId));
  if (raw === null) return emptyUwhState();
  try {
    const parsed = JSON.parse(raw) as Partial<UwhState>;
    if (parsed === null || typeof parsed !== "object" || parsed.version !== UWH_STATE_VERSION) {
      return emptyUwhState();
    }
    return {
      version: UWH_STATE_VERSION,
      templateForks: typeof parsed.templateForks === "object" && parsed.templateForks !== null
        ? parsed.templateForks
        : {},
      createdSessionIds: Array.isArray(parsed.createdSessionIds) ? parsed.createdSessionIds : [],
    };
  } catch {
    return emptyUwhState();
  }
}

/** Persist one user's browser-local state. */
export function writeLocalState(storage: StorageLike, userId: string, state: UwhState): void {
  storage.setItem(stateKeyFor(userId), JSON.stringify(state));
}

/** Append a session id to the created list (head, order-preserving; no-ops when already present). */
export function recordCreatedSession(state: UwhState, sessionId: string): UwhState {
  if (state.createdSessionIds.includes(sessionId)) return state;
  return { ...state, createdSessionIds: [sessionId, ...state.createdSessionIds] };
}

/** Record a template fork for a key and append it to the created list. */
export function recordTemplateFork(state: UwhState, key: string, sessionId: string): UwhState {
  const next = recordCreatedSession(state, sessionId);
  if (next.templateForks[key] === sessionId) return next;
  return { ...next, templateForks: { ...next.templateForks, [key]: sessionId } };
}

/** The forked session id a template key already resolved to, if any. */
export function templateForkOf(state: UwhState, key: string): string | undefined {
  return state.templateForks[key];
}

/** Whether a session id is in the user's created list. */
export function hasCreatedSession(state: UwhState, sessionId: string): boolean {
  return state.createdSessionIds.includes(sessionId);
}
