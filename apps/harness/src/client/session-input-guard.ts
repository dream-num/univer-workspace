/** Routes browser prompt calls through the authenticated harness-owned host route. */

import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { ConnectionHandle } from "@deepseek-ai/dsh-client-connection/client";
import { RpcId, type ResponseValue, type RpcResponse, type RpcResult } from "@deepseek-ai/dsh-host-apiproxy/api";
import { UWH_SESSION_PROMPT_PATH } from "../contract.ts";

/** Client plugin name. */
export const name = "univer-workspace-harness-session-input-guard";

/** Required browser service. */
export const inject = ["connection"];

/** Route prompt calls through the harness-owned authenticated endpoint. */
export function apply(ctx: ClientContext): void {
  const api = (ctx.get("connection") as ConnectionHandle).api;
  const original = api.sessions.prompt;
  api.sessions.prompt = async (payload, signal): Promise<RpcResponse<ResponseValue<"session.prompt">>> => {
    const response = await fetch(UWH_SESSION_PROMPT_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok) throw new Error(`univer-workspace-harness: guarded prompt route answered ${response.status}`);
    const result = await response.json() as RpcResult<ResponseValue<"session.prompt">>;
    return { rpcId: RpcId(crypto.randomUUID()), result };
  };
  ctx.effect(() => () => { api.sessions.prompt = original; }, "uwh: guarded prompt client wrapper");
}
