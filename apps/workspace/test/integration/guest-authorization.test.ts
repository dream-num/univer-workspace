import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientMetadataDocumentError, type FetchClientMetadataDocument } from "../../server/src/modules/identity/client-metadata-document.js";
import { createProductTestApplication, type ProductTestApplication } from "../support/product-test-application.js";

const ISSUER = "https://space.example.test";
const RESOURCE = "https://space.example.test/mcp";
const CALLBACK = "http://127.0.0.1:9/callback";
const CIMD = "https://client.example.test/metadata";
const STATIC_ID = "workspace-agent";
const STATIC_REDIRECT = "https://agent.example.test/cb";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const STATE = "Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Z2FycGx5";
const applications: ProductTestApplication[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(applications.splice(0).map((application) => application.close()));
});

describe("continuing an OAuth authorization as a guest agent", () => {
  it("creates nothing and spends no creation for an authorization that would fail", async () => {
    const fetchDocument = vi.fn<FetchClientMetadataDocument>().mockImplementation(async (id) => {
      if (id === `${CIMD}/offline`) throw new ClientMetadataDocumentError(true, "offline");
      return { body: JSON.stringify({ client_id: CIMD, client_name: "Claude Code", redirect_uris: ["http://127.0.0.1/callback"] }) };
    });
    const origin = await start({ agentCreateLimitPerHour: 3, fetchDocument });
    const registered = await register(origin, "opencode");
    const failing: Array<[Record<string, string | undefined>, number]> = [
      [{ client_id: registered, resource: "https://wrong.example.test/mcp" }, 400],
      [{ client_id: CIMD, redirect_uri: "http://127.0.0.1:51063/callback", resource: undefined, scope: undefined }, 400],
      [{ client_id: registered, redirect_uri: "http://127.0.0.1:10/elsewhere" }, 400],
      [{ client_id: registered, code_challenge_method: "plain" }, 400],
      [{ client_id: "00000000-0000-4000-8000-000000000000" }, 400],
      [{ client_id: `${CIMD}/mismatch` }, 400],
      [{ client_id: `${CIMD}/offline` }, 503],
      [{ client_id: undefined }, 400],
    ];
    for (const [fields, status] of failing) {
      const refused = await guest(origin, { oauthAuthorization: authorizeQuery(fields) });
      expect(refused.status).toBe(status);
      expect(refused.headers.get("set-cookie")).toBeNull();
    }
    expect((await guest(origin, { oauthAuthorization: 42 })).status).toBe(400);

    const continued = [
      authorizeQuery({ client_id: registered }),
      authorizeQuery({ client_id: CIMD, redirect_uri: "http://127.0.0.1:51063/callback" }),
      new URLSearchParams({ client_id: STATIC_ID, redirect_uri: STATIC_REDIRECT, state: STATE, code_challenge: CHALLENGE }).toString(),
    ];
    for (const query of continued) {
      const created = await guest(origin, { oauthAuthorization: query });
      expect(created.status).toBe(201);
      const cookie = created.headers.get("set-cookie")!.split(";", 1)[0]!;
      const authorize = await fetch(`${origin}/api/auth/authorize?${query}`, { headers: { cookie }, redirect: "manual" });
      expect(authorize.headers.get("location")).toMatch(query.includes(STATIC_ID) ? /^https:\/\/agent\.example\.test\/cb\?code=/u : /^\/api\/auth\/authorize\/consent\?/u);
    }
    expect(fetchDocument.mock.calls.filter(([id]) => id === CIMD)).toHaveLength(1);
    const limited = await guest(origin, { oauthAuthorization: continued[0] });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: { code: "AGENT_CREATE_RATE_LIMITED" } });
  });

  it("refuses a source over its creation limit before fetching a client metadata document", async () => {
    const fetchDocument = vi.fn<FetchClientMetadataDocument>().mockImplementation(async (id) => ({
      body: JSON.stringify({ client_id: id, redirect_uris: ["http://127.0.0.1/callback"] }),
    }));
    const origin = await start({ agentCreateLimitPerHour: 1, fetchDocument });
    const continueWith = (clientId: string) => guest(origin, { oauthAuthorization: authorizeQuery({ client_id: clientId, redirect_uri: "http://127.0.0.1:51063/callback" }) });
    expect((await continueWith(`${CIMD}/first`)).status).toBe(201);
    const limited = await continueWith(`${CIMD}/second`);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("set-cookie")).toBeNull();
    expect(fetchDocument.mock.calls.map(([id]) => id)).toEqual([`${CIMD}/first`]);
  });

  it("fetches nothing and creates nothing for a metadata-document client when guests are off", async () => {
    const fetchDocument = vi.fn<FetchClientMetadataDocument>();
    const origin = await start({ agentCreateLimitPerHour: 0, fetchDocument });
    const refused = await guest(origin, { oauthAuthorization: authorizeQuery({ client_id: CIMD, redirect_uri: "http://127.0.0.1:51063/callback" }) });
    expect(refused.status).toBe(429);
    expect(refused.headers.get("set-cookie")).toBeNull();
    expect(((await refused.json()) as { error: { message: string } }).error.message).toMatch(/turned off/u);
    expect(fetchDocument).not.toHaveBeenCalled();
  });

  it("tells the caller nothing about why a client metadata document failed", async () => {
    const details: Record<string, ClientMetadataDocumentError | string> = {
      [`${CIMD}/private`]: new ClientMetadataDocumentError(false, "Client metadata address is not a public network address."),
      [`${CIMD}/unreachable`]: new ClientMetadataDocumentError(true, "Client metadata network request failed."),
      [`${CIMD}/garbled`]: "{not json",
    };
    const fetchDocument = vi.fn<FetchClientMetadataDocument>().mockImplementation(async (id) => {
      const detail = details[id]!;
      if (typeof detail === "string") return { body: detail };
      throw detail;
    });
    const origin = await start({ agentCreateLimitPerHour: 3, fetchDocument });
    const refusals: Array<{ status: number; message: string; retryAfter: string | null }> = [];
    for (const clientId of Object.keys(details)) {
      const refused = await guest(origin, { oauthAuthorization: authorizeQuery({ client_id: clientId, redirect_uri: "http://127.0.0.1:51063/callback" }) });
      refusals.push({ status: refused.status, message: ((await refused.json()) as { error: { message: string } }).error.message, retryAfter: refused.headers.get("retry-after") });
    }
    expect(refusals.map(({ status }) => status)).toEqual([400, 503, 400]);
    expect(new Set(refusals.map(({ message }) => message)).size).toBe(1);
    expect(refusals[0]!.message).not.toMatch(/public network|network request|JSON/u);
    expect(refusals.map(({ retryAfter }) => retryAfter)).toEqual([null, null, null]);
  });

  it("tells a guest to retry shortly when the anonymous metadata fetches are all busy", async () => {
    let release!: () => void;
    const held = new Promise<void>((done) => { release = done; });
    const fetchDocument = vi.fn<FetchClientMetadataDocument>().mockImplementation(async (id) => {
      if (id.includes("/held/")) await held;
      return { body: JSON.stringify({ client_id: id, redirect_uris: ["http://127.0.0.1/callback"] }) };
    });
    const origin = await start({ agentCreateLimitPerHour: 1, fetchDocument, trustProxy: true });
    const continueWith = (clientId: string, source: string) =>
      guest(origin, { oauthAuthorization: authorizeQuery({ client_id: clientId, redirect_uri: "http://127.0.0.1:51063/callback" }) }, source);
    const holders = Array.from({ length: 8 }, (_, i) => continueWith(`${CIMD}/held/${i}`, `192.0.2.${i + 1}`));
    await vi.waitFor(() => expect(fetchDocument).toHaveBeenCalledTimes(8));

    const busy = await continueWith(`${CIMD}/new`, "198.51.100.1");
    release();
    await Promise.all(holders);
    expect(busy.status).toBe(503);
    expect(busy.headers.get("retry-after")).toBe("5");
    expect(busy.headers.get("set-cookie")).toBeNull();
    expect(await busy.json()).toMatchObject({ error: { code: "CLIENT_METADATA_BUSY" } });
    expect(fetchDocument).not.toHaveBeenCalledWith(`${CIMD}/new`);
    expect((await continueWith(`${CIMD}/new`, "198.51.100.1")).status).toBe(201);
  });

  it("stops a source that keeps starting metadata fetches before it starts another, without spending its guest creations or limiting its signed-in users", async () => {
    const fetchDocument = vi.fn<FetchClientMetadataDocument>().mockImplementation(async (id) => {
      if (id.includes("/slow/")) throw new ClientMetadataDocumentError(true, "Client metadata fetch exceeded 5 seconds.");
      return { body: JSON.stringify({ client_id: id, redirect_uris: ["http://127.0.0.1/callback"] }) };
    });
    const origin = await start({ agentCreateLimitPerHour: 1, fetchDocument, trustProxy: true });
    const continueWith = (clientId: string, source: string) =>
      guest(origin, { oauthAuthorization: authorizeQuery({ client_id: clientId, redirect_uri: "http://127.0.0.1:51063/callback" }) }, source);
    expect((await continueWith(`${CIMD}/cached`, "192.0.2.10")).status).toBe(201);
    for (let i = 0; i < 10; i++) expect((await continueWith(`${CIMD}/slow/${i}`, "192.0.2.1")).status).toBe(503);

    const limited = await continueWith(`${CIMD}/new`, "192.0.2.1");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("set-cookie")).toBeNull();
    expect(await limited.json()).toMatchObject({ error: { code: "AGENT_CREATE_RATE_LIMITED" } });
    expect(fetchDocument).not.toHaveBeenCalledWith(`${CIMD}/new`);
    const signedIn = await fetch(`${origin}/api/auth/authorize?${authorizeQuery({ client_id: `${CIMD}/signed-in`, redirect_uri: "http://127.0.0.1:51063/callback" })}`, {
      headers: { cookie: await signIn(origin), "x-forwarded-for": "192.0.2.1" },
      redirect: "manual",
    });
    expect(signedIn.headers.get("location")).toMatch(/^\/api\/auth\/authorize\/consent\?/u);
    expect(fetchDocument).toHaveBeenCalledWith(`${CIMD}/signed-in`);
    expect((await continueWith(`${CIMD}/cached`, "192.0.2.1")).status).toBe(201);
    expect((await continueWith(`${CIMD}/new`, "192.0.2.2")).status).toBe(201);
  });

  it("keeps signed-in authorization able to fetch a client metadata document while anonymous guests wait on theirs", async () => {
    let release!: () => void;
    const held = new Promise<void>((done) => { release = done; });
    const fetchDocument = vi.fn<FetchClientMetadataDocument>().mockImplementation(async (id) => {
      if (id.includes("/held/")) await held;
      return { body: JSON.stringify({ client_id: id, redirect_uris: ["http://127.0.0.1/callback"] }) };
    });
    const origin = await start({ agentCreateLimitPerHour: 1, fetchDocument, trustProxy: true });
    const query = (clientId: string) => authorizeQuery({ client_id: clientId, redirect_uri: "http://127.0.0.1:51063/callback" });
    const answered: number[] = [];
    const guests = Array.from({ length: 32 }, (_, i) =>
      guest(origin, { oauthAuthorization: query(`${CIMD}/held/${i}`) }, `192.0.2.${i + 1}`).then((response) => answered.push(response.status)));
    await vi.waitFor(() => expect(fetchDocument.mock.calls.length + answered.length).toBe(32));

    const signedIn = await fetch(`${origin}/api/auth/authorize?${query(`${CIMD}/signed-in`)}`, { headers: { cookie: await signIn(origin) }, redirect: "manual" });
    release();
    await Promise.all(guests);
    expect(signedIn.status).toBe(302);
    expect(signedIn.headers.get("location")).toMatch(/^\/api\/auth\/authorize\/consent\?/u);
  });

  it("names the guest after a metadata-document client under the display-name rules", async () => {
    const names: Record<string, string> = {
      [`${CIMD}/claude`]: "Claude Code",
      [`${CIMD}/hostile`]: `\u202EClaude\nCode\u200B ops@claude.ai ${"x".repeat(60)}`,
      [`${CIMD}/blank`]: "\u202E\u2066\n",
    };
    const fetchDocument = vi.fn<FetchClientMetadataDocument>().mockImplementation(async (id) => ({
      body: JSON.stringify({ client_id: id, client_name: names[id], redirect_uris: ["http://127.0.0.1/callback"] }),
    }));
    const origin = await start({ agentCreateLimitPerHour: 10, fetchDocument });
    const continueAs = async (clientId: string, label?: string) => {
      const query = authorizeQuery({ client_id: clientId, redirect_uri: "http://127.0.0.1:51063/callback" });
      const created = await guest(origin, { oauthAuthorization: query, ...(label === undefined ? {} : { label }) });
      expect(created.status).toBe(201);
      const cookie = created.headers.get("set-cookie")!.split(";", 1)[0]!;
      const { user } = (await (await fetch(`${origin}/api/session`, { headers: { cookie } })).json()) as { user: { username: string; displayName: string } };
      return { ...user, consent: await (await fetch(`${origin}/api/auth/authorize/consent?${query}`, { headers: { cookie } })).text() };
    };

    const claude = await continueAs(`${CIMD}/claude`);
    expect(claude.username).toMatch(/^claude-code-[a-z0-9]{4}$/u);
    expect(claude.displayName).toBe(`Claude Code · ${claude.username.slice(-4)}`);
    expect(claude.consent).toContain(`wants to use Univer Workspace as <strong>Claude Code · ${claude.username.slice(-4)}</strong>`);

    const hostile = await continueAs(`${CIMD}/hostile`);
    const suffix = ` · ${hostile.username.slice(-4)}`;
    expect(hostile.displayName.endsWith(suffix)).toBe(true);
    const name = hostile.displayName.slice(0, -suffix.length);
    expect(name.startsWith("Claude Code")).toBe(true);
    expect(name).not.toMatch(/[@\u0000-\u001F\u200B\u202A-\u202E\u2066-\u2069]|claude\.ai/u);
    expect([...name].length).toBeLessThanOrEqual(40);

    expect(await continueAs(`${CIMD}/blank`)).toMatchObject({ displayName: "agent", username: expect.stringMatching(/^agent-[a-z0-9]{4}$/u) });
    expect(await continueAs(`${CIMD}/claude`, "Budget bot")).toMatchObject({ displayName: "Budget bot" });
  });
});

