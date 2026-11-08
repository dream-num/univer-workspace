import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceApplication, type WorkspaceApplication } from "../../server/src/app.js";
import { loadConfig, type WorkspaceConfig } from "../../server/src/config.js";

const ISSUER = "https://space.example.test";
const RESOURCE = "https://space.example.test/mcp";
const GATEWAY_ID = "univer-workspace-mcp-gateway";
const GATEWAY_SECRET = "test-gateway-secret-at-least-32-characters";
const STATIC_ID = "static-client";
const STATIC_SECRET = "test-static-secret-at-least-32-characters";
const STATIC_REDIRECT = "https://static.example.test/cb";
const VERIFIER = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const STATE = "Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Z2FycGx5";
const ALL_SCOPES = "read write publish worktree:merge";
const OPENCODE_REGISTRATION = {
  redirect_uris: ["http://127.0.0.1:53379/callback"],
  client_name: "opencode",
  client_uri: "https://opencode.ai",
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
  application_type: "native",
  scope: ALL_SCOPES,
};
const OAUTH_CLIENTS: WorkspaceConfig["oauthClients"] = {
  clients: [
    { clientId: GATEWAY_ID, clientSecret: GATEWAY_SECRET, tokenExchange: true, redirectUris: ["https://gw.example.test/cb"], scopes: ["identity"] },
    { clientId: STATIC_ID, clientSecret: STATIC_SECRET, redirectUris: [STATIC_REDIRECT], scopes: ["identity"] },
  ],
};

let application: WorkspaceApplication | undefined;
let server: Server | undefined;
let directory: string | undefined;

afterEach(async () => {
  vi.useRealTimers();
  if (server?.listening) await new Promise<void>((resolve) => server!.close(() => resolve()));
  await application?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
  application = server = directory = undefined;
});

