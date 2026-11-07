import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import {
  createMcpHandler,
  McpServer,
  CLIENT_INFO_META_KEY,
  TRACEPARENT_META_KEY,
} from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import {
  whoami,
  WorkspaceApplicationError,
  workspaceError,
  WorkspaceHttp,
} from "@univerjs/univer-workspace-client-core/product";
import { pino, type Logger } from "pino";
import { Counter, Histogram, Registry } from "prom-client";
import { z } from "zod";
import type { GatewayConfig } from "../shared/config.js";
import { translateToolError } from "./tool-error.js";
import type { ToolContext, ToolDefinition, ToolScope } from "./tools/definition.js";
import { selectTools, toolsets } from "./tools/registry.js";

const callEnvelope = z.object({
  method: z.literal("tools/call"),
  params: z.object({ name: z.string(), _meta: z.record(z.string(), z.unknown()).optional() }),
});
const clientInfoSchema = z.object({ name: z.string(), version: z.string() });
const developmentPassthroughScopes: ReadonlySet<ToolScope> = new Set([
  "read",
  "write",
  "publish",
  "worktree:merge",
]);
type Outcome = "ok" | "tool_error" | "auth_error" | "rate_limited" | "timeout" | "internal_error";
interface RequestState {
  readonly context: ToolContext;
  readonly selected: readonly ToolDefinition[];
  outcome: Outcome;
  errorCode: string | null;
  repo: string | null;
  modern: boolean;
}

// The SDK would reject invalid arguments with plain text before the callback runs. Keep the precise schema for
// tools/list and let the callback validate, so every tool returns the same structured argument error.
function advertiseOnly(schema: z.ZodObject): z.ZodObject {
  return {
    "~standard": {
      ...schema["~standard"],
      validate: (value: unknown) => ({ value: value ?? {} }),
    },
  } as unknown as z.ZodObject;
}

