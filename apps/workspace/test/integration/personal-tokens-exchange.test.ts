import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceApplication, type WorkspaceApplication } from "../../server/src/app.js";
import { loadConfig, type WorkspaceConfig } from "../../server/src/config.js";
import { createAccessTokenService } from "../../server/src/modules/identity/access-tokens.js";

const GATEWAY_ID = "univer-workspace-mcp-gateway";
const GATEWAY_SECRET = "test-gateway-secret-at-least-32-characters";
const PLAIN_ID = "plain-client";
const PLAIN_SECRET = "test-plain-secret-at-least-32-characters";
const RESOURCE = "https://mcp.example.test/mcp";
const PLAIN_REDIRECT = "https://plain.example.test/cb";
const CONSENT_ID = "consent-client";
const CONSENT_REDIRECT = "https://consent.example.test/cb";
const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:token-exchange";
const TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";
const OAUTH_CLIENTS_JSON = JSON.stringify({
  clients: [
    { clientId: GATEWAY_ID, clientSecret: GATEWAY_SECRET, tokenExchange: true, redirectUris: ["https://gw.example.test/cb"], scopes: ["identity"] },
    { clientId: PLAIN_ID, clientSecret: PLAIN_SECRET, redirectUris: [PLAIN_REDIRECT], scopes: ["identity"] },
    { clientId: "public-client", clientType: "public", redirectUris: ["http://127.0.0.1:3101/cb"], scopes: ["identity"] },
    { clientId: CONSENT_ID, clientSecret: PLAIN_SECRET, requiresConsent: true, redirectUris: [CONSENT_REDIRECT], scopes: ["identity"] },
  ],
});

let application: WorkspaceApplication | undefined;
let server: Server | undefined;
let directory: string | undefined;

afterEach(close);

async function close(): Promise<void> {
  if (server?.listening) await new Promise<void>((resolve) => server!.close(() => resolve()));
  await application?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
  application = server = directory = undefined;
}

describe("personal access tokens", () => {
  it("creates once, lists without secrets, defaults to all scopes, and scopes revocation to the owner", async () => {
    const origin = await start();
    const alice = await register(origin, "alice");
    const bob = await register(origin, "bob");

    expect((await fetch(`${origin}/api/auth/tokens`)).status).toBe(401);
    expect((await post(origin, "/api/auth/tokens", undefined, { name: "x" })).status).toBe(401);
    expect((await fetch(`${origin}/api/auth/tokens/anything`, { method: "DELETE" })).status).toBe(401);

    const created = await post(origin, "/api/auth/tokens", alice.cookie, { name: "Laptop" });
    expect(created.status).toBe(201);
    const { token, record } = (await created.json()) as { token: string; record: Record<string, unknown> };
    expect(token).toMatch(/^uvw_pat_/u);
    expect(record).toMatchObject({
      name: "Laptop",
      scopes: ["read", "write", "publish", "worktree:merge"],
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
    });
    expect(record).not.toHaveProperty("userId");

    const listedText = await (await fetch(`${origin}/api/auth/tokens`, { headers: { cookie: alice.cookie } })).text();
    expect(JSON.parse(listedText)).toEqual({ tokens: [record] });
    expect(listedText).not.toContain(token);
    expect(listedText).not.toMatch(/hash|secret/u);
    expect(await (await fetch(`${origin}/api/auth/tokens`, { headers: { cookie: bob.cookie } })).json()).toEqual({ tokens: [] });

    const bad = await post(origin, "/api/auth/tokens", alice.cookie, { name: "", scopes: ["read"] });
    expect(bad.status).toBe(400);
    expect((await post(origin, "/api/auth/tokens", alice.cookie, { name: "n", scopes: ["nope"] })).status).toBe(400);
    expect((await post(origin, "/api/auth/tokens", alice.cookie, { name: 5 })).status).toBe(400);
    const narrow = await post(origin, "/api/auth/tokens", alice.cookie, { name: "ro", scopes: ["read"], expiresAt: Date.now() + 60_000 });
    expect(((await narrow.json()) as { record: { scopes: string[] } }).record.scopes).toEqual(["read"]);

    const foreign = await fetch(`${origin}/api/auth/tokens/${record.id}`, { method: "DELETE", headers: { cookie: bob.cookie } });
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual({ error: { code: "NOT_FOUND", message: "The token was not found." } });
    expect((await exchange(origin, { subject_token: token })).status).toBe(200);
    const mine = await fetch(`${origin}/api/auth/tokens/${record.id}`, { method: "DELETE", headers: { cookie: alice.cookie } });
    expect(mine.status).toBe(204);
    expect((await fetch(`${origin}/api/auth/tokens/${record.id}`, { method: "DELETE", headers: { cookie: alice.cookie } })).status).toBe(404);
  });

});