async function start(options: { agentCreateLimitPerHour: number; fetchDocument: FetchClientMetadataDocument; trustProxy?: boolean }): Promise<string> {
  const application = await createProductTestApplication({
    host: "127.0.0.1",
    port: 0,
    productFilename: ":memory:",
    collaborationDatabaseFilename: ":memory:",
    secureCookies: false,
    sessionTtlMs: 24 * 60 * 60_000,
    passwordAuthEnabled: true,
    ...(options.trustProxy ? { trustProxy: true } : {}),
    agentCreateLimitPerHour: options.agentCreateLimitPerHour,
    oauthClients: { clients: [{ clientId: STATIC_ID, clientType: "public", redirectUris: [STATIC_REDIRECT], scopes: ["identity"] }] },
    mcpOAuth: { issuer: ISSUER, resources: [RESOURCE], maxRegisteredClients: 100, cimdEnabled: true },
  }, {
    unitStore: { createUnit: async (input) => ({ unitId: input.unitId, headRevision: 1 }) },
    fetchClientMetadataDocument: options.fetchDocument,
  });
  applications.push(application);
  const server = createServer(application.app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not expose a TCP address");
  return `http://127.0.0.1:${address.port}`;
}

function guest(origin: string, body: unknown, forwardedFor?: string): Promise<Response> {
  return fetch(`${origin}/api/auth/guest`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(forwardedFor === undefined ? {} : { "x-forwarded-for": forwardedFor }) },
    body: JSON.stringify(body),
  });
}

async function signIn(origin: string): Promise<string> {
  const response = await fetch(`${origin}/api/auth/password/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "olivia", displayName: "Olivia", password: "correct horse battery staple" }),
  });
  expect(response.status).toBe(201);
  return response.headers.get("set-cookie")!.split(";", 1)[0]!;
}

async function register(origin: string, clientName: string): Promise<string> {
  const response = await fetch(`${origin}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: clientName, redirect_uris: [CALLBACK] }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { client_id: string }).client_id;
}

function authorizeQuery(fields: Record<string, string | undefined>): string {
  const values: Record<string, string | undefined> = {
    response_type: "code",
    redirect_uri: CALLBACK,
    state: STATE,
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    scope: "read write",
    resource: RESOURCE,
    ...fields,
  };
  return new URLSearchParams(Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined)).toString();
}
