/**
 * Harness-owned input route for the authenticated browser.
 *
 * The route checks the signed harness session cookie and the DSH Workspace
 * membership before delegating the prompt to the normal ApiProxy. The DSH
 * source tree remains unchanged; the browser harness plugin routes its prompt
 * calls through this endpoint.
 * @module @univerjs/univer-workspace-harness/session-input-guard
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context } from "@deepseek-ai/cordis";
import { RpcId, type RpcResult } from "@deepseek-ai/dsh-host-apiproxy/api";
import { sessionPromptRequestSchema } from "@deepseek-ai/dsh-host-apiproxy/api/sessions.schema";
import type { SessionId } from "@deepseek-ai/dsh-session";
import type {} from "@deepseek-ai/dsh-host-apiproxy";
import type {} from "@deepseek-ai/dsh-host-webserver";
import type {} from "@deepseek-ai/dsh-workspace";
import { parseCookies, parseSessionCookie } from "./auth.ts";
import { isUserScopedPath } from "./identity.ts";
import { UWH_SESSION_PROMPT_PATH } from "./contract.ts";

/** Configuration needed by the harness-owned prompt route. */
export interface Config {
  /** Root under which the authenticated user's default Workspace is derived. */
  workspaceRoot: string;
  /** Signed harness-session cookie name. */
  sessionCookieName: string;
  /** Secret used to authenticate the harness-session cookie. */
  sessionSecret: string;
}

/** Stable plugin name. */
export const name = "univer-workspace-harness-session-input-guard";

/** Host services used by the guarded route. */
export const inject = ["webServer", "apiProxy", "workspaceRegistry"];

/** Maximum JSON body accepted by the harness-owned prompt route. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

/** Write a JSON response. */
function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/** Read one bounded request body. */
async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) throw new Error("prompt request body is too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

/** Return a typed business denial. */
function denied(sessionId: SessionId, message: string): RpcResult<never> {
  return {
    ok: false,
    error: { code: "session-not-found", message, details: { sessionId } },
  };
}

/** Return whether the authenticated User's scope contains the Session. */
export function sessionBelongsToUser(
  workspaceRegistry: { list(): readonly { path: string; sessionIds: readonly string[] }[] },
  workspaceRoot: string,
  userId: string,
  sessionId: string,
): boolean {
  return workspaceRegistry.list().some(workspace =>
    isUserScopedPath(workspaceRoot, userId, workspace.path)
    && workspace.sessionIds.includes(sessionId),
  );
}

/** Build the harness-owned prompt handler. */
export function createSessionPromptHandler(ctx: Context, config: Config): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res): Promise<void> => {
    if (req.method !== "POST") {
      jsonResponse(res, 405, { error: "method_not_allowed" });
      return;
    }

    const identity = parseSessionCookie(
      parseCookies(req.headers.cookie).get(config.sessionCookieName),
      config.sessionSecret,
    );
    if (identity === undefined) {
      jsonResponse(res, 401, { error: "missing_or_invalid_session" });
      return;
    }

    let parsed: ReturnType<typeof sessionPromptRequestSchema.safeParse>;
    try {
      parsed = sessionPromptRequestSchema.safeParse(await readBody(req));
    } catch (error: unknown) {
      jsonResponse(res, 400, { error: "invalid_prompt_request", detail: String(error) });
      return;
    }
    if (!parsed.success) {
      jsonResponse(res, 400, { error: "invalid_prompt_request", detail: parsed.error.message });
      return;
    }

    const { sessionId } = parsed.data;
    if (!sessionBelongsToUser(ctx.workspaceRegistry, config.workspaceRoot, identity.userId, sessionId)) {
      jsonResponse(res, 200, denied(sessionId, "the Session does not belong to the authenticated user"));
      return;
    }

    const response = await ctx.apiProxy.sessions.prompt({
      rpcId: RpcId(randomUUID()),
      payload: parsed.data,
    });
    jsonResponse(res, 200, response.result);
  };
}

/** Register the harness-owned guarded prompt route. */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(
    () => ctx.webServer.register({
      kind: "exact",
      path: UWH_SESSION_PROMPT_PATH,
      handler: createSessionPromptHandler(ctx, config),
    }),
    "uwh: guarded session prompt route",
  );
}
