import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceApplication, type WorkspaceApplication } from "../../server/src/app.js";
import type { WorkspaceConfig } from "../../server/src/config.js";

const GATEWAY_ID = "univer-workspace-mcp-gateway";
const GATEWAY_SECRET = "test-gateway-secret-at-least-32-characters";

interface Agent {
  readonly id: string;
  readonly username: string;
  /** The Workspace session the MCP gateway gets for the agent's personal access token. */
  readonly cookie: string;
  readonly token: string;
}

const applications: WorkspaceApplication[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(applications.splice(0).map((application) => application.close()));
});

describe("principal kind", () => {
  it("shows an agent's kind and claim in its session and in the token exchange, and only the kind for a human", async () => {
    const { origin, application } = await start();
    const agent = await createAgent(origin);
    const exchanged = (await (await exchange(origin, agent.token)).json()) as { user: unknown };
    const agentUser = { id: agent.id, username: agent.username, displayName: "agent", avatarUrl: null, kind: "agent", claimed: false };
    expect(exchanged.user).toEqual(agentUser);
    expect(await session(origin, agent.cookie)).toMatchObject({ authenticated: true, user: agentUser });

    const human = await register(origin, "alice");
    application.database.connection
      .prepare("UPDATE agents SET owner_user_id = ?, claimed_at = 1 WHERE user_id = ?")
      .run(human.id, agent.id);
    expect((await session(origin, agent.cookie)).user).toEqual({ ...agentUser, claimed: true });
    expect((await session(origin, human.cookie)).user).toEqual({
      id: human.id, username: "alice", displayName: "alice", avatarUrl: null, kind: "human",
    });
  });
});

describe("a banned agent", () => {
  it("is unauthenticated on its sessions and gets invalid_grant from the token exchange", async () => {
    const { origin, application } = await start();
    const agent = await createAgent(origin);
    const guest = await post(origin, "/api/auth/guest", {});
    const guestCookie = guest.headers.get("set-cookie")!.split(";")[0]!;
    const guestId = ((await guest.json()) as { agent: { id: string } }).agent.id;
    expect((await fetch(`${origin}/api/spaces`, { headers: { cookie: agent.cookie } })).status).toBe(200);

    application.database.connection
      .prepare("UPDATE agents SET banned_at = ? WHERE user_id IN (?, ?)")
      .run(Date.now(), agent.id, guestId);

    for (const cookie of [agent.cookie, guestCookie]) {
      const refused = await fetch(`${origin}/api/spaces`, { headers: { cookie } });
      expect(refused.status).toBe(401);
      expect(await refused.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
      expect(await session(origin, cookie)).toMatchObject({ authenticated: false });
      expect(application.identity.getRealtimeSession(cookie)).toBeNull();
    }
    const refused = await exchange(origin, agent.token);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: "invalid_grant" });
  });
});

async function start(config: Partial<WorkspaceConfig> = {}): Promise<{ origin: string; application: WorkspaceApplication }> {
  const application = createWorkspaceApplication({
    host: "127.0.0.1",
    port: 0,
    databaseFilename: ":memory:",
    collaborationDatabaseFilename: ":memory:",
    secureCookies: false,
    sessionTtlMs: 24 * 60 * 60_000,
    passwordAuthEnabled: true,
    emailAuth: null,
    agentCreateLimitPerHour: 100,
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

async function createAgent(origin: string): Promise<Agent> {
  const created = (await (await post(origin, "/api/agents", {})).json()) as { agent: { id: string; username: string }; token: string };
  return { ...created.agent, token: created.token, cookie: await tokenSession(origin, created.token) };
}

async function tokenSession(origin: string, token: string): Promise<string> {
  const response = await exchange(origin, token);
  if (response.status !== 200) throw new Error(`Token exchange failed with ${response.status}`);
  return `workspace_session=${((await response.json()) as { access_token: string }).access_token}`;
}

async function register(origin: string, username: string): Promise<{ id: string; cookie: string }> {
  const response = await post(origin, "/api/auth/password/register", { username, displayName: username, password: "correct horse battery staple" });
  if (response.status !== 201) throw new Error(`Registration failed with ${response.status}`);
  const body = (await response.json()) as { user: { id: string } };
  return { id: body.user.id, cookie: response.headers.get("set-cookie")!.split(";")[0]! };
}

async function session(origin: string, cookie: string): Promise<{ authenticated: boolean; user?: unknown }> {
  return (await (await fetch(`${origin}/api/session`, { headers: { cookie } })).json()) as { authenticated: boolean; user?: unknown };
}

function post(origin: string, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return send(origin, "POST", path, body, headers);
}

function send(origin: string, method: string, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function exchange(origin: string, subjectToken: string): Promise<Response> {
  return fetch(`${origin}/api/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      client_id: GATEWAY_ID,
      client_secret: GATEWAY_SECRET,
      subject_token: subjectToken,
    }),
  });
}
