import { once } from "node:events";
import { createServer, request as httpRequest, type Server } from "node:http";
import { Writable } from "node:stream";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createGateway } from "../src/gateway/server.js";
import { parseGatewayConfig } from "../src/shared/config.js";

const identityOrigin = "https://workspace.example";
const session = "test-session-secret-do-not-log";
const subject = { id: "user-1", name: "alice" };
const spaces = [
  {
    id: "personal-1",
    name: "Personal",
    type: "personal",
    accessRole: "owner",
    affiliation: "owner",
    fullName: "alice/personal",
    owner: { id: "user-1", username: "Alice" },
    publicRead: false,
    slug: null,
  },
  {
    id: "team-1",
    name: "Team",
    type: "team",
    accessRole: "admin",
    affiliation: "member",
    fullName: "bob/team",
    owner: { id: "user-2", username: "bob" },
    publicRead: true,
    slug: "team",
  },
];
const observedSchema = z.object({
  event: z.literal("mcp.tool_call"),
  schema_version: z.literal(1),
  ts: z.iso.datetime(),
  request_id: z.string().min(1),
  trace_id: z.string().nullable(),
  user_id: z.string().min(1),
  auth_kind: z.literal("dev"),
  client_id: z.literal("dev"),
  client_name: z.string().nullable(),
  client_version: z.string().nullable(),
  tool: z.string().min(1),
  toolset: z.enum(["core", "files", "admin"]),
  repo: z.string().nullable(),
  unit_type: z.null(),
  outcome: z.enum(["ok", "tool_error", "auth_error", "rate_limited", "timeout", "internal_error"]),
  error_code: z.string().nullable(),
  duration_ms: z.number().nonnegative(),
  executor: z.literal("none"),
  cost: z.object({
    worker_cpu_ms: z.literal(0),
    worker_peak_rss_mb: z.literal(0),
    render_pages: z.literal(0),
    export_bytes: z.literal(0),
    upload_bytes: z.literal(0),
    committed_revisions: z.literal(0),
  }),
});
async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected TCP server");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