describe("MCP OAuth", () => {
  it("returns OAuth token errors for unknown clients and unsupported or malformed grants", async () => {
    const origin = await start();
    for (const clientId of ["unknown", undefined, ""]) {
      for (const grantType of ["authorization_code", "refresh_token", "client_credentials", undefined]) {
        const response = await token(origin, { client_id: clientId, grant_type: grantType });
        expect(response.status).toBe(401);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual({
          error: "invalid_client",
          error_description: "client_id is not a registered MCP client.",
        });
      }
      const json = await fetch(`${origin}/api/auth/token`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_id: clientId, grant_type: "authorization_code" }),
      });
      expect(json.status).toBe(401);
      expect(json.headers.get("cache-control")).toBe("no-store");
      expect(await json.json()).toMatchObject({ error: "invalid_client" });
    }
    const empty = await fetch(`${origin}/api/auth/token`, { method: "POST" });
    expect(empty.status).toBe(401);
    expect(empty.headers.get("cache-control")).toBe("no-store");
    expect(await empty.json()).toMatchObject({ error: "invalid_client" });

    const clientId = await registeredClientId(origin);
    for (const grantType of ["client_credentials", "password"]) {
      const response = await token(origin, { client_id: clientId, grant_type: grantType });
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toMatchObject({ error: "unsupported_grant_type" });
    }
    for (const grantType of [undefined, "", "authorization_code", "refresh_token"]) {
      const response = await token(origin, { client_id: clientId, grant_type: grantType });
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toMatchObject({ error: "invalid_request" });
    }
    const json = await fetch(`${origin}/api/auth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: clientId, grant_type: "authorization_code" }),
    });
    expect(json.status).toBe(400);
    expect(json.headers.get("cache-control")).toBe("no-store");
    expect(await json.json()).toMatchObject({ error: "invalid_request" });
  });

  it.each([false, true])("preserves static and legacy token errors with MCP OAuth disabled=%s", async (disabled) => {
    const origin = await start({ disabled });
    const unsupported = await token(origin, { client_id: STATIC_ID, grant_type: "client_credentials" });
    expect(unsupported.status).toBe(400);
    expect(await unsupported.json()).toEqual({ error: { code: "INVALID_INPUT", message: "grant_type must be authorization_code." } });
    const secret = await token(origin, { client_id: STATIC_ID, grant_type: "authorization_code", client_secret: "wrong" });
    expect(secret.status).toBe(401);
    expect(await secret.json()).toEqual({ error: { code: "INVALID_CLIENT_SECRET", message: "A valid client secret is required." } });
    const invalidCode = await token(origin, {
      client_id: STATIC_ID, grant_type: "authorization_code", client_secret: STATIC_SECRET,
      code: "invalid", code_verifier: VERIFIER, redirect_uri: STATIC_REDIRECT,
    });
    expect(invalidCode.status).toBe(400);
    expect(await invalidCode.json()).toEqual({ error: { code: "INVALID_GRANT", message: "authorization code is invalid." } });
    if (disabled) {
      const unknown = await token(origin, { client_id: "unknown", grant_type: "authorization_code" });
      expect(unknown.status).toBe(400);
      expect(await unknown.json()).toEqual({ error: {
        code: "OAUTH_CLIENT_UNAVAILABLE", field: "client_id",
        message: 'OAuth client "unknown" is not registered for this Workspace deployment.',
      } });
      const missing = await token(origin, { grant_type: "authorization_code" });
      expect(missing.status).toBe(400);
      expect(await missing.json()).toEqual({ error: { code: "INVALID_INPUT", message: "A required parameter is missing." } });
    }
  });

  it("runs the opencode flow: discovery, registration, scoped consent, code, exchange, refresh rotation and replay", async () => {
    // The token service reads the clock it was created with, so the fake clock is installed first.
    vi.useFakeTimers({ toFake: ["Date"] });
    const origin = await start();
    const metadata = await fetch(`${origin}/.well-known/oauth-authorization-server`);
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toEqual({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/api/auth/authorize`,
      token_endpoint: `${ISSUER}/api/auth/token`,
      registration_endpoint: `${ISSUER}/api/auth/register`,
      revocation_endpoint: `${ISSUER}/api/auth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["read", "write", "publish", "worktree:merge"],
    });

    const registered = await registerClient(origin, OPENCODE_REGISTRATION);
    expect(registered.status).toBe(201);
    expect(registered.headers.get("cache-control")).toBe("no-store");
    const client = (await registered.json()) as Record<string, unknown>;
    expect(client).toEqual({
      client_id: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      client_id_issued_at: expect.any(Number),
      client_name: "opencode",
      redirect_uris: ["http://127.0.0.1:53379/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: ALL_SCOPES,
    });
    const clientId = client.client_id as string;
    const redirectUri = "http://127.0.0.1:61234/callback";
    const query = authorizeQuery({ client_id: clientId, redirect_uri: redirectUri });

    const anonymous = await fetch(`${origin}/api/auth/authorize?${query}`, { redirect: "manual" });
    expect(anonymous.status).toBe(302);
    const returnTo = new URL(anonymous.headers.get("location")!, origin).searchParams.get("returnTo")!;
    expect(Object.fromEntries(new URL(returnTo, origin).searchParams)).toEqual(Object.fromEntries(query));

    const alice = await registerUser(origin, "alice");
    const authorized = await fetch(`${origin}${returnTo}`, { headers: { cookie: alice }, redirect: "manual" });
    expect(authorized.status).toBe(302);
    const consentUrl = authorized.headers.get("location")!;
    expect(consentUrl).toMatch(/^\/api\/auth\/authorize\/consent\?/u);
    expect(Object.fromEntries(new URL(consentUrl, origin).searchParams)).toEqual(Object.fromEntries(query));

    const consent = await fetch(`${origin}${consentUrl}`, { headers: { cookie: alice } });
    expect(consent.status).toBe(200);
    expect(consent.headers.get("content-security-policy")).toContain("form-action 'self' http://127.0.0.1:61234;");
    const page = await consent.text();
    expect(page).toContain("<strong>opencode</strong>");
    expect(page).toContain(RESOURCE);
    expect(page.match(/type="checkbox" name="scope" value="[^"]+" checked/gu)).toHaveLength(4);
    const consentToken = consentTokenOf(page);

    const empty = await submitConsent(origin, alice, consentToken, []);
    expect(empty.status).toBe(400);
    const allowed = await submitConsent(origin, alice, consentToken, ["read", "write", "publish"]);
    expect(allowed.status).toBe(303);
    const callback = new URL(allowed.headers.get("location")!);
    expect(`${callback.origin}${callback.pathname}`).toBe(redirectUri);
    expect(callback.searchParams.get("state")).toBe(STATE);
    expect(callback.searchParams.get("scope")).toBe("read write publish");
    const code = callback.searchParams.get("code")!;

    const tokens = await token(origin, {
      grant_type: "authorization_code",
      code,
      code_verifier: VERIFIER,
      redirect_uri: redirectUri,
      resource: RESOURCE,
      client_id: clientId,
    });
    expect(tokens.status).toBe(200);
    expect(tokens.headers.get("cache-control")).toBe("no-store");
    const issued = (await tokens.json()) as { access_token: string; refresh_token: string };
    expect(issued).toEqual({
      access_token: expect.stringMatching(/^uvw_at_/u),
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: expect.stringMatching(/^uvw_rt_/u),
      scope: "read write publish",
    });

    const exchanged = await exchange(origin, issued.access_token);
    expect(exchanged.status).toBe(200);
    expect(await exchanged.json()).toMatchObject({ scope: "read write publish", subject: { kind: "oauth", client_id: clientId } });
    expect((await exchange(origin, issued.access_token, "https://other.example.test/mcp")).status).toBe(400);

    expect(await (await refresh(origin, clientId, issued.refresh_token, "https://other.example.test/mcp")).json()).toMatchObject({ error: "invalid_grant" });
    const rotated = await refresh(origin, clientId, issued.refresh_token);
    expect(rotated.status).toBe(200);
    const second = (await rotated.json()) as { access_token: string; refresh_token: string; scope: string };
    expect(second.scope).toBe("read write publish");
    expect(second.refresh_token).not.toBe(issued.refresh_token);
    expect((await exchange(origin, issued.access_token)).status).toBe(400);
    expect((await exchange(origin, second.access_token)).status).toBe(200);

    expect(await (await refresh(origin, clientId, issued.refresh_token)).json()).toMatchObject({ error: "invalid_grant" });
    expect((await exchange(origin, second.access_token)).status).toBe(200);

    vi.setSystemTime(Date.now() + 61_000);
    expect(await (await refresh(origin, clientId, issued.refresh_token)).json()).toMatchObject({ error: "invalid_grant" });
    expect((await exchange(origin, second.access_token)).status).toBe(400);
    expect(await (await refresh(origin, clientId, second.refresh_token)).json()).toMatchObject({ error: "invalid_grant" });
  });

  it("binds codes to client, redirect, PKCE and resource, and revokes the grant when a code is replayed", async () => {
    const origin = await start();
    const clientId = await registeredClientId(origin);
    const alice = await registerUser(origin, "alice");
    const redirectUri = "http://127.0.0.1:53379/callback";
    const fields = (code: string) => ({
      grant_type: "authorization_code",
      code,
      code_verifier: VERIFIER,
      redirect_uri: redirectUri,
      resource: RESOURCE,
      client_id: clientId,
    });

    for (const wrong of [
      { resource: "https://other.example.test/mcp" },
      { code_verifier: "x".repeat(43) },
      { redirect_uri: "http://127.0.0.1:1/callback" },
    ]) {
      const code = await authorizeCode(origin, alice, clientId, redirectUri);
      const rejected = await token(origin, { ...fields(code), ...wrong });
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toMatchObject({ error: "invalid_grant" });
      expect(await (await token(origin, fields(code))).json()).toMatchObject({ error: "invalid_grant" });
    }
    const code = await authorizeCode(origin, alice, clientId, redirectUri);
    expect(await (await token(origin, { ...fields(code), resource: undefined })).json()).toMatchObject({ error: "invalid_request" });
    expect(await (await token(origin, { ...fields(code), client_id: "unknown" })).json()).toMatchObject({ error: "invalid_client" });
    expect(await (await refresh(origin, "unknown", "uvw_rt_x.y")).json()).toEqual({
      error: "invalid_client",
      error_description: "client_id is not a registered MCP client.",
    });
    const issued = (await (await token(origin, fields(code))).json()) as { access_token: string };
    expect((await exchange(origin, issued.access_token)).status).toBe(200);
    expect(await (await token(origin, fields(code))).json()).toMatchObject({ error: "invalid_grant" });
    expect((await exchange(origin, issued.access_token)).status).toBe(400);
  });

  it("returns verified-redirect errors to the client and rejects unverified clients and redirects in place", async () => {
    const origin = await start();
    const clientId = await registeredClientId(origin, {
      ...OPENCODE_REGISTRATION,
      redirect_uris: ["http://127.0.0.1:53379/callback", "https://app.example.test/cb", "com.example.app:/oauth"],
    });
    const alice = await registerUser(origin, "alice");
    const authorize = (fields: Record<string, string | undefined>) =>
      fetch(`${origin}/api/auth/authorize?${authorizeQuery({ client_id: clientId, redirect_uri: "https://app.example.test/cb", ...fields })}`, {
        headers: { cookie: alice },
        redirect: "manual",
      });
    const errorOf = async (fields: Record<string, string | undefined>) => {
      const response = await authorize(fields);
      expect(response.status).toBe(302);
      const target = new URL(response.headers.get("location")!);
      expect(`${target.origin}${target.pathname}`).toBe("https://app.example.test/cb");
      expect(target.searchParams.get("state")).toBe(STATE);
      return target.searchParams.get("error");
    };
    expect(await errorOf({ resource: "https://other.example.test/mcp" })).toBe("invalid_target");
    expect(await errorOf({ resource: undefined })).toBe("invalid_target");
    expect(await errorOf({ code_challenge_method: undefined })).toBe("invalid_request");
    expect(await errorOf({ code_challenge_method: "plain" })).toBe("invalid_request");
    expect(await errorOf({ code_challenge: undefined })).toBe("invalid_request");
    expect(await errorOf({ scope: "read admin" })).toBe("invalid_scope");
    expect(await errorOf({ response_type: "token" })).toBe("unsupported_response_type");

    const rejectedInPlace = async (fields: Record<string, string | undefined>, code: string) => {
      const response = await authorize(fields);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(code);
    };
    await rejectedInPlace({ redirect_uri: "https://app.example.test:8443/cb" }, "INVALID_REDIRECT_URI");
    await rejectedInPlace({ redirect_uri: "https://app.example.test/cb/other" }, "INVALID_REDIRECT_URI");
    await rejectedInPlace({ redirect_uri: "http://localhost:53379/callback" }, "INVALID_REDIRECT_URI");
    await rejectedInPlace({ redirect_uri: "http://127.0.0.1:9999/other" }, "INVALID_REDIRECT_URI");
    await rejectedInPlace({ client_id: "00000000-0000-0000-0000-000000000000" }, "OAUTH_CLIENT_UNAVAILABLE");

    const defaulted = await authorize({ scope: undefined, state: undefined });
    expect(defaulted.status).toBe(302);
    const consentQuery = new URL(defaulted.headers.get("location")!, origin).searchParams;
    expect(consentQuery.get("scope")).toBe(ALL_SCOPES);
    expect(consentQuery.has("state")).toBe(false);

    const native = await fetch(`${origin}/api/auth/authorize/consent?${authorizeQuery({ client_id: clientId, redirect_uri: "com.example.app:/oauth" })}`, {
      headers: { cookie: alice },
    });
    expect(native.headers.get("content-security-policy")).toContain("form-action 'self' com.example.app:;");
    const denied = await submitConsent(origin, alice, consentTokenOf(await native.text()), ALL_SCOPES.split(" "), "deny");
    expect(denied.headers.get("location")).toBe(`com.example.app:/oauth?error=access_denied&state=${STATE}`);
  });

  it("validates registration metadata, caps the request size and the number of clients", async () => {
    const origin = await start({ maxRegisteredClients: 2 });
    const rejected = async (body: unknown, error: string) => {
      const response = await registerClient(origin, body);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe(error);
    };
    await rejected({ ...OPENCODE_REGISTRATION, redirect_uris: ["http://app.example.test/cb"] }, "invalid_redirect_uri");
    await rejected({ ...OPENCODE_REGISTRATION, redirect_uris: ["https://app.example.test/cb#x"] }, "invalid_redirect_uri");
    await rejected({ ...OPENCODE_REGISTRATION, redirect_uris: ["https://user:pw@app.example.test/cb"] }, "invalid_redirect_uri");
    await rejected({ ...OPENCODE_REGISTRATION, redirect_uris: ["javascript:alert(1)"] }, "invalid_redirect_uri");
    await rejected({ ...OPENCODE_REGISTRATION, redirect_uris: [] }, "invalid_redirect_uri");
    await rejected({ ...OPENCODE_REGISTRATION, redirect_uris: Array.from({ length: 11 }, (_, i) => `https://app.example.test/${i}`) }, "invalid_redirect_uri");
    await rejected({ ...OPENCODE_REGISTRATION, token_endpoint_auth_method: "client_secret_basic" }, "invalid_client_metadata");
    await rejected({ ...OPENCODE_REGISTRATION, grant_types: ["refresh_token"] }, "invalid_client_metadata");
    await rejected({ ...OPENCODE_REGISTRATION, grant_types: ["authorization_code", "client_credentials"] }, "invalid_client_metadata");
    await rejected({ ...OPENCODE_REGISTRATION, response_types: ["token"] }, "invalid_client_metadata");
    await rejected({ ...OPENCODE_REGISTRATION, scope: "read admin" }, "invalid_client_metadata");
    await rejected({ ...OPENCODE_REGISTRATION, client_name: "x".repeat(101) }, "invalid_client_metadata");
    await rejected([OPENCODE_REGISTRATION], "invalid_client_metadata");
    const form = await fetch(`${origin}/api/auth/register`, { method: "POST", body: new URLSearchParams({ redirect_uris: "https://a.test/cb" }) });
    expect(form.status).toBe(400);
    const oversized = await registerClient(origin, { ...OPENCODE_REGISTRATION, client_uri: "x".repeat(20_000) });
    expect(oversized.status).toBe(413);
    expect(((await oversized.json()) as { error: string }).error).toBe("invalid_client_metadata");

    const minimal = await registerClient(origin, { redirect_uris: ["com.example.app:/oauth", "http://[::1]/cb"] });
    expect(minimal.status).toBe(201);
    expect(await minimal.json()).toMatchObject({
      redirect_uris: ["com.example.app:/oauth", "http://[::1]/cb"],
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "none",
    });
    expect((await registerClient(origin, OPENCODE_REGISTRATION)).status).toBe(201);
    const full = await registerClient(origin, OPENCODE_REGISTRATION);
    expect(full.status).toBe(503);
    expect(((await full.json()) as { error: string }).error).toBe("temporarily_unavailable");
    expect(application!.database.connection.prepare("SELECT count(*) AS n FROM oauth_clients").get()).toEqual({ n: 2 });
  });

  it("revokes a grant by access or refresh token for its own client and always answers 200", async () => {
    const origin = await start();
    const clientId = await registeredClientId(origin);
    const otherClientId = await registeredClientId(origin);
    const alice = await registerUser(origin, "alice");
    const redirectUri = "http://127.0.0.1:53379/callback";
    const issue = async () => {
      const code = await authorizeCode(origin, alice, clientId, redirectUri);
      return (await (await token(origin, {
        grant_type: "authorization_code", code, code_verifier: VERIFIER, redirect_uri: redirectUri, resource: RESOURCE, client_id: clientId,
      })).json()) as { access_token: string; refresh_token: string };
    };

    const first = await issue();
    const foreign = await revoke(origin, otherClientId, first.refresh_token);
    expect(foreign.status).toBe(200);
    expect((await exchange(origin, first.access_token)).status).toBe(200);
    expect((await revoke(origin, clientId, "uvw_rt_garbage.value")).status).toBe(200);
    expect((await revoke(origin, clientId, first.refresh_token)).status).toBe(200);
    expect((await exchange(origin, first.access_token)).status).toBe(400);
    expect(await (await refresh(origin, clientId, first.refresh_token)).json()).toMatchObject({ error: "invalid_grant" });

    const second = await issue();
    const session = (await (await exchange(origin, second.access_token)).json()) as { access_token: string };
    expect((await revoke(origin, clientId, second.access_token)).status).toBe(200);
    expect((await exchange(origin, second.access_token)).status).toBe(400);
    expect((await fetch(`${origin}/api/session`, { headers: { cookie: `workspace_session=${session.access_token}` } })).json())
      .resolves.toMatchObject({ authenticated: false });

    expect(((await (await revoke(origin, "unknown", second.access_token)).json()) as { error: string }).error).toBe("invalid_client");
    expect(((await (await revoke(origin, clientId, "")).json()) as { error: string }).error).toBe("invalid_request");
  });

  it("is absent when MCP_RESOURCE_URLS is unset, leaving static clients unchanged", async () => {
    const origin = await start({ disabled: true });
    expect((await fetch(`${origin}/.well-known/oauth-authorization-server`)).status).toBe(404);
    expect((await registerClient(origin, OPENCODE_REGISTRATION)).status).toBe(404);
    expect((await revoke(origin, "any", "token")).status).toBe(404);
    const refreshed = await refresh(origin, "any", "uvw_rt_x.y");
    expect(await refreshed.json()).toEqual({ error: { code: "INVALID_INPUT", message: "grant_type must be authorization_code." } });
  });

  it("keeps static clients on their exact rules when MCP OAuth is enabled", async () => {
    const origin = await start();
    const alice = await registerUser(origin, "alice");
    const authorize = (fields: Record<string, string>) =>
      fetch(`${origin}/api/auth/authorize?${new URLSearchParams({
        client_id: STATIC_ID, redirect_uri: STATIC_REDIRECT, state: STATE, code_challenge: CHALLENGE, scope: "identity", ...fields,
      })}`, { headers: { cookie: alice }, redirect: "manual" });
    expect((await authorize({ state: "short" })).status).toBe(400);
    expect((await authorize({ scope: "read" })).status).toBe(400);
    const allowed = await authorize({});
    expect(allowed.status).toBe(302);
    const location = new URL(allowed.headers.get("location")!);
    expect(`${location.origin}${location.pathname}`).toBe(STATIC_REDIRECT);
    const response = await token(origin, {
      grant_type: "authorization_code",
      code: location.searchParams.get("code")!,
      code_verifier: VERIFIER,
      redirect_uri: STATIC_REDIRECT,
      client_id: STATIC_ID,
      client_secret: STATIC_SECRET,
    });
    expect(await response.json()).toMatchObject({ access_token: "", token_type: "Bearer", expires_in: 3600 });
  });

  it("loads MCP OAuth from MCP_RESOURCE_URLS and PUBLIC_ORIGIN", () => {
    expect(loadConfig({}).mcpOAuth).toBeNull();
    expect(loadConfig({ MCP_RESOURCE_URLS: `${RESOURCE}, https://b.example.test/mcp`, PUBLIC_ORIGIN: `${ISSUER}/` }).mcpOAuth).toEqual({
      issuer: ISSUER,
      resources: [RESOURCE, "https://b.example.test/mcp"],
      maxRegisteredClients: 10_000,
    });
    expect(loadConfig({ MCP_RESOURCE_URLS: RESOURCE, PUBLIC_ORIGIN: ISSUER, MCP_MAX_REGISTERED_CLIENTS: "5" }).mcpOAuth?.maxRegisteredClients).toBe(5);
    expect(() => loadConfig({ MCP_RESOURCE_URLS: RESOURCE })).toThrow(/PUBLIC_ORIGIN/u);
    expect(() => loadConfig({ MCP_RESOURCE_URLS: RESOURCE, PUBLIC_ORIGIN: `${ISSUER}/app` })).toThrow(/PUBLIC_ORIGIN/u);
    expect(() => loadConfig({ MCP_RESOURCE_URLS: "not a url", PUBLIC_ORIGIN: ISSUER })).toThrow(/MCP_RESOURCE_URLS/u);
    expect(() => loadConfig({ MCP_RESOURCE_URLS: `${RESOURCE}#x`, PUBLIC_ORIGIN: ISSUER })).toThrow(/MCP_RESOURCE_URLS/u);
  });
});

