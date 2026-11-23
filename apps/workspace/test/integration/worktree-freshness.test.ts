import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { UniverCollabService } from "@univerjs-pro/collaboration-service";
import { UniverType } from "@univerjs/protocol";
import { afterEach, expect, it, vi } from "vitest";
import { createWorkspaceApplication } from "../../server/src/app.js";
import { loadConfig, type WorkspaceConfig } from "../../server/src/config.js";
import { openProductDatabase } from "../../server/src/db/index.js";
import { openCollaborationDatabase } from "../../server/src/integrations/univer/collaboration-database/open-collaboration-database.js";
import { collaborationCallOptions, createCollaborationRuntime } from "../../server/src/integrations/univer/unit-store.js";
import { createWorktreeBackend } from "../../server/src/integrations/univer/worktree-store.js";
import { createTestBucket } from "../support/postgres/s3.js";
import { createPostgresTestDatabase } from "../support/postgres/schema.js";

const DAY = 24 * 60 * 60 * 1000;
const cleanups: AsyncDisposableStack[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup.disposeAsync();
  vi.useRealTimers();
});

it("tells how far Trunk moved since a Trunk Unit joined the pull request, and calls it stale past 100 revisions or 7 days", async () => {
  // The Worktree module reads the clock it finds when the application is created.
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  const { origin, trunk } = await start();
  const me = await person(origin, "author");
  const plan = await trunkSheet(origin, me, "Plan");

  const pull = await openPull(origin, me);
  const joined = Date.now();
  const unit = await addFile(origin, me, pull, { source: "trunk", resourceId: plan.resourceId });
  await addFile(origin, me, pull, { source: "worktree", name: "Notes", unitType: "sheet", targetSpaceId: me.spaceId, targetParentNodeId: null });
  const [first, local] = await freshness(origin, me, pull);
  expect(first).toMatchObject({ label: "current", revisionsBehind: 0, baselineTrunkRevision: expect.any(Number) });
  expect(Date.parse(first!.addedAt)).toBeGreaterThanOrEqual(joined);
  expect(local, "a Worktree-local Unit has no Trunk to fall behind").toBeNull();

  const advance = commitToTrunk(trunk, me.id, plan.unitId, first!.baselineTrunkRevision);
  await advance(3);
  expect((await freshness(origin, me, pull))[0]).toEqual({ ...first, label: "behind", revisionsBehind: 3 });
  await advance(97);
  expect((await freshness(origin, me, pull))[0]).toMatchObject({ label: "behind", revisionsBehind: 100 });
  await advance(1);
  expect((await freshness(origin, me, pull))[0]).toMatchObject({ label: "stale", revisionsBehind: 101 });

  const young = await openPull(origin, me);
  await addFile(origin, me, young, { source: "trunk", resourceId: plan.resourceId });
  vi.setSystemTime(Date.now() + 7 * DAY - 60_000);
  expect((await freshness(origin, me, young))[0]).toMatchObject({ label: "current", revisionsBehind: 0 });
  vi.setSystemTime(Date.now() + 2 * 60_000);
  expect((await freshness(origin, me, young))[0]).toMatchObject({ label: "stale", revisionsBehind: 0 });

  // Stale is advice: the author still marks it ready and merges it.
  const edited = await send(origin, "POST", `/api/worktrees/${pull}/units/${unit.unitId}/changesets`, {
    changeset: {
      unitID: unit.unitId, type: UniverType.UNIVER_SHEET, baseRev: unit.draftHeadRevision, revision: unit.draftHeadRevision + 1,
      sid: randomUUID(), reqId: 1, mutations: [],
    },
  }, me.cookie);
  expect(await ok(edited)).toMatchObject({ status: "committed" });
  expect(await transition(origin, me, pull, "ready")).toBe("ready");
  expect((await freshness(origin, me, pull))[0]).toMatchObject({ label: "stale" });
  expect(await transition(origin, me, pull, "merge")).toBe("merged");
  expect(await freshness(origin, me, pull), "a merged pull request has nothing left to redo").toEqual([null, null]);
}, 60_000);

type Actor = { readonly id: string; readonly cookie: string; readonly spaceId: string };
type Freshness = { label: string; baselineTrunkRevision: number; revisionsBehind: number; addedAt: string } | null;

