import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceConfig } from "../../server/src/config.js";
import { createProductTestApplication, type ProductTestApplication } from "../support/product-test-application.js";

const PASSWORD = "correct horse battery staple";
const NEW_PASSWORD = "another correct horse staple";
const GATEWAY = { client_id: "univer-workspace-mcp-gateway", client_secret: "test-gateway-secret-at-least-32-characters" };

const sockets: WebSocket[] = [];
let application: ProductTestApplication | undefined;
let server: Server | undefined;
let directory: string | undefined;

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  if (server?.listening) await new Promise<void>((resolve) => server!.close(() => resolve()));
  await application?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
  application = server = directory = undefined;
});

describe("changing the password", () => {
  it("ends the User's CLI sessions and keeps browser and token sessions", async () => {
    const origin = await start();
    const browser = await signIn(origin, "/api/auth/password/register", "alice", { displayName: "alice" });
    const otherBrowser = await signIn(origin, "/api/auth/password/login", "alice");
    const deviceCli = await approveCli(origin, browser);
    const passwordCli = await signIn(origin, "/api/auth/cli/password/login", "alice");
    const bob = await signIn(origin, "/api/auth/password/register", "bob", { displayName: "bob" });
    const bobCli = await signIn(origin, "/api/auth/cli/password/login", "bob");
    const created = await post(origin, "/api/auth/tokens", browser, { name: "agent" });
    const { token } = (await created.json()) as { token: string };
    const patSession = await exchange(origin, token);
    const cliSocket = await connect(origin, deviceCli);
    const browserSocket = await connect(origin, otherBrowser);
    const cliSocketClosed = closed(cliSocket);

    expect(await changePassword(origin, browser, PASSWORD, NEW_PASSWORD)).toBe(204);

    expect(await authenticated(origin, deviceCli), "a CLI session from device approval ends").toBe(false);
    expect(await authenticated(origin, passwordCli), "a CLI session from CLI password login ends").toBe(false);
    expect(await cliSocketClosed, "the ended CLI session's realtime socket closes").toBe(1008);
    expect(await authenticated(origin, browser), "the browser session that changed the password").toBe(true);
    expect(await authenticated(origin, otherBrowser), "another browser session").toBe(true);
    expect(browserSocket.readyState).toBe(WebSocket.OPEN);
    expect(await authenticated(origin, patSession), "a session issued for a PAT").toBe(true);
    expect(await authenticated(origin, await exchange(origin, token)), "the PAT itself").toBe(true);
    expect(await authenticated(origin, bobCli), "another User's CLI session").toBe(true);
    expect(await authenticated(origin, bob)).toBe(true);
  });

  it("keeps the CLI session that changes the password and ends the others", async () => {
    const origin = await start();
    await signIn(origin, "/api/auth/password/register", "alice", { displayName: "alice" });
    const changing = await signIn(origin, "/api/auth/cli/password/login", "alice");
    const other = await signIn(origin, "/api/auth/cli/password/login", "alice");

    expect(await changePassword(origin, changing, PASSWORD, NEW_PASSWORD)).toBe(204);

    expect(await authenticated(origin, changing)).toBe(true);
    expect(await authenticated(origin, other)).toBe(false);
  });
});

async function start(): Promise<string> {
  directory = mkdtempSync(join(tmpdir(), "univer-password-sessions-"));
  application = await createProductTestApplication({
    host: "127.0.0.1",
    port: 3020,
    productFilename: join(directory, "product.sqlite"),
    collaborationDatabaseFilename: join(directory, "collaboration.sqlite"),
    secureCookies: false,
    sessionTtlMs: 24 * 60 * 60_000,
    oauthClients: {
      clients: [{ clientId: GATEWAY.client_id, clientSecret: GATEWAY.client_secret, tokenExchange: true, redirectUris: ["https://gw.example.test/cb"], scopes: ["identity"] }],
    } as WorkspaceConfig["oauthClients"],
  });
  server = createServer(application.app);
  application.attachWebSocket(server);
  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not expose a TCP address");
  return `http://127.0.0.1:${address.port}`;
}

async function signIn(origin: string, path: string, username: string, extra: object = {}): Promise<string> {
  const response = await post(origin, path, undefined, { username, password: PASSWORD, ...extra });
  expect(response.ok).toBe(true);
  return response.headers.get("set-cookie")!.split(";", 1)[0]!;
}

async function approveCli(origin: string, browserCookie: string): Promise<string> {
  const { deviceCode, userCode } = (await (await post(origin, "/api/auth/cli/authorizations", undefined, {})).json()) as {
    deviceCode: string;
    userCode: string;
  };
  expect((await post(origin, "/api/auth/cli/authorizations/approve", browserCookie, { userCode })).status).toBe(200);
  const exchanged = await post(origin, "/api/auth/cli/authorizations/exchange", undefined, { deviceCode });
  expect(exchanged.status).toBe(200);
  return exchanged.headers.get("set-cookie")!.split(";", 1)[0]!;
}

async function exchange(origin: string, subjectToken: string): Promise<string> {
  const response = await fetch(`${origin}/api/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      subject_token: subjectToken,
      ...GATEWAY,
    }),
  });
  expect(response.status).toBe(200);
  const { access_token } = (await response.json()) as { access_token: string };
  return `workspace_session=${access_token}`;
}

async function changePassword(origin: string, cookie: string, currentPassword: string, newPassword: string): Promise<number> {
  const response = await fetch(`${origin}/api/auth/password`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  return response.status;
}

async function authenticated(origin: string, cookie: string): Promise<boolean> {
  const response = await fetch(`${origin}/api/session`, { headers: { cookie } });
  return ((await response.json()) as { authenticated: boolean }).authenticated;
}

async function connect(origin: string, cookie: string): Promise<WebSocket> {
  const response = await fetch(`${origin}/universer-api/user/session-ticket`, { headers: { cookie } });
  expect(response.status).toBe(200);
  const { ticket } = (await response.json()) as { ticket: string };
  const socket = new WebSocket(`${origin.replace(/^http/u, "ws")}/api/worktree-events?sessionTicket=${encodeURIComponent(ticket)}`);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("WebSocket upgrade failed")), { once: true });
  });
  return socket;
}

function closed(socket: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket did not close within 1 s")), 1000);
    socket.addEventListener("close", (event) => { clearTimeout(timer); resolve(event.code); }, { once: true });
  });
}

function post(origin: string, path: string, cookie: string | undefined, body: unknown): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}
