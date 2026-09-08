/** One shared, account-scoped recovery request for the mounted Session's cards. */
import { useMemo, useSyncExternalStore } from "react";
import type { UniverTurnFile, UniverTurnMatch } from "../conversation/univer-turn-definition.ts";

interface SessionFiles {
  readonly files: readonly UniverTurnFile[];
  readonly turns: readonly UniverTurnMatch[];
}
const EMPTY: SessionFiles = { files: [], turns: [] };
const entries = new Map<string, ReturnType<typeof createEntry>>();

function createEntry(sessionId: string) {
  let value = EMPTY;
  let controller: AbortController | undefined;
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  const clear = () => {
    controller?.abort();
    value = EMPTY;
    if (entries.get(sessionId) === entry) entries.delete(sessionId);
    notify();
  };
  const entry = {
    getSnapshot: () => value,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        if (!entries.has(sessionId)) entries.set(sessionId, entry);
        window.addEventListener("uwh:workspace-changed", clear);
        const abort = new AbortController();
        controller = abort;
        void fetch(`/univer-workspace/api/session-files?sessionId=${encodeURIComponent(sessionId)}`, { signal: abort.signal })
          .then(async (response) => {
            if (!response.ok) throw new Error(`Session file recovery failed (${response.status})`);
            const data = await response.json() as SessionFiles;
            if (abort.signal.aborted) return;
            value = data;
            notify();
          })
          .catch((error: unknown) => {
            if (!abort.signal.aborted) console.error("[workspace] Unable to restore Session documents", error);
          });
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          controller?.abort();
          window.removeEventListener("uwh:workspace-changed", clear);
          if (entries.get(sessionId) === entry) entries.delete(sessionId);
        }
      };
    },
  };
  return entry;
}

export function useSessionFiles(sessionId: string): SessionFiles {
  const entry = useMemo(() => {
    const existing = entries.get(sessionId);
    if (existing !== undefined) return existing;
    const created = createEntry(sessionId);
    entries.set(sessionId, created);
    return created;
  }, [sessionId]);
  return useSyncExternalStore(entry.subscribe, entry.getSnapshot, () => EMPTY);
}