describe("gateway over real HTTP and the MCP client", () => {
  let workspace: Server;
  let gateway: ReturnType<typeof createGateway>;
  let url: string;
  let logs: string;
  let workspaceRequests: {
    path: string;
    cookie: string | undefined;
    requestId: string | string[] | undefined;
  }[];
  let clients: Client[];
  let expireDuringTool: boolean;
  let missingRepoCode: string;
  beforeEach(async () => {
    clients = [];
    logs = "";
    expireDuringTool = false;
    missingRepoCode = "workspace-not-found";
    workspaceRequests = [];
    workspace = createServer((request, response) => {
      const path = new URL(request.url ?? "/", "http://localhost");
      workspaceRequests.push({
        path: path.pathname,
        cookie: request.headers.cookie,
        requestId: request.headers["x-request-id"],
      });
      response.setHeader("Content-Type", "application/json");
      if (request.headers.cookie !== `workspace_session=${session}`) {
        response.end(JSON.stringify({ authenticated: false }));
      } else if (path.pathname === "/api/session") {
        response.end(
          JSON.stringify({
            authenticated: true,
            user: { id: subject.id, displayName: subject.name },
          }),
        );
      } else if (expireDuringTool) {
        response.writeHead(401).end("{}");
      } else if (path.pathname === "/api/spaces") {
        response.end(JSON.stringify({ spaces }));
      } else if (path.pathname === "/api/spaces/lookup") {
        const space = spaces.find(
          (space) =>
            space.fullName === `${path.searchParams.get("owner")}/${path.searchParams.get("slug")}`,
        );
        if (space) response.end(JSON.stringify(space));
        else
          response.writeHead(404).end(
            JSON.stringify({
              error: { code: missingRepoCode, message: "Repository not found." },
            }),
          );
      } else if (path.pathname.endsWith("/star")) {
        response.end(JSON.stringify({ starCount: 7, starred: true }));
      } else {
        const space = spaces.find((space) => path.pathname === `/api/spaces/${space.id}`);
        if (space) response.end(JSON.stringify(space));
        else
          response.writeHead(404).end(
            JSON.stringify({
              error: { code: missingRepoCode, message: "Repository not found." },
            }),
          );
      }
    });
    const transportOrigin = await listen(workspace);
    const logOutput = new Writable({
      write(chunk, _encoding, callback) {
        logs += chunk.toString();
        callback();
      },
    });
    // Reserve the actual socket first so public Host validation exercises its real address.
    const socket = createServer();
    const origin = await listen(socket);
    await close(socket);
    url = `${origin}/mcp`;
    gateway = createGateway(
      parseGatewayConfig({
        MCP_DEV_SESSION_PASSTHROUGH: "1",
        WORKSPACE_ORIGIN: identityOrigin,
        WORKSPACE_TRANSPORT_URL: transportOrigin,
        MCP_PUBLIC_URL: url,
        METRICS_TOKEN: "metrics-secret",
      }),
      { logger: pino({}, logOutput) },
    );
    const port = new URL(origin).port;
    gateway.server.listen(Number(port), "127.0.0.1");
    await once(gateway.server, "listening");
  });
  afterEach(async () => {
    await Promise.all(clients.map((client) => client.close()));
    await gateway.close();
    await close(gateway.server);
    await close(workspace);
    expect(logs).not.toContain(session);
    expect(logs).not.toContain("metrics-secret");
  });
  async function connect(mode: "legacy" | { pin: string } = { pin: "2026-07-28" }, suffix = "") {
    const client = new Client(
      { name: "gateway-test", version: "1.2.3" },
      { versionNegotiation: { mode } },
    );
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url + suffix), {
        requestInit: {
          headers: { Authorization: `Bearer ${session}`, "x-request-id": "gateway-test-id" },
        },
      }),
    );
    return client;
  }
  function events() {
    return logs
      .trim()
      .split("\n")
      .map((line) => z.record(z.string(), z.unknown()).parse(JSON.parse(line)))
      .filter((line) => line["event"] === "mcp.tool_call")
      .map((line) => observedSchema.parse(line));
  }

  it("returns identical whoami in both protocol versions and preserves identity and transport origins", async () => {
    for (const mode of ["legacy", { pin: "2026-07-28" }] as const) {
      const client = await connect(mode);
      expect(client.getProtocolEra()).toBe(mode === "legacy" ? "legacy" : "modern");
      const result = await client.callTool({ name: "whoami", arguments: {} });
      expect(result.structuredContent).toEqual({ origin: identityOrigin, subject });
    }
    expect(workspaceRequests.length).toBeGreaterThan(1);
    expect(
      workspaceRequests.every(
        (request) =>
          request.cookie === `workspace_session=${session}` &&
          request.requestId === "gateway-test-id",
      ),
    ).toBe(true);
    const emitted = events();
    expect(emitted).toHaveLength(2);
    expect(emitted[0]).toMatchObject({
      outcome: "ok",
      request_id: "gateway-test-id",
      client_name: null,
      client_version: null,
    });
    expect(emitted[1]).toMatchObject({
      outcome: "ok",
      client_name: "gateway-test",
      client_version: "1.2.3",
    });
  });

  it("wraps repository lists, preserves ordering and CLI owner/type/limit semantics", async () => {
    const client = await connect();
    const expected = spaces.map((space) => ({
      ...space,
      url: `${identityOrigin}/spaces/${space.id}`,
    }));
    expect((await client.callTool({ name: "repo_list", arguments: {} })).structuredContent).toEqual(
      { repos: expected },
    );
    for (const args of [{ owner: "@me" }, { owner: "ALICE" }, { type: "personal" }, { limit: 1 }]) {
      expect(
        (await client.callTool({ name: "repo_list", arguments: args })).structuredContent,
      ).toEqual({ repos: expected.slice(0, 1) });
    }
    expect(
      (await client.callTool({ name: "repo_list", arguments: { type: "team" } })).structuredContent,
    ).toEqual({ repos: expected.slice(1) });
    expect((await client.callTool({ name: "repo_list", arguments: { limit: 0 } })).isError).toBe(
      true,
    );
  });

  it("resolves all repository reference forms with CLI get and getStar composition", async () => {
    const client = await connect();
    for (const repo of ["alice/personal", "personal-1", `${identityOrigin}/spaces/personal-1`]) {
      expect(
        (await client.callTool({ name: "repo_view", arguments: { repo } })).structuredContent,
      ).toEqual({
        ...spaces[0],
        starCount: 7,
        starred: true,
        url: `${identityOrigin}/spaces/personal-1`,
      });
    }
    expect(events().every((event) => event.repo === "personal-1")).toBe(true);
    const foreign = await client.callTool({
      name: "repo_view",
      arguments: { repo: "https://elsewhere.example/spaces/personal-1" },
    });
    expect(foreign).toMatchObject({
      isError: true,
      structuredContent: { code: "workspace-origin-mismatch" },
    });
  });

  it.each(["workspace-not-found", "NOT_FOUND"])(
    "preserves %s and emits exactly one failed usage event",
    async (code) => {
      missingRepoCode = code;
      const client = await connect();
      const result = await client.callTool({
        name: "repo_view",
        arguments: { repo: "alice/missing-sensitive-argument" },
      });
      expect(result).toMatchObject({
        isError: true,
        structuredContent: {
          code,
          message: "Repository not found.",
          detail: { status: 404, path: "/api/spaces/lookup" },
        },
        content: [{ type: "text", text: "Repository not found." }],
      });
      expect(events()).toHaveLength(1);
      expect(events()[0]).toMatchObject({ outcome: "tool_error", error_code: code });
      expect(logs).not.toContain("missing-sensitive-argument");
    },
  );

  it("lists the ordered registry identically for core and all with complete schemas and annotations", async () => {
    const core = await connect({ pin: "2026-07-28" }, "?toolsets=core");
    const all = await connect({ pin: "2026-07-28" }, "?toolsets=all");
    const coreTools = await core.listTools();
    expect(await all.listTools()).toEqual(coreTools);
    expect(coreTools.tools.map((tool) => tool.name)).toEqual(["whoami", "repo_list", "repo_view"]);
    for (const tool of coreTools.tools) {
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });
    }
    expect(events()).toHaveLength(0);
    const files = await connect({ pin: "2026-07-28" }, "?toolsets=files");
    expect((await files.listTools()).tools).toEqual([]);
  });

  it("checks Host, Origin, bearer, session, and toolsets in that order", async () => {
    const challenge = `Bearer resource_metadata="${new URL(url).origin}/.well-known/oauth-protected-resource/mcp"`;
    for (const authorization of [undefined, "Bearer ", "Bearer rejected-session"]) {
      const response = await fetch(url, {
        method: "POST",
        headers: authorization === undefined ? {} : { authorization },
      });
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe(challenge);
    }
    const auth = { authorization: `Bearer ${session}` };
    const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(
        url,
        { method: "POST", headers: { ...auth, Host: "foreign.example" } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      request.on("error", reject);
      request.end();
    });
    expect(wrongHost).toBe(403);
    expect(
      (
        await fetch(url, {
          method: "POST",
          headers: { ...auth, Origin: "https://foreign.example" },
        })
      ).status,
    ).toBe(403);
    const unknown = await fetch(url + "?toolsets=nope", { method: "POST", headers: auth });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({
      message: "Unknown toolset",
      valid: ["core", "files", "admin", "all"],
    });
    expect((await fetch(url + "?toolsets=nope", { method: "POST" })).status).toBe(401);
    expect(events()).toHaveLength(0);
  });

  it("echoes request IDs, generates safe IDs, and serves health/metrics without Workspace", async () => {
    const origin = new URL(url).origin;
    const health = await fetch(origin + "/healthz", { headers: { "x-request-id": "safe.id-1" } });
    expect(health.status).toBe(200);
    expect(health.headers.get("x-request-id")).toBe("safe.id-1");
    const invalid = await fetch(origin + "/healthz", { headers: { "x-request-id": "invalid id" } });
    expect(invalid.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const noToken = await fetch(origin + "/metrics");
    expect(noToken.status).toBe(401);
    expect(noToken.headers.get("www-authenticate")).toBe("Bearer");
    expect(noToken.headers.get("cache-control")).toBe("no-store");
    const metrics = await fetch(origin + "/metrics", {
      headers: { Authorization: "Bearer metrics-secret" },
    });
    expect(metrics.status).toBe(200);
    expect(metrics.headers.get("content-type")).toContain("text/plain");
    expect(workspaceRequests).toHaveLength(0);
    const client = await connect();
    await client.callTool({ name: "whoami", arguments: {} });
    const measured = await fetch(origin + "/metrics", {
      headers: { Authorization: "Bearer metrics-secret" },
    });
    expect(await measured.text()).toContain(
      'mcp_tool_calls_total{tool="whoami",client="dev",outcome="ok"} 1',
    );
    expect((await fetch(origin + "/unknown")).status).toBe(404);
    const unconfigured = createGateway(
      parseGatewayConfig({
        MCP_DEV_SESSION_PASSTHROUGH: "1",
        WORKSPACE_ORIGIN: identityOrigin,
        MCP_PUBLIC_URL: url,
      }),
      { logger: pino({ level: "silent" }) },
    );
    const unconfiguredOrigin = await listen(unconfigured.server);
    try {
      expect((await fetch(unconfiguredOrigin + "/metrics")).status).toBe(404);
    } finally {
      await unconfigured.close();
      await close(unconfigured.server);
    }
  });

  it("returns HTTP 401 if a validated session expires during a tool", async () => {
    const client = await connect();
    expireDuringTool = true;
    await expect(client.callTool({ name: "repo_list", arguments: {} })).rejects.toThrow();
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({
      outcome: "auth_error",
      error_code: null,
    });
  });
});

