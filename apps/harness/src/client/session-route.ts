/** Hash routing for the native DSH Session selection. */

import type { ClientContext, ISessions } from "@deepseek-ai/dsh-client-runtime/client";
import type { SessionId } from "@deepseek-ai/dsh-client-connection/client";

/** Hash prefix used by Harness Session links. */
export const SESSION_HASH_PREFIX = "#/s/";

/** Client plugin name. */
export const name = "univer-workspace-harness-session-route";

/** Required browser service. */
export const inject = ["sessions"];

/** Build the canonical URL fragment for one Session. */
export function sessionHashForId(sessionId: string): string {
  return `${SESSION_HASH_PREFIX}${encodeURIComponent(sessionId)}`;
}

/** Read a Session ID from the current hash. */
export function sessionIdFromHash(hash: string): string | undefined {
  if (!hash.startsWith(SESSION_HASH_PREFIX)) return undefined;
  const encoded = hash.slice(SESSION_HASH_PREFIX.length);
  if (encoded === "") return undefined;
  try {
    const sessionId = decodeURIComponent(encoded);
    return sessionId === "" ? undefined : sessionId;
  } catch {
    return undefined;
  }
}

/**
 * Synchronize the browser fragment with DSH's authoritative Session list.
 *
 * The authenticated carrier already projects the list and downlink to the
 * signed-in account.  This router therefore does not fetch identity or wrap
 * the Session store; it only translates a listed id to `sessions.open()` and
 * reflects the native `current` selection back into the URL.  Keeping both
 * directions on the same synchronous store notification preserves the DSH
 * `startSession → connectWorkspace → sessions.create/open` lifecycle.
 */
export function apply(ctx: ClientContext): void {
  const sessions = ctx.sessions as unknown as ISessions;
  let disposed = false;
  let listCurrent = sessions.list.getSnapshot().current;
  let hashNavigation = false;
  let opening = false;

  /** Open a URL target once the authenticated native list has published it. */
  const openHashTarget = (): void => {
    if (disposed || opening) return;
    const target = sessionIdFromHash(window.location.hash);
    if (target === undefined) {
      hashNavigation = false;
      return;
    }
    const snapshot = sessions.list.getSnapshot();
    if (snapshot.byId[target as SessionId] === undefined) return;
    if (snapshot.current === target) {
      hashNavigation = false;
      return;
    }
    opening = true;
    try {
      sessions.open(target as SessionId);
    } finally {
      opening = false;
      if (sessions.list.getSnapshot().current === target) hashNavigation = false;
    }
  };

  /** Reflect an authoritative native selection, including sidebar clicks. */
  const projectCurrent = (): void => {
    if (disposed) return;
    const snapshot = sessions.list.getSnapshot();
    const current = snapshot.current;
    const changed = current !== listCurrent;
    listCurrent = current;

    // A hash navigation owns the next selection. Keep the requested fragment
    // while its row is still arriving through the downlink/list baseline.
    if (hashNavigation) {
      const target = sessionIdFromHash(window.location.hash);
      if (target === undefined) {
        hashNavigation = false;
      } else if (snapshot.byId[target as SessionId] !== undefined) {
        openHashTarget();
        return;
      } else if (changed && current !== undefined && snapshot.byId[current] !== undefined) {
        // The requested id is not in the authenticated list, while a native
        // action has selected a real row. Treat the stale/unauthorized hash
        // as inert instead of pinning the router to it forever.
        hashNavigation = false;
      } else {
        return;
      }
    }

    // A native DSH action (sidebar row, New Session, reconnect restoration)
    // changed the authoritative current id. Project that id immediately; do
    // not read the previous hash as an instruction and undo the action.
    if (changed && current !== undefined && snapshot.byId[current] !== undefined) {
      const nextHash = sessionHashForId(String(current));
      if (window.location.hash !== nextHash) window.location.hash = nextHash;
    }
  };

  const onHashChange = (): void => {
    hashNavigation = sessionIdFromHash(window.location.hash) !== undefined;
    openHashTarget();
  };
  window.addEventListener("hashchange", onHashChange);
  const unsubscribe = sessions.list.subscribe(projectCurrent);
  onHashChange();
  projectCurrent();
  ctx.effect(() => () => {
    disposed = true;
    window.removeEventListener("hashchange", onHashChange);
    unsubscribe();
  }, "uwh: session hash route");
}
