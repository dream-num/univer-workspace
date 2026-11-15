import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceApplication, type WorkspaceApplication } from "../../server/src/app.js";
import type { WorkspaceConfig } from "../../server/src/config.js";
import { createStaticSiteRouter } from "../../server/src/middleware/static-site.js";

const GATEWAY_ID = "univer-workspace-mcp-gateway";
const GATEWAY_SECRET = "test-gateway-secret-at-least-32-characters";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

interface Agent {
  readonly id: string;
  readonly username: string;
  /** The Workspace session the MCP gateway gets for the agent's personal access token. */
  readonly cookie: string;
  readonly token: string;
}

const applications: WorkspaceApplication[] = [];
const servers: Server[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(applications.splice(0).map((application) => application.close()));
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
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

describe("access rules for agents", () => {
  it("holds an unclaimed agent to Viewer on an Editor link, like the anonymous reader", async () => {
    const { origin, application } = await start();
    const owner = await register(origin, "owner");
    const other = await register(origin, "other");
    const agent = await createAgent(origin);
    const nodeId = await createFile(origin, owner.cookie, "Shared sheet");
    expect((await put(origin, `/api/nodes/${nodeId}/link-sharing`, { enabled: true, role: "editor" }, owner.cookie)).status).toBe(200);

    expect(await accessRole(origin, nodeId, other.cookie)).toBe("editor");
    expect(await accessRole(origin, nodeId, undefined)).toBe("viewer");
    expect(await accessRole(origin, nodeId, agent.cookie)).toBe("viewer");

    application.database.connection
      .prepare("UPDATE agents SET owner_user_id = ?, claimed_at = 1 WHERE user_id = ?")
      .run(owner.id, agent.id);
    expect(await accessRole(origin, nodeId, agent.cookie)).toBe("editor");
  });

  it("gives nobody but the owner a role in a suspended agent's Space, in lookups and listings alike", async () => {
    const { origin, application } = await start();
    const reader = await register(origin, "reader");
    const agent = await createAgent(origin);
    const nodeId = await createFile(origin, agent.cookie, "Agent sheet");
    expect((await put(origin, `/api/nodes/${nodeId}/link-sharing`, { enabled: true, role: "viewer" }, agent.cookie)).status).toBe(200);
    expect((await put(origin, `/api/nodes/${nodeId}/grants/${reader.id}`, { role: "editor" }, agent.cookie)).status).toBe(200);
    const sharedWithReader = async () =>
      ((await (await fetch(`${origin}/api/shared-with-me`, { headers: { cookie: reader.cookie } })).json()) as { items: unknown[] }).items.length;
    const suspend = (column: "expires_at" | "banned_at", value: number | null) =>
      application.database.connection.prepare(`UPDATE agents SET ${column} = ? WHERE user_id = ?`).run(value, agent.id);

    for (const [column, lifted] of [["expires_at", Date.now() + 60_000], ["banned_at", null]] as const) {
      expect(await accessRole(origin, nodeId, undefined)).toBe("viewer");
      expect(await accessRole(origin, nodeId, reader.cookie)).toBe("editor");
      expect(await sharedWithReader()).toBe(1);

      suspend(column, Date.now() - 1);
      expect(await accessRole(origin, nodeId, undefined)).toBeNull();
      expect(await accessRole(origin, nodeId, reader.cookie)).toBeNull();
      expect(await sharedWithReader()).toBe(0);
      expect(application.access.resolveNode(agent.id, nodeId)?.role).toBe("owner");
      suspend(column, lifted);
    }
    expect(await accessRole(origin, nodeId, undefined)).toBe("viewer");
  });
});

describe("agent expiry", () => {
  it("moves an unclaimed agent's expiry 30 days out when it authenticates, at most once a day", async () => {
    const { origin, application } = await start();
    const agent = await createAgent(origin);
    const lifecycle = agentLifecycle(application, agent.id);
    const authenticate = () => fetch(`${origin}/api/spaces`, { headers: { cookie: agent.cookie } });

    lifecycle.set({ last_active_at: Date.now() - 25 * HOUR, expires_at: Date.now() + DAY });
    let before = Date.now();
    expect((await authenticate()).status).toBe(200);
    expect(lifecycle.get().last_active_at).toBeGreaterThanOrEqual(before);
    expect(lifecycle.get().expires_at).toBeGreaterThanOrEqual(before + 30 * DAY);

    // Seen within the day: the next request leaves the row alone.
    lifecycle.set({ last_active_at: Date.now() - 23 * HOUR, expires_at: 1 });
    await authenticate();
    await exchange(origin, agent.token);
    expect(lifecycle.get().expires_at).toBe(1);

    lifecycle.set({ last_active_at: Date.now() - 25 * HOUR, expires_at: 1 });
    before = Date.now();
    expect((await exchange(origin, agent.token)).status).toBe(200);
    expect(lifecycle.get().expires_at).toBeGreaterThanOrEqual(before + 30 * DAY);

    const human = await register(origin, "claimer");
    application.database.connection
      .prepare("UPDATE agents SET owner_user_id = ?, claimed_at = 1, expires_at = NULL, last_active_at = 0 WHERE user_id = ?")
      .run(human.id, agent.id);
    await authenticate();
    expect(lifecycle.get()).toEqual({ last_active_at: 0, expires_at: null });
  });

  it("closes an expired agent's link to anonymous readers until the agent is active again", async () => {
    const { origin, application } = await start();
    const pages = await startPages(application);
    const agent = await createAgent(origin);
    const nodeId = await createFile(origin, agent.cookie, "Budget");
    await put(origin, `/api/nodes/${nodeId}/link-sharing`, { enabled: true, role: "viewer" }, agent.cookie);
    const lifecycle = agentLifecycle(application, agent.id);
    const page = async () => (await fetch(`${pages}/nodes/${nodeId}`)).text();
    expect(await page()).toContain("<title>Budget · Univer Workspace</title>");

    const expired = { last_active_at: Date.now() - 31 * DAY, expires_at: Date.now() - DAY };
    lifecycle.set(expired);
    expect(await accessRole(origin, nodeId, undefined)).toBeNull();
    expect(await page()).toContain("<title>Univer Workspace</title>");
    expect(lifecycle.get()).toEqual(expired);

    expect((await fetch(`${origin}/api/spaces`, { headers: { cookie: agent.cookie } })).status).toBe(200);
    expect(await accessRole(origin, nodeId, undefined)).toBe("viewer");
    expect(await page()).toContain("<title>Budget · Univer Workspace</title>");
  });

  it("moves the expiry out when a reader opens the agent's shared page, at most once a day", async () => {
    const { origin, application } = await start();
    const pages = await startPages(application);
    const agent = await createAgent(origin);
    const nodeId = await createFile(origin, agent.cookie, "Budget");
    await put(origin, `/api/nodes/${nodeId}/link-sharing`, { enabled: true, role: "viewer" }, agent.cookie);
    const privateNodeId = await createFile(origin, agent.cookie, "Private");
    const lifecycle = agentLifecycle(application, agent.id);

    lifecycle.set({ last_active_at: Date.now() - 25 * HOUR, expires_at: Date.now() + DAY });
    const stale = lifecycle.get();
    await fetch(`${pages}/nodes/${privateNodeId}`);
    expect(lifecycle.get()).toEqual(stale);

    const before = Date.now();
    await fetch(`${pages}/nodes/${nodeId}`);
    expect(lifecycle.get().last_active_at).toBeGreaterThanOrEqual(before);
    expect(lifecycle.get().expires_at).toBeGreaterThanOrEqual(before + 30 * DAY);

    lifecycle.set({ last_active_at: Date.now() - 23 * HOUR, expires_at: Date.now() + DAY });
    const fresh = lifecycle.get();
    await fetch(`${pages}/nodes/${nodeId}`);
    expect(lifecycle.get()).toEqual(fresh);
  });
});

function agentLifecycle(application: WorkspaceApplication, agentId: string) {
  type Lifecycle = { last_active_at: number; expires_at: number | null };
  return {
    get: (): Lifecycle => ({
      ...(application.database.connection
        .prepare("SELECT last_active_at, expires_at FROM agents WHERE user_id = ?")
        .get(agentId) as unknown as Lifecycle),
    }),
    set: (value: Lifecycle) => {
      application.database.connection
        .prepare("UPDATE agents SET last_active_at = ?, expires_at = ? WHERE user_id = ?")
        .run(value.last_active_at, value.expires_at, agentId);
    },
  };
}

/** The share-page route the production build mounts when the web bundle exists. */
async function startPages(application: WorkspaceApplication): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), "workspace-agent-pages-"));
  directories.push(directory);
  writeFileSync(join(directory, "index.html"), "<!doctype html><html><head><title>Univer Workspace</title></head><body></body></html>");
  const app = express();
  app.use(createStaticSiteRouter(directory, { nodes: application.nodes, identity: application.identity }));
  return listen(createServer(app));
}

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not expose a TCP address");
  return `http://127.0.0.1:${address.port}`;
}

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
  return { origin: await listen(createServer(application.app)), application };
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