describe("configuration boundary", () => {
  const env = {
    MCP_DEV_SESSION_PASSTHROUGH: "1",
    WORKSPACE_ORIGIN: identityOrigin,
    MCP_PUBLIC_URL: "http://127.0.0.1:3930/mcp",
  };
  it("rejects production passthrough before reading other configuration", () => {
    for (const value of ["1", "0", "false"]) {
      expect(() =>
        parseGatewayConfig({ NODE_ENV: "production", MCP_DEV_SESSION_PASSTHROUGH: value }),
      ).toThrow(/NODE_ENV.*MCP_DEV_SESSION_PASSTHROUGH/);
    }
  });
  it("requires development auth, validates URLs and ports, and resolves defaults once", () => {
    expect(() => parseGatewayConfig({ ...env, MCP_DEV_SESSION_PASSTHROUGH: "" })).toThrow(
      /requires MCP_DEV_SESSION_PASSTHROUGH=1/,
    );
    for (const change of [
      { PORT: "0" },
      { PORT: "65536" },
      { LOG_LEVEL: "whatever" },
      { WORKSPACE_ORIGIN: "https://example.com/path" },
      { MCP_PUBLIC_URL: "file:///mcp" },
    ]) {
      expect(() => parseGatewayConfig({ ...env, ...change })).toThrow();
    }
    const config = parseGatewayConfig(env);
    expect(config).toMatchObject({
      WORKSPACE_TRANSPORT_URL: identityOrigin,
      PORT: 3000,
      HOST: "127.0.0.1",
      auth: { kind: "dev-session" },
    });
    expect(Object.isFrozen(config)).toBe(true);
  });
});
