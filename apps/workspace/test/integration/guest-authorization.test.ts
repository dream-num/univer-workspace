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
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const STATE = "Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Z2FycGx5";
const GATEWAY_ID = "univer-workspace-mcp-gateway";
const GATEWAY_SECRET = "test-gateway-secret-at-least-32-characters";
const applications: ProductTestApplication[] = [];
const servers: Server[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(applications.splice(0).map((application) => application.close()));
});

describe("authorizing an MCP client as a guest agent from the sign-in page", () => {
  it("answers what authorize would, sets no cookie, and lets the client redeem the code for an unclaimed agent named after it", async () => {
    const fetchDocument = vi.fn<FetchClientMetadataDocument>().mockImplementation(async (id) => {
      if (id === `${CIMD}/offline`) throw new ClientMetadataDocumentError(true, "offline");
      return { body: JSON.stringify({ client_id: CIMD, client_name: "Claude Code", redirect_uris: ["http://127.0.0.1/callback"] }) };
    });
    const origin = await start({ agentCreateLimitPerHour: 3, fetchDocument });
    const registered = await register(origin, "opencode");
    const refused: Array<[Record<string, string | undefined>, number]> = [
      [{ client_id: registered, redirect_uri: "http://127.0.0.1:10/elsewhere" }, 400],
      [{ client_id: "00000000-0000-4000-8000-000000000000" }, 400],
      [{ client_id: `${CIMD}/mismatch` }, 400],
      [{ client_id: `${CIMD}/offline` }, 503],
      [{ client_id: undefined }, 400],
      [{ client_id: STATIC_ID, redirect_uri: STATIC_REDIRECT }, 400],
    ];
    for (const [fields, status] of refused) {
      const answer = await guestAuthorization(origin, authorizeQuery(fields));
      expect(answer.status, JSON.stringify(fields)).toBe(status);
      expect(answer.headers.get("set-cookie")).toBeNull();
    }
    expect((await guestAuthorization(origin, 42)).status).toBe(400);
    const staticClient = await guestAuthorization(origin, new URLSearchParams({ client_id: STATIC_ID, redirect_uri: STATIC_REDIRECT, state: STATE, code_challenge: CHALLENGE }).toString());
    expect(await staticClient.json()).toMatchObject({ error: { code: "INVALID_INPUT", message: expect.stringMatching(/needs a person signed in/u) } });

    const redirected: Array<[Record<string, string | undefined>, string]> = [
      [{ client_id: registered, resource: "https://wrong.example.test/mcp" }, "invalid_target"],
      [{ client_id: CIMD, redirect_uri: "http://127.0.0.1:51063/callback", resource: undefined, scope: undefined }, "invalid_target"],
      [{ client_id: registered, code_challenge_method: "plain" }, "invalid_request"],
    ];
    for (const [fields, error] of redirected) {
      const answer = await guestAuthorization(origin, authorizeQuery(fields));
      expect(answer.status).toBe(200);
      const target = new URL(((await answer.json()) as { redirectUrl: string }).redirectUrl);
      expect(Object.fromEntries(target.searchParams)).toMatchObject({ error, state: STATE, iss: ISSUER });
      expect(target.searchParams.has("code")).toBe(false);
    }

    for (const [fields, callback, name] of [
      [{ client_id: registered }, CALLBACK, /^opencode · [a-z0-9]{4}$/u],
      [{ client_id: CIMD, redirect_uri: "http://127.0.0.1:51063/callback" }, "http://127.0.0.1:51063/callback", /^Claude Code · [a-z0-9]{4}$/u],
    ] as const) {
      const answer = await guestAuthorization(origin, authorizeQuery(fields));
      expect(answer.status).toBe(200);
      expect(answer.headers.get("set-cookie")).toBeNull();
      expect(answer.headers.get("cache-control")).toBe("no-store");
      const redirectUrl = ((await answer.json()) as { redirectUrl: string }).redirectUrl;
      const target = new URL(redirectUrl);
      expect(`${target.origin}${target.pathname}`).toBe(callback);
      expect(Object.fromEntries(target.searchParams)).toEqual({ code: expect.stringMatching(/^[\w-]{32}$/u), state: STATE, iss: ISSUER, scope: "read write" });

      const issued = await redeem(origin, fields.client_id, redirectUrl);
      expect(issued.status).toBe(200);
      const { access_token: accessToken } = (await issued.json()) as { access_token: string };
      expect(await (await principalOf(origin, accessToken)).json()).toMatchObject({
        scope: "read write",
        user: { kind: "agent", claimed: false, displayName: expect.stringMatching(name) },
      });
    }
    expect(fetchDocument.mock.calls.filter(([id]) => id === CIMD)).toHaveLength(1);
  });

  it("spends no creation until the client redeems the code, and refuses a source over its limit before fetching a client metadata document", async () => {
    const fetchDocument = vi.fn<FetchClientMetadataDocument>().mockImplementation(async (id) => ({
      body: JSON.stringify({ client_id: id, redirect_uris: ["http://127.0.0.1/callback"] }),
    }));
    const origin = await start({ agentCreateLimitPerHour: 1, fetchDocument });
    const continueWith = (clientId: string) => guestAuthorization(origin, authorizeQuery({ client_id: clientId, redirect_uri: "http://127.0.0.1:51063/callback" }));
    const first = await continueWith(`${CIMD}/first`);
    expect(first.status).toBe(200);
    expect((await redeem(origin, `${CIMD}/first`, ((await first.json()) as { redirectUrl: string }).redirectUrl)).status).toBe(200);
    const limited = await continueWith(`${CIMD}/second`);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: { code: "AGENT_CREATE_RATE_LIMITED" } });
    expect(fetchDocument.mock.calls.map(([id]) => id)).toEqual([`${CIMD}/first`]);
  });

  it("fetches nothing for a metadata-document client when guests are off", async () => {
    const fetchDocument = vi.fn<FetchClientMetadataDocument>();
    const origin = await start({ agentCreateLimitPerHour: 0, fetchDocument });
    const refused = await guestAuthorization(origin, authorizeQuery({ client_id: CIMD, redirect_uri: "http://127.0.0.1:51063/callback" }));
    expect(refused.status).toBe(429);
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
      const refused = await guestAuthorization(origin, authorizeQuery({ client_id: clientId, redirect_uri: "http://127.0.0.1:51063/callback" }));
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
      guestAuthorization(origin, authorizeQuery({ client_id: clientId, redirect_uri: "http://127.0.0.1:51063/callback" }), source);
    const holders = Array.from({ length: 8 }, (_, i) => continueWith(`${CIMD}/held/${i}`, `192.0.2.${i + 1}`));
    await vi.waitFor(() => expect(fetchDocument).toHaveBeenCalledTimes(8));

    const busy = await continueWith(`${CIMD}/new`, "198.51.100.1");
    release();
    await Promise.all(holders);
    expect(busy.status).toBe(503);
    expect(busy.headers.get("retry-after")).toBe("5");
    expect(await busy.json()).toMatchObject({ error: { code: "CLIENT_METADATA_BUSY" } });
    expect(fetchDocument).not.toHaveBeenCalledWith(`${CIMD}/new`);
    expect((await continueWith(`${CIMD}/new`, "198.51.100.1")).status).toBe(200);
  });

  it("stops a source that keeps starting metadata fetches before it starts another, without limiting its signed-in users", async () => {
    const fetchDocument = vi.fn<FetchClientMetadataDocument>().mockImplementation(async (id) => {
      if (id.includes("/slow/")) throw new ClientMetadataDocumentError(true, "Client metadata fetch exceeded 5 seconds.");
      return { body: JSON.stringify({ client_id: id, redirect_uris: ["http://127.0.0.1/callback"] }) };
    });
    const origin = await start({ agentCreateLimitPerHour: 1, fetchDocument, trustProxy: true });
    const continueWith = (clientId: string, source: string) =>
      guestAuthorization(origin, authorizeQuery({ client_id: clientId, redirect_uri: "http://127.0.0.1:51063/callback" }), source);
    expect((await continueWith(`${CIMD}/cached`, "192.0.2.10")).status).toBe(200);
    for (let i = 0; i < 10; i++) expect((await continueWith(`${CIMD}/slow/${i}`, "192.0.2.1")).status).toBe(503);

    const limited = await continueWith(`${CIMD}/new`, "192.0.2.1");
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: { code: "AGENT_CREATE_RATE_LIMITED" } });
    expect(fetchDocument).not.toHaveBeenCalledWith(`${CIMD}/new`);
    const signedIn = await fetch(`${origin}/api/auth/authorize?${authorizeQuery({ client_id: `${CIMD}/signed-in`, redirect_uri: "http://127.0.0.1:51063/callback" })}`, {
      headers: { cookie: await signIn(origin), "x-forwarded-for": "192.0.2.1" },
      redirect: "manual",
    });
    expect(signedIn.headers.get("location")).toMatch(/^\/api\/auth\/authorize\/consent\?/u);
    expect(fetchDocument).toHaveBeenCalledWith(`${CIMD}/signed-in`);
    expect((await continueWith(`${CIMD}/cached`, "192.0.2.1")).status).toBe(200);
    expect((await continueWith(`${CIMD}/new`, "192.0.2.2")).status).toBe(200);
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
      guestAuthorization(origin, query(`${CIMD}/held/${i}`), `192.0.2.${i + 1}`).then((response) => answered.push(response.status)));
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
    const continueAs = async (clientId: string) => {
      const answer = await guestAuthorization(origin, authorizeQuery({ client_id: clientId, redirect_uri: "http://127.0.0.1:51063/callback" }));
      const issued = await redeem(origin, clientId, ((await answer.json()) as { redirectUrl: string }).redirectUrl);
      const { access_token: accessToken } = (await issued.json()) as { access_token: string };
      return ((await (await principalOf(origin, accessToken)).json()) as { user: { username: string; displayName: string } }).user;
    };

    const claude = await continueAs(`${CIMD}/claude`);
    expect(claude.username).toMatch(/^claude-code-[a-z0-9]{4}$/u);
    expect(claude.displayName).toBe(`Claude Code · ${claude.username.slice(-4)}`);

    const hostile = await continueAs(`${CIMD}/hostile`);
    const suffix = ` · ${hostile.username.slice(-4)}`;
    expect(hostile.displayName.endsWith(suffix)).toBe(true);
    const name = hostile.displayName.slice(0, -suffix.length);
    expect(name.startsWith("Claude Code")).toBe(true);
    expect(name).not.toMatch(/[@\u0000-\u001F\u200B\u202A-\u202E\u2066-\u2069]|claude\.ai/u);
    expect([...name].length).toBeLessThanOrEqual(40);

    expect(await continueAs(`${CIMD}/blank`)).toMatchObject({ displayName: "agent", username: expect.stringMatching(/^agent-[a-z0-9]{4}$/u) });
  });
});

