/**
 * Local Web Harness connection host.
 *
 * This plugin exposes one process-wide remote Workspace connection through
 * Device Authorization. It does not authenticate local browser users or
 * filter DSH state per request; origin/user isolation is established before
 * startup by selecting an identity-specific DSH_HOME.
 *
 * @module @univerjs/univer-workspace-harness
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import type {} from "@deepseek-ai/dsh-host-webserver";
import {
  UWH_DEVICE_COMPLETE_PATH,
  UWH_DEVICE_LOGOUT_PATH,
  UWH_DEVICE_START_PATH,
  UWH_SESSION_PROMPT_PATH,
} from "./contract.ts";
import {
  completeDeviceAuthorization,
  startDeviceAuthorization,
  type DeviceAuthorizationStart,
} from "./device-authorization.ts";
import * as workspaceAuthProvider from "./workspace-auth-provider.ts";
import { responseErrorBody } from "./diagnostics.ts";
import { sessionPromptRequestSchema } from "./dsh-compat.ts";

export {
  completeDeviceAuthorization,
  startDeviceAuthorization,
  type DeviceAuthorizationCompletion,
  type DeviceAuthorizationStart,
} from "./device-authorization.ts";
export {
  CONNECTION_STATE_VERSION,
  canonicalWorkspaceOrigin,
  connectionIdentityKey,
  parseConnectionState,
  readConnectionState,
  readConnectionStateSync,
  runtimeHomeFor,
  writeConnectionState,
  type WorkspaceConnection,
  type WorkspaceConnectionState,
} from "./connection-state.ts";
export {
  isDirectSha256Child,
  isUserScopedPath,
  SHA_256_HEX_LENGTH,
  spaceDirectoryName,
  spaceDirectoryPath,
  workspaceOriginName,
  workspacePathFor,
  workspacePathForOrigin,
  workspacePathName,
} from "./identity.ts";
export {
  WorkspaceAuthService,
  WORKSPACE_SESSION_COOKIE,
  type WorkspaceHttpClient,
} from "./workspace-auth.ts";

export interface Config {
  /** Default remote Workspace origin, editable in Settings before login. */
  workspaceOrigin: string;
  /** Local browser origin used only for same-origin route validation. */
  publicOrigin: string;
  /** Shared bootstrap file read by the launcher before DSH starts. */
  connectionStatePath: string;
}

export const Config: z<Config> = z.object({
  workspaceOrigin: z.string().required(),
  publicOrigin: z.string().required(),
  connectionStatePath: z.string().required(),
});

export const name = "univer-workspace-harness";
export const inject = ["webServer", "settings"];

function assertHttpOrigin(value: string, field: "publicOrigin" | "workspaceOrigin"): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      `univer-workspace-harness: ${field} must be an absolute http(s) URL; received ${JSON.stringify(value)}`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `univer-workspace-harness: ${field} must use http or https; received ${JSON.stringify(value)}`,
    );
  }
}

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(responseErrorBody(status, body)));
}

