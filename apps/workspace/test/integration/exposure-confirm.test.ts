import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterEach, expect, it } from "vitest";
import { createProductTestApplication, type ProductTestApplication } from "../support/product-test-application.js";

const GATEWAY_ID = "univer-workspace-mcp-gateway";
const GATEWAY_SECRET = "test-gateway-secret-at-least-32-characters";
const PASSWORD = "correct horse battery staple";

const applications: ProductTestApplication[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(applications.splice(0).map((application) => application.close()));
});

interface Actor {
  readonly id: string;
  readonly cookie: string;
}

interface Target {
  readonly cookie: string;
  readonly team: string;
  readonly file: string;
  readonly confirmer: string;
}

const PRIVATE = { publicRead: false, members: [], grants: [], link: "off" };

it("refuses to widen for every session but a person in a browser, changes nothing, and names the confirm page", async () => {
  const w = await world();
  for (const [session, target] of Object.entries(w.refusedWithLink)) {
    const teams = await teamCount(w.origin, target.cookie);
    for (const [request, url] of [
      ...widenings(w, target),
      [send(w.origin, "POST", "/api/team-spaces", { name: "Public", publicRead: true }, target.cookie), undefined],
    ] as const) {
      expect(await answer(request), session).toEqual({ status: 403, code: "INTERACTIVE_SESSION_REQUIRED", url });
    }
    expect(await exposure(w.origin, target), session).toEqual(PRIVATE);
    expect(await teamCount(w.origin, target.cookie), session).toBe(teams);
  }

  const browser = { ...w.refusedWithLink["a person's CLI session"], cookie: w.alice.cookie };
  for (const [request] of widenings(w, browser)) expect((await request).status).toBe(200);
  expect(await exposure(w.origin, browser)).toEqual({
    publicRead: true, members: [[w.bob.id, "editor"]], grants: [[w.bob.id, "viewer"]], link: "editor",
  });
  expect((await send(w.origin, "POST", "/api/team-spaces", { name: "Public", publicRead: true }, w.alice.cookie)).status).toBe(201);
}, 60_000);

it("tells a temporary agent to hand over its handoff link, with no confirm page, a viewer link included", async () => {
  const w = await world();
  const target = w.temporary;
  for (const [request] of [
    ...widenings(w, target),
    [send(w.origin, "POST", "/api/team-spaces", { name: "Public", publicRead: true }, target.cookie)],
    [send(w.origin, "PUT", `/api/nodes/${target.file}/link-sharing`, { enabled: true, role: "viewer" }, target.cookie)],
  ] as const) {
    const response = await request;
    expect({ status: response.status, body: await response.json() }).toEqual({ status: 403, body: { error: {
      code: "AGENT_NOT_ALLOWED",
      message: expect.stringContaining("Get a handoff link with claim (uvw claim in the CLI) and give it to the user."),
    } } });
  }
  expect(await exposure(w.origin, target)).toEqual(PRIVATE);

  expect((await send(w.origin, "PUT", `/api/nodes/${target.file}/link-sharing`, { enabled: false, role: "viewer" }, target.cookie)).status).toBe(200);
}, 60_000);

it("lets every session repeat the stored level and narrow it", async () => {
  const w = await world();
  for (const [session, target] of Object.entries(w.refusedWithLink)) {
    const { cookie, team, file } = target;
    for (const [request] of widenings(w, { ...target, cookie: target.confirmer })) expect((await request).status, session).toBe(200);
    for (const [request] of widenings(w, target)) expect((await request).status, `${session} repeats`).toBe(200);

    for (const [method, path, body, status] of [
      ["PUT", `/api/team-spaces/${team}/members/${w.bob.id}`, { role: "viewer" }, 200],
      ["PUT", `/api/nodes/${file}/link-sharing`, { enabled: true, role: "viewer" }, 200],
      ["DELETE", `/api/team-spaces/${team}/members/${w.bob.id}`, undefined, 204],
      ["DELETE", `/api/nodes/${file}/grants/${w.bob.id}`, undefined, 200],
      ["PUT", `/api/nodes/${file}/link-sharing`, { enabled: false, role: "editor" }, 200],
      ["PATCH", `/api/spaces/${team}`, { publicRead: false }, 200],
    ] as const) {
      expect((await send(w.origin, method, path, body, cookie)).status, `${session} ${method} ${path}`).toBe(status);
    }
    expect(await exposure(w.origin, target), session).toEqual(PRIVATE);
  }
}, 60_000);