describe("a browser that holds only an agent's cookie", () => {
  it("is signed out for authorize, which sends it to the sign-in page and never makes a code for that agent", async () => {
    const fetchDocument = vi.fn<FetchClientMetadataDocument>();
    const origin = await start({ agentCreateLimitPerHour: 3, fetchDocument });
    const registered = await register(origin, "opencode", [CALLBACK, "https://client.example.test/cb"]);
    const cookies = { legacy: await legacyAgentCookie(origin), cli: cookieOf(await fetch(`${origin}/api/auth/guest`, { method: "POST" })) };
    for (const [kind, cookie] of Object.entries(cookies)) {
      for (const fields of [{ client_id: registered }, { client_id: registered, redirect_uri: "https://client.example.test/cb" }, { client_id: CIMD, redirect_uri: "http://127.0.0.1:51063/callback" }]) {
        const authorized = await authorize(origin, fields, cookie);
        expect(authorized.status, `${kind} ${fields.client_id}`).toBe(302);
        expect(authorized.headers.get("location")).toMatch(/^\/login\?returnTo=%2Fapi%2Fauth%2Fauthorize%3F/u);
      }
    }
    expect(fetchDocument, "a metadata document is fetched only for a person").not.toHaveBeenCalled();
    const consent = await fetch(`${origin}/api/auth/authorize/consent?${authorizeQuery({ client_id: registered })}`, { headers: { cookie: cookies.legacy } });
    expect({ status: consent.status, body: await consent.json() }).toMatchObject({ status: 403, body: { error: { code: "INTERACTIVE_SESSION_REQUIRED" } } });
  });

  it("cannot act for a person: no token, no agent token, no CLI approval", async () => {
    const origin = await start({ agentCreateLimitPerHour: 3, fetchDocument: vi.fn<FetchClientMetadataDocument>() });
    const cookie = await legacyAgentCookie(origin);
    const { userCode } = (await (await fetch(`${origin}/api/auth/cli/authorizations`, { method: "POST" })).json()) as { userCode: string };
    for (const [path, body] of [
      ["/api/auth/tokens", { name: "escalate" }],
      ["/api/auth/agent-token", { scopes: ["read"] }],
      ["/api/auth/cli/authorizations/approve", { userCode }],
    ] as const) {
      const refused = await fetch(`${origin}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
      expect({ path, status: refused.status, body: await refused.json() }).toMatchObject({
        path,
        status: 403,
        body: { error: { code: "INTERACTIVE_SESSION_REQUIRED", message: "This action needs a person signed in to Workspace in a browser." } },
      });
    }
    const person = await signIn(origin);
    expect((await fetch(`${origin}/api/auth/cli/authorizations/approve`, { method: "POST", headers: { "content-type": "application/json", cookie: person }, body: JSON.stringify({ userCode }) })).status).toBe(200);
  });
});

describe("authorizing a loopback client from a browser with no session", () => {
  const claudeCode = () => vi.fn<FetchClientMetadataDocument>().mockImplementation(async (id) => ({
    body: JSON.stringify({ client_id: id, client_name: "Claude Code", redirect_uris: ["http://127.0.0.1/callback"] }),
  }));

  it("sends the client a code for a new guest agent, with no page and no session", async () => {
    const origin = await start({ agentCreateLimitPerHour: 3, fetchDocument: claudeCode() });
    const registered = await register(origin, "opencode");
    const clients: Array<[Record<string, string | undefined>, string, string, RegExp]> = [
      [{ client_id: registered, scope: undefined }, CALLBACK, "read write publish worktree:merge", /^opencode · [a-z0-9]{4}$/u],
      [{ client_id: CIMD, redirect_uri: "http://127.0.0.1:51063/callback" }, "http://127.0.0.1:51063/callback", "read write", /^Claude Code · [a-z0-9]{4}$/u],
    ];
    for (const [fields, callback, scope, name] of clients) {
      const authorized = await authorize(origin, fields);
      expect(authorized.status).toBe(302);
      expect(authorized.headers.get("set-cookie")).toBeNull();
      const location = new URL(authorized.headers.get("location")!);
      expect(`${location.origin}${location.pathname}`).toBe(callback);
      expect(location.searchParams.get("code")).toMatch(/^[\w-]{32}$/u);
      expect(location.searchParams.get("state")).toBe(STATE);
      expect(location.searchParams.get("iss")).toBe(ISSUER);
      expect(location.searchParams.get("scope")).toBe(scope);

      const issued = await redeem(origin, fields.client_id!, authorized);
      expect(issued.status).toBe(200);
      const tokens = (await issued.json()) as { access_token: string; refresh_token: string; scope: string };
      expect(tokens).toMatchObject({ access_token: expect.stringMatching(/^uvw_at_/u), refresh_token: expect.stringMatching(/^uvw_rt_/u), scope });
      const principal = await principalOf(origin, tokens.access_token);
      expect(principal.status).toBe(200);
      expect(await principal.json()).toMatchObject({ scope, user: { kind: "agent", displayName: expect.stringMatching(name) } });
    }
  });

  it("leaves a client that is not loopback to the sign-in page, and a signed-in browser to the consent page", async () => {
    const origin = await start({ agentCreateLimitPerHour: 3, fetchDocument: claudeCode() });
    const registered = await register(origin, "opencode", [CALLBACK, "https://client.example.test/cb"]);
    const remote = await authorize(origin, { client_id: registered, redirect_uri: "https://client.example.test/cb" });
    expect(remote.status).toBe(302);
    expect(remote.headers.get("location")).toMatch(/^\/login\?returnTo=%2Fapi%2Fauth%2Fauthorize%3F/u);
    expect(remote.headers.get("set-cookie")).toBeNull();
    const signedIn = await authorize(origin, { client_id: registered }, await signIn(origin));
    expect(signedIn.status).toBe(302);
    expect(signedIn.headers.get("location")).toMatch(/^\/api\/auth\/authorize\/consent\?/u);

    const guestsOff = await start({ agentCreateLimitPerHour: 0, fetchDocument: claudeCode() });
    const off = await authorize(guestsOff, { client_id: await register(guestsOff, "opencode") });
    expect(off.headers.get("location")).toMatch(/^\/login\?/u);
  });

  it("creates the guest when the code is redeemed, once, within the creation limit", async () => {
    const fetchDocument = claudeCode();
    const origin = await start({ agentCreateLimitPerHour: 2, fetchDocument });
    const registered = await register(origin, "opencode");
    const unredeemed = await authorize(origin, { client_id: registered });
    const first = await authorize(origin, { client_id: registered });
    const issued = await redeem(origin, registered, first);
    expect(issued.status).toBe(200);
    const { access_token: accessToken } = (await issued.json()) as { access_token: string };
    const replayed = await redeem(origin, registered, first);
    expect(replayed.status).toBe(400);
    expect(await replayed.json()).toMatchObject({ error: "invalid_grant" });
    expect((await principalOf(origin, accessToken)).status).toBe(400);

    const second = await authorize(origin, { client_id: registered });
    expect((await redeem(origin, registered, second)).status).toBe(200);
    const limited = await authorize(origin, { client_id: CIMD, redirect_uri: "http://127.0.0.1:51063/callback" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("location")).toBeNull();
    expect(limited.headers.get("set-cookie")).toBeNull();
    expect(await limited.json()).toMatchObject({ error: { code: "AGENT_CREATE_RATE_LIMITED" } });
    expect(fetchDocument).not.toHaveBeenCalled();

    const late = await redeem(origin, registered, unredeemed);
    expect(late.status).toBe(429);
    expect(await late.json()).toEqual({ error: "temporarily_unavailable", error_description: "Too many agents were created from this address. Try again later." });
  });

  it("creates nothing for a request that would fail", async () => {
    const origin = await start({ agentCreateLimitPerHour: 1, fetchDocument: claudeCode() });
    const registered = await register(origin, "opencode");
    const redirected: Array<[Record<string, string | undefined>, string]> = [
      [{ client_id: registered, resource: "https://wrong.example.test/mcp" }, "invalid_target"],
      [{ client_id: registered, code_challenge_method: "plain" }, "invalid_request"],
      [{ client_id: registered, scope: "read admin" }, "invalid_scope"],
    ];
    for (const [fields, error] of redirected) {
      const refused = await authorize(origin, fields);
      const location = new URL(refused.headers.get("location")!);
      expect(location.searchParams.get("error")).toBe(error);
      expect(location.searchParams.has("code")).toBe(false);
    }
    for (const fields of [{ client_id: registered, redirect_uri: "http://127.0.0.1:10/elsewhere" }, { client_id: "00000000-0000-4000-8000-000000000000" }]) {
      const refused = await authorize(origin, fields);
      expect(refused.status).toBe(400);
      expect(refused.headers.get("location")).toBeNull();
    }
    const wrongVerifier = await redeem(origin, registered, await authorize(origin, { client_id: registered }), "x".repeat(43));
    expect(wrongVerifier.status).toBe(400);

    expect((await redeem(origin, registered, await authorize(origin, { client_id: registered }))).status).toBe(200);
    expect((await authorize(origin, { client_id: registered })).status).toBe(429);
  });

  it("tells the client to try again, and issues nothing, while too many codes wait unredeemed", async () => {
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    const origin = await start({ agentCreateLimitPerHour: 3, fetchDocument: claudeCode(), guestAuthorizationCapacity: 2 });
    const registered = await register(origin, "opencode");
    const codeOf = (authorized: Response) => new URL(authorized.headers.get("location")!).searchParams.get("code");
    const first = await authorize(origin, { client_id: registered });
    const second = await authorize(origin, { client_id: registered });
    expect([codeOf(first), codeOf(second)]).toEqual([expect.stringMatching(/^[\w-]{32}$/u), expect.stringMatching(/^[\w-]{32}$/u)]);

    const refused = await authorize(origin, { client_id: registered });
    expect(refused.status).toBe(302);
    expect(refused.headers.get("set-cookie")).toBeNull();
    const location = new URL(refused.headers.get("location")!);
    expect(`${location.origin}${location.pathname}`).toBe(CALLBACK);
    expect(Object.fromEntries(location.searchParams)).toEqual({
      error: "temporarily_unavailable",
      error_description: expect.stringMatching(/try again/iu),
      state: STATE,
      iss: ISSUER,
    });

    expect((await redeem(origin, registered, first)).status).toBe(200);
    const third = await authorize(origin, { client_id: registered });
    expect(codeOf(third)).toMatch(/^[\w-]{32}$/u);
    expect(codeOf(await authorize(origin, { client_id: registered }))).toBeNull();

    vi.setSystemTime(Date.now() + 61_000);
    const fresh = [await authorize(origin, { client_id: registered }), await authorize(origin, { client_id: registered })];
    expect(fresh.map(codeOf)).toEqual([expect.stringMatching(/^[\w-]{32}$/u), expect.stringMatching(/^[\w-]{32}$/u)]);
    expect((await redeem(origin, registered, third)).status).toBe(400);

    const cookie = await signIn(origin);
    const consent = await fetch(`${origin}/api/auth/authorize/consent?${authorizeQuery({ client_id: registered })}`, { headers: { cookie } });
    const consentToken = /name="consent_token" value="([^"]+)"/u.exec(await consent.text())![1]!;
    const allowed = await fetch(`${origin}/api/auth/authorize/consent`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie },
      body: new URLSearchParams({ consent_token: consentToken, decision: "allow", scope: "read", connect_as: "self" }),
      redirect: "manual",
    });
    expect(codeOf(allowed)).toMatch(/^[\w-]{32}$/u);

    for (const authorized of fresh) expect((await redeem(origin, registered, authorized)).status).toBe(200);
  });
});

async function start(options: { agentCreateLimitPerHour: number; fetchDocument: FetchClientMetadataDocument; trustProxy?: boolean; guestAuthorizationCapacity?: number }): Promise<string> {
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
    oauthClients: { clients: [
      { clientId: STATIC_ID, clientType: "public", redirectUris: [STATIC_REDIRECT], scopes: ["identity"] },
      { clientId: GATEWAY_ID, clientType: "confidential", clientSecret: GATEWAY_SECRET, tokenExchange: true, redirectUris: ["https://gw.example.test/cb"], scopes: ["identity"] },
    ] },
    mcpOAuth: { issuer: ISSUER, resources: [RESOURCE], maxRegisteredClients: 100, cimdEnabled: true },
  }, {
    unitStore: { createUnit: async (input) => ({ unitId: input.unitId, headRevision: 1 }) },
    fetchClientMetadataDocument: options.fetchDocument,
    ...(options.guestAuthorizationCapacity === undefined ? {} : { guestAuthorizationCapacity: options.guestAuthorizationCapacity }),
  });
  applications.push(application);
  const server = createServer(application.app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not expose a TCP address");
  return `http://127.0.0.1:${address.port}`;
}

function guestAuthorization(origin: string, oauthAuthorization: unknown, forwardedFor?: string): Promise<Response> {
  return fetch(`${origin}/api/auth/authorize/guest`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(forwardedFor === undefined ? {} : { "x-forwarded-for": forwardedFor }) },
    body: JSON.stringify({ oauthAuthorization }),
  });
}

/** A guest card's agent browser session from before agents stopped getting one; no route issues it now. */
async function legacyAgentCookie(origin: string): Promise<string> {
  const application = applications.at(-1)!;
  const { agent } = (await (await fetch(`${origin}/api/agents`, { method: "POST" })).json()) as { agent: { id: string } };
  const [user] = await application.identity.findUsers([agent.id]);
  const issued = await application.identity.issueSession(user!, "browser");
  return `${application.identity.cookieName}=${issued.cookieValue}`;
}

function cookieOf(response: Response): string {
  return response.headers.get("set-cookie")!.split(";", 1)[0]!;
}

async function signIn(origin: string): Promise<string> {
  const response = await fetch(`${origin}/api/auth/password/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "olivia", displayName: "Olivia", password: "correct horse battery staple" }),
  });
  expect(response.status).toBe(201);
  return cookieOf(response);
}

async function register(origin: string, clientName: string, redirectUris = [CALLBACK]): Promise<string> {
  const response = await fetch(`${origin}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: clientName, redirect_uris: redirectUris }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { client_id: string }).client_id;
}

function authorize(origin: string, fields: Record<string, string | undefined>, cookie?: string): Promise<Response> {
  return fetch(`${origin}/api/auth/authorize?${authorizeQuery(fields)}`, { redirect: "manual", ...(cookie === undefined ? {} : { headers: { cookie } }) });
}

function redeem(origin: string, clientId: string, authorized: Response | string, codeVerifier = VERIFIER): Promise<Response> {
  const callback = new URL(typeof authorized === "string" ? authorized : authorized.headers.get("location")!);
  return fetch(`${origin}/api/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", client_id: clientId, code: callback.searchParams.get("code")!, code_verifier: codeVerifier,
      redirect_uri: `${callback.origin}${callback.pathname}`, resource: RESOURCE,
    }),
  });
}

/** Whom an MCP access token acts for, as the gateway learns it. */
function principalOf(origin: string, accessToken: string): Promise<Response> {
  return fetch(`${origin}/api/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange", client_id: GATEWAY_ID, client_secret: GATEWAY_SECRET,
      subject_token: accessToken, subject_token_type: "urn:ietf:params:oauth:token-type:access_token", resource: RESOURCE,
    }),
  });
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