export function createGateway(
  config: GatewayConfig,
  options: {
    readonly logger?: Logger;
    readonly fetcher?: typeof fetch;
    readonly scopes?: ReadonlySet<ToolScope>;
  } = {},
) {
  const logger =
    options.logger ??
    pino({
      level: config.LOG_LEVEL,
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "headers.authorization",
        "headers.cookie",
      ],
    });
  const registry = new Registry();
  const calls = new Counter({
    name: "mcp_tool_calls_total",
    help: "Authenticated MCP tool calls",
    labelNames: ["tool", "client", "outcome"],
    registers: [registry],
  });
  const duration = new Histogram({
    name: "mcp_tool_duration_seconds",
    help: "MCP tool call duration in seconds",
    labelNames: ["tool"],
    registers: [registry],
    buckets: [0.01, 0.05, 0.1, 0.3, 1, 3, 10, 30],
  });
  const publicUrl = new URL(config.MCP_PUBLIC_URL);
  const challenge = `Bearer resource_metadata="${publicUrl.origin}/.well-known/oauth-protected-resource/mcp"`;
  const unauthorized = () =>
    new Response("Authentication required", {
      status: 401,
      headers: { "WWW-Authenticate": challenge },
    });
  const expectedMetricsToken = config.METRICS_TOKEN
    ? createHash("sha256").update(`Bearer ${config.METRICS_TOKEN}`).digest()
    : null;
  const requests = new AsyncLocalStorage<RequestState>();
  const mcp = createMcpHandler(({ era }) => {
    const state = requests.getStore();
    if (!state) throw new Error("Missing authenticated request context");
    state.modern = era === "modern";
    const server = new McpServer({ name: "univer-workspace", version: "0.0.0" });
    for (const tool of state.selected) {
      server.registerTool(
        tool.name,
        { ...tool, inputSchema: advertiseOnly(tool.inputSchema) },
        async (args) => {
          try {
            if (!state.context.scopes.has(tool.scope)) {
              throw workspaceError(
                "workspace-scope-required",
                `This connection is not authorized for ${tool.scope} access.`,
                { required: tool.scope },
              );
            }
            const result = await tool.run(state.context, tool.inputSchema.parse(args));
            const structuredContent = z.json().parse(result.output);
            if (!tool.outputSchema.safeParse(structuredContent).success) {
              throw new Error(`Tool ${tool.name} returned output that violates its output schema.`);
            }
            state.repo = result.repo;
            state.outcome = "ok";
            return {
              content: [{ type: "text", text: `${tool.name} completed.` }],
              structuredContent,
            };
          } catch (error) {
            const { outcome, code, message, detail } = translateToolError(error);
            if (outcome === "internal_error") {
              logger.error(
                {
                  request_id: state.context.requestId,
                  tool: tool.name,
                  error: error instanceof Error ? error.message : typeof error,
                },
                "Tool failed internally",
              );
            }
            state.outcome = outcome;
            state.errorCode = outcome === "tool_error" ? code : null;
            return {
              isError: true,
              content: [{ type: "text", text: message.replace(/[\r\n]+/g, " ") }],
              structuredContent: { code, message, detail },
            };
          }
        },
      );
    }
    return server;
  });

  const handler = {
    async fetch(request: Request): Promise<Response> {
      const started = performance.now();
      const incomingId = request.headers.get("x-request-id");
      const requestId =
        incomingId !== null && /^[a-zA-Z0-9._-]{1,128}$/.test(incomingId)
          ? incomingId
          : randomUUID();
      const url = new URL(request.url);
      let response: Response;
      try {
        response = await route(request, url, requestId, started);
      } catch {
        logger.error({ request_id: requestId }, "Gateway request failed");
        response = new Response("Internal server error", { status: 500 });
      }
      response.headers.set("x-request-id", requestId);
      logger.info(
        {
          req: { id: requestId, method: request.method, url: url.pathname },
          res: { statusCode: response.status },
          duration_ms: performance.now() - started,
        },
        "Request completed",
      );
      return response;
    },
  };

  async function route(
    request: Request,
    url: URL,
    requestId: string,
    started: number,
  ): Promise<Response> {
    if (request.method === "GET" && url.pathname === "/healthz") return new Response("ok");
    if (request.method === "GET" && url.pathname === "/metrics") {
      const headers = { "Cache-Control": "no-store" };
      if (!expectedMetricsToken) return new Response("Not found", { status: 404, headers });
      const actual = createHash("sha256")
        .update(request.headers.get("authorization") ?? "")
        .digest();
      if (!timingSafeEqual(actual, expectedMetricsToken)) {
        return new Response("Unauthorized", {
          status: 401,
          headers: { ...headers, "WWW-Authenticate": "Bearer" },
        });
      }
      return new Response(await registry.metrics(), {
        headers: { ...headers, "Content-Type": registry.contentType },
      });
    }
    if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 });
    if (
      request.headers.get("host") !== publicUrl.host ||
      (request.headers.has("origin") && request.headers.get("origin") !== publicUrl.origin)
    ) {
      return new Response("Forbidden", { status: 403 });
    }
    const bearer = /^Bearer ([^\s;,]+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
    if (!bearer) return unauthorized();
    const fetcher: typeof fetch = (input, init) => {
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      headers.set("x-request-id", requestId);
      return (options.fetcher ?? fetch)(input, { ...init, headers });
    };
    const http = new WorkspaceHttp({
      cookie: `workspace_session=${bearer}`,
      origin: config.WORKSPACE_ORIGIN,
      transportOrigin: config.WORKSPACE_TRANSPORT_URL,
      role: "client",
      fetcher,
    });
    let user;
    try {
      user = (await whoami(http)).subject;
    } catch (error) {
      if (
        error instanceof WorkspaceApplicationError &&
        error.code === "workspace-authentication-required"
      )
        return unauthorized();
      throw error;
    }
    const selected = selectTools(url.searchParams.get("toolsets"));
    if (!selected)
      return Response.json({ message: "Unknown toolset", valid: toolsets }, { status: 400 });
    let body: unknown;
    if (request.method === "POST") {
      try {
        body = await request.clone().json();
      } catch {
        /* The SDK returns the protocol parse error. */
      }
    }
    const call = callEnvelope.safeParse(body);
    const state: RequestState = {
      context: {
        http,
        user,
        requestId,
        identityOrigin: config.WORKSPACE_ORIGIN,
        scopes: options.scopes ?? developmentPassthroughScopes,
      },
      selected,
      outcome: "tool_error",
      errorCode: null,
      repo: null,
      modern: false,
    };
    return requests.run(state, async () => {
      try {
        const response = await mcp.fetch(
          request,
          body === undefined ? undefined : { parsedBody: body },
        );
        if (!call.success) return response;
        // Consume the finite call response before logging or translating an expired downstream session to HTTP 401.
        const text = await response.text();
        if (state.outcome === "auth_error") return unauthorized();
        return new Response(text, { status: response.status, headers: response.headers });
      } finally {
        if (call.success) {
          const tool = selected.find((tool) => tool.name === call.data.params.name);
          const meta = call.data.params._meta;
          const client = state.modern
            ? clientInfoSchema.safeParse(meta?.[CLIENT_INFO_META_KEY])
            : undefined;
          const elapsed = performance.now() - started;
          logger.info({
            event: "mcp.tool_call",
            schema_version: 1,
            ts: new Date().toISOString(),
            request_id: requestId,
            trace_id:
              typeof meta?.[TRACEPARENT_META_KEY] === "string" ? meta[TRACEPARENT_META_KEY] : null,
            user_id: user.id,
            auth_kind: "dev",
            client_id: "dev",
            client_name: client?.success ? client.data.name : null,
            client_version: client?.success ? client.data.version : null,
            tool: tool?.name ?? "unknown",
            toolset: tool?.toolset ?? "core",
            repo: state.repo,
            unit_type: null,
            outcome: state.outcome,
            error_code: state.errorCode,
            duration_ms: elapsed,
            executor: "none",
            cost: {
              worker_cpu_ms: 0,
              worker_peak_rss_mb: 0,
              render_pages: 0,
              export_bytes: 0,
              upload_bytes: 0,
              committed_revisions: 0,
            },
          });
          calls.inc({ tool: tool?.name ?? "unknown", client: "dev", outcome: state.outcome });
          duration.observe({ tool: tool?.name ?? "unknown" }, elapsed / 1000);
        }
      }
    });
  }
  const nodeHandler = toNodeHandler(handler, {
    onerror: () => logger.error("MCP Node adapter failed"),
  });
  // The SDK adapter excludes undefined optional fields under exactOptionalPropertyTypes.
  const server = createServer((request, response) => {
    void nodeHandler(
      {
        method: request.method ?? "GET",
        url: request.url ?? "/",
        headers: request.headers,
        [Symbol.asyncIterator]: () => request[Symbol.asyncIterator](),
      },
      response,
    );
  });
  return { server, registry, close: () => mcp.close() };
}
