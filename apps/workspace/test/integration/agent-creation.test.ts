import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSqliteTestApplication, type SqliteTestApplication } from "../support/sqlite/test-application.js";
import { loadConfig, type WorkspaceConfig } from "../../server/src/config.js";

const GATEWAY_ID = "univer-workspace-mcp-gateway";
const GATEWAY_SECRET = "test-gateway-secret-at-least-32-characters";
const RESOURCE = "https://mcp.example.test/mcp";
const USERNAME = /^[\p{L}\p{N}._-]{1,64}$/u;
const DAY = 24 * 60 * 60 * 1000;
const THIRTY_DAYS = 30 * DAY;

interface Agent {
  readonly id: string;
  readonly username: string;
}

const applications: SqliteTestApplication[] = [];
const servers: Server[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(applications.splice(0).map((application) => application.close()));
});

describe("POST /api/agents", () => {
  it("creates an agent with a Personal Space and a token the MCP gateway can exchange", async () => {
    const { origin, application } = await start({ mcpOAuth: { issuer: "https://space.example.test", resources: [RESOURCE], maxRegisteredClients: 100 } });
    const before = Date.now();
    const response = await post(origin, "/api/agents", { label: "Claude Code" });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    const body = (await response.json()) as { agent: Agent; token: string; mcpUrl: string | null; expiresAt: number };
    expect(Object.keys(body).sort()).toEqual(["agent", "expiresAt", "mcpUrl", "token"]);
    expect(Object.keys(body.agent).sort()).toEqual(["id", "username"]);
    expect(body.agent.username).toMatch(/^claude-code-[a-z0-9]{4}$/u);
    expect(body.mcpUrl).toBe(RESOURCE);
    expect(body.expiresAt).toBeGreaterThanOrEqual(before + THIRTY_DAYS);
    expect(body.expiresAt).toBeLessThanOrEqual(Date.now() + THIRTY_DAYS);

    const exchanged = await exchange(origin, body.token);
    expect(exchanged.status).toBe(200);
    const downstream = (await exchanged.json()) as { access_token: string; scope: string; user: Agent };
    expect(downstream.user).toMatchObject(body.agent);
    expect(downstream.scope).toBe("read write publish worktree:merge");
    const cookie = `workspace_session=${downstream.access_token}`;
    expect(await (await fetch(`${origin}/api/session`, { headers: { cookie } })).json()).toMatchObject({
      authenticated: true,
      user: { ...body.agent, displayName: "Claude Code" },
      authenticationMethods: { password: false, email: null, externalIdentities: [] },
    });
    expect(await (await fetch(`${origin}/api/spaces`, { headers: { cookie } })).json()).toMatchObject({
      spaces: [{ type: "personal" }],
    });

    expect({ ...application.database.connection.prepare(
      `SELECT users.kind, agents.owner_user_id, agents.claimed_at, agents.origin_label,
              agents.last_active_at = agents.created_at AS fresh, agents.expires_at, agents.banned_at
       FROM agents JOIN users ON users.id = agents.user_id WHERE agents.user_id = ?`
    ).get(body.agent.id) }).toEqual({
      kind: "agent",
      owner_user_id: null,
      claimed_at: null,
      origin_label: "Claude Code",
      fresh: 1,
      expires_at: body.expiresAt,
      banned_at: null,
    });
  });

  it("names agents from the label, defaults to agent, and never repeats a username", async () => {
    const { origin } = await start({ agentCreateLimitPerHour: 100 });
    const create = async (body: unknown) => ((await (await post(origin, "/api/agents", body)).json()) as { agent: Agent; mcpUrl: string | null });

    const unlabelled = await create(undefined);
    expect(unlabelled.agent.username).toMatch(/^agent-[a-z0-9]{4}$/u);
    expect(unlabelled.mcpUrl).toBeNull();
    expect((await create({ label: "   " })).agent.username).toMatch(/^agent-[a-z0-9]{4}$/u);
    expect((await create({ label: "  My  Büdget_Bot!! " })).agent.username).toMatch(/^my-büdget-bot-[a-z0-9]{4}$/u);
    expect((await create({ label: "预算 助手" })).agent.username).toMatch(/^预算-助手-[a-z0-9]{4}$/u);
    expect((await create({ label: "🤖🤖" })).agent.username).toMatch(/^agent-[a-z0-9]{4}$/u);
    // The 48-unit slug cut lands inside an astral letter here and must not leave half of it.
    expect((await create({ label: `a${"𠀀".repeat(31)}` })).agent.username).toMatch(/^a𠀀{23}-[a-z0-9]{4}$/u);

    const agents = await Promise.all(Array.from({ length: 30 }, () => create({ label: "x".repeat(64) })));
    for (const { agent } of agents) expect(agent.username).toMatch(USERNAME);
    expect(new Set(agents.map(({ agent }) => agent.username)).size).toBe(30);
    expect(new Set(agents.map(({ agent }) => agent.id)).size).toBe(30);
  });

  it("removes control and bidi characters from an explicit label on both creation endpoints", async () => {
    const { origin, application } = await start({ agentCreateLimitPerHour: 100 });
    const sessionUser = async (cookie: string) =>
      ((await (await fetch(`${origin}/api/session`, { headers: { cookie } })).json()) as { user: Agent & { displayName: string } }).user;
    const viaApi = async (label: string) => {
      const { token } = (await (await post(origin, "/api/agents", { label })).json()) as { token: string };
      const { access_token } = (await (await exchange(origin, token)).json()) as { access_token: string };
      return sessionUser(`workspace_session=${access_token}`);
    };
    const viaGuest = async (label: string) =>
      sessionUser((await post(origin, "/api/auth/guest", { label })).headers.get("set-cookie")!.split(";", 1)[0]!);

    for (const create of [viaApi, viaGuest]) {
      const agent = await create("\u202EBudget\nbot\u200B\u0000");
      expect(agent.displayName).toBe("Budget bot");
      expect(agent.username).toMatch(/^budget-bot-[a-z0-9]{4}$/u);
      expect(application.database.connection.prepare("SELECT origin_label FROM agents WHERE user_id = ?").get(agent.id))
        .toEqual({ origin_label: "Budget bot" });
      for (const invisible of ["\u202E\u2066\r\n", "\u3164\u2800", "\u115F\u1160\uFFA0"]) {
        expect(await create(invisible)).toMatchObject({ displayName: "agent", username: expect.stringMatching(/^agent-[a-z0-9]{4}$/u) });
      }
    }
  });

  it("rejects a label that is not a string of at most 64 characters without spending the rate limit", async () => {
    const { origin } = await start({ agentCreateLimitPerHour: 1 });
    for (const label of [5, null, ["a"], "x".repeat(65), "\u{1F916}".repeat(65)]) {
      const response = await post(origin, "/api/agents", { label });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "INVALID_INPUT", field: "label" } });
    }
    expect((await post(origin, "/api/agents", { label: "\u{1F916}".repeat(64) })).status).toBe(201);
  });
});