async function createFile(origin: string, cookie: string, name: string): Promise<string> {
  const response = await createFileRequest(origin, cookie, name);
  if (response.status !== 201) throw new Error(`File creation failed with ${response.status}`);
  return ((await response.json()) as { node: { id: string } }).node.id;
}

async function createFileRequest(origin: string, cookie: string, name: string): Promise<Response> {
  const spaces = (await (await fetch(`${origin}/api/spaces`, { headers: { cookie } })).json()) as { spaces: { id: string; type: string }[] };
  return post(
    origin,
    "/api/resources",
    { kind: "univer", spaceId: spaces.spaces.find((space) => space.type === "personal")!.id, parentNodeId: null, name, unitType: "sheet" },
    { cookie, "idempotency-key": randomUUID() },
  );
}

/** The requester's role on the node, or null when the node route answers not found. */
async function accessRole(origin: string, nodeId: string, cookie: string | undefined): Promise<string | null> {
  const response = await fetch(`${origin}/api/nodes/${nodeId}`, { headers: cookie ? { cookie } : {} });
  if (response.status === 404) return null;
  return ((await response.json()) as { node: { accessRole: string } }).node.accessRole;
}

function put(origin: string, path: string, body: unknown, cookie: string): Promise<Response> {
  return send(origin, "PUT", path, body, { cookie });
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
