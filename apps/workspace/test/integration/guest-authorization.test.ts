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
});

async function start(options: { agentCreateLimitPerHour: number; fetchDocument: FetchClientMetadataDocument }): Promise<string> {
  const application = await createProductTestApplication({
    host: "127.0.0.1",
    port: 0,
    productFilename: ":memory:",
    collaborationDatabaseFilename: ":memory:",
    secureCookies: false,
    sessionTtlMs: 24 * 60 * 60_000,
    passwordAuthEnabled: true,
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

function guest(origin: string, body: unknown): Promise<Response> {
  return fetch(`${origin}/api/auth/guest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
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
