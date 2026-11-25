import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transformSnapshotToDocumentData, transformSnapshotToWorkbookData } from "@univerjs-pro/collaboration";
import { JSONX, TextXActionType } from "@univerjs/core";
import { UniverType } from "@univerjs/protocol";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { createWorkspaceApplication, type WorkspaceApplication } from "../../server/src/app.js";
import { loadConfig, type WorkspaceConfig } from "../../server/src/config.js";
import { openProductDatabase } from "../../server/src/db/index.js";
import { createBlobStore } from "../../server/src/integrations/blob/create-blob-store.js";
import { openCollaborationDatabase } from "../../server/src/integrations/univer/collaboration-database/open-collaboration-database.js";
import { collaborationCallOptions, createCollaborationRuntime } from "../../server/src/integrations/univer/unit-store.js";
import { createWorktreeBackend } from "../../server/src/integrations/univer/worktree-store.js";
import type { RevertPlan } from "../../server/src/modules/reverts/index.js";
import type { WorktreeBackend } from "../../server/src/modules/worktrees/index.js";
import { createTestBucket } from "../support/postgres/s3.js";
import { createPostgresTestDatabase } from "../support/postgres/schema.js";

type Actor = { readonly id: string; readonly cookie: string };

const cleanups: AsyncDisposableStack[] = [];
// The revert module reads the clock it finds when the application is created.
beforeAll(() => void vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true }));
afterAll(() => void vi.useRealTimers());
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup.disposeAsync();
});

/** Lets a held lease run out, as it does when the replica holding it dies. */
const leaseRunsOut = () => vi.setSystemTime(Date.now() + 61_000);

it("reverts an Issue's three merged pull requests across a Sheet and a Doc, one adding and one removing a file", async () => {
  const f = await repository();
  const { application } = f.h;
  const north = await f.sheet("North");
  const notes = await f.doc("Notes");
  const old = await f.sheet("Old");
  const before = { north: await f.h.a1(north.unitId), notes: await f.h.text(notes.unitId) };
  const issue = await application.issues.create(f.owner.id, f.team, { title: "Fix totals", assigneeUserIds: [f.alice.id] });

  const first = await f.pull(f.alice.id, issue.number);
  await f.edit(f.alice.id, first, await f.add(f.alice.id, first, north.id), "first");
  await f.merge(f.owner.id, first);
  const second = await f.pull(f.alice.id, issue.number);
  await f.edit(f.alice.id, second, await f.add(f.alice.id, second, notes.id), "merged ");
  const added = await application.worktrees.addUnit(f.alice.id, second, randomUUID(), {
    source: "worktree", name: "Added", unitType: "sheet", targetSpaceId: f.team, targetParentNodeId: null,
  });
  await f.merge(f.owner.id, second);
  // Only an owner or admin may move a file to Trash, so the owner opens the pull request that removes one.
  const third = await f.pull(f.owner.id, issue.number);
  await f.edit(f.owner.id, third, await f.add(f.owner.id, third, north.id), "second");
  await application.worktrees.setUnitRemoved(f.owner.id, third, await f.add(f.owner.id, third, old.id), { removed: true });
  await f.merge(f.owner.id, third);
  expect([await f.h.a1(north.unitId), await f.h.text(notes.unitId)]).toEqual(["second", `merged ${before.notes}`]);
  expect(await application.access.resolveNode(f.owner.id, old.nodeId)).toBeNull();
  await application.issues.verdict(f.alice.id, f.team, issue.number, { kind: "submitted", body: "Done." });
  await application.issues.verdict(f.owner.id, f.team, issue.number, { kind: "accepted", body: "" });

  const path = `/api/spaces/${f.team}/issues/${issue.number}/revert`;
  const plan = (await (await f.get(f.owner, path)).json()) as RevertPlan;
  expect(plan).toMatchObject({ capabilities: { revert: true, force: false }, refusal: null });
  expect(plan.pullRequests.map((pull) => pull.id).sort()).toEqual([first, second, third].sort());
  expect(plan.items.map(({ action, state, name }) => [action, state, name])).toEqual([
    ["recover", "ready", "Old"],
    ["restore", "ready", "North"],
    ["restore", "ready", "Notes"],
    ["trash", "ready", "Added"],
  ]);
  expect(plan.items[1]).toMatchObject({ targetRevision: north.revision, laterEdits: [] });

  const key = randomUUID();
  const done = await f.post(f.owner, path, key);
  expect(done.status).toBe(201);
  const body = (await done.json()) as { operation: { id: string; kind: string; state: string }; items: RevertPlan["items"] };
  expect(body.operation).toMatchObject({ kind: "revertWorktrees", state: "completed" });
  expect(body.items.map(({ action, state }) => [action, state])).toEqual([["recover", "done"], ["restore", "done"], ["restore", "done"], ["trash", "done"]]);
  expect([await f.h.a1(north.unitId), await f.h.text(notes.unitId)]).toEqual([before.north, before.notes]);
  expect(await application.access.resolveNode(f.owner.id, old.nodeId), "the removed file is back").not.toBeNull();
  expect(await application.access.resolveNode(f.owner.id, added.body.unit.nodeId!), "the added file is in Trash").toBeNull();
  const reopened = await application.issues.get(f.owner.id, f.team, issue.number);
  expect(reopened).toMatchObject({ state: "open", acceptance: { kind: "reverted", actor: { id: f.owner.id } } });
  const timeline = await application.issues.timeline(f.owner.id, f.team, issue.number, {});
  expect(timeline.items.slice(-2).map((item) => item.type === "event" && item.kind)).toEqual(["reopened", "reverted"]);

  const replay = await f.post(f.owner, path, key);
  expect(replay.status).toBe(200);
  expect(((await replay.json()) as typeof body).items).toEqual(body.items);
  expect(await f.h.restores(north.unitId, body.operation.id)).toBe(1);
  expect(await f.h.restores(notes.unitId, body.operation.id, UniverType.UNIVER_DOC)).toBe(1);
  expect(await application.issues.get(f.owner.id, f.team, issue.number)).toMatchObject({ acceptance: { kind: "reverted" } });
  const again = await f.get(f.owner, path);
  expect(((await again.json()) as RevertPlan).items.find((item) => item.name === "North"), "a revert is a later edit to the next one")
    .toMatchObject({ state: "blocked", laterEdits: [{ user: { id: f.owner.id }, revisions: 1 }] });
}, 120_000);

