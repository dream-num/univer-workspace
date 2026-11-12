import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceApplication, type WorkspaceApplication } from "../../server/src/app.js";

const ISSUER = "https://space.example.test";
const RESOURCE = `${ISSUER}/mcp`;
const GATEWAY_ID = "univer-workspace-mcp-gateway";
const GATEWAY_SECRET = "test-gateway-secret-at-least-32-characters";
let application: WorkspaceApplication | undefined;
let server: Server | undefined;
let directory: string | undefined;

afterEach(async () => {
  if (server?.listening) await new Promise<void>((resolve) => server!.close(() => resolve()));
  await application?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
  application = server = directory = undefined;
});

describe("browser agent tokens", () => {
  it.each([["read"], ["read", "write"], ["write", "read"], ["read", "publish"], ["publish", "read"]].map((scopes) => ({ scopes })))("issues and exchanges $scopes", async ({ scopes }) => {
    const origin = await start();
    const cookie = await register(origin);
    const before = Date.now();
    const response = await post(origin, "/api/auth/agent-token", cookie, { scopes });
    const after = Date.now();
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body: { token: string; expiresAt: number; scopes: string[]; resource: string } = await response.json();
    expect(Object.keys(body).sort()).toEqual(["expiresAt", "resource", "scopes", "token"]);
    expect(body.token).toMatch(/^uvw_at_/u);
    expect(body.expiresAt).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(body.expiresAt).toBeLessThanOrEqual(after + 3_600_000);
    expect([...body.scopes].sort()).toEqual([...scopes].sort());
    expect(body.resource).toBe(RESOURCE);

    const exchanged = await exchange(origin, body.token, RESOURCE);
    expect(exchanged.status).toBe(200);
    const session: { access_token: string; scope: string; subject: { client_id: string } } = await exchanged.json();
    expect(session.scope.split(" ")).toEqual(body.scopes);
    expect(session.subject.client_id).toBe("univer-workspace-agents");
    if (scopes.length === 1) expect(session.scope.split(" ")).not.toContain("write");

    const forbidden = await post(origin, "/api/auth/agent-token", `workspace_session=${session.access_token}`, { scopes });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({ error: { code: "FORBIDDEN" } });

    const wrongResource = await exchange(origin, body.token, "https://other.example.test/mcp");
    expect(wrongResource.status).toBe(400);
    expect(await wrongResource.json()).toEqual({ error: "invalid_grant" });

    const listed = await fetch(`${origin}/api/auth/tokens`, { headers: { cookie } });
    expect(listed.status).toBe(200);
    const listedText = await listed.text();
    expect(JSON.parse(listedText)).toEqual({ tokens: [] });
    expect(listedText).not.toContain(body.token);
  });

  it("requires a signed-in user", async () => {
    const origin = await start();
    const response = await post(origin, "/api/auth/agent-token", undefined, { scopes: ["read"] });
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  it("rejects missing, empty, duplicate, unsupported and malformed scopes", async () => {
    const origin = await start();
    const cookie = await register(origin);
    for (const scopes of [
      undefined, [], ["read", "read"], ["read", "write", "write"], ["write"],
      ["publish"], ["worktree:merge"], ["read", "write", "publish"], ["read", "worktree:merge"],
      ["nope"], ["read", 1], ["READ"], "read", null, 1, {},
    ]) {
      const response = await post(origin, "/api/auth/agent-token", cookie, { scopes });
      expect(response.status, JSON.stringify(scopes)).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "INVALID_INPUT", field: "scopes" } });
    }
    expect(application!.database.connection.prepare("SELECT count(*) AS n FROM oauth_grants").get()).toEqual({ n: 0 });
  });

  it.each([{ resources: null }, { resources: ["https://other.example.test/mcp"] }])("returns 503 when the same-origin MCP resource is unavailable ($resources)", async ({ resources }) => {
    const origin = await start(resources);
    const cookie = await register(origin);
    const response = await post(origin, "/api/auth/agent-token", cookie, { scopes: ["read"] });
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body: { error: { code: string; message: string } } = await response.json();
    expect(body.error.code).toBe("OAUTH_CLIENT_UNAVAILABLE");
    expect(body.error.message).toContain("MCP_RESOURCE_URLS");
    expect(body.error.message).toContain("PUBLIC_ORIGIN");
    expect(application!.database.connection.prepare("SELECT count(*) AS n FROM oauth_grants").get()).toEqual({ n: 0 });
  });
});

function post(origin: string, path: string, cookie: string | undefined, body: unknown): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function register(origin: string): Promise<string> {
  const response = await post(origin, "/api/auth/password/register", undefined, {
    username: "alice", displayName: "Alice", password: "correct horse battery staple",
  });
  expect(response.status).toBe(201);
  return response.headers.get("set-cookie")!.split(";", 1)[0]!;
}

function exchange(origin: string, token: string, resource: string): Promise<Response> {
  return fetch(`${origin}/api/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      client_id: GATEWAY_ID, client_secret: GATEWAY_SECRET, subject_token: token, resource,
    }),
  });
}

async function start(resources: string[] | null = [RESOURCE]): Promise<string> {
  directory = mkdtempSync(join(tmpdir(), "univer-agent-token-"));
  application = createWorkspaceApplication({
    host: "127.0.0.1", port: 3020,
    databaseFilename: join(directory, "product.sqlite"),
    collaborationDatabaseFilename: join(directory, "collaboration.sqlite"),
    secureCookies: false,
    sessionTtlMs: 24 * 60 * 60_000,
    passwordAuthEnabled: true,
    emailAuth: null,
    ...(resources === null ? {} : { mcpOAuth: { issuer: ISSUER, resources, maxRegisteredClients: 100 } }),
    oauthClients: { clients: [{
      clientId: GATEWAY_ID, clientSecret: GATEWAY_SECRET, tokenExchange: true,
      redirectUris: ["https://gw.example.test/cb"], scopes: ["identity"],
    }] },
  });
  server = createServer(application.app);
  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not expose a TCP address");
  return `http://127.0.0.1:${address.port}`;
}
