import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkspaceApplication,
  type WorkspaceApplication,
} from "../../server/src/app.js";
import { loadConfig, type WorkspaceConfig } from "../../server/src/config.js";

const CLIENT_ID = "internal-client";
const CLIENT_SECRET = "test-client-secret-at-least-32-characters";
const CALLBACK_URL = "https://client.example.test/auth/callback";
const STATE = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGH";
const CODE_VERIFIER = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CODE_CHALLENGE = createHash("sha256").update(CODE_VERIFIER).digest("base64url");
const OAUTH_CLIENTS_JSON = JSON.stringify({
  clients: [
    {
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUris: [CALLBACK_URL],
      scopes: ["identity"],
    },
  ],
});

let application: WorkspaceApplication | undefined;
let server: Server | undefined;
let directory: string | undefined;

afterEach(async () => {
  if (server?.listening) {
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve()))
    );
  }
  await application?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
  application = undefined;
  server = undefined;
  directory = undefined;
});

describe("OAuth authorization", () => {
  it("loads registered clients from OAUTH_CLIENTS_JSON", () => {
    const config = loadConfig({ OAUTH_CLIENTS_JSON });
    expect(config.oauthClients?.clients).toHaveLength(1);
    expect(config.oauthClients?.clients[0]).toMatchObject({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUris: [CALLBACK_URL],
      scopes: ["identity"],
    });
  });

  it("rejects OAUTH_CLIENTS_JSON without an array or with a missing client id", () => {
    expect(() => loadConfig({ OAUTH_CLIENTS_JSON: "{}" })).toThrow();
    expect(() =>
      loadConfig({
        OAUTH_CLIENTS_JSON: JSON.stringify({
          clients: [{ clientSecret: CLIENT_SECRET, redirectUris: [CALLBACK_URL], scopes: ["identity"] }],
        }),
      })
    ).toThrow();
  });

  it("returns through Workspace login before issuing a code", async () => {
    const origin = await startApplication();
    const response = await fetch(
      `${origin}/api/auth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(CALLBACK_URL)}&state=${STATE}&code_challenge=${CODE_CHALLENGE}&scope=identity`,
      { redirect: "manual" }
    );

    expect(response.status).toBe(302);
    const location = response.headers.get("location");
    expect(location).toContain("/login?returnTo=");
    expect(location).toContain(encodeURIComponent(STATE));
  });

  it("issues a one-time short-lived code for an authenticated User and exchanges it", async () => {
    const origin = await startApplication();
    const registration = await fetch(`${origin}/api/auth/password/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "alice",
        displayName: "Alice",
        password: "correct horse battery staple",
      }),
    });
    const session = (await registration.json()) as {
      readonly user: { readonly id: string };
    };
    const cookie = registration.headers.get("set-cookie")?.split(";", 1)[0];
    expect(cookie).toBeTruthy();

    const authorize = await fetch(
      `${origin}/api/auth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(CALLBACK_URL)}&state=${STATE}&code_challenge=${CODE_CHALLENGE}&scope=identity`,
      { headers: { cookie: cookie! }, redirect: "manual" }
    );
    expect(authorize.status).toBe(302);
    const callback = new URL(authorize.headers.get("location")!);
    expect(`${callback.origin}${callback.pathname}`).toBe(CALLBACK_URL);
    const code = callback.searchParams.get("code");
    expect(code).toBeTruthy();

    const token = await fetch(`${origin}/api/auth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: CALLBACK_URL,
        code_verifier: CODE_VERIFIER,
      }),
    });
    expect(token.status).toBe(200);
    const body = (await token.json()) as {
      readonly user: {
        readonly id: string;
        readonly username: string;
        readonly displayName: string;
      };
    };
    expect(body.user).toMatchObject({
      id: session.user.id,
      username: "alice",
      displayName: "Alice",
    });

    const replay = await fetch(`${origin}/api/auth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: CALLBACK_URL,
        code_verifier: CODE_VERIFIER,
      }),
    });
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({
      error: { code: "INVALID_GRANT" },
    });
  });

  it("rejects an unknown client and an invalid client secret", async () => {
    const origin = await startApplication();
    const unknown = await fetch(
      `${origin}/api/auth/authorize?client_id=someone-else&redirect_uri=${encodeURIComponent(CALLBACK_URL)}&state=${STATE}&code_challenge=${CODE_CHALLENGE}&scope=identity`,
      { redirect: "manual" }
    );
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({
      error: { code: "OAUTH_CLIENT_UNAVAILABLE" },
    });

    const secret = await fetch(`${origin}/api/auth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: "not-a-real-code",
        client_id: CLIENT_ID,
        client_secret: "wrong-secret",
        redirect_uri: CALLBACK_URL,
        code_verifier: CODE_VERIFIER,
      }),
    });
    expect(secret.status).toBe(401);
    expect(await secret.json()).toMatchObject({
      error: { code: "INVALID_CLIENT_SECRET" },
    });
  });

  it("rejects a state outside the base64url protocol", async () => {
    const origin = await startApplication();
    const response = await fetch(
      `${origin}/api/auth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(CALLBACK_URL)}&state=not-valid&code_challenge=${CODE_CHALLENGE}&scope=identity`
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
  });

  it("rejects a redirect_uri not registered for the client", async () => {
    const origin = await startApplication();
    const response = await fetch(
      `${origin}/api/auth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent("https://evil.example.test/callback")}&state=${STATE}&code_challenge=${CODE_CHALLENGE}&scope=identity`,
      { redirect: "manual" }
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_REDIRECT_URI" },
    });
  });
});

async function startApplication(): Promise<string> {
  directory = mkdtempSync(join(tmpdir(), "univer-oauth-authorization-"));
  application = createWorkspaceApplication({
    host: "127.0.0.1",
    port: 3020,
    databaseFilename: join(directory, "product.sqlite"),
    collaborationDatabaseFilename: join(directory, "collaboration.sqlite"),
    secureCookies: false,
    sessionTtlMs: 60_000,
    oauthClients: JSON.parse(OAUTH_CLIENTS_JSON) as WorkspaceConfig["oauthClients"],
  });
  server = createServer(application.app);
  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(0, "127.0.0.1", () => {
      server!.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server did not expose a TCP address");
  }
  return `http://127.0.0.1:${address.port}`;
}