it("blocks a Unit edited after the merge, names who edited it, and lets only a person in the browser overwrite it", async () => {
  const f = await repository();
  const north = await f.sheet("North");
  const before = await f.h.a1(north.unitId);
  const pull = await f.pull(f.bot.id);
  await f.edit(f.bot.id, pull, await f.add(f.bot.id, pull, north.id), "merged");
  await f.merge(f.bot.id, pull);
  await f.h.commit(f.bob.id, north.unitId, "later");
  const path = `/api/worktrees/${pull}/revert`;

  const plan = (await (await f.get(f.owner, path)).json()) as RevertPlan;
  expect(plan).toMatchObject({ capabilities: { revert: true, force: true }, refusal: null });
  expect(plan.items).toMatchObject([{
    action: "restore", state: "blocked", name: "North",
    laterEdits: [{ user: { id: f.bob.id, username: "bob" }, revisions: 1, lastEditedAt: expect.any(String) }],
  }]);
  const blocked = plan.items[0]!;
  expect(Math.abs(Date.parse(blocked.laterEdits[0]!.lastEditedAt!) - Date.now())).toBeLessThan(60_000);
  const force = { force: [{ unitId: blocked.unitId, headRevision: blocked.headRevision }] };

  const agentPlan = (await (await f.get(f.bot, path)).json()) as RevertPlan;
  expect(agentPlan.capabilities, "an agent may revert but never force").toEqual({ revert: true, force: false });
  expect((await f.post(f.bot, path, randomUUID(), force)).status).toBe(403);
  const nothing = await f.post(f.bot, path, randomUUID());
  expect(nothing.status).toBe(409);
  expect(((await nothing.json()) as { error: { message: string } }).error.message).toContain("A person can overwrite those edits in the browser.");
  expect(await f.h.a1(north.unitId)).toBe("later");

  await f.h.commit(f.alice.id, north.unitId, "unseen");
  expect((await f.post(f.owner, path, randomUUID(), force)).status, "an edit the plan did not name keeps the Unit blocked").toBe(409);

  const fresh = ((await (await f.get(f.owner, path)).json()) as RevertPlan).items[0]!;
  expect(fresh.laterEdits.map((edit) => edit.user?.username).sort()).toEqual(["alice", "bob"]);
  const forced = await f.post(f.owner, path, randomUUID(), { force: [{ unitId: fresh.unitId, headRevision: fresh.headRevision }] });
  expect(forced.status).toBe(201);
  expect(((await forced.json()) as { items: RevertPlan["items"] }).items).toMatchObject([{ action: "restore", state: "done" }]);
  expect(await f.h.a1(north.unitId), "the restore replaces the whole Unit").toBe(before);
}, 120_000);

