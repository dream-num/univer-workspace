import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { UniverCollabWorktreeService } from "@univerjs-pro/collaboration-worktree-service";
import { afterEach, expect, it, vi } from "vitest";
import { createWorkspaceApplication } from "../../server/src/app.js";
import { loadConfig, type WorkspaceConfig } from "../../server/src/config.js";
import { openProductDatabase } from "../../server/src/db/index.js";
import { openCollaborationDatabase } from "../../server/src/integrations/univer/collaboration-database/open-collaboration-database.js";
import { createTestBucket } from "../support/postgres/s3.js";
import { createPostgresTestDatabase } from "../support/postgres/schema.js";

const DAY = 24 * 60 * 60 * 1000;
const cleanups: AsyncDisposableStack[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup.disposeAsync();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("holds an agent to 10 open pull requests however it opens them, replays a creation, and leaves people alone (A6.6)", async () => {
  const origin = (await start())[0]!;
  const me = await agent(origin);
  expect(await budget(origin, me)).toEqual({ openWorktrees: { used: 0, limit: 10 }, merges: { used: 0, limit: 50 } });
  vi.spyOn(UniverCollabWorktreeService.prototype, "createWorktree")
    .mockRejectedValueOnce(Object.assign(new Error("Collaboration is unavailable."), { code: "UNAVAILABLE" }));
  const failed = randomUUID();
  expect((await openPull(origin, me, failed)).status).toBe(409);
  expect(await budget(origin, me), "a failed creation holds no place").toMatchObject({ openWorktrees: { used: 0 } });

  const repo = await created<{ id: string }>(send(origin, "POST", "/api/team-spaces", me, { name: "Plans" }));
  const [first, second] = [await fork(origin, me, repo.id, "first"), await fork(origin, me, repo.id, "second")];
  expect((await send(origin, "POST", `/api/forks/${first}/worktree`, me)).status).toBe(201);
  await created(send(origin, "POST", "/api/worktrees", me, { kind: "team", teamSpaceId: repo.id, name: "team", summary: null, visibility: "private" }));
  const key = randomUUID();
  const pulls: string[] = [];
  for (let pull = 0; pull < 8; pull++) pulls.push((await created<{ id: string }>(openPull(origin, me, pull === 0 ? key : undefined))).id);
  expect(await budget(origin, me)).toMatchObject({ openWorktrees: { used: 10, limit: 10 } });

  await refused(openPull(origin, me), /at most 10 open pull requests\. Merge or discard one/);
  await refused(send(origin, "POST", `/api/forks/${second}/worktree`, me), /at most 10 open pull requests/);
  expect(await created(openPull(origin, me, key)), "a replayed creation is the same pull request").toMatchObject({ id: pulls[0] });
  await refused(send(origin, "POST", `/api/operations/${failed}/retry`, me), /at most 10 open pull requests/);

  await transition(origin, me, pulls[0]!, "discard");
  expect(await budget(origin, me)).toMatchObject({ openWorktrees: { used: 9, limit: 10 } });
  const retried = await send(origin, "POST", `/api/operations/${failed}/retry`, me);
  expect({ status: retried.status, body: await retried.json() }).toMatchObject({ status: 202, body: { state: "completed" } });
  expect(await budget(origin, me)).toMatchObject({ openWorktrees: { used: 10, limit: 10 } });

  const human = await person(origin, "person");
  for (let pull = 0; pull < 11; pull++) await created(openPull(origin, human));
  expect(await budget(origin, human)).toBeUndefined();
}, 120_000);

it("holds an agent to 50 merges started in any 24 hours, and counts a replayed merge once (A6.6)", async () => {
  // The Worktree module reads the clock it finds when the application is created.
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  const origin = (await start())[0]!;
  const me = await agent(origin);
  const merge =async (id: string, key = randomUUID()) => send(origin, "POST", `/api/worktrees/${id}/merge`, me, undefined, key);
  let last = { id: "", key: "" };
  for (let count = 0; count < 50; count++) {
    last = { id: (await created<{ id: string }>(openPull(origin, me))).id, key: randomUUID() };
    await transition(origin, me, last.id, "ready");
    expect(await ok(merge(last.id, last.key))).toMatchObject({ worktree: { state: "merged" } });
  }
  expect(await budget(origin, me)).toEqual({ openWorktrees: { used: 0, limit: 10 }, merges: { used: 50, limit: 50 } });

  const next = (await created<{ id: string }>(openPull(origin, me))).id;
  await transition(origin, me, next, "ready");
  await refused(merge(next), /at most 50 merges in 24 hours/);
  expect(await ok(merge(last.id, last.key)), "a replayed merge is the same merge").toMatchObject({ worktree: { id: last.id, state: "merged" } });
  expect(await budget(origin, me)).toMatchObject({ merges: { used: 50, limit: 50 } });

  vi.setSystemTime(Date.now() + DAY);
  expect(await budget(origin, me)).toMatchObject({ merges: { used: 0, limit: 50 } });
  expect(await ok(merge(next))).toMatchObject({ worktree: { state: "merged" } });
}, 240_000);

it("admits exactly the limit when an agent's creations race at the edge, across replicas on PostgreSQL", async () => {
  const origins = await start(2);
  const me = await agent(origins[0]!);
  for (let pull = 0; pull < 7; pull++) await created(openPull(origins[0]!, me));

  const raced = await Promise.all(Array.from({ length: 8 }, (_, index) => openPull(origins[index % origins.length]!, me)));
  const outcomes = await Promise.all(raced.map(async (response) => {
    const body = (await response.json()) as { error?: { code: string } };
    return response.status === 201 ? "created" : `${response.status} ${body.error?.code}`;
  }));
  expect(outcomes.filter((outcome) => outcome === "created")).toHaveLength(3);
  expect(outcomes.filter((outcome) => outcome !== "created")).toEqual(Array(5).fill("403 AGENT_QUOTA_EXCEEDED"));
  expect(await budget(origins.at(-1)!, me)).toMatchObject({ openWorktrees: { used: 10, limit: 10 } });
}, 120_000);

type Actor = { readonly cookie: string };

/** Replicas share only the database, so more than one needs PostgreSQL. */
async function start(replicas = 1): Promise<string[]> {
  const cleanup = new AsyncDisposableStack();
  cleanups.push(cleanup);
  const url = process.env.WORKSPACE_TEST_POSTGRES_URL;
  const postgres = url ? await createPostgresTestDatabase(url) : undefined;
  if (postgres) cleanup.defer(postgres.close);
  const config: WorkspaceConfig = {
    ...loadConfig({}),
    host: "127.0.0.1",
    port: 0,
    secureCookies: false,
    passwordAuthEnabled: true,
    agentCreateLimitPerHour: 100,
    ...(postgres && { s3BlobStore: await createTestBucket(cleanup) }),
    database: postgres
      ? { provider: "postgres", connectionString: postgres.connectionString }
      : { provider: "sqlite", filename: ":memory:", collaborationFilename: ":memory:" },
  };
  const origins: string[] = [];
  for (let replica = 0; replica < (postgres ? replicas : 1); replica++) {
    const database = await openProductDatabase(config.database);
    cleanup.defer(() => database.close());
    const collaboration = await openCollaborationDatabase(config, database.unitCreationFacts);
    cleanup.defer(() => collaboration.close());
    const application = createWorkspaceApplication(config, database.repositories, collaboration);
    cleanup.defer(() => application.close());
    await application.initialize();
    const server = createServer(application.app);
    cleanup.defer(() => new Promise<void>((resolve) => server.close(() => resolve())));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origins.push(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  }
  return origins;
}

function send(origin: string, method: string, path: string, actor?: Actor, body?: unknown, key = randomUUID()): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method,
    headers: {
      "idempotency-key": key,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(actor ? { cookie: actor.cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function ok<T = unknown>(request: Promise<Response>): Promise<T> {
  const response = await request;
  if (response.status !== 200) throw new Error(`${response.url} answered ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

async function created<T = unknown>(request: Promise<Response>): Promise<T> {
  const response = await request;
  if (response.status !== 201) throw new Error(`${response.url} answered ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

async function refused(request: Promise<Response>, message: RegExp): Promise<void> {
  const response = await request;
  const { error } = (await response.json()) as { error: { code: string; message: string } };
  expect({ status: response.status, code: error.code }).toEqual({ status: 403, code: "AGENT_QUOTA_EXCEEDED" });
  expect(error.message).toMatch(message);
}

async function signedIn(origin: string, response: Response): Promise<Actor> {
  if (response.status !== 201) throw new Error(`Sign-in answered ${response.status}: ${await response.text()}`);
  return { cookie: response.headers.get("set-cookie")!.split(";")[0]! };
}

async function agent(origin: string): Promise<Actor> {
  return signedIn(origin, await send(origin, "POST", "/api/auth/guest", undefined, {}));
}

async function person(origin: string, username: string): Promise<Actor> {
  return signedIn(origin, await send(origin, "POST", "/api/auth/password/register", undefined, {
    username, displayName: username, password: "correct horse battery staple",
  }));
}

async function budget(origin: string, actor: Actor): Promise<unknown> {
  return ((await ok<{ budget?: unknown }>(send(origin, "GET", "/api/session", actor))).budget);
}

async function fork(origin: string, actor: Actor, upstreamSpaceId: string, name: string): Promise<string> {
  return (await created<{ id: string }>(send(origin, "POST", "/api/forks", actor, { upstreamSpaceId, name }))).id;
}

function openPull(origin: string, actor: Actor, key?: string): Promise<Response> {
  return send(origin, "POST", "/api/worktrees", actor, { kind: "user", name: "task", summary: null, visibility: "private" }, key);
}

async function transition(origin: string, actor: Actor, id: string, action: "ready" | "discard"): Promise<void> {
  await ok(send(origin, "POST", `/api/worktrees/${id}/${action}`, actor));
}
