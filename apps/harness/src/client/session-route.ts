/** Opens locally recorded Sessions from stable hash links without a server route. */

import type { ClientContext, ISessions } from "@deepseek-ai/dsh-client-runtime/client";
import type { SessionId } from "@deepseek-ai/dsh-client-connection/client";
import { UWH_LOGIN_PATH, UWH_ME_PATH } from "../contract.ts";
import { hasCreatedSession, readLocalState } from "./local-state.ts";

/** Hash prefix used by harness Session links. */
const SESSION_HASH_PREFIX = "#/s/";

/** Client plugin name. */
export const name = "univer-workspace-harness-session-route";

/** Required browser service. */
export const inject = ["sessions"];

/** Read a Session ID from the current hash. */
function sessionIdFromHash(hash: string): string | undefined {
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

/** Resolve the authenticated local list before opening a hash link. */
async function openHashSession(sessions: ISessions, hash: string): Promise<void> {
  const sessionId = sessionIdFromHash(hash);
  if (sessionId === undefined) return;
  const response = await fetch(UWH_ME_PATH, { headers: { accept: "application/json" } });
  if (response.status === 401) {
    window.location.assign(UWH_LOGIN_PATH);
    return;
  }
  if (!response.ok) return;
  const me = await response.json() as { identity?: { userId?: unknown } };
  const userId = me.identity?.userId;
  if (typeof userId !== "string") return;
  const state = readLocalState(window.localStorage, userId);
  if (hasCreatedSession(state, sessionId)) sessions.open(sessionId as SessionId);
}

/** Install the hashchange listener and process the initial URL. */
export function apply(ctx: ClientContext): void {
  const sessions = ctx.sessions as unknown as ISessions;
  const onHashChange = (): void => { void openHashSession(sessions, window.location.hash); };
  window.addEventListener("hashchange", onHashChange);
  onHashChange();
  ctx.effect(() => () => { window.removeEventListener("hashchange", onHashChange); }, "uwh: session hash route");
}