it("resumes a revert that died after the second of three restores, and restores each Unit once", async () => {
  const f = await repository();
  const sheets = [await f.sheet("North"), await f.sheet("South"), await f.sheet("East")];
  const pull = await f.pull(f.alice.id);
  for (const sheet of sheets) await f.edit(f.alice.id, pull, await f.add(f.alice.id, pull, sheet.id), "merged");
  await f.merge(f.owner.id, pull);

  const crash = f.h.crashAfterRestore(2);
  const running = f.h.application.reverts.revert(f.owner.id, true, { kind: "pullRequest", worktreeId: pull }, randomUUID(), undefined);
  const operationId = await crash.reached;
  const stored = JSON.parse((await f.h.repositories.reverts.find(operationId))!.payload_json) as { items: { state: string; attempt?: object }[] };
  expect(stored.items.map((item) => [item.state, Boolean(item.attempt)])).toEqual([["done", true], ["ready", true], ["ready", false]]);
  expect(await f.h.application.reverts.resumeDue("replica-b"), "the lease is still held").toBe(0);

  leaseRunsOut();
  expect(await f.h.application.reverts.resumeDue("replica-b")).toBe(1);
  const row = (await f.h.repositories.reverts.find(operationId))!;
  expect(row.state).toBe("completed");
  for (const sheet of sheets) {
    expect(await f.h.a1(sheet.unitId)).toBeNull();
    expect(await f.h.restores(sheet.unitId, operationId), sheet.name).toBe(1);
  }
  crash.release();
  expect((await running).status, "the runner that died does nothing once it wakes").toBe(201);
  for (const sheet of sheets) expect(await f.h.restores(sheet.unitId, operationId)).toBe(1);
}, 120_000);

it("restores once when two replicas recover the same revert", async () => {
  const f = await repository();
  const sheets = [await f.sheet("North"), await f.sheet("South")];
  const pull = await f.pull(f.alice.id);
  for (const sheet of sheets) await f.edit(f.alice.id, pull, await f.add(f.alice.id, pull, sheet.id), "merged");
  await f.merge(f.owner.id, pull);
  const replica = await f.h.replica();

  const crash = f.h.crashAfterRestore(1);
  const running = f.h.application.reverts.revert(f.owner.id, true, { kind: "pullRequest", worktreeId: pull }, randomUUID(), undefined);
  const operationId = await crash.reached;
  leaseRunsOut();
  const claimed = await Promise.all([f.h.application.reverts.resumeDue("replica-a"), replica.reverts.resumeDue("replica-b")]);
  expect(claimed.sort()).toEqual([0, 1]);
  expect((await f.h.repositories.reverts.find(operationId))!.state).toBe("completed");
  for (const sheet of sheets) {
    expect(await f.h.a1(sheet.unitId)).toBeNull();
    expect(await f.h.restores(sheet.unitId, operationId), sheet.name).toBe(1);
  }
  crash.release();
  await running;
}, 120_000);

it("refuses a revert by an agent that a checks repository gates, and lets one revert in a review repository", async () => {
  const f = await repository();
  const north = await f.sheet("North");
  const issue = await f.h.application.issues.create(f.bot.id, f.team, { title: "Fix totals" });
  const pull = await f.pull(f.alice.id, issue.number);
  await f.edit(f.alice.id, pull, await f.add(f.alice.id, pull, north.id), "merged");
  await f.merge(f.owner.id, pull);
  const path = `/api/spaces/${f.team}/issues/${issue.number}/revert`;

  await f.h.application.spaces.update(f.owner.id, f.team, { landing: "checks" });
  const plan = (await (await f.get(f.bot, path)).json()) as RevertPlan;
  expect(plan.capabilities).toEqual({ revert: false, force: false });
  expect(plan.refusal).toBe("A revert changes Trunk without a merge. This repository requires checks, so an agent that does not own it changes its files only by merging a pull request whose declared checks all passed.");
  const refused = await f.post(f.bot, path, randomUUID());
  expect(refused.status).toBe(403);
  expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("AGENT_NOT_ALLOWED");
  expect(await f.h.a1(north.unitId)).toBe("merged");
  expect((await (await f.get(f.reader, path)).json()) as RevertPlan, "only someone who may accept the Issue reverts it")
    .toMatchObject({ capabilities: { revert: false }, refusal: "Only someone who may accept this Issue can revert it." });

  await f.h.application.spaces.update(f.owner.id, f.team, { landing: "review" });
  const reverted = await f.post(f.bot, path, randomUUID());
  expect(reverted.status).toBe(201);
  expect(await f.h.a1(north.unitId)).toBeNull();
}, 120_000);

