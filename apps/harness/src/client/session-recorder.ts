/** Records native DSH-created Sessions in the authenticated user's browser list. */

import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { ConnectionHandle } from "@deepseek-ai/dsh-client-connection/client";
import { UWH_ME_PATH, type UwhMeView } from "../contract.ts";
import { readLocalState, recordCreatedSession, writeLocalState } from "./local-state.ts";

/** Client plugin name. */
export const name = "univer-workspace-harness-session-recorder";

/** Required browser service. */
export const inject = ["connection"];

/** Record a successful native session creation for the current user's Workspace. */
export function apply(ctx: ClientContext): void {
  const api = (ctx.get("connection") as ConnectionHandle).api;
  const original = api.sessions.create;
  let mePromise: Promise<UwhMeView | undefined> | undefined;

  const loadMe = (): Promise<UwhMeView | undefined> => {
    if (mePromise !== undefined) return mePromise;
    mePromise = fetch(UWH_ME_PATH, { headers: { accept: "application/json" } })
      .then(async response => response.ok ? await response.json() as UwhMeView : undefined)
      .catch(() => undefined);
    return mePromise;
  };

  api.sessions.create = async (payload, signal) => {
    const result = await original(payload, signal);
    const sessionId = result.result.ok ? result.result.value.sessionId : undefined;
    if (sessionId !== undefined && payload.workspaceId !== undefined) {
      const me = await loadMe();
      if (me !== undefined && me.workspace.workspaceId === payload.workspaceId) {
        const state = readLocalState(window.localStorage, me.identity.userId);
        writeLocalState(window.localStorage, me.identity.userId, recordCreatedSession(state, sessionId));
      }
    }
    return result;
  };
  ctx.effect(() => () => { api.sessions.create = original; }, "uwh: native session recorder");
}