async function readJsonBody(req: IncomingMessage, maxBytes = 16 * 1024): Promise<unknown> {
  const declaredLength = req.headers["content-length"];
  if (typeof declaredLength === "string" && Number(declaredLength) > maxBytes) {
    throw new Error("request_too_large");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Uint8Array>) {
    const value = Buffer.from(chunk);
    size += value.byteLength;
    if (size > maxBytes) throw new Error("request_too_large");
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

interface LocalRouteDefinition {
  readonly kind: "exact";
  readonly path: string;
  readonly handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
}

interface SessionPromptGateway {
  invoke(request: {
    readonly namespace: "session";
    readonly method: "prompt";
    readonly args: { readonly request: Record<string, unknown> };
  }): Promise<unknown>;
}

/** Build the local-only prompt route backed by DSH's alpha.4 Session Remote. */
export function createLocalSessionPromptHandler(
  ctx: Context,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res): Promise<void> => {
    if (req.method !== "POST") {
      jsonResponse(res, 405, { error: "method_not_allowed" });
      return;
    }

    let parsed: ReturnType<typeof sessionPromptRequestSchema.safeParse>;
    try {
      parsed = sessionPromptRequestSchema.safeParse(await readJsonBody(req, 8 * 1024 * 1024));
    } catch (error) {
      jsonResponse(res, 400, { error: "invalid_prompt_request", detail: String(error) });
      return;
    }
    if (!parsed.success) {
      jsonResponse(res, 400, {
        error: "invalid_prompt_request",
        detail: parsed.error.message,
      });
      return;
    }

    const gateway = ctx.get("typertGateway") as SessionPromptGateway | undefined;
    if (gateway === undefined) {
      jsonResponse(res, 503, { error: "session_prompt_unavailable" });
      return;
    }

    const request = {
      ...parsed.data,
      requestId: parsed.data.requestId ?? randomUUID(),
    } satisfies Record<string, unknown>;
    try {
      const value = await gateway.invoke({
        namespace: "session",
        method: "prompt",
        args: { request },
      });
      jsonResponse(res, 200, { ok: true, value });
    } catch (error) {
      jsonResponse(res, 200, {
        ok: false,
        error: {
          code: "session-prompt-failed",
          message: error instanceof Error ? error.message : String(error),
          details: {},
        },
      });
    }
  };
}

export function createDeviceStartHandler(
  ctx: Context,
  pending: Map<string, DeviceAuthorizationStart>,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res): Promise<void> => {
    if (req.method !== "POST") return jsonResponse(res, 405, { error: "method_not_allowed" });
    try {
      const now = Date.now();
      for (const [code, entry] of pending) {
        if (entry.expiresAt <= now) pending.delete(code);
      }
      if (pending.size >= 128) {
        return jsonResponse(res, 429, { error: "too_many_pending_authorizations" });
      }
      const authorization = await startDeviceAuthorization(ctx.workspaceAuth.loginOrigin());
      pending.set(authorization.deviceCode, authorization);
      jsonResponse(res, 200, {
        deviceCode: authorization.deviceCode,
        userCode: authorization.userCode,
        verificationUrl: authorization.verificationUrl,
        expiresAt: authorization.expiresAt,
        intervalMs: authorization.intervalMs,
      });
    } catch (error) {
      console.warn(
        `univer-workspace-harness: device_start_failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      jsonResponse(res, 502, { error: "device_authorization_start_failed" });
    }
  };
}

export function createDeviceCompleteHandler(
  ctx: Context,
  pending: Map<string, DeviceAuthorizationStart>,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res): Promise<void> => {
    if (req.method !== "POST") return jsonResponse(res, 405, { error: "method_not_allowed" });
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      const code = error instanceof Error && error.message === "request_too_large" ? 413 : 400;
      return jsonResponse(res, code, {
        error: code === 413 ? "request_too_large" : "invalid_request",
      });
    }
    const deviceCode =
      body !== null &&
      typeof body === "object" &&
      typeof (body as Record<string, unknown>).deviceCode === "string"
        ? ((body as Record<string, unknown>).deviceCode as string)
        : "";
    const authorization = pending.get(deviceCode);
    if (authorization === undefined) {
      return jsonResponse(res, 400, { error: "device_authorization_not_found" });
    }
    if (authorization.origin !== ctx.workspaceAuth.loginOrigin()) {
      pending.delete(deviceCode);
      return jsonResponse(res, 409, { error: "device_authorization_origin_changed" });
    }
    try {
      const result = await completeDeviceAuthorization(authorization);
      if (result.status === "pending") return jsonResponse(res, 202, { status: "pending" });
      pending.delete(deviceCode);
      await ctx.workspaceAuth.stageConnection(
        result.identity,
        result.sessionToken,
        authorization.origin,
      );
      jsonResponse(res, 200, {
        status: "restart_required",
        restartRequired: true,
        identity: result.identity,
      });
    } catch (error) {
      console.warn(
        `univer-workspace-harness: device_complete_failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      jsonResponse(res, 502, { error: "device_authorization_complete_failed" });
    }
  };
}

export function createDeviceLogoutHandler(
  ctx: Context,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res): Promise<void> => {
    if (req.method !== "POST") return jsonResponse(res, 405, { error: "method_not_allowed" });
    await ctx.workspaceAuth.stageDisconnect();
    jsonResponse(res, 200, { loggedOut: true, restartRequired: true });
  };
}

/** The exact local HTTP routes installed by the Harness composition root. */
export function localRouteDefinitions(
  ctx: Context,
  pending: Map<string, DeviceAuthorizationStart>,
): readonly LocalRouteDefinition[] {
  return [
    {
      kind: "exact",
      path: UWH_DEVICE_START_PATH,
      handler: createDeviceStartHandler(ctx, pending),
    },
    {
      kind: "exact",
      path: UWH_DEVICE_COMPLETE_PATH,
      handler: createDeviceCompleteHandler(ctx, pending),
    },
    {
      kind: "exact",
      path: UWH_DEVICE_LOGOUT_PATH,
      handler: createDeviceLogoutHandler(ctx),
    },
    {
      kind: "exact",
      path: UWH_SESSION_PROMPT_PATH,
      handler: createLocalSessionPromptHandler(ctx),
    },
  ];
}

export function apply(ctx: Context, config: Config): void {
  assertHttpOrigin(config.publicOrigin, "publicOrigin");
  assertHttpOrigin(config.workspaceOrigin, "workspaceOrigin");

  const workspaceAuth = new workspaceAuthProvider.WorkspaceAuthProvider(ctx.root, {
    workspaceOrigin: config.workspaceOrigin,
    connectionStatePath: config.connectionStatePath,
  });
  const pending = new Map<string, DeviceAuthorizationStart>();
  ctx.effect(() => {
    const routes = localRouteDefinitions(ctx, pending).map((route) =>
      ctx.webServer.register(route),
    );
    return () => {
      for (const dispose of routes) dispose();
      pending.clear();
    };
  }, "uwh: local Workspace connection routes");
  void workspaceAuth;
}