it("refuses an agent that sets a link to viewer after the owner turned the link off", async () => {
  const w = await world();
  const { cookie, file, confirmer } = w.refusedWithLink["a claimed agent"];
  const link = (by: string, enabled: boolean, role: string) => send(w.origin, "PUT", `/api/nodes/${file}/link-sharing`, { enabled, role }, by);
  expect((await link(confirmer, true, "editor")).status).toBe(200);
  expect((await link(confirmer, false, "editor")).status).toBe(200);
  expect(await answer(link(cookie, true, "viewer")))
    .toEqual({ status: 403, code: "INTERACTIVE_SESSION_REQUIRED", url: `/confirm/link-sharing?node=${file}&role=viewer` });
  expect((await exposure(w.origin, w.refusedWithLink["a claimed agent"])).link).toBe("off");
}, 60_000);

it("gives someone without the capability the refusal they always got, and no confirm page", async () => {
  const w = await world();
  const { team, file } = w.refusedWithLink["a person's CLI session"];
  expect((await send(w.origin, "PUT", `/api/team-spaces/${team}/members/${w.carol.id}`, { role: "viewer" }, w.alice.cookie)).status).toBe(200);
  expect((await send(w.origin, "PUT", `/api/nodes/${file}/grants/${w.carol.id}`, { role: "viewer" }, w.alice.cookie)).status).toBe(200);
  const carolCli = await cliSession(w.origin, "carol");

  for (const cookie of [carolCli, w.carol.cookie]) {
    const target = { cookie, team, file, confirmer: w.alice.cookie };
    expect(await Promise.all(widenings(w, target).map(([request]) => answer(request)))).toEqual([
      { status: 403, code: "FORBIDDEN", url: undefined },
      { status: 403, code: "FORBIDDEN", url: undefined },
      { status: 403, code: "FORBIDDEN", url: undefined },
      { status: 403, code: "FORBIDDEN", url: undefined },
    ]);
  }
}, 60_000);

function widenings(w: { readonly origin: string; readonly bob: Actor }, { cookie, team, file }: Target) {
  const bob = w.bob.id;
  return [
    [send(w.origin, "PATCH", `/api/spaces/${team}`, { publicRead: true }, cookie), `/confirm/public?space=${team}`],
    [send(w.origin, "PUT", `/api/team-spaces/${team}/members/${bob}`, { role: "editor" }, cookie), `/confirm/member?space=${team}&user=${bob}&role=editor`],
    [send(w.origin, "PUT", `/api/nodes/${file}/grants/${bob}`, { role: "viewer" }, cookie), `/confirm/grant?node=${file}&user=${bob}&role=viewer`],
    [send(w.origin, "PUT", `/api/nodes/${file}/link-sharing`, { enabled: true, role: "editor" }, cookie), `/confirm/link-sharing?node=${file}&role=editor`],
  ] as const;
}

async function answer(request: Promise<Response>) {
  const response = await request;
  const { error } = (await response.json()) as { error?: { code: string; url?: string } };
  return { status: response.status, code: error?.code, url: error?.url };
}

async function exposure(origin: string, { cookie, team, file }: Pick<Target, "cookie" | "team" | "file">) {
  const read = async <T>(path: string) => (await (await send(origin, "GET", path, undefined, cookie)).json()) as T;
  const { publicRead } = await read<{ publicRead: boolean }>(`/api/spaces/${team}`);
  const { members } = await read<{ members: { user: { id: string }; role: string }[] }>(`/api/team-spaces/${team}/members`);
  const { grants } = await read<{ grants: { user: { id: string }; role: string }[] }>(`/api/nodes/${file}/grants`);
  const link = await read<{ enabled: boolean; role: string }>(`/api/nodes/${file}/link-sharing`);
  return {
    publicRead,
    members: members.map(({ user, role }) => [user.id, role]),
    grants: grants.map(({ user, role }) => [user.id, role]),
    link: link.enabled ? link.role : "off",
  };
}

async function teamCount(origin: string, cookie: string): Promise<number> {
  const { spaces } = (await (await send(origin, "GET", "/api/spaces", undefined, cookie)).json()) as { spaces: { type: string; affiliation: string }[] };
  return spaces.filter((space) => space.type === "team" && space.affiliation === "owner").length;
}

