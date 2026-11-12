import { testStagingDirectory } from "./staging-directory.js";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { Writable } from "node:stream";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { pino } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthenticator } from "../src/gateway/auth.js";
import { createGateway } from "./gateway.js";
import { opSpecs, PROTOCOL_VERSION } from "../src/shared/executor-protocol.js";
import { parseGatewayConfig } from "../src/shared/config.js";

const identityOrigin = "https://workspace.example";
const clientSecret = "gateway-client-secret-do-not-log";
const tokens: Record<string, { scope: string; kind: "pat" | "oauth"; id: string; clientId: string | null }> = {
  uvw_pat_full: { scope: "read write publish worktree:merge nope", kind: "pat", id: "pat-1", clientId: null },
  uvw_pat_readonly: { scope: "read", kind: "pat", id: "pat-2", clientId: null },
  uvw_at_oauth: { scope: "read write", kind: "oauth", id: "grant-1", clientId: "chatgpt" },
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function listen(server: Server, port = 0): Promise<string> {
  server.listen(port, "127.0.0.1");
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

describe("gateway authentication", () => {
  const cleanup: (() => Promise<void>)[] = [];
  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((task) => task()));
    vi.restoreAllMocks();
  });

  async function start(
    env: Record<string, string>,
    behavior: {
      executor?: boolean;
      exchangeStatus?: number;
      exchangeBody?: object;
      beforeExchange?: () => Promise<void>;
      expireDownstream?: (cookie: string | undefined) => boolean | Promise<boolean>;
    } = {},
  ) {
    const exchanges: URLSearchParams[] = [];
    const productCookies: (string | undefined)[] = [];
    let logs = "";
    let issued = 0;
    const workspace = createServer(async (request, response) => {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      response.setHeader("Content-Type", "application/json");
      if (path === "/rpc/v1/capabilities") {
        response.end(JSON.stringify({ v: PROTOCOL_VERSION, operations: Object.keys(opSpecs) }));
        return;
      }
      if (path === "/api/auth/token") {
        let body = "";
        request.on("data", (chunk) => (body += chunk));
        request.on("end", async () => {
          const form = new URLSearchParams(body);
          exchanges.push(form);
          await behavior.beforeExchange?.();
          const token = tokens[form.get("subject_token") ?? ""];
          if (behavior.exchangeStatus !== undefined) {
            response.writeHead(behavior.exchangeStatus).end(JSON.stringify(behavior.exchangeBody ?? {}));
          } else if (!token) {
            response.writeHead(400).end(JSON.stringify({ error: "invalid_grant" }));
          } else {
            response.end(
              JSON.stringify({
                access_token: `downstream-session-${++issued}`,
                issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
                token_type: "N_A",
                expires_in: 600,
                scope: token.scope,
                subject: { kind: token.kind, id: token.id, client_id: token.clientId },
                user: { id: "user-1", username: "alice", displayName: "alice", avatarUrl: null },
              }),
            );
          }
        });
        return;
      }
      productCookies.push(request.headers.cookie);
      if (path !== "/api/session" && await behavior.expireDownstream?.(request.headers.cookie)) {
        response.writeHead(401).end("{}");
      } else if (request.headers.cookie === "workspace_session=dev-session" && path === "/api/session") {
        response.end(JSON.stringify({ authenticated: true, user: { id: "user-1", displayName: "alice" } }));
      } else if (path === "/api/spaces") {
        response.end(JSON.stringify({ spaces: [] }));
      } else {
        response.end(JSON.stringify({ authenticated: false }));
      }
    });
    const transport = await listen(workspace);
    const probe = createServer();
    const origin = await listen(probe);
    await close(probe);
    const url = `${origin}/mcp`;
    const gateway = createGateway(
      parseGatewayConfig({
        WORKSPACE_ORIGIN: identityOrigin,
        WORKSPACE_TRANSPORT_URL: transport,
        MCP_STAGING_DIRECTORY: testStagingDirectory(), MCP_PUBLIC_URL: url,
        ...env,
        ...(behavior.executor ? { MCP_EXECUTOR_URLS: transport, MCP_EXECUTOR_TOKEN: "t".repeat(32) } : {}),
      }),
      {
        logger: pino(
          {},
          new Writable({
            write(chunk, _encoding, callback) {
              logs += chunk.toString();
              callback();
            },
          }),
        ),
      },
    );
    await listen(gateway.server, Number(new URL(origin).port));
    const clients: Client[] = [];
    cleanup.push(async () => {
      await Promise.all(clients.map((client) => client.close()));
      await gateway.close();
      await close(gateway.server);
      await close(workspace);
      for (const secret of [...Object.keys(tokens), clientSecret]) expect(logs).not.toContain(secret);
      expect(logs).not.toContain("downstream-session-");
    });
    async function connect(bearer: string, suffix = "") {
      const client = new Client({ name: "auth-test", version: "1" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
      clients.push(client);
      await client.connect(
        new StreamableHTTPClientTransport(new URL(url + suffix), {
          requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
        }),
      );
      return client;
    }
    const post = (bearer: string, method = "ping", params?: object) =>
      fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
    const events = () =>
      logs
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((line) => line["event"] === "mcp.tool_call");
    return { url, origin, exchanges, productCookies, connect, post, events, logs: () => logs };
  }

  const exchangeEnv = { MCP_OAUTH_CLIENT_ID: "univer-workspace-mcp-gateway", MCP_OAUTH_CLIENT_SECRET: clientSecret };

  it("exchanges a PAT, sends only the downstream session to product APIs and records pat in the event", async () => {
    const gateway = await start(exchangeEnv);
    const client = await gateway.connect("uvw_pat_full");
    expect((await client.callTool({ name: "whoami", arguments: {} })).structuredContent).toEqual({
      origin: identityOrigin,
      subject: { id: "user-1", name: "alice" },
    });
    await client.callTool({ name: "repo_list", arguments: {} });
    const form = gateway.exchanges[0]!;
    expect(Object.fromEntries(form)).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: "uvw_pat_full",
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      resource: gateway.url,
      client_id: "univer-workspace-mcp-gateway",
      client_secret: clientSecret,
    });
    expect(gateway.productCookies).toEqual(["workspace_session=downstream-session-1"]);
    expect(gateway.events()).toMatchObject([
      { auth_kind: "pat", client_id: "pat-1", user_id: "user-1", outcome: "ok" },
      { auth_kind: "pat", client_id: "pat-1", tool: "repo_list", outcome: "ok" },
    ]);
  });

  it("shares one exchange across parallel first calls", async () => {
    const gateway = await start(exchangeEnv);
    const responses = await Promise.all(Array.from({ length: 20 }, () => gateway.post("uvw_pat_full")));
    expect(responses.map((response) => response.status)).toEqual(Array(20).fill(200));
    expect(gateway.exchanges).toHaveLength(1);
  });

  it("leaves a missing-bearer challenge free of invalid_token and exposes it to browsers", async () => {
    const gateway = await start(exchangeEnv);
    const response = await fetch(gateway.url, { method: "POST" });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${gateway.origin}/.well-known/oauth-protected-resource/mcp"`,
    );
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-expose-headers")).toBe("WWW-Authenticate");
  });

  it("reports the OAuth client for an access token and labels metrics by auth kind", async () => {
    const gateway = await start({ ...exchangeEnv, METRICS_TOKEN: "metrics-secret" });
    await (await gateway.connect("uvw_at_oauth")).callTool({ name: "whoami", arguments: {} });
    expect(gateway.events()).toMatchObject([{ auth_kind: "oauth", client_id: "chatgpt" }]);
    const write = await (await gateway.connect("uvw_at_oauth", "?toolsets=admin")).callTool({
      name: "pr_merge",
      arguments: { repo: "a/b", number: 1 },
    });
    expect(write.structuredContent).toMatchObject({ code: "workspace-scope-required" });
    const metrics = await fetch(gateway.origin + "/metrics", { headers: { Authorization: "Bearer metrics-secret" } });
    expect(await metrics.text()).toContain('mcp_tool_calls_total{tool="whoami",client="oauth",outcome="ok"} 1');
  });

  it("exchanges once for repeated calls with the same bearer", async () => {
    const gateway = await start(exchangeEnv);
    const client = await gateway.connect("uvw_pat_full");
    await client.callTool({ name: "whoami", arguments: {} });
    await client.callTool({ name: "whoami", arguments: {} });
    expect(gateway.exchanges).toHaveLength(1);
  });

  it("negatively caches invalid_grant and answers HTTP 401 with the invalid-token challenge", async () => {
    const gateway = await start(exchangeEnv);
    for (const bearer of ["uvw_pat_unknown", "uvw_pat_unknown", "uvw_at_unknown", "uvw_at_unknown"]) {
      const response = await gateway.post(bearer);
      expect(response.status).toBe(401);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("access-control-expose-headers")).toBe("WWW-Authenticate");
      expect(response.headers.get("www-authenticate")).toBe(
        `Bearer resource_metadata="${gateway.origin}/.well-known/oauth-protected-resource/mcp", error="invalid_token"`,
      );
    }
    expect(gateway.exchanges).toHaveLength(2);
    expect(gateway.productCookies).toEqual([]);
  });

  it("refuses a write tool for a read-only PAT", async () => {
    const gateway = await start(exchangeEnv);
    const result = await (await gateway.connect("uvw_pat_readonly")).callTool({
      name: "issue_create",
      arguments: { repo: "a/b", title: "t" },
    });
    expect(result).toMatchObject({ isError: true, structuredContent: { code: "workspace-scope-required" } });
    expect(gateway.events()).toMatchObject([{ outcome: "tool_error", error_code: "workspace-scope-required" }]);
    expect(gateway.productCookies).toEqual([]);
  });

  it("requires publish scope for html_view_create before executor dispatch", async () => {
    const gateway = await start(exchangeEnv, { executor: true });
    const client = await gateway.connect("uvw_pat_readonly");
    expect(
      await client.callTool({
        name: "html_view_create",
        arguments: {
          html: "<h1>Dashboard</h1>",
          space: "space",
          name: "Dashboard",
          idempotency_key: "html-retry-key-123",
        },
      }),
    ).toMatchObject({
      isError: true,
      structuredContent: { code: "workspace-scope-required", detail: { required: "publish" } },
    });
    expect(gateway.productCookies).toEqual([]);
  });

  it("re-exchanges a dead downstream session and lets the client retry the same valid token", async () => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let expired = false;
    const gateway = await start(exchangeEnv, { expireDownstream: () => expired });
    const client = await gateway.connect("uvw_pat_full");
    await client.callTool({ name: "whoami", arguments: {} });
    expired = true;
    now += 5_000;
    const response = await gateway.post("uvw_pat_full", "tools/call", { name: "repo_list", arguments: {} });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${gateway.origin}/.well-known/oauth-protected-resource/mcp"`,
    );
    expect(gateway.exchanges).toHaveLength(2);
    expect(gateway.productCookies).toEqual(["workspace_session=downstream-session-1"]);
    expect(gateway.events().at(-1)).toMatchObject({ outcome: "auth_error" });
    expired = false;
    await client.callTool({ name: "repo_list", arguments: {} });
    expect(gateway.exchanges).toHaveLength(2);
    expect(gateway.productCookies.at(-1)).toBe("workspace_session=downstream-session-2");
  });

  it("marks a token rejected during downstream recovery as invalid", async () => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const behavior: { expireDownstream: () => boolean; exchangeStatus?: number; exchangeBody?: object } = {
      expireDownstream: () => false,
    };
    const gateway = await start(exchangeEnv, behavior);
    await gateway.connect("uvw_pat_full");
    now += 5_000;
    behavior.expireDownstream = () => true;
    behavior.exchangeStatus = 400;
    behavior.exchangeBody = { error: "invalid_grant" };
    const response = await gateway.post("uvw_pat_full", "tools/call", { name: "repo_list", arguments: {} });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect(gateway.exchanges).toHaveLength(2);
    expect((await gateway.post("uvw_pat_full")).status).toBe(401);
    expect(gateway.exchanges).toHaveLength(2);
  });

  it.each([false, true])("shares recovery across five downstream failures (revoked=%s)", async (revoked) => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const failures = Array.from({ length: 5 }, deferred);
    const allStarted = deferred();
    const exchangeStarted = deferred();
    const exchangeGate = deferred();
    let arrivals = 0;
    const behavior: Parameters<typeof start>[1] = {
      expireDownstream: async (cookie) => {
        if (cookie !== "workspace_session=downstream-session-1") return false;
        const failure = failures[arrivals++]!;
        if (arrivals === 5) allStarted.resolve();
        await failure.promise;
        return true;
      },
    };
    const gateway = await start(exchangeEnv, behavior);
    await gateway.post("uvw_pat_full");
    now += 5_000;
    behavior.beforeExchange = async () => {
      exchangeStarted.resolve();
      await exchangeGate.promise;
    };
    if (revoked) {
      behavior.exchangeStatus = 400;
      behavior.exchangeBody = { error: "invalid_grant" };
    }
    const responses = failures.map(() => gateway.post("uvw_pat_full", "tools/call", { name: "repo_list", arguments: {} }));
    try {
      await allStarted.promise;
      failures[0]!.resolve();
      await exchangeStarted.promise;
      exchangeGate.resolve();
      await responses[0];
      for (let i = 1; i < failures.length; i += 1) {
        failures[i]!.resolve();
        await responses[i];
      }
      for (const response of await Promise.all(responses)) {
        expect(response.status).toBe(401);
        expect(response.headers.get("www-authenticate")).toBe(
          `Bearer resource_metadata="${gateway.origin}/.well-known/oauth-protected-resource/mcp"` +
          (revoked ? ', error="invalid_token"' : ""),
        );
      }
      expect(gateway.exchanges).toHaveLength(2);
      const retry = await gateway.post("uvw_pat_full", "tools/call", { name: "repo_list", arguments: {} });
      expect(retry.status).toBe(revoked ? 401 : 200);
      expect(gateway.exchanges).toHaveLength(2);
      if (!revoked) expect(gateway.productCookies.at(-1)).toBe("workspace_session=downstream-session-2");
    } finally {
      failures.forEach((failure) => failure.resolve());
      exchangeGate.resolve();
      await Promise.all(responses);
    }
  });

  it.each([0, 4_999])("marks a session rejected after %s ms invalid without re-exchanging", async (age) => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const gateway = await start(exchangeEnv, { expireDownstream: () => true });
    await gateway.post("uvw_pat_full");
    now += age;
    const response = await gateway.post("uvw_pat_full", "tools/call", { name: "repo_list", arguments: {} });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect(gateway.exchanges).toHaveLength(1);
    expect(gateway.events().at(-1)).toMatchObject({ outcome: "auth_error" });
  });

  it.each([
    ["invalid_client", 401],
    ["unauthorized_client", 400],
    ["invalid_request", 400],
  ])("answers a %s exchange failure with HTTP 500 and no credential in the log", async (error, status) => {
    const gateway = await start(exchangeEnv, { exchangeStatus: status, exchangeBody: { error } });
    expect((await gateway.post("uvw_pat_full")).status).toBe(500);
    expect((await gateway.post("uvw_pat_full")).status).toBe(500);
    expect(gateway.exchanges).toHaveLength(2);
    expect(gateway.logs()).toContain("Token exchange failed");
    expect(gateway.logs()).toContain(error);
  });

  it("answers an unreachable Workspace with HTTP 500", async () => {
    const gateway = await start({
      ...exchangeEnv,
      WORKSPACE_TRANSPORT_URL: "http://127.0.0.1:1",
    });
    expect((await gateway.post("uvw_pat_full")).status).toBe(500);
    expect(gateway.logs()).toContain("Token exchange could not reach Workspace");
  });

  it("keeps development passthrough for non-token bearers when enabled", async () => {
    const gateway = await start({ ...exchangeEnv, MCP_DEV_SESSION_PASSTHROUGH: "1" });
    await (await gateway.connect("dev-session")).callTool({ name: "whoami", arguments: {} });
    expect(gateway.events()).toMatchObject([{ auth_kind: "dev", client_id: "dev" }]);
    expect(gateway.exchanges).toHaveLength(0);
    await (await gateway.connect("uvw_pat_full")).callTool({ name: "whoami", arguments: {} });
    expect(gateway.exchanges).toHaveLength(1);
  });

  it("refuses non-token bearers when passthrough is disabled", async () => {
    const gateway = await start(exchangeEnv);
    expect((await gateway.post("dev-session")).status).toBe(401);
    expect(gateway.productCookies).toEqual([]);
  });

  it("never forwards a Workspace token as a session when exchange is not configured", async () => {
    const gateway = await start({ MCP_DEV_SESSION_PASSTHROUGH: "1" });
    expect((await gateway.post("uvw_pat_full")).status).toBe(401);
    expect(gateway.productCookies).toEqual([]);
  });

  it("serves protected-resource metadata without authentication", async () => {
    const gateway = await start(exchangeEnv);
    for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) {
      const response = await fetch(gateway.origin + path);
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("cache-control")).toBe("public, max-age=300");
      expect(await response.json()).toEqual({
        resource: gateway.url,
        authorization_servers: [identityOrigin],
        scopes_supported: ["read", "write", "publish", "worktree:merge"],
        bearer_methods_supported: ["header"],
      });
    }
  });
});