it.each([
  ["someone edits the only file while the revert restores it", async (f: Awaited<ReturnType<typeof repository>>) => {
    f.h.beforeFirstRestore((unitId) => f.h.commit(f.bob.id, unitId, "foreign"));
    return { state: "blocked", a1: "foreign" };
  }],
  ["the protection guard refuses to restore the only file", async (f: Awaited<ReturnType<typeof repository>>) => {
    f.h.beforeFirstRestore(() => Promise.reject(Object.assign(new Error("Protected range"), { code: "PERMISSION_DENIED" })));
    return { state: "failed", a1: "merged" };
  }],
])("records no verdict and keeps an accepted Issue closed when %s", async (_case, arrange) => {
  const f = await repository();
  const { application } = f.h;
  const north = await f.sheet("North");
  const issue = await application.issues.create(f.owner.id, f.team, { title: "Fix totals", assigneeUserIds: [f.alice.id] });
  const pull = await f.pull(f.alice.id, issue.number);
  await f.edit(f.alice.id, pull, await f.add(f.alice.id, pull, north.id), "merged");
  await f.merge(f.owner.id, pull);
  await application.issues.verdict(f.alice.id, f.team, issue.number, { kind: "submitted", body: "Done." });
  await application.issues.verdict(f.owner.id, f.team, issue.number, { kind: "accepted", body: "" });
  const expected = await arrange(f);

  const response = await f.post(f.owner, `/api/spaces/${f.team}/issues/${issue.number}/revert`, randomUUID());
  expect(response.status).toBe(201);
  const body = (await response.json()) as { operation: { state: string; error: { code: string; message: string } | null }; items: RevertPlan["items"] };
  expect(body.operation).toMatchObject({ state: "failed", error: { code: "CONFLICT", message: expect.stringMatching(/^Nothing was reverted\. North: /) } });
  expect(body.items).toMatchObject([{ action: "restore", state: expected.state }]);
  expect(await f.h.a1(north.unitId)).toBe(expected.a1);
  expect(await application.issues.get(f.owner.id, f.team, issue.number)).toMatchObject({ state: "closed", acceptance: { kind: "accepted" } });
  const timeline = await application.issues.timeline(f.owner.id, f.team, issue.number, {});
  expect(timeline.items.filter((item) => item.type === "event" && ["reopened", "reverted"].includes(item.kind))).toEqual([]);
}, 120_000);