async function world() {
  const application = await createProductTestApplication({
    host: "127.0.0.1",
    port: 0,
    productFilename: ":memory:",
    collaborationDatabaseFilename: ":memory:",
    secureCookies: false,
    passwordAuthEnabled: true,
    agentCreateLimitPerHour: 100,
    oauthClients: {
      clients: [{ clientId: GATEWAY_ID, clientType: "confidential", clientSecret: GATEWAY_SECRET, tokenExchange: true, redirectUris: ["https://gw.example.test/cb"], scopes: ["identity"] }],
    },
  });
  applications.push(application);
  const server = createServer(application.app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not expose a TCP address");
  const origin = `http://127.0.0.1:${address.port}`;

  const [alice, bob, carol] = await Promise.all(["alice", "bob", "carol"].map((name) => person(origin, name)));
  const owns = async (actor: Actor, confirmer: string): Promise<Target> => {
    const { spaces } = (await (await send(origin, "GET", "/api/spaces", undefined, actor.cookie)).json()) as { spaces: { id: string; type: string }[] };
    const personal = spaces.find((space) => space.type === "personal")!.id;
    const team = await created(send(origin, "POST", "/api/team-spaces", { name: "Team" }, actor.cookie));
    const file = await created(send(origin, "POST", "/api/resources",
      { kind: "univer", spaceId: personal, parentNodeId: null, name: "Plan", unitType: "sheet" }, actor.cookie, { "idempotency-key": randomUUID() }));
    return { cookie: actor.cookie, team, file, confirmer };
  };
  const aliceOwns = await owns(alice!, alice!.cookie);
  const claimed = await guestAgent(origin);
  const { code } = (await (await send(origin, "POST", "/api/agents/claim-codes", undefined, claimed.cookie)).json()) as { code: string };
  if ((await send(origin, "POST", "/api/agents/claim", { code }, alice!.cookie)).status !== 200) throw new Error("Claim failed");
  const { token } = (await (await send(origin, "POST", "/api/auth/tokens", { name: "mcp" }, alice!.cookie)).json()) as { token: string };

  return {
    origin,
    alice: alice!,
    bob: bob!,
    carol: carol!,
    refusedWithLink: {
      "a person's CLI session": { ...aliceOwns, cookie: await cliSession(origin, "alice") },
      "a person's token session": { ...aliceOwns, cookie: await tokenSession(origin, token) },
      "a claimed agent": await owns(claimed, alice!.cookie),
    },
    temporary: await owns(await guestAgent(origin), ""),
  };
}

async function created(request: Promise<Response>): Promise<string> {
  const response = await request;
  if (response.status !== 201) throw new Error(`Creation failed with ${response.status}: ${await response.text()}`);
  const body = (await response.json()) as { id?: string; node?: { id: string } };
  return body.node?.id ?? body.id!;
}

function send(origin: string, method: string, path: string, body?: unknown, cookie?: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function signedIn(origin: string, response: Response): Promise<Actor> {
  const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
  const { user } = (await (await send(origin, "GET", "/api/session", undefined, cookie)).json()) as { user: { id: string } };
  return { id: user.id, cookie };
}

async function person(origin: string, username: string): Promise<Actor> {
  const response = await send(origin, "POST", "/api/auth/password/register", { username, displayName: username, password: PASSWORD });
  if (response.status !== 201) throw new Error(`Registration failed with ${response.status}`);
  return signedIn(origin, response);
}

async function cliSession(origin: string, username: string): Promise<string> {
  const response = await send(origin, "POST", "/api/auth/cli/password/login", { username, password: PASSWORD });
  if (response.status !== 200) throw new Error(`CLI login failed with ${response.status}`);
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

async function tokenSession(origin: string, token: string): Promise<string> {
  const response = await fetch(`${origin}/api/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      client_id: GATEWAY_ID,
      client_secret: GATEWAY_SECRET,
      subject_token: token,
    }),
  });
  if (response.status !== 200) throw new Error(`Token exchange failed with ${response.status}`);
  return `workspace_session=${((await response.json()) as { access_token: string }).access_token}`;
}

async function guestAgent(origin: string): Promise<Actor> {
  const response = await send(origin, "POST", "/api/auth/guest", {});
  if (response.status !== 201) throw new Error(`Guest creation failed with ${response.status}`);
  return signedIn(origin, response);
}