describe("token-issued sessions", () => {
  it("cannot create tokens, approve CLI logins, authorize OAuth clients or link identities", async () => {
    const origin = await start();
    const alice = await register(origin, "alice");
    const { token } = await createPat(origin, alice.cookie);
    const { access_token } = (await (await exchange(origin, { subject_token: token })).json()) as { access_token: string };
    const downstream = `workspace_session=${access_token}`;
    const forbidden = async (response: Response) => {
      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe("FORBIDDEN");
    };

    await forbidden(await post(origin, "/api/auth/tokens", downstream, { name: "escalate" }));
    expect((await fetch(`${origin}/api/auth/tokens`, { headers: { cookie: downstream } })).status).toBe(200);
    expect((await fetch(`${origin}/api/session`, { headers: { cookie: downstream } })).status).toBe(200);

    const { userCode } = (await (await post(origin, "/api/auth/cli/authorizations", undefined, {})).json()) as { userCode: string };
    await forbidden(await post(origin, "/api/auth/cli/authorizations/approve", downstream, { userCode }));
    expect((await post(origin, "/api/auth/cli/authorizations/approve", alice.cookie, { userCode })).status).toBe(200);

    const authorize = (clientId: string, redirectUri: string, cookie: string) =>
      fetch(`${origin}/api/auth/authorize?${new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        state: "s".repeat(32),
        code_challenge: "c".repeat(43),
        scope: "identity",
      })}`, { headers: { cookie }, redirect: "manual" });
    await forbidden(await authorize(PLAIN_ID, PLAIN_REDIRECT, downstream));
    const allowed = await authorize(PLAIN_ID, PLAIN_REDIRECT, alice.cookie);
    expect(allowed.status).toBe(302);
    expect(allowed.headers.get("location")).toMatch(new RegExp(`^${PLAIN_REDIRECT}\\?code=`, "u"));
    await forbidden(await authorize(CONSENT_ID, CONSENT_REDIRECT, downstream));
    const consentQuery = new URLSearchParams({
      client_id: CONSENT_ID,
      redirect_uri: CONSENT_REDIRECT,
      state: "s".repeat(32),
      code_challenge: "c".repeat(43),
      scope: "identity",
    });
    await forbidden(await fetch(`${origin}/api/auth/authorize/consent?${consentQuery}`, { headers: { cookie: downstream } }));
    expect((await fetch(`${origin}/api/auth/authorize/consent?${consentQuery}`, { headers: { cookie: alice.cookie } })).status).toBe(200);
    const consentPost = (cookie: string) =>
      fetch(`${origin}/api/auth/authorize/consent`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie },
        body: new URLSearchParams({ consent_token: "any", decision: "allow" }),
        redirect: "manual",
      });
    await forbidden(await consentPost(downstream));
    expect((await consentPost(alice.cookie)).status).toBe(400);

    const linkCallback = async (provider: string, sessionCookie: string) => {
      const started = await fetch(`${origin}/api/auth/${provider}/link`, { headers: { cookie: alice.cookie }, redirect: "manual" });
      expect(started.status).toBe(302);
      const state = new URL(started.headers.get("location")!).searchParams.get("state")!;
      const oauthCookie = started.headers.get("set-cookie")!.split(";", 1)[0]!;
      const callback = await fetch(`${origin}/api/auth/${provider}/callback?${new URLSearchParams({ code: "c", state })}`, {
        headers: { cookie: `${oauthCookie}; ${sessionCookie}` },
        redirect: "manual",
      });
      expect(callback.status).toBe(302);
      return callback.headers.get("location");
    };
    const linked = async () =>
      ((await (await fetch(`${origin}/api/session`, { headers: { cookie: alice.cookie } })).json()) as {
        authenticationMethods: { externalIdentities: unknown[] };
      }).authenticationMethods.externalIdentities.length;
    for (const provider of ["github", "google", "discord"]) {
      await forbidden(await fetch(`${origin}/api/auth/${provider}/link`, { headers: { cookie: downstream }, redirect: "manual" }));
      expect(await linkCallback(provider, downstream)).toMatch(/^\/login\?oauthError=/u);
    }
    expect(await linked()).toBe(0);
    expect(await linkCallback("github", alice.cookie)).not.toMatch(/oauthError/u);
    expect(await linked()).toBe(1);
  });

  it("cannot change the password, while an interactive session can", async () => {
    const origin = await start();
    const alice = await register(origin, "alice");
    const { token } = await createPat(origin, alice.cookie);
    const { access_token } = (await (await exchange(origin, { subject_token: token })).json()) as { access_token: string };
    const change = (cookie: string, currentPassword: string, newPassword: string) =>
      fetch(`${origin}/api/auth/password`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
    const oldPassword = "correct horse battery staple";
    const newPassword = "another correct horse staple";
    const denied = await change(`workspace_session=${access_token}`, "wrong password entirely", newPassword);
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { error: { code: string } }).error.code).toBe("FORBIDDEN");
    expect((await change(`workspace_session=${access_token}`, oldPassword, newPassword)).status).toBe(403);
    expect((await change(alice.cookie, oldPassword, newPassword)).status).toBe(204);
  });
});

