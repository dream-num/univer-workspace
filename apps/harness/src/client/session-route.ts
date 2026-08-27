/** Opens hash-linked Sessions the signed-in user owns (cwd under their root). */

import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { ISessions } from "@deepseek-ai/dsh-client-runtime/client";
import type { SessionId } from "@deepseek-ai/dsh-client-connection/client";
import { UWH_LOGIN_PATH, UWH_ME_PATH } from "../contract.ts";

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

/**
 * Open a hash-linked session when it belongs to this user: the live list
 * snapshot must carry a summary whose cwd sits under the user's mechanical
 * root directory. Ownership follows the HOST facts, not browser-local state.
 */
async function openHashSession(sessions: ISessions, hash: string): Promise<void> {
  const sessionId = sessionIdFromHash(hash);
  if (sessionId === undefined) return;
  const response = await fetch(UWH_ME_PATH, { headers: { accept: "application/json" } });
  if (response.status === 401) {
    window.location.assign(UWH_LOGIN_PATH);
    return;
  }
  if (!response.ok) return;
  const me = await response.json() as { identity?: { userId?: unknown }; workspace?: { path?: unknown } };
  const root = me.workspace?.path;
  if (typeof root !== "string" || root === "") return;
  const summary = sessions.list.getSnapshot().byId[sessionId as SessionId];
  if (summary === undefined) return;
  const cwd = summary.cwd ?? "";
  if (cwd === root || cwd.startsWith(`${root}/`)) sessions.open(sessionId as never);
}

/** Install the hashchange listener and process the initial URL. */
export function apply(ctx: ClientContext): void {
  const sessions = ctx.sessions as unknown as ISessions;
  const onHashChange = (): void => { void openHashSession(sessions, window.location.hash); };
  window.addEventListener("hashchange", onHashChange);
  onHashChange();
  ctx.effect(() => () => { window.removeEventListener("hashchange", onHashChange); }, "uwh: session hash route");
}