describe("authentication configuration", () => {
  const base = { WORKSPACE_ORIGIN: identityOrigin, MCP_STAGING_DIRECTORY: testStagingDirectory(), MCP_PUBLIC_URL: "http://127.0.0.1:3930/mcp" };
  it("requires the client id and secret together and at least one mode", () => {
    expect(() => parseGatewayConfig({ ...base, MCP_OAUTH_CLIENT_ID: "id" })).toThrow(/together/);
    expect(() => parseGatewayConfig({ ...base, MCP_OAUTH_CLIENT_SECRET: "secret" })).toThrow(/together/);
    expect(() => parseGatewayConfig(base)).toThrow(/MCP_OAUTH_CLIENT_ID.*MCP_DEV_SESSION_PASSTHROUGH/);
    expect(() => parseGatewayConfig({ ...base, MCP_DEV_SESSION_PASSTHROUGH: "yes" })).toThrow(/must be 1/);
  });
  it("freezes a config containing the client secret exactly once", () => {
    const config = parseGatewayConfig({ ...base, MCP_OAUTH_CLIENT_ID: "id", MCP_OAUTH_CLIENT_SECRET: clientSecret });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.auth.exchange)).toBe(true);
    expect(config).not.toHaveProperty("MCP_OAUTH_CLIENT_SECRET");
    expect(JSON.stringify(config).split(clientSecret)).toHaveLength(2);
  });
  it("accepts exchange alone, passthrough alone, or both, and refuses passthrough in production", () => {
    const exchange = { MCP_OAUTH_CLIENT_ID: "id", MCP_OAUTH_CLIENT_SECRET: "secret" };
    expect(parseGatewayConfig({ ...base, ...exchange, NODE_ENV: "production" }).auth).toEqual({
      exchange: { clientId: "id", clientSecret: "secret" },
      devSessionPassthrough: false,
    });
    expect(parseGatewayConfig({ ...base, MCP_DEV_SESSION_PASSTHROUGH: "1" }).auth).toEqual({
      exchange: null,
      devSessionPassthrough: true,
    });
    expect(parseGatewayConfig({ ...base, ...exchange, MCP_DEV_SESSION_PASSTHROUGH: "1" }).auth.devSessionPassthrough).toBe(true);
    expect(() =>
      parseGatewayConfig({ ...base, ...exchange, MCP_DEV_SESSION_PASSTHROUGH: "1", NODE_ENV: "production" }),
    ).toThrow(/NODE_ENV.*MCP_DEV_SESSION_PASSTHROUGH/);
  });
});