function authorizeQuery(fields: Record<string, string | undefined>): URLSearchParams {
  const values: Record<string, string | undefined> = {
    response_type: "code",
    state: STATE,
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    scope: ALL_SCOPES,
    resource: RESOURCE,
    ...fields,
  };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) query.set(key, value);
  return query;
}

async function authorizeCode(origin: string, cookie: string, clientId: string, redirectUri: string): Promise<string> {
  const consent = await fetch(`${origin}/api/auth/authorize/consent?${authorizeQuery({ client_id: clientId, redirect_uri: redirectUri })}`, {
    headers: { cookie },
  });
  const allowed = await submitConsent(origin, cookie, consentTokenOf(await consent.text()), ALL_SCOPES.split(" "));
  return new URL(allowed.headers.get("location")!).searchParams.get("code")!;
}

function consentTokenOf(page: string): string {
  return /name="consent_token" value="([^"]+)"/u.exec(page)![1]!;
}

function submitConsent(origin: string, cookie: string, consentToken: string, scopes: readonly string[], decision = "allow"): Promise<Response> {
  const body = new URLSearchParams({ consent_token: consentToken, decision });
  for (const scope of scopes) body.append("scope", scope);
  return fetch(`${origin}/api/auth/authorize/consent`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    body,
    redirect: "manual",
  });
}

