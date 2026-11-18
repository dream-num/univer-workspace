import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createProductTestApplication, type ProductTestApplication } from "../support/product-test-application.js";

const applications: ProductTestApplication[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(applications.splice(0).map((application) => application.close()));
});

describe("requests that write at the same moment", () => {
  it("registers every person who signs up at once", async () => {
    const origin = await start();

    for (let round = 0; round < 20; round += 1) {
      const statuses = await Promise.all(Array.from({ length: 10 }, async (_, index) => (await register(origin, `person-${round}-${index}`)).status));

      expect(statuses).toEqual(statuses.map(() => 201));
    }
  }, 30_000);

  it("gives one of several people who claim the same name at once the account, and tells the rest it is taken", async () => {
    const origin = await start();

    const responses = await Promise.all(Array.from({ length: 8 }, () => register(origin, "alice")));
    const outcomes = await Promise.all(responses.map(async (response) =>
      response.status === 201 ? "registered" : `${response.status} ${((await response.json()) as { error: { code: string } }).error.code}`));

    expect(outcomes.filter((outcome) => outcome === "registered")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome !== "registered")).toEqual(Array.from({ length: 7 }, () => "409 USERNAME_TAKEN"));
  });

  it("merges a ready pull request when its author sends the merge several times at once", async () => {
    const origin = await start();
    const author = await signedIn(origin, await register(origin, "author"));

    for (let round = 0; round < 3; round += 1) {
      const pull = await readyPull(origin, author);
      const statuses = await Promise.all(Array.from({ length: 10 }, async () => (await send(
        origin, "POST", `/api/worktrees/${pull}/merge`, undefined, author.cookie, { "idempotency-key": randomUUID() },
      )).status));

      expect(statuses).toEqual(statuses.map(() => 200));
      const { worktree } = (await (await send(origin, "GET", `/api/worktrees/${pull}`, undefined, author.cookie)).json()) as {
        worktree: { state: string; units: { activationState: string }[] };
      };
      expect({ state: worktree.state, files: worktree.units.map((unit) => unit.activationState) }).toEqual({ state: "merged", files: ["completed"] });
    }
  }, 30_000);
});

type Actor = { readonly id: string; readonly cookie: string };

async function start(): Promise<string> {
  const application = await createProductTestApplication({
    host: "127.0.0.1",
    port: 0,
    productFilename: ":memory:",
    collaborationDatabaseFilename: ":memory:",
    secureCookies: false,
    passwordAuthEnabled: true,
  });
  applications.push(application);
  const server = createServer(application.app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not expose a TCP address");
  return `http://127.0.0.1:${address.port}`;
}

function send(origin: string, method: string, path: string, body?: unknown, cookie?: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function register(origin: string, username: string): Promise<Response> {
  return send(origin, "POST", "/api/auth/password/register", { username, displayName: username, password: "correct horse battery staple" });
}

async function signedIn(origin: string, response: Response): Promise<Actor> {
  if (response.status !== 201) throw new Error(`Registration failed with ${response.status}`);
  const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
  const { user } = (await (await send(origin, "GET", "/api/session", undefined, cookie)).json()) as { user: { id: string } };
  return { id: user.id, cookie };
}

async function readyPull(origin: string, author: Actor): Promise<string> {
  const { spaces } = (await (await send(origin, "GET", "/api/spaces", undefined, author.cookie)).json()) as { spaces: { id: string; type: string }[] };
  const created = await send(origin, "POST", "/api/worktrees", { kind: "user", name: "Budget", summary: null }, author.cookie, { "idempotency-key": randomUUID() });
  if (created.status !== 201) throw new Error(`Pull request creation failed with ${created.status}: ${await created.text()}`);
  const { id } = (await created.json()) as { id: string };
  const unit = await send(origin, "POST", `/api/worktrees/${id}/units`,
    { source: "worktree", name: "Budget sheet", unitType: "sheet", targetSpaceId: spaces.find((space) => space.type === "personal")!.id, targetParentNodeId: null },
    author.cookie, { "idempotency-key": randomUUID() });
  if (unit.status !== 201) throw new Error(`Adding a Sheet failed with ${unit.status}: ${await unit.text()}`);
  const ready = await send(origin, "POST", `/api/worktrees/${id}/ready`, undefined, author.cookie, { "idempotency-key": randomUUID() });
  if (ready.status !== 200) throw new Error(`Marking ready failed with ${ready.status}: ${await ready.text()}`);
  return id;
}