describe("exchange cache lifetime and capacity", () => {
  const config = parseGatewayConfig({
    WORKSPACE_ORIGIN: identityOrigin,
    MCP_STAGING_DIRECTORY: testStagingDirectory(), MCP_PUBLIC_URL: "http://127.0.0.1:3930/mcp",
    MCP_OAUTH_CLIENT_ID: "id",
    MCP_OAUTH_CLIENT_SECRET: clientSecret,
  });

  function success(expiresIn = 600): Response {
    const body = {
      access_token: "downstream-session",
      expires_in: expiresIn,
      scope: "read",
      subject: { kind: "pat", id: "pat-1", client_id: null },
      user: { id: "user-1", displayName: "alice" },
    };
    // Capacity tests reuse parsed replies instead of creating thousands of HTTP body streams.
    return Object.assign(new Response(), { json: async () => body });
  }

  it("keeps a valid cached session through 2,000 distinct invalid tokens", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) =>
      new URLSearchParams(String(init?.body)).get("subject_token") === "uvw_pat_full"
        ? success()
        : Response.json({ error: "invalid_grant" }, { status: 400 }),
    );
    const { authenticate } = createAuthenticator(config, pino({ level: "silent" }), fetcher);
    const valid = await authenticate("uvw_pat_full", "test");
    for (let i = 0; i < 2_000; i += 1) expect(await authenticate(`uvw_pat_invalid_${i}`, "test")).toBeNull();
    expect(await authenticate("uvw_pat_full", "test")).toEqual(valid);
    expect(fetcher).toHaveBeenCalledTimes(2_001);
  });

  it("evicts only the failed object and preserves pending recovery and its fresh session", async () => {
    const gate = deferred();
    const fetcher = vi.fn<typeof fetch>(async () => {
      if (fetcher.mock.calls.length > 1) await gate.promise;
      return success();
    });
    const { authenticate, evict } = createAuthenticator(config, pino({ level: "silent" }), fetcher);
    const failed = await authenticate("uvw_pat_full", "test");
    expect(failed).not.toBeNull();
    evict("uvw_pat_full", failed!);
    const recovery = authenticate("uvw_pat_full", "test");
    evict("uvw_pat_full", failed!);
    const shared = authenticate("uvw_pat_full", "test");
    gate.resolve();
    const fresh = await recovery;
    expect(await shared).toBe(fresh);
    evict("uvw_pat_full", failed!);
    expect(await authenticate("uvw_pat_full", "test")).toBe(fresh);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps a settled session through more than 10,000 pending unknown tokens", async () => {
    const gate = deferred();
    const response = success();
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      if (new URLSearchParams(String(init?.body)).get("subject_token") === "uvw_pat_full") return response;
      await gate.promise;
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    });
    const { authenticate } = createAuthenticator(config, pino({ level: "silent" }), fetcher);
    const valid = await authenticate("uvw_pat_full", "test");
    const pending = Array.from({ length: 10_001 }, (_, i) => authenticate(`uvw_pat_invalid_${i}`, "test"));
    try {
      expect(await authenticate("uvw_pat_full", "test")).toBe(valid);
      expect(fetcher).toHaveBeenCalledTimes(10_002);
    } finally {
      gate.resolve();
      await Promise.all(pending);
    }
    expect(await authenticate("uvw_pat_full", "test")).toBe(valid);
  });

  it("sweeps expired positive entries before evicting a live entry at capacity", async () => {
    let now = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    const liveResponse = success();
    const shortResponse = success(6);
    const fetcher = vi.fn<typeof fetch>(async (_input, init) =>
      new URLSearchParams(String(init?.body)).get("subject_token") === "uvw_pat_live"
        ? liveResponse
        : shortResponse,
    );
    const { authenticate } = createAuthenticator(config, pino({ level: "silent" }), fetcher);
    try {
      const live = await authenticate("uvw_pat_live", "test");
      for (let i = 0; i < 9_999; i += 1) await authenticate(`uvw_pat_short_${i}`, "test");
      now += 1_000;
      await authenticate("uvw_pat_new", "test");
      expect(await authenticate("uvw_pat_live", "test")).toEqual(live);
      expect(fetcher).toHaveBeenCalledTimes(10_001);
      await authenticate("uvw_pat_short_9998", "test");
      expect(fetcher).toHaveBeenCalledTimes(10_002);
    } finally {
      clock.mockRestore();
    }
  });

  it("shares and caches every exchange beyond 10,000 pending tokens", async () => {
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    const response = success();
    const fetcher = vi.fn<typeof fetch>(async () => {
      await gate;
      return response;
    });
    const { authenticate } = createAuthenticator(config, pino({ level: "silent" }), fetcher);
    const pending = Array.from({ length: 10_000 }, (_, i) => authenticate(`uvw_pat_${i}`, "test"));
    const overflow = authenticate("uvw_pat_overflow", "test");
    const shared = authenticate("uvw_pat_overflow", "test");
    const first = authenticate("uvw_pat_0", "test");
    const last = authenticate("uvw_pat_9999", "test");
    resume();
    const values = await Promise.all(pending);
    expect(await first).toEqual(values[0]);
    expect(await last).toEqual(values[9999]);
    expect(await shared).toBe(await overflow);
    expect(fetcher).toHaveBeenCalledTimes(10_001);
    expect(await authenticate("uvw_pat_overflow", "test")).toBe(await overflow);
    expect(fetcher).toHaveBeenCalledTimes(10_001);
  });

  it("skips an older in-flight exchange when evicting a completed entry", async () => {
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    const response = success();
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      if (new URLSearchParams(String(init?.body)).get("subject_token") === "uvw_pat_pending") await gate;
      return response;
    });
    const { authenticate } = createAuthenticator(config, pino({ level: "silent" }), fetcher);
    const pending = authenticate("uvw_pat_pending", "test");
    for (let i = 0; i < 10_000; i += 1) await authenticate(`uvw_pat_${i}`, "test");
    const shared = authenticate("uvw_pat_pending", "test");
    resume();
    expect(await shared).toEqual(await pending);
    expect(fetcher).toHaveBeenCalledTimes(10_001);
    await authenticate("uvw_pat_0", "test");
    expect(fetcher).toHaveBeenCalledTimes(10_002);
  });

  it("retries a negative entry after five seconds and evicts the oldest entry at capacity", async () => {
    let calls = 0;
    const authenticate = createAuthenticator(config, pino({ level: "silent" }), async () => {
      calls += 1;
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    }).authenticate;
    let now = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      expect(await authenticate("uvw_pat_first", "test")).toBeNull();
      now += 4999;
      expect(await authenticate("uvw_pat_first", "test")).toBeNull();
      expect(calls).toBe(1);
      now += 1;
      expect(await authenticate("uvw_pat_first", "test")).toBeNull();
      expect(calls).toBe(2);
      for (let i = 0; i < 1_000; i += 1) await authenticate(`uvw_pat_${i}`, "test");
      expect(await authenticate("uvw_pat_999", "test")).toBeNull();
      expect(calls).toBe(1_002);
      expect(await authenticate("uvw_pat_first", "test")).toBeNull();
      expect(calls).toBe(1_003);
    } finally {
      clock.mockRestore();
    }
  });
});
