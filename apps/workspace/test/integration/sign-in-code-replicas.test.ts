import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createWorkspaceApplication } from "../../server/src/app.js";
import { loadConfig, type WorkspaceConfig } from "../../server/src/config.js";
import { openProductDatabase } from "../../server/src/db/index.js";
import { openCollaborationDatabase } from "../../server/src/integrations/univer/collaboration-database/open-collaboration-database.js";
import { createTestBucket } from "../support/postgres/s3.js";
import { createPostgresTestDatabase } from "../support/postgres/schema.js";

const ISSUER = "https://space.example.test";
const RESOURCE = "https://space.example.test/mcp";
const CALLBACK = "http://127.0.0.1:9/callback";
const STATIC_ID = "workspace-agent";
const STATIC_REDIRECT = "https://agent.example.test/cb";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const STATE = "Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Z2FycGx5";
const GATEWAY_ID = "univer-workspace-mcp-gateway";
const GATEWAY_SECRET = "test-gateway-secret-at-least-32-characters";
const PASSWORD = "correct horse battery staple";

interface Storage {
  readonly settings: Pick<WorkspaceConfig, "database" | "s3BlobStore">;
  /** Reads product rows straight from the database, past every replica. */
  rows(sql: string): Promise<readonly Record<string, unknown>[]>;
}

async function sqliteStorage(resources: AsyncDisposableStack): Promise<Storage> {
  const directory = mkdtempSync(join(tmpdir(), "workspace-sign-in-codes-"));
  resources.defer(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, "product.sqlite");
  return {
    settings: { database: { provider: "sqlite", filename, collaborationFilename: join(directory, "collaboration.sqlite") } },
    async rows(sql) {
      const database = new DatabaseSync(filename, { readOnly: true });
      try {
        return database.prepare(sql).all();
      } finally {
        database.close();
      }
    },
  };
}

async function postgresStorage(url: string, resources: AsyncDisposableStack): Promise<Storage> {
  const database = await createPostgresTestDatabase(url);
  resources.defer(database.close);
  const pool = new Pool({ connectionString: database.connectionString });
  resources.defer(() => pool.end());
  return {
    settings: { database: { provider: "postgres", connectionString: database.connectionString }, s3BlobStore: await createTestBucket(resources) },
    rows: async (sql) => (await pool.query(sql)).rows,
  };
}

const postgresUrl = process.env.WORKSPACE_TEST_POSTGRES_URL;
const backends = [
  { name: "SQLite", storage: sqliteStorage },
  { name: "PostgreSQL", storage: postgresUrl ? (resources: AsyncDisposableStack) => postgresStorage(postgresUrl, resources) : undefined },
];