function registerClient(origin: string, body: unknown): Promise<Response> {
  return fetch(`${origin}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function registeredClientId(origin: string, body: unknown = OPENCODE_REGISTRATION): Promise<string> {
  return ((await (await registerClient(origin, body)).json()) as { client_id: string }).client_id;
}

function form(origin: string, path: string, fields: Record<string, string | undefined>): Promise<Response> {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) body.set(key, value);
  return fetch(`${origin}${path}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
}

function token(origin: string, fields: Record<string, string | undefined>): Promise<Response> {
  return form(origin, "/api/auth/token", fields);
}

function refresh(origin: string, clientId: string, refreshToken: string, resource = RESOURCE): Promise<Response> {
  return token(origin, { grant_type: "refresh_token", refresh_token: refreshToken, resource, client_id: clientId });
}

function revoke(origin: string, clientId: string, value: string): Promise<Response> {
  return form(origin, "/api/auth/revoke", { token: value, client_id: clientId });
}

function exchange(origin: string, subjectToken: string, resource = RESOURCE): Promise<Response> {
  return token(origin, {
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
    subject_token: subjectToken,
    resource,
    client_id: GATEWAY_ID,
    client_secret: GATEWAY_SECRET,
  });
}

async function registerUser(origin: string, username: string): Promise<string> {
  const response = await fetch(`${origin}/api/auth/password/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, displayName: username, password: "correct horse battery staple" }),
  });
  return response.headers.get("set-cookie")!.split(";", 1)[0]!;
}

async function start(options: { maxRegisteredClients?: number; disabled?: boolean } = {}): Promise<string> {
  directory = mkdtempSync(join(tmpdir(), "univer-mcp-oauth-"));
  application = createWorkspaceApplication({
    host: "127.0.0.1",
    port: 3020,
    databaseFilename: join(directory, "product.sqlite"),
    collaborationDatabaseFilename: join(directory, "collaboration.sqlite"),
    secureCookies: false,
    sessionTtlMs: 24 * 60 * 60_000,
    passwordAuthEnabled: true,
    emailAuth: null,
    oauthClients: OAUTH_CLIENTS,
    mcpOAuth: options.disabled
      ? null
      : { issuer: ISSUER, resources: [RESOURCE], maxRegisteredClients: options.maxRegisteredClients ?? 10_000 },
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