async function repository() {
  const h = await start();
  const { application } = h;
  const owner = await h.person("owner");
  const alice = await h.person("alice");
  const bob = await h.person("bob");
  const reader = await h.person("reader");
  const bot = await h.agent(owner, "bot");
  const { id: team } = await application.spaces.createTeamSpace(owner.id, { name: "Sales" });
  for (const member of [alice, bob, bot]) await application.permissions.upsertTeamMember(owner.id, team, member.id, { role: "editor" });
  await application.permissions.upsertTeamMember(owner.id, team, reader.id, { role: "viewer" });
  const file = async (name: string, unitType: "sheet" | "doc") => {
    const created = await application.resources.create(owner.id, randomUUID(), { kind: "univer", spaceId: team, parentNodeId: null, name, unitType });
    if (created.status === 202 || created.body.node.resource?.kind !== "univer") throw new Error("File missing");
    const { resource, id: nodeId } = created.body.node;
    return { name, nodeId, id: resource.id, unitId: resource.unitId, revision: (await h.backend.trunkRevision(resource.unitId, owner.id))! };
  };
  return {
    h, owner, alice, bob, reader, bot, team,
    sheet: (name: string) => file(name, "sheet"),
    doc: (name: string) => file(name, "doc"),
    get: (actor: Actor, path: string) => fetch(`${h.origin}${path}`, { headers: { cookie: actor.cookie } }),
    post: (actor: Actor, path: string, key: string, body?: unknown) => fetch(`${h.origin}${path}`, {
      method: "POST",
      headers: { cookie: actor.cookie, "idempotency-key": key, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    async pull(userId: string, issueNumber?: number) {
      return (await application.worktrees.create(userId, randomUUID(), {
        kind: "team", teamSpaceId: team, name: "Fix totals", summary: null, visibility: "space", ...(issueNumber && { issueNumber }),
      })).body.id;
    },
    async add(userId: string, pull: string, resourceId: string) {
      return (await application.worktrees.addUnit(userId, pull, randomUUID(), { source: "trunk", resourceId })).body.unit.unitId;
    },
    /** Writes A1 of a Sheet, or puts text at the start of a Doc, in the pull request's draft. */
    async edit(userId: string, pull: string, unitId: string, value: string) {
      const unit = (await application.worktrees.get(userId, pull)).worktree.units.find((candidate) => candidate.unitId === unitId)!;
      const result = await application.worktrees.submitChangeset(userId, pull, unitId, {
        changeset: {
          unitID: unitId, type: unit.unitType === "doc" ? UniverType.UNIVER_DOC : UniverType.UNIVER_SHEET,
          baseRev: unit.draftHeadRevision, revision: unit.draftHeadRevision + 1, sid: randomUUID(), reqId: 1,
          userID: "", memberID: "", createTime: 1, mutations: [await h.mutation(unitId, unit.unitType, value)],
        },
      });
      if (result.status !== "committed") throw new Error(`Draft write was ${result.status}`);
    },
    async merge(userId: string, pull: string) {
      await application.worktrees.markReady(userId, pull);
      const merged = await application.worktrees.merge(userId, pull, randomUUID());
      if (merged.worktree.state !== "merged") throw new Error(`Merge left ${merged.worktree.state}`);
    },
  };
}

async function start() {
  const cleanup = new AsyncDisposableStack();
  cleanups.push(cleanup);
  const url = process.env.WORKSPACE_TEST_POSTGRES_URL;
  const postgres = url ? await createPostgresTestDatabase(url) : undefined;
  if (postgres) cleanup.defer(postgres.close);
  const directory = mkdtempSync(join(tmpdir(), "workspace-reverts-"));
  cleanup.defer(() => rmSync(directory, { recursive: true, force: true }));
  const config: WorkspaceConfig = {
    ...loadConfig({}),
    host: "127.0.0.1",
    port: 0,
    secureCookies: false,
    passwordAuthEnabled: true,
    agentCreateLimitPerHour: 100,
    sessionTtlMs: 3_600_000,
    blobDirectory: join(directory, "blobs"),
    ...(postgres && { s3BlobStore: await createTestBucket(cleanup) }),
    database: postgres
      ? { provider: "postgres", connectionString: postgres.connectionString }
      : { provider: "sqlite", filename: join(directory, "product.sqlite"), collaborationFilename: join(directory, "collaboration.sqlite") },
  };
  const database = await openProductDatabase(config.database);
  cleanup.defer(() => database.close());
  const collaboration = await openCollaborationDatabase(config, database.unitCreationFacts);
  cleanup.defer(() => collaboration.close());
  const runtime = createCollaborationRuntime(collaboration);
  cleanup.defer(() => runtime.dispose());
  const blobStore = createBlobStore(config);
  cleanup.defer(async () => void (await blobStore.dispose?.()));

  const sdk = createWorktreeBackend(runtime.worktreeService, runtime.service);
  // The test seam: after the nth restore commits, its runner stops as a dead replica's would.
  let crash: { after: number; calls: number; reached: (operationId: string) => void; wake: Promise<void> } | undefined;
  let beforeRestore: ((unitId: string) => Promise<void>) | undefined;
  const backend: WorktreeBackend = {
    ...sdk,
    async restoreTrunk(input, userId) {
      await beforeRestore?.(input.unitId);
      const result = await sdk.restoreTrunk(input, userId);
      if (crash && ++crash.calls === crash.after) {
        crash.reached(input.sid.slice("revert-".length));
        await crash.wake;
      }
      return result;
    },
  };
  const create = (repositories: typeof database.repositories): WorkspaceApplication => {
    const application = createWorkspaceApplication(config, repositories, collaboration, {
      unitStore: runtime.unitStore, unitSnapshotStore: runtime.unitSnapshotStore, worktreeBackend: backend, blobStore,
    });
    cleanup.defer(() => application.close());
    return application;
  };
  const application = create(database.repositories);
  await application.initialize();
  const server = createServer(application.app);
  cleanup.defer(() => new Promise<void>((resolve) => server.close(() => resolve())));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const workbook = async (unitId: string) => {
    const { snapshot, sheetBlocks } = await runtime.unitSnapshotStore.materialize({ unitId, unitType: "sheet", userId: "reader" });
    return transformSnapshotToWorkbookData(snapshot, structuredClone(sheetBlocks));
  };
  const head = async (unitId: string) => (await sdk.trunkRevision(unitId, "reader"))!;
  const mutation = async (unitId: string, unitType: string, value: string) => unitType === "doc"
    ? { id: "doc.mutation.rich-text-editing", data: JSON.stringify({ unitId, actions: JSONX.getInstance().editOp([{ t: TextXActionType.INSERT, len: value.length, body: { dataStream: value } }]) }) }
    : { id: "sheet.mutation.set-range-values", data: JSON.stringify({ unitId, subUnitId: (await workbook(unitId)).sheetOrder[0], cellValue: { 0: { 0: { v: value } } } }) };

  return {
    application,
    repositories: database.repositories,
    backend: sdk,
    origin,
    mutation,
    async person(username: string): Promise<Actor> {
      const issued = await application.identity.registerWithPassword({ username, displayName: username, password: "correct horse battery staple" });
      return { id: issued.view.user.id, cookie: `${application.identity.cookieName}=${issued.cookieValue}` };
    },
    async agent(claimer: Actor, label: string): Promise<Actor> {
      const { user } = await application.identity.createAgent({ label, originIp: undefined });
      const issued = await application.identity.issueSession(user, "agent");
      const cookie = `${application.identity.cookieName}=${issued.cookieValue}`;
      const send = (path: string, by: string, body?: unknown) => fetch(`${origin}${path}`, {
        method: "POST",
        headers: { cookie: by, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const { code } = (await (await send("/api/agents/claim-codes", cookie)).json()) as { code: string };
      const claimed = await send("/api/agents/claim", claimer.cookie, { code });
      if (claimed.status !== 200) throw new Error(`Claim answered ${claimed.status}: ${await claimed.text()}`);
      return { id: user.id, cookie };
    },
    async a1(unitId: string) {
      const data = await workbook(unitId);
      return data.sheets[data.sheetOrder[0]!]?.cellData?.[0]?.[0]?.v ?? null;
    },
    async text(unitId: string) {
      const { snapshot } = await runtime.unitSnapshotStore.materialize({ unitId, unitType: "doc", userId: "reader" });
      return transformSnapshotToDocumentData(snapshot).body?.dataStream ?? "";
    },
    /** Commits a change to A1 straight onto Trunk, as someone editing the file does. */
    async commit(userId: string, unitId: string, value: string) {
      const options = collaborationCallOptions(userId);
      const base = await head(unitId);
      const result = await runtime.service.submitChangeset({
        changeset: {
          unitID: unitId, type: UniverType.UNIVER_SHEET, baseRev: base, revision: base + 1, sid: randomUUID(), reqId: 1,
          userID: userId, memberID: options.memberID, mutations: [await mutation(unitId, "sheet", value)],
        },
      }, options);
      if (result.status !== "committed") throw new Error(`Trunk commit was ${result.status}`);
    },
    /** How many restores the revert Operation committed on the Unit. */
    async restores(unitId: string, operationId: string, type = UniverType.UNIVER_SHEET) {
      const { changesets } = await runtime.service.getChangesets({ unitID: unitId, type, from: 1, to: await head(unitId) }, collaborationCallOptions("reader"));
      return changesets.filter((changeset) => changeset.sid === `revert-${operationId}`).length;
    },
    /** Runs once, right before the revert's first restore is submitted. */
    beforeFirstRestore(run: (unitId: string) => Promise<void>) {
      beforeRestore = async (unitId) => {
        beforeRestore = undefined;
        await run(unitId);
      };
    },
    crashAfterRestore(after: number) {
      let reached!: (operationId: string) => void;
      let release!: () => void;
      const wake = new Promise<void>((resolve) => { release = resolve; });
      const operation = new Promise<string>((resolve) => { reached = resolve; });
      crash = { after, calls: 0, reached, wake };
      return { reached: operation, release: () => { crash = undefined; release(); } };
    },
    /** A second server on the same databases, as another replica is. */
    async replica() {
      const second = await openProductDatabase(config.database);
      cleanup.defer(() => second.close());
      const other = create(second.repositories);
      await other.initialize();
      return other;
    },
  };
}