for (const { name, storage } of backends) {
  describe.skipIf(!storage)(`Two replicas on one ${name} product database`, { timeout: 30_000 }, () => {
    /** Two Workspace applications, each with its own connections, as two replicas run. */
    async function replicas(resources: AsyncDisposableStack, guestAuthorizationCapacity?: number) {
      const { settings, rows } = await storage!(resources);
      const config: WorkspaceConfig = {
        ...loadConfig({}),
        ...settings,
        host: "127.0.0.1",
        port: 0,
        secureCookies: false,
        passwordAuthEnabled: true,
        trustProxy: "loopback",
        agentCreateLimitPerHour: 20,
        oauthClients: { clients: [
          { clientId: STATIC_ID, clientType: "public", redirectUris: [STATIC_REDIRECT], scopes: ["identity"] },
          { clientId: GATEWAY_ID, clientType: "confidential", clientSecret: GATEWAY_SECRET, tokenExchange: true, redirectUris: ["https://gw.example.test/cb"], scopes: ["identity"] },
        ] },
        mcpOAuth: { issuer: ISSUER, resources: [RESOURCE], maxRegisteredClients: 100, cimdEnabled: false },
      };
      const start = async () => {
        const product = await openProductDatabase(config.database);
        resources.defer(() => product.close());
        const collaboration = await openCollaborationDatabase(config, product.unitCreationFacts);
        resources.defer(() => collaboration.close());
        const application = createWorkspaceApplication(config, product.repositories, collaboration, {
          unitStore: { createUnit: async (input) => ({ unitId: input.unitId, headRevision: 1 }) },
          ...(guestAuthorizationCapacity === undefined ? {} : { guestAuthorizationCapacity }),
        });
        resources.defer(() => application.close());
        await application.initialize();
        const server = createServer(application.app);
        resources.defer(() => new Promise<void>((resolve) => server.close(() => resolve())));
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      };
      const count = async (table: string) => Number((await rows(`SELECT COUNT(*) AS count FROM ${table}`))[0]!.count);
      return { a: await start(), b: await start(), rows, count };
    }

    it("redeems on one replica the consent and the authorization code another issued, for a person and for a zero-click guest", async () => {
      await using resources = new AsyncDisposableStack();
      const { a, b, count } = await replicas(resources);
      const client = await registerClient(a);
      const cookie = await registerPerson(a, "olivia");

      const consentToken = await consentTokenFrom(a, client, cookie);
      const allowed = await decide(b, consentToken, cookie);
      expect(allowed.status).toBe(303);
      const personTokens = await redeem(a, client, allowed);
      expect(personTokens.status).toBe(200);
      expect(await principalOf(b, await accessTokenOf(personTokens))).toMatchObject({ status: 200, body: { scope: "read", user: { kind: "human", username: "olivia" } } });
      expect((await decide(a, consentToken, cookie)).status, "a consent token is used once, whichever replica gets it").toBe(400);

      const guestCode = await authorize(a, { client_id: client });
      expect(await count("agents")).toBe(0);
      const guestTokens = await redeem(b, client, guestCode);
      expect(guestTokens.status).toBe(200);
      expect(await principalOf(a, await accessTokenOf(guestTokens))).toMatchObject({ status: 200, body: { user: { kind: "agent" } } });
      expect(await count("agents")).toBe(1);

      const staticCode = await fetch(`${a}/api/auth/authorize?${new URLSearchParams({ client_id: STATIC_ID, redirect_uri: STATIC_REDIRECT, state: STATE, code_challenge: CHALLENGE })}`, { headers: { cookie }, redirect: "manual" });
      const redeemStatic = (origin: string) => fetch(`${origin}/api/auth/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant_type: "authorization_code", code: codeOf(staticCode), client_id: STATIC_ID, redirect_uri: STATIC_REDIRECT, code_verifier: VERIFIER }),
      });
      const identity = await redeemStatic(b);
      expect({ status: identity.status, body: await identity.json() }).toMatchObject({ status: 200, body: { user: { username: "olivia" } } });
      const again = await redeemStatic(a);
      expect({ status: again.status, body: await again.json() }).toMatchObject({ status: 400, body: { error: { code: "INVALID_GRANT" } } });
    });

    it("refuses a replay on another replica and revokes the grant the first redemption issued", async () => {
      await using resources = new AsyncDisposableStack();
      const { a, b, count } = await replicas(resources);
      const client = await registerClient(a);
      const code = await authorize(a, { client_id: client });
      const accessToken = await accessTokenOf(await redeem(a, client, code));
      expect((await principalOf(b, accessToken)).status).toBe(200);

      const replayed = await redeem(b, client, code);
      expect({ status: replayed.status, body: await replayed.json() }).toMatchObject({ status: 400, body: { error: "invalid_grant" } });
      expect((await principalOf(a, accessToken)).status).toBe(400);
      expect(await count("agents")).toBe(1);
    });

    it("gives one grant and one agent to redemptions of one code that reach both replicas at once", async () => {
      await using resources = new AsyncDisposableStack();
      const { a, b, count } = await replicas(resources);
      const client = await registerClient(a);
      for (let round = 1; round <= 5; round += 1) {
        const code = await authorize(round % 2 ? a : b, { client_id: client });
        const responses = await Promise.all([redeem(a, client, code), redeem(b, client, code)]);
        expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
        const [won, lost] = responses[0]!.status === 200 ? responses : responses.toReversed();
        expect(await lost!.json()).toMatchObject({ error: "invalid_grant" });
        expect([await count("agents"), await count("oauth_grants")]).toEqual([round, round]);
        expect((await principalOf(a, await accessTokenOf(won!))).status, "the second redemption is a replay, so the grant ends revoked").toBe(400);
      }
    });

    it("holds the unredeemed guest code capacity across replicas", async () => {
      await using resources = new AsyncDisposableStack();
      const { a, b } = await replicas(resources, 2);
      const client = await registerClient(a);
      const first = await authorize(a, { client_id: client });
      expect([codeOf(first), codeOf(await authorize(b, { client_id: client }))]).toEqual([expect.any(String), expect.any(String)]);
      for (const origin of [a, b]) {
        const refused = new URL((await authorize(origin, { client_id: client })).headers.get("location")!);
        expect(Object.fromEntries(refused.searchParams)).toMatchObject({ error: "temporarily_unavailable", state: STATE });
      }
      expect((await redeem(b, client, first)).status).toBe(200);
      expect(codeOf(await authorize(a, { client_id: client }))).toEqual(expect.any(String));
    });

    it("gives one source at most 20 guest codes a minute across replicas, and leaves other sources theirs", async () => {
      await using resources = new AsyncDisposableStack();
      const { a, b } = await replicas(resources);
      const client = await registerClient(a);
      const attempts = await Promise.all(Array.from({ length: 24 }, (_, index) => authorize(index % 2 ? a : b, { client_id: client }, "203.0.113.7")));
      expect(attempts.filter((attempt) => codeOf(attempt) !== null)).toHaveLength(20);
      for (const origin of [a, b]) {
        const refused = new URL((await authorize(origin, { client_id: client }, "203.0.113.7")).headers.get("location")!);
        expect(Object.fromEntries(refused.searchParams)).toEqual({
          error: "temporarily_unavailable",
          error_description: "Too many sign-ins came from this address. Try again shortly.",
          state: STATE,
          iss: ISSUER,
        });
        const other = await authorize(origin, { client_id: client }, "198.51.100.9");
        expect((await redeem(origin === a ? b : a, client, other)).status, "another source still gets a guest").toBe(200);
      }
    });

    it("lets a person claim on one replica through the code the agent got from another", async () => {
      await using resources = new AsyncDisposableStack();
      const { a, b } = await replicas(resources);
      const created = await send(a, "POST", "/api/auth/guest", {});
      const agent = { id: ((await created.json()) as { agent: { id: string } }).agent.id, cookie: cookieOf(created) };
      const { code } = (await (await send(a, "POST", "/api/agents/claim-codes", undefined, agent.cookie)).json()) as { code: string };
      const cookie = await registerPerson(b, "alice");

      const preview = await send(b, "GET", `/api/agents/claim?code=${code}`, undefined, cookie);
      expect({ status: preview.status, body: await preview.json() }).toMatchObject({ status: 200, body: { claimed: false, agent: { id: agent.id } } });
      const claimed = await send(b, "POST", "/api/agents/claim", { code }, cookie);
      expect({ status: claimed.status, body: await claimed.json() }).toMatchObject({ status: 200, body: { agent: { id: agent.id } } });
      expect(await (await send(a, "GET", "/api/session", undefined, agent.cookie)).json()).toMatchObject({ user: { kind: "agent", claimed: true } });
    });

    it("approves and completes on one replica a CLI authorization another started, for one poll only", async () => {
      await using resources = new AsyncDisposableStack();
      const { a, b } = await replicas(resources);
      const cookie = await registerPerson(a, "olivia");
      const { deviceCode, userCode } = (await (await send(a, "POST", "/api/auth/cli/authorizations")).json()) as { deviceCode: string; userCode: string };
      const poll = (origin: string) => send(origin, "POST", "/api/auth/cli/authorizations/exchange", { deviceCode });

      const pending = await poll(b);
      expect({ status: pending.status, body: await pending.json() }).toEqual({ status: 202, body: { status: "pending" } });
      expect((await send(b, "POST", "/api/auth/cli/authorizations/approve", { userCode }, cookie)).status).toBe(200);
      const other = await registerPerson(b, "mallory");
      expect((await send(a, "POST", "/api/auth/cli/authorizations/approve", { userCode }, other)).status).toBe(409);

      const polls = await Promise.all([poll(a), poll(b)]);
      expect(polls.map((response) => response.status).sort()).toEqual([200, 400]);
      const authorized = polls.find((response) => response.status === 200)!;
      expect(await (await send(a, "GET", "/api/session", undefined, cookieOf(authorized))).json()).toMatchObject({ authenticated: true, user: { username: "olivia" } });
    });

    it("stores no code, token or user code in the clear", async () => {
      await using resources = new AsyncDisposableStack();
      const { a, rows } = await replicas(resources);
      const client = await registerClient(a);
      const cookie = await registerPerson(a, "olivia");
      const agent = cookieOf(await send(a, "POST", "/api/auth/guest", {}));
      const secrets = [
        codeOf(await authorize(a, { client_id: client }))!,
        await consentTokenFrom(a, client, cookie),
        ((await (await send(a, "POST", "/api/agents/claim-codes", undefined, agent)).json()) as { code: string }).code,
        ...Object.values((await (await send(a, "POST", "/api/auth/cli/authorizations")).json()) as { deviceCode: string; userCode: string }).filter((value) => typeof value === "string" && !value.startsWith("/")),
      ];
      expect(secrets).toHaveLength(5);

      const stored = await rows("SELECT * FROM sign_in_codes ORDER BY kind");
      expect(stored.map((row) => row.kind)).toEqual(["claim", "cli", "consent", "oauth_code"]);
      const text = JSON.stringify(stored);
      for (const secret of secrets) expect(text).not.toContain(secret);
    });
  });
}

function send(origin: string, method: string, path: string, body?: unknown, cookie?: string): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function cookieOf(response: Response): string {
  return response.headers.get("set-cookie")!.split(";", 1)[0]!;
}

async function registerPerson(origin: string, username: string): Promise<string> {
  const response = await send(origin, "POST", "/api/auth/password/register", { username, displayName: username, password: PASSWORD });
  expect(response.status).toBe(201);
  return cookieOf(response);
}

async function registerClient(origin: string): Promise<string> {
  const response = await send(origin, "POST", "/api/auth/register", { client_name: "opencode", redirect_uris: [CALLBACK] });
  expect(response.status).toBe(201);
  return ((await response.json()) as { client_id: string }).client_id;
}

function authorizeQuery(fields: Record<string, string>): string {
  return new URLSearchParams({
    response_type: "code", redirect_uri: CALLBACK, state: STATE, code_challenge: CHALLENGE, code_challenge_method: "S256",
    scope: "read write", resource: RESOURCE, ...fields,
  }).toString();
}

function authorize(origin: string, fields: Record<string, string>, forwardedFor?: string): Promise<Response> {
  return fetch(`${origin}/api/auth/authorize?${authorizeQuery(fields)}`, {
    redirect: "manual",
    ...(forwardedFor === undefined ? {} : { headers: { "x-forwarded-for": forwardedFor } }),
  });
}

function codeOf(redirected: Response): string | null {
  return new URL(redirected.headers.get("location")!).searchParams.get("code");
}

async function consentTokenFrom(origin: string, clientId: string, cookie: string): Promise<string> {
  const page = await fetch(`${origin}/api/auth/authorize/consent?${authorizeQuery({ client_id: clientId })}`, { headers: { cookie } });
  return /name="consent_token" value="([^"]+)"/u.exec(await page.text())![1]!;
}

function decide(origin: string, consentToken: string, cookie: string): Promise<Response> {
  return fetch(`${origin}/api/auth/authorize/consent`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    body: new URLSearchParams({ consent_token: consentToken, decision: "allow", scope: "read" }),
    redirect: "manual",
  });
}

function redeem(origin: string, clientId: string, redirected: Response): Promise<Response> {
  return fetch(`${origin}/api/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code: codeOf(redirected)!, code_verifier: VERIFIER, redirect_uri: CALLBACK, resource: RESOURCE }),
  });
}

async function accessTokenOf(issued: Response): Promise<string> {
  return ((await issued.json()) as { access_token: string }).access_token;
}

/** Whom an MCP access token acts for, as the gateway learns it. */
async function principalOf(origin: string, accessToken: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${origin}/api/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange", client_id: GATEWAY_ID, client_secret: GATEWAY_SECRET,
      subject_token: accessToken, subject_token_type: "urn:ietf:params:oauth:token-type:access_token", resource: RESOURCE,
    }),
  });
  return { status: response.status, body: await response.json() };
}