async function start(): Promise<{ origin: string; trunk: UniverCollabService }> {
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
    sessionTtlMs: 30 * DAY,
    ...(postgres && { s3BlobStore: await createTestBucket(cleanup) }),
    database: postgres
      ? { provider: "postgres", connectionString: postgres.connectionString }
      : { provider: "sqlite", filename: ":memory:", collaborationFilename: ":memory:" },
  };
  const database = await openProductDatabase(config.database);
  cleanup.defer(() => database.close());
  const collaboration = await openCollaborationDatabase(config, database.unitCreationFacts);
  cleanup.defer(() => collaboration.close());
  // The test holds the runtime so that it can commit to Trunk directly.
  const runtime = createCollaborationRuntime(collaboration);
  cleanup.defer(() => runtime.dispose());
  const application = createWorkspaceApplication(config, database.repositories, collaboration, {
    unitStore: runtime.unitStore,
    unitSnapshotStore: runtime.unitSnapshotStore,
    worktreeBackend: createWorktreeBackend(runtime.worktreeService, runtime.service),
  });
  cleanup.defer(() => application.close());
  await application.initialize();
  const server = createServer(application.app);
  cleanup.defer(() => new Promise<void>((resolve) => server.close(() => resolve())));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not expose a TCP address");
  return { origin: `http://127.0.0.1:${address.port}`, trunk: runtime.service };
}

/** Commits empty changesets to a Trunk Unit, each one revision. */
function commitToTrunk(trunk: UniverCollabService, userId: string, unitId: string, from: number) {
  const options = collaborationCallOptions(userId);
  const sid = randomUUID();
  let head = from;
  return async (revisions: number) => {
    for (const stop = head + revisions; head < stop; head++) {
      const result = await trunk.submitChangeset({
        changeset: {
          unitID: unitId, type: UniverType.UNIVER_SHEET, baseRev: head, revision: head + 1, sid, reqId: head + 1,
          userID: userId, memberID: options.memberID, mutations: [],
        },
      }, options);
      if (result.status !== "committed") throw new Error(`Trunk commit was ${result.status}`);
    }
  };
}

function send(origin: string, method: string, path: string, body?: unknown, cookie?: string): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json", "idempotency-key": randomUUID() }),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function ok<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`${response.url} answered ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

async function person(origin: string, username: string): Promise<Actor> {
  const response = await send(origin, "POST", "/api/auth/password/register", { username, displayName: username, password: "correct horse battery staple" });
  if (response.status !== 201) throw new Error(`Registration failed with ${response.status}`);
  const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
  const { user } = await ok<{ user: { id: string } }>(await send(origin, "GET", "/api/session", undefined, cookie));
  const { spaces } = await ok<{ spaces: { id: string; type: string }[] }>(await send(origin, "GET", "/api/spaces", undefined, cookie));
  return { id: user.id, cookie, spaceId: spaces.find((space) => space.type === "personal")!.id };
}

async function trunkSheet(origin: string, actor: Actor, name: string) {
  const { node } = await ok<{ node: { resource: { id: string; unitId: string } } }>(await send(origin, "POST", "/api/resources",
    { kind: "univer", spaceId: actor.spaceId, parentNodeId: null, name, unitType: "sheet" }, actor.cookie));
  return { resourceId: node.resource.id, unitId: node.resource.unitId };
}

async function openPull(origin: string, actor: Actor): Promise<string> {
  return (await ok<{ id: string }>(await send(origin, "POST", "/api/worktrees", { kind: "user", name: "Plan", summary: null }, actor.cookie))).id;
}

async function addFile(origin: string, actor: Actor, pull: string, file: object): Promise<{ unitId: string; draftHeadRevision: number }> {
  return (await ok<{ unit: { unitId: string; draftHeadRevision: number } }>(
    await send(origin, "POST", `/api/worktrees/${pull}/units`, file, actor.cookie),
  )).unit;
}

async function freshness(origin: string, actor: Actor, pull: string): Promise<Freshness[]> {
  const { worktree } = await ok<{ worktree: { units: { freshness: Freshness }[] } }>(
    await send(origin, "GET", `/api/worktrees/${pull}`, undefined, actor.cookie),
  );
  return worktree.units.map((unit) => unit.freshness);
}

async function transition(origin: string, actor: Actor, pull: string, action: "ready" | "merge"): Promise<string> {
  return (await ok<{ worktree: { state: string } }>(await send(origin, "POST", `/api/worktrees/${pull}/${action}`, {}, actor.cookie))).worktree.state;
}