describe("POST /api/auth/guest", () => {
  it("creates an agent and signs a CLI in as it, with a session that renews while in use", async () => {
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    const { origin } = await start();
    const response = await post(origin, "/api/auth/guest", {});
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { agent: Agent };
    expect(Object.keys(body)).toEqual(["agent"]);
    expect(body.agent.username).toMatch(/^agent-[a-z0-9]{4}$/u);
    const setCookie = response.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/^workspace_session=[^;]+;.*HttpOnly/u);

    const cookie = setCookie.split(";", 1)[0]!;
    const session = async () => (await (await fetch(`${origin}/api/session`, { headers: { cookie } })).json()) as { authenticated: boolean };
    expect(await session()).toMatchObject({ authenticated: true, user: body.agent });
    vi.setSystemTime(Date.now() + 0.75 * DAY);
    expect(await session()).toMatchObject({ authenticated: true });
    vi.setSystemTime(Date.now() + 0.5 * DAY);
    expect(await session(), "used past its first day, it lives on").toMatchObject({ authenticated: true });
  });
});

describe("POST /api/auth/authorize/guest", () => {
  it("names the guest after the registered OAuth client, cleaned, bounded and told apart by a suffix", async () => {
    const { origin } = await start({
      agentCreateLimitPerHour: 100,
      mcpOAuth: { issuer: "https://space.example.test", resources: [RESOURCE], maxRegisteredClients: 100 },
    });
    const register = async (clientName?: string) => {
      const response = await post(origin, "/api/auth/register", {
        redirect_uris: ["http://127.0.0.1:9/callback"],
        ...(clientName === undefined ? {} : { client_name: clientName }),
      });
      expect(response.status).toBe(201);
      return ((await response.json()) as { client_id: string }).client_id;
    };
    const guest = async (clientId: string) => {
      const oauthAuthorization = new URLSearchParams({
        response_type: "code", client_id: clientId, redirect_uri: "http://127.0.0.1:9/callback", resource: RESOURCE,
        code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", code_challenge_method: "S256",
      }).toString();
      const response = await post(origin, "/api/auth/authorize/guest", { oauthAuthorization });
      expect(response.status).toBe(200);
      const code = new URL(((await response.json()) as { redirectUrl: string }).redirectUrl).searchParams.get("code")!;
      const issued = await fetch(`${origin}/api/auth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code", client_id: clientId, code, redirect_uri: "http://127.0.0.1:9/callback",
          code_verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", resource: RESOURCE,
        }),
      });
      const { access_token: accessToken } = (await issued.json()) as { access_token: string };
      return ((await (await exchange(origin, accessToken, RESOURCE)).json()) as { user: { username: string; displayName: string } }).user;
    };

    const claudeCode = await register("Claude Code");
    const first = await guest(claudeCode);
    const second = await guest(claudeCode);
    expect(first.username).toMatch(/^claude-code-[a-z0-9]{4}$/u);
    expect(first.displayName).toBe(`Claude Code · ${first.username.slice(-4)}`);
    expect(second.displayName).not.toBe(first.displayName);

    const hostile = await guest(await register(`\u202EClaude\nCode\u200B\u0000 ${"x".repeat(80)}`));
    expect(hostile.displayName).toBe(`Claude Code ${"x".repeat(28)} · ${hostile.username.slice(-4)}`);

    const surrogate = await guest(await register("Claude\uD800Code"));
    expect(surrogate.displayName).toBe(`ClaudeCode · ${surrogate.username.slice(-4)}`);

    for (const clientId of [await register(), await register("\u202E\u2066\n"), await register("\u3164\u2800")]) {
      const unnamed = await guest(clientId);
      expect(unnamed.username).toMatch(/^agent-[a-z0-9]{4}$/u);
      expect(unnamed.displayName).toBe("agent");
    }
  });

  it("refuses with 409 when the request already carries a valid session, and keeps that session", async () => {
    const { origin, application } = await start();
    const registered = await post(origin, "/api/auth/password/register", {
      username: "alice",
      displayName: "Alice",
      password: "correct horse battery staple",
    });
    const cookie = registered.headers.get("set-cookie")!.split(";", 1)[0]!;

    const refused = await post(origin, "/api/auth/guest", {}, { cookie });
    expect(refused.status).toBe(409);
    expect(refused.headers.get("set-cookie")).toBeNull();
    expect(await refused.json()).toMatchObject({ error: { code: "CONFLICT" } });
    expect(await (await fetch(`${origin}/api/session`, { headers: { cookie } })).json()).toMatchObject({
      authenticated: true,
      user: { username: "alice" },
    });
    expect(application.database.connection.prepare("SELECT count(*) AS n FROM agents").get()?.n).toBe(0);

    const stale = await post(origin, "/api/auth/guest", {}, { cookie: "workspace_session=not-a-session" });
    expect(stale.status).toBe(201);
  });
});

describe("agent creation rate limit", () => {
  it("refuses the sixth creation from one source across both endpoints by default", async () => {
    const { origin } = await start();
    for (const path of ["/api/agents", "/api/auth/guest", "/api/agents", "/api/auth/guest", "/api/agents"]) {
      expect((await post(origin, path, {})).status).toBe(201);
    }
    for (const path of ["/api/agents", "/api/auth/guest"]) {
      const refused = await post(origin, path, {});
      expect(refused.status).toBe(429);
      expect(refused.headers.get("set-cookie")).toBeNull();
      expect(await refused.json()).toMatchObject({ error: { code: "AGENT_CREATE_RATE_LIMITED" } });
    }
  });

  it("ignores X-Forwarded-For unless TRUST_PROXY is configured", async () => {
    const untrusted = await start({ agentCreateLimitPerHour: 1 });
    expect((await post(untrusted.origin, "/api/agents", {}, { "x-forwarded-for": "203.0.113.1" })).status).toBe(201);
    expect((await post(untrusted.origin, "/api/agents", {}, { "x-forwarded-for": "203.0.113.2" })).status).toBe(429);

    const trusted = await start({ agentCreateLimitPerHour: 1, trustProxy: 1 });
    expect((await post(trusted.origin, "/api/agents", {}, { "x-forwarded-for": "203.0.113.1" })).status).toBe(201);
    expect((await post(trusted.origin, "/api/agents", {}, { "x-forwarded-for": "203.0.113.2" })).status).toBe(201);
    expect((await post(trusted.origin, "/api/agents", {}, { "x-forwarded-for": "203.0.113.1" })).status).toBe(429);
    expect((await post(trusted.origin, "/api/agents", {}, { "x-forwarded-for": "2001:db8:1:2::1" })).status).toBe(201);
    expect((await post(trusted.origin, "/api/agents", {}, { "x-forwarded-for": "2001:db8:1:2::2" })).status).toBe(429);
  });

  it("disables creation when the limit is 0", async () => {
    const { origin } = await start({ agentCreateLimitPerHour: 0 });
    expect(await (await fetch(`${origin}/api/session`)).json()).toMatchObject({ guestAuthEnabled: false });
    for (const path of ["/api/agents", "/api/auth/guest"]) {
      const refused = await post(origin, path, {});
      expect(refused.status).toBe(429);
      expect(await refused.json()).toMatchObject({ error: { code: "AGENT_CREATE_RATE_LIMITED" } });
    }
  });

  it("reads AGENT_CREATE_LIMIT_PER_HOUR and TRUST_PROXY from the environment", () => {
    expect(loadConfig({})).toMatchObject({ agentCreateLimitPerHour: 5 });
    expect(loadConfig({})).not.toHaveProperty("trustProxy");
    expect(loadConfig({ AGENT_CREATE_LIMIT_PER_HOUR: "0" }).agentCreateLimitPerHour).toBe(0);
    expect(loadConfig({ AGENT_CREATE_LIMIT_PER_HOUR: "20" }).agentCreateLimitPerHour).toBe(20);
    for (const value of ["-1", "1.5", "many"]) {
      expect(() => loadConfig({ AGENT_CREATE_LIMIT_PER_HOUR: value })).toThrow(/AGENT_CREATE_LIMIT_PER_HOUR/u);
    }
    expect(loadConfig({ TRUST_PROXY: "true" }).trustProxy).toBe(true);
    expect(loadConfig({ TRUST_PROXY: "false" }).trustProxy).toBe(false);
    expect(loadConfig({ TRUST_PROXY: "2" }).trustProxy).toBe(2);
    expect(loadConfig({ TRUST_PROXY: "loopback, 10.0.0.0/8" }).trustProxy).toBe("loopback, 10.0.0.0/8");
  });
});

async function start(config: Partial<WorkspaceConfig> = {}): Promise<{ origin: string; application: SqliteTestApplication }> {
  const application = await createSqliteTestApplication({
    host: "127.0.0.1",
    port: 0,
    database: { provider: "sqlite", filename: ":memory:", collaborationFilename: ":memory:" },
    secureCookies: false,
    sessionTtlMs: 24 * 60 * 60_000,
    passwordAuthEnabled: true,
    emailAuth: null,
    oauthClients: {
      clients: [{ clientId: GATEWAY_ID, clientType: "confidential", clientSecret: GATEWAY_SECRET, tokenExchange: true, redirectUris: ["https://gw.example.test/cb"], scopes: ["identity"] }],
    },
    ...config,
  }, {
    unitStore: { createUnit: async (input) => ({ unitId: input.unitId, headRevision: 1 }) },
  });
  applications.push(application);
  const server = createServer(application.app);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not expose a TCP address");
  return { origin: `http://127.0.0.1:${address.port}`, application };
}

function post(origin: string, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method: "POST",
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function exchange(origin: string, subjectToken: string, resource?: string): Promise<Response> {
  return fetch(`${origin}/api/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      client_id: GATEWAY_ID,
      client_secret: GATEWAY_SECRET,
      subject_token: subjectToken,
      ...(resource === undefined ? {} : { resource }),
    }),
  });
}