describe("token exchange", () => {
  it("turns a PAT into a 10-minute session for the same user, and revocation ends it", async () => {
    const origin = await start();
    const alice = await register(origin, "alice");
    const { token, record } = await createPat(origin, alice.cookie, ["read", "write"]);

    const response = await exchange(origin, { subject_token: token, resource: "ignored-for-pats" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as Record<string, any>;
    expect(body).toEqual({
      access_token: expect.any(String),
      issued_token_type: "urn:univer:params:oauth:token-type:workspace-session",
      token_type: "N_A",
      expires_in: 600,
      scope: "read write",
      subject: { kind: "pat", id: record.id, client_id: null },
      user: { id: alice.userId, username: "alice", displayName: "alice", avatarUrl: null },
    });
    expect(Object.keys(body.user).sort()).toEqual(contractRequired("User").sort());
    expect(Object.keys(body.subject).sort()).toEqual(contractRequired("TokenExchangeSubject").sort());

    const session = application!.database.connection
      .prepare("SELECT created_at, expires_at, write_source, issued_for_pat_id FROM login_sessions WHERE id = ?")
      .get(body.access_token.split(".", 1)[0]) as Record<string, unknown>;
    expect(Number(session.expires_at) - Number(session.created_at)).toBe(600_000);
    expect(session).toMatchObject({ write_source: "agent", issued_for_pat_id: record.id });

    const cookie = `workspace_session=${body.access_token}`;
    const me = (await (await fetch(`${origin}/api/session`, { headers: { cookie } })).json()) as { user: { id: string } };
    expect(me.user.id).toBe(alice.userId);

    expect((await fetch(`${origin}/api/auth/tokens/${record.id}`, { method: "DELETE", headers: { cookie: alice.cookie } })).status).toBe(204);
    expect(((await (await fetch(`${origin}/api/session`, { headers: { cookie } })).json()) as { authenticated: boolean }).authenticated).toBe(false);
    await expectInvalidGrant(await exchange(origin, { subject_token: token }));
  });

  it("rejects unknown, malformed, expired and wrong-resource subject tokens as invalid_grant", async () => {
    const origin = await start();
    const alice = await register(origin, "alice");
    const { token, record } = await createPat(origin, alice.cookie);
    await expectInvalidGrant(await exchange(origin, { subject_token: "uvw_pat_nope.secret" }));
    await expectInvalidGrant(await exchange(origin, { subject_token: "garbage" }));
    await expectInvalidGrant(await exchange(origin, { subject_token: `${token}x` }));
    application!.database.connection.prepare("UPDATE personal_access_tokens SET expires_at = 1 WHERE id = ?").run(record.id);
    await expectInvalidGrant(await exchange(origin, { subject_token: token }));

    const grants = createAccessTokenService({ database: application!.database });
    const issued = grants.issueGrant({ userId: alice.userId, clientId: "claude", scopes: ["read"], resource: RESOURCE });
    for (const resource of [undefined, "", "https://other.example.test/mcp"]) {
      await expectInvalidGrant(await exchange(origin, { subject_token: issued.accessToken, ...(resource === undefined ? {} : { resource }) }));
    }
    await expectInvalidGrant(await exchange(origin, { subject_token: issued.refreshToken, resource: RESOURCE }));
    const ok = await exchange(origin, { subject_token: issued.accessToken, resource: RESOURCE });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as Record<string, any>;
    expect(body).toMatchObject({
      scope: "read",
      subject: { kind: "oauth", id: issued.grant.id, client_id: "claude" },
      user: { id: alice.userId },
    });
    grants.revokeGrant(alice.userId, issued.grant.id);
    expect(application!.database.connection.prepare("SELECT count(*) AS n FROM login_sessions WHERE issued_for_grant_id = ?").get(issued.grant.id)).toEqual({ n: 0 });
    await expectInvalidGrant(await exchange(origin, { subject_token: issued.accessToken, resource: RESOURCE }));
  });

  it("only serves a confidential client flagged tokenExchange with the right secret", async () => {
    const origin = await start();
    const alice = await register(origin, "alice");
    const { token } = await createPat(origin, alice.cookie);
    const base = { subject_token: token };
    const unauthorized = async (response: Response) => {
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "unauthorized_client" });
    };
    const invalidClient = async (response: Response) => {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "invalid_client" });
    };
    await unauthorized(await exchange(origin, base, { client_id: PLAIN_ID, client_secret: PLAIN_SECRET }));
    await invalidClient(await exchange(origin, base, { client_id: "public-client", client_secret: undefined }));
    await invalidClient(await exchange(origin, base, { client_id: "unknown", client_secret: GATEWAY_SECRET }));
    await invalidClient(await exchange(origin, base, { client_id: undefined, client_secret: GATEWAY_SECRET }));
    for (const client_secret of ["wrong", undefined, PLAIN_SECRET]) {
      await invalidClient(await exchange(origin, base, { client_secret }));
    }
    // A wrong secret on an unflagged client says nothing about the flag.
    const plainWrong = await exchange(origin, base, { client_id: PLAIN_ID, client_secret: "wrong" });
    expect(plainWrong.status).toBe(401);
    for (const bad of [{ subject_token: undefined }, { subject_token: "" }, { subject_token_type: "other" }, { subject_token_type: undefined }]) {
      const response = await exchange(origin, { ...base, ...bad });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
    }
    expect(application!.database.connection.prepare("SELECT count(*) AS n FROM login_sessions WHERE issued_for_pat_id IS NOT NULL").get()).toEqual({ n: 0 });
  });

  it("caps the session at the subject token expiry and the deployment session lifetime", async () => {
    const lifetime = async (body: { access_token: string; expires_in: number }) => {
      const row = application!.database.connection
        .prepare("SELECT created_at, expires_at FROM login_sessions WHERE id = ?")
        .get(body.access_token.split(".", 1)[0]) as { created_at: number; expires_at: number };
      return row.expires_at - row.created_at;
    };
    const short = await start({ sessionTtlMs: 60_000 });
    const bob = await register(short, "bob");
    const capped = (await (await exchange(short, { subject_token: (await createPat(short, bob.cookie)).token })).json()) as {
      access_token: string;
      expires_in: number;
    };
    expect(capped.expires_in).toBe(60);
    expect(await lifetime(capped)).toBe(60_000);
    await close();

    const origin = await start();
    const alice = await register(origin, "alice");
    const expiring = await post(origin, "/api/auth/tokens", alice.cookie, { name: "soon", expiresAt: Date.now() + 30_000 });
    const pat = (await (await exchange(origin, { subject_token: ((await expiring.json()) as { token: string }).token })).json()) as {
      access_token: string;
      expires_in: number;
    };
    expect(pat.expires_in).toBeGreaterThan(25);
    expect(pat.expires_in).toBeLessThanOrEqual(30);
    expect(await lifetime(pat)).toBeLessThanOrEqual(30_000);
    expect(Math.floor((await lifetime(pat)) / 1000)).toBe(pat.expires_in);

    const issued = createAccessTokenService({ database: application!.database })
      .issueGrant({ userId: alice.userId, clientId: "claude", scopes: ["read"], resource: RESOURCE });
    application!.database.connection
      .prepare("UPDATE oauth_grants SET access_expires_at = ? WHERE id = ?")
      .run(Date.now() + 120_000, issued.grant.id);
    const oauth = (await (await exchange(origin, { subject_token: issued.accessToken, resource: RESOURCE })).json()) as {
      access_token: string;
      expires_in: number;
    };
    expect(oauth.expires_in).toBeGreaterThan(115);
    expect(oauth.expires_in).toBeLessThanOrEqual(120);
  });

  it("refuses a computed lifetime under one second", async () => {
    const origin = await start();
    const alice = await register(origin, "alice");
    const soon = await post(origin, "/api/auth/tokens", alice.cookie, { name: "blink", expiresAt: Date.now() + 500 });
    const { token } = (await soon.json()) as { token: string };
    await expectInvalidGrant(await exchange(origin, { subject_token: token }));
    expect(application!.database.connection.prepare("SELECT count(*) AS n FROM login_sessions WHERE issued_for_pat_id IS NOT NULL").get()).toEqual({ n: 0 });
  });

  it("accepts the token-exchange grant only as a form body", async () => {
    const origin = await start();
    const alice = await register(origin, "alice");
    const { token } = await createPat(origin, alice.cookie);
    const response = await post(origin, "/api/auth/token", undefined, {
      grant_type: GRANT_TYPE,
      subject_token_type: TOKEN_TYPE,
      subject_token: token,
      client_id: GATEWAY_ID,
      client_secret: GATEWAY_SECRET,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(application!.database.connection.prepare("SELECT count(*) AS n FROM login_sessions WHERE issued_for_pat_id IS NOT NULL").get()).toEqual({ n: 0 });
  });

  it("keeps the authorization_code grant rejecting other grant types", async () => {
    const origin = await start();
    const response = await fetch(`${origin}/api/auth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "password" }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "INVALID_INPUT", message: "grant_type must be authorization_code." },
    });
  });

  it("loads tokenExchange from OAUTH_CLIENTS_JSON and refuses it on a public client", () => {
    const config = loadConfig({ OAUTH_CLIENTS_JSON });
    expect(config.oauthClients?.clients.map((client) => client.tokenExchange)).toEqual([true, undefined, undefined, undefined]);
    expect(() =>
      loadConfig({
        OAUTH_CLIENTS_JSON: JSON.stringify({
          clients: [{ clientId: "p", clientType: "public", tokenExchange: true, redirectUris: ["http://127.0.0.1/cb"], scopes: ["identity"] }],
        }),
      })
    ).toThrow(/confidential/u);
  });
});

function contractRequired(schema: string): string[] {
  const text = readFileSync(new URL("../../contracts/http/schemas/identity.yaml", import.meta.url), "utf8");
  const block = text.split(/^(?=\S)/mu).find((candidate) => candidate.startsWith(`${schema}:\n`))!;
  return /^ {2}required: \[(.*)\]$/mu.exec(block)![1]!.split(", ");
}

async function expectInvalidGrant(response: Response): Promise<void> {
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "invalid_grant" });
}

function post(origin: string, path: string, cookie: string | undefined, body: unknown): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function register(origin: string, username: string): Promise<{ cookie: string; userId: string }> {
  const response = await post(origin, "/api/auth/password/register", undefined, {
    username,
    displayName: username,
    password: "correct horse battery staple",
  });
  const body = (await response.json()) as { user: { id: string } };
  return { cookie: response.headers.get("set-cookie")!.split(";", 1)[0]!, userId: body.user.id };
}

async function createPat(origin: string, cookie: string, scopes?: string[]) {
  const response = await post(origin, "/api/auth/tokens", cookie, { name: "test", ...(scopes ? { scopes } : {}) });
  return (await response.json()) as { token: string; record: { id: string } };
}

function exchange(
  origin: string,
  fields: Record<string, string | undefined>,
  client: { client_id?: string | undefined; client_secret?: string | undefined } = { client_id: GATEWAY_ID, client_secret: GATEWAY_SECRET },
): Promise<Response> {
  const form = { grant_type: GRANT_TYPE, subject_token_type: TOKEN_TYPE, client_id: GATEWAY_ID, client_secret: GATEWAY_SECRET, ...fields, ...client };
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(form)) if (value !== undefined) body.set(key, value);
  return fetch(`${origin}/api/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

function fakeProvider(name: string) {
  return {
    authorizationUrl: ({ state }: { state: string }) => `https://${name}.example.test/authorize?state=${state}`,
    exchangeCode: async () => ({ subject: `${name}-subject`, username: `${name}-user`, displayName: name, avatarUrl: null }),
  };
}

async function start(options: { sessionTtlMs?: number } = {}): Promise<string> {
  directory = mkdtempSync(join(tmpdir(), "univer-pat-exchange-"));
  application = createWorkspaceApplication({
    host: "127.0.0.1",
    port: 3020,
    databaseFilename: join(directory, "product.sqlite"),
    collaborationDatabaseFilename: join(directory, "collaboration.sqlite"),
    secureCookies: false,
    sessionTtlMs: options.sessionTtlMs ?? 24 * 60 * 60_000,
    oauthClients: JSON.parse(OAUTH_CLIENTS_JSON) as WorkspaceConfig["oauthClients"],
  }, {
    githubOAuthProvider: fakeProvider("github"),
    googleOAuthProvider: fakeProvider("google"),
    discordOAuthProvider: fakeProvider("discord"),
    oauthStateSecret: "test-oauth-state-secret-at-least-32-characters",
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
