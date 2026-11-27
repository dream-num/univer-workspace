import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { UniverCollabWorktreeService } from "@univerjs-pro/collaboration-worktree-service";
import { UniverType } from "@univerjs/protocol";
import { Client } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { blankUnitData, collaborationCallOptions } from "../../server/src/integrations/univer/unit-store.js";
import { createProductTestApplication, type ProductTestApplication } from "../support/product-test-application.js";

const applications: ProductTestApplication[] = [];
const servers: Server[] = [];
const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(applications.splice(0).map((application) => application.close()));
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

interface Actor {
  readonly id: string;
  readonly username: string;
  readonly cookie: string;
}

describe("forks", () => {
  it("records a fork of a Team Space with 500 files as one product row and nothing in Collaboration (A4.1)", async () => {
    const { origin, database } = await start();
    const [holder, agent] = await Promise.all([person(origin, "holder"), person(origin, "agent")]);
    const team = await createRepo(origin, holder, "Team");
    for (let file = 1; file <= 500; file += 1) await createSheet(origin, holder, team, `Sheet ${file}`);
    expect((await setRole(origin, team, holder, agent.id, "viewer")).status).toBe(200);

    const before = await database.rowCounts();
    expect(before.resources).toBe(500);
    expect(Object.entries(before).find(([table]) => /^collaboration\.(collaboration_)?units$/.test(table))?.[1]).toBe(500);
    const created = await send(origin, "POST", "/api/forks", { upstreamSpaceId: team, name: "fix-totals" }, agent.cookie);
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      name: "fix-totals", fullName: "agent/fix-totals", owner: { id: agent.id, username: "agent" },
      upstream: { id: team, accessRole: "viewer", affiliation: "member" }, state: "clean", worktree: null,
    });
    const after = await database.rowCounts();
    expect(changedCounts(before, after)).toEqual({ forks: 1 });
  }, 180_000);

  it("is seen, looked up and deleted only by its owner, and never through the Space lookup", async () => {
    const { origin } = await start();
    const [holder, agent] = await Promise.all([person(origin, "holder"), person(origin, "agent")]);
    const team = await createRepo(origin, holder, "Team");
    await setRole(origin, team, holder, agent.id, "editor");
    const fork = await createFork(origin, agent, team, "fix-totals");

    expect((await send(origin, "GET", `/api/forks/${fork}`, undefined, holder.cookie)).status).toBe(404);
    expect((await send(origin, "GET", "/api/forks/lookup?owner=agent&name=fix-totals", undefined, holder.cookie)).status).toBe(404);
    expect(await forkIds(origin, holder)).toEqual([]);
    expect((await send(origin, "DELETE", `/api/forks/${fork}`, undefined, holder.cookie)).status).toBe(404);
    expect((await send(origin, "GET", `/api/forks/${fork}`)).status).toBe(401);

    expect(await forkIds(origin, agent)).toEqual([fork]);
    const looked = await send(origin, "GET", "/api/forks/lookup?owner=AGENT&name=Fix-Totals", undefined, agent.cookie);
    expect(await looked.json()).toMatchObject({ id: fork, fullName: "agent/fix-totals" });
    expect((await send(origin, "GET", "/api/spaces/lookup?owner=agent&slug=fix-totals", undefined, agent.cookie)).status).toBe(404);

    const removed = await send(origin, "DELETE", `/api/forks/${fork}`, undefined, agent.cookie);
    expect({ status: removed.status, body: await removed.json() }).toEqual({ status: 200, body: { worktree: null } });
    expect((await send(origin, "GET", `/api/forks/${fork}`, undefined, agent.cookie)).status).toBe(404);
  }, 60_000);

  it("takes several names for one upstream, returns a repeated create, and keeps one name per owner (A4.11)", async () => {
    const { origin, database } = await start();
    const [holder, agent] = await Promise.all([person(origin, "holder"), person(origin, "agent")]);
    const [team, other] = [await createRepo(origin, holder, "Team"), await createRepo(origin, holder, "Other")];
    await setRole(origin, team, holder, agent.id, "viewer");
    await setRole(origin, other, holder, agent.id, "viewer");

    const first = await createFork(origin, agent, team, "fix-totals");
    const second = await createFork(origin, agent, team, "add-forecast");
    expect(second).not.toBe(first);
    const repeated = await send(origin, "POST", "/api/forks", { upstreamSpaceId: team, name: "FIX-totals" }, agent.cookie);
    expect({ status: repeated.status, id: ((await repeated.json()) as { id: string }).id }).toEqual({ status: 200, id: first });
    await expectError(send(origin, "POST", "/api/forks", { upstreamSpaceId: other, name: "fix-totals" }, agent.cookie), 409, "SPACE_SLUG_TAKEN");
    expect(await forkIds(origin, agent)).toEqual([second, first]);
    expect((await database.rowCounts()).forks).toBe(2);
  }, 60_000);

  it("needs a role in a readable Team Space and a valid name", async () => {
    const { origin } = await start();
    const [holder, reader] = await Promise.all([person(origin, "holder"), person(origin, "reader")]);
    const team = await createRepo(origin, holder, "Team");
    const create = (actor: Actor, upstreamSpaceId: unknown, name: unknown) =>
      send(origin, "POST", "/api/forks", { upstreamSpaceId, name }, actor.cookie);

    await expectError(create(reader, team, "fix"), 404, "NOT_FOUND");
    expect((await send(origin, "PATCH", `/api/spaces/${team}`, { publicRead: true }, holder.cookie)).status).toBe(200);
    const refused = await expectError(create(reader, team, "fix"), 403, "FORBIDDEN");
    expect(refused.message).toMatch(/proposals setting is members/);
    await expectError(create(reader, await personalSpace(origin, reader), "fix"), 404, "NOT_FOUND");
    await expectError(create(holder, await personalSpace(origin, holder), "fix"), 404, "NOT_FOUND");
    for (const name of ["personal", "a/b", "-lead", "", 7]) await expectError(create(holder, team, name), 400, "INVALID_INPUT");
    await expectError(create(holder, undefined, "fix"), 400, "INVALID_INPUT");
    expect(await createFork(origin, holder, team, "own-fork")).toBeTruthy();
    expect(await forkIds(origin, reader)).toEqual([]);
  }, 60_000);

  it("shares one namespace with the owner's Team Space slugs in both directions", async () => {
    const { origin } = await start();
    const owner = await person(origin, "owner");
    const team = await createRepo(origin, owner, "Team");
    const budget = await createRepo(origin, owner, "Budget");

    await expectError(send(origin, "POST", "/api/forks", { upstreamSpaceId: team, name: "BUDGET" }, owner.cookie), 409, "SPACE_SLUG_TAKEN");
    await createFork(origin, owner, team, "fix-totals");
    await expectError(send(origin, "POST", "/api/team-spaces", { name: "Fix", slug: "Fix-Totals" }, owner.cookie), 409, "SPACE_SLUG_TAKEN");
    await expectError(send(origin, "PATCH", `/api/spaces/${budget}`, { slug: "FIX-TOTALS" }, owner.cookie), 409, "SPACE_SLUG_TAKEN");
    const derived = await send(origin, "POST", "/api/team-spaces", { name: "Fix Totals" }, owner.cookie);
    expect({ status: derived.status, slug: ((await derived.json()) as { slug: string }).slug }).toEqual({ status: 201, slug: "fix-totals-2" });

    const other = await person(origin, "other");
    expect((await send(origin, "POST", "/api/team-spaces", { name: "Fix", slug: "fix-totals" }, other.cookie)).status).toBe(201);
  }, 60_000);

  it("caps an unclaimed agent at three forks until it deletes one", async () => {
    const { origin } = await start();
    const agent = await guestAgent(origin);
    const repo = await createRepo(origin, agent, "Research");
    const [one] = [await createFork(origin, agent, repo, "one"), await createFork(origin, agent, repo, "two"), await createFork(origin, agent, repo, "three")];
    expect((await expectError(send(origin, "POST", "/api/forks", { upstreamSpaceId: repo, name: "four" }, agent.cookie), 403, "AGENT_QUOTA_EXCEEDED")).message)
      .toBe("An unclaimed agent can own at most 3 forks. Delete a fork you no longer need, or give a person a handoff link so they can take you, which lifts this limit.");
    expect((await send(origin, "POST", "/api/forks", { upstreamSpaceId: repo, name: "two" }, agent.cookie)).status).toBe(200);
    expect((await send(origin, "DELETE", `/api/forks/${one}`, undefined, agent.cookie)).status).toBe(200);
    await createFork(origin, agent, repo, "four");

    const claimed = await guestAgent(origin);
    await claim(origin, claimed, await person(origin, "claimer"));
    const claimedRepo = await createRepo(origin, claimed, "Claimed");
    for (const name of ["one", "two", "three", "four"]) await createFork(origin, claimed, claimedRepo, name);
  }, 60_000);

  it("follows an agent to the person who takes it, who lists, opens, looks up and deletes its forks but never writes through them", async () => {
    const { origin } = await start();
    const agent = await guestAgent(origin);
    const repo = await createRepo(origin, agent, "Research");
    const sheet = await createSheet(origin, agent, repo, "Totals");
    const [dropped, kept, third] = [await createFork(origin, agent, repo, "dropped"), await createFork(origin, agent, repo, "kept"), await createFork(origin, agent, repo, "third")];
    await writeThrough(origin, agent, kept, sheet);
    const [owner, stranger] = [await person(origin, "owner"), await person(origin, "stranger")];
    expect(await forkIds(origin, owner)).toEqual([]);

    await claim(origin, agent, owner);

    expect(await forkIds(origin, owner)).toEqual([dropped, kept, third]);
    expect(await forkView(origin, owner, kept)).toMatchObject({
      fullName: `${agent.username}/kept`, owner: { id: agent.id }, upstream: { id: repo }, state: "drafting", worktree: { state: "draft" },
    });
    const looked = await send(origin, "GET", `/api/forks/lookup?owner=${agent.username}&name=kept`, undefined, owner.cookie);
    expect(await looked.json()).toMatchObject({ id: kept });
    for (const [path, body] of [[`/api/forks/${kept}/worktree`, undefined], [`/api/forks/${kept}/units`, { source: "trunk", resourceId: sheet.resourceId }]] as const) {
      await expectError(send(origin, "POST", path, body, owner.cookie, { "idempotency-key": randomUUID() }), 404, "NOT_FOUND");
    }
    expect((await writeThrough(origin, agent, kept, sheet)).status).toBe(200);

    expect(await forkIds(origin, stranger)).toEqual([]);
    expect((await send(origin, "GET", `/api/forks/${kept}`, undefined, stranger.cookie)).status).toBe(404);
    expect((await send(origin, "DELETE", `/api/forks/${kept}`, undefined, stranger.cookie)).status).toBe(404);

    expect((await send(origin, "DELETE", `/api/forks/${dropped}`, undefined, owner.cookie)).status).toBe(200);
    expect(await forkIds(origin, agent)).toEqual([kept, third]);
    await createFork(origin, owner, repo, "kept");
    expect(await forkIds(origin, agent)).toEqual([kept, third]);
  }, 60_000);

  it("leaves its Worktrees and their history to the upstream when deleted (A4.10)", async () => {
    const { origin, database } = await start();
    const [holder, agent] = await Promise.all([person(origin, "holder"), person(origin, "agent")]);
    const team = await createRepo(origin, holder, "Team");
    const budget = await createSheet(origin, holder, team, "Budget");
    await setRole(origin, team, holder, agent.id, "viewer");
    const fork = await createFork(origin, agent, team, "fix-totals");
    const done = await createPull(origin, agent, team, budget.resourceId);
    expect(await transition(origin, done, "discard", agent)).toBe("discarded");
    const open = await createPull(origin, agent, team, budget.resourceId);
    await database.run("UPDATE worktrees SET fork_id = $1 WHERE id IN ($2, $3)", [fork, done, open]);

    const drafting = (await (await send(origin, "GET", `/api/forks/${fork}`, undefined, agent.cookie)).json()) as Record<string, unknown>;
    expect(drafting).toMatchObject({ state: "drafting", worktree: { id: open, state: "draft", teamSpace: { id: team } } });
    expect(drafting.worktree).not.toHaveProperty("units");
    expect(await transition(origin, open, "ready", agent)).toBe("ready");
    expect(await (await send(origin, "GET", `/api/forks/${fork}`, undefined, agent.cookie)).json()).toMatchObject({ state: "proposed" });
    const second = await createPull(origin, agent, team, budget.resourceId);
    await expect(database.run("UPDATE worktrees SET fork_id = $1 WHERE id = $2", [fork, second])).rejects.toThrow(/UNIQUE|worktrees_open_fork/);

    const removed = await send(origin, "DELETE", `/api/forks/${fork}`, undefined, agent.cookie);
    expect({ status: removed.status, body: await removed.json() }).toMatchObject({ status: 200, body: { worktree: { id: open, state: "ready" } } });
    expect(await database.all("SELECT id, fork_id FROM worktrees WHERE id IN ($1, $2) ORDER BY id", [done, open]))
      .toEqual([done, open].sort().map((id) => ({ id, fork_id: null })));
    for (const [id, state] of [[done, "discarded"], [open, "ready"]] as const) {
      const worktree = await send(origin, "GET", `/api/worktrees/${id}`, undefined, agent.cookie);
      expect(await worktree.json()).toMatchObject({ worktree: { id, state, units: [{ resourceId: budget.resourceId }] } });
    }
    expect(await transition(origin, open, "merge", holder)).toBe("merged");
  }, 60_000);

  it("stays readable and deletable by its owner after the upstream and its Worktree are gone", async () => {
    const { origin, database } = await start();
    const [holder, agent] = await Promise.all([person(origin, "holder"), person(origin, "agent")]);
    const team = await createRepo(origin, holder, "Team");
    const budget = await createSheet(origin, holder, team, "Budget");
    await setRole(origin, team, holder, agent.id, "viewer");
    const [kept, orphaned] = [await createFork(origin, agent, team, "fix-totals"), await createFork(origin, agent, team, "orphaned")];
    await database.run("UPDATE worktrees SET fork_id = $1 WHERE id = $2", [orphaned, await createPull(origin, holder, team, budget.resourceId)]);
    expect((await send(origin, "DELETE", `/api/team-spaces/${team}/members/${agent.id}`, undefined, holder.cookie)).status).toBe(204);

    for (const fork of [kept, orphaned]) {
      const read = await send(origin, "GET", `/api/forks/${fork}`, undefined, agent.cookie);
      expect({ status: read.status, body: await read.json() }).toMatchObject({ status: 200, body: { id: fork, upstream: null, state: "clean", worktree: null } });
      const removed = await send(origin, "DELETE", `/api/forks/${fork}`, undefined, agent.cookie);
      expect({ status: removed.status, body: await removed.json() }).toEqual({ status: 200, body: { worktree: null } });
    }
    expect(await database.all("SELECT id FROM worktrees WHERE fork_id IS NOT NULL", [])).toEqual([]);
  }, 60_000);
});

describe("writing through a fork", () => {
  it("opens one private Team Worktree on the first write and adds the Unit at the current Trunk revision (A4.4)", async () => {
    const { origin, database } = await start();
    const { holder, agent, team } = await upstream(origin);
    const budget = await createSheet(origin, holder, team, "Budget");
    const fork = await createFork(origin, agent, team, "fix-totals");
    await expectError(send(origin, "POST", `/api/forks/${fork}/units`, { source: "trunk", resourceId: budget.resourceId }, agent.cookie), 400, "INVALID_INPUT");

    const before = await database.rowCounts();
    const key = randomUUID();
    const first = await writeThrough(origin, agent, fork, budget, key);
    expect(first).toMatchObject({
      status: 201,
      worktree: { kind: "team", visibility: "private", name: "fix-totals", state: "draft", teamSpace: { id: team }, creator: { id: agent.id } },
      unit: { unitId: budget.unitId, resourceId: budget.resourceId, source: "trunk", freshness: { label: "current", revisionsBehind: 0 } },
    });
    const after = await database.rowCounts();
    expect(changedCounts(before, after)).toMatchObject({ worktrees: 1, worktree_units: 1 });
    expect(await database.all("SELECT fork_id FROM worktrees WHERE id = $1", [first.worktree.id])).toEqual([{ fork_id: fork }]);
    expect(await forkView(origin, agent, fork)).toMatchObject({ state: "drafting", worktree: { id: first.worktree.id, state: "draft" } });

    for (const retry of [key, randomUUID()]) {
      expect(await writeThrough(origin, agent, fork, budget, retry)).toMatchObject({ status: 200, worktree: { id: first.worktree.id }, unit: { unitId: budget.unitId } });
    }
    expect(changedCounts(after, await database.rowCounts())).toEqual({});

    const plain = await send(origin, "POST", "/api/worktrees", { kind: "team", teamSpaceId: team, visibility: "private", name: "by-hand", summary: null, forkId: fork },
      agent.cookie, { "idempotency-key": randomUUID() });
    expect(plain.status).toBe(201);
    expect(await database.all("SELECT fork_id FROM worktrees WHERE id = $1", [((await plain.json()) as { id: string }).id])).toEqual([{ fork_id: null }]);
  }, 60_000);

  it("links the pull request a fork opens to an upstream Issue, which then lists it", async () => {
    const { origin } = await start();
    const { holder, agent, team } = await upstream(origin);
    const budget = await createSheet(origin, holder, team, "Budget");
    const opened = await send(origin, "POST", `/api/spaces/${team}/issues`, { title: "Fix totals", assigneeUserIds: [agent.id] }, holder.cookie);
    const issue = (await opened.json()) as { number: number };
    const fork = await createFork(origin, agent, team, "fix-totals");
    const { worktree } = await writeThrough(origin, agent, fork, budget);

    const linked = await send(origin, "PATCH", `/api/worktrees/${worktree.id}`, { issueNumber: issue.number }, agent.cookie);
    expect(await linked.json()).toMatchObject({ worktree: { id: worktree.id, issue: { number: issue.number, title: "Fix totals", state: "open" } } });
    const view = await send(origin, "GET", `/api/spaces/${team}/issues/${issue.number}`, undefined, holder.cookie);
    expect(((await view.json()) as { pullRequests: unknown }).pullRequests).toEqual([
      expect.objectContaining({ id: worktree.id, title: "fix-totals", state: "draft", author: expect.objectContaining({ id: agent.id }), mergedBy: null }),
    ]);
  }, 60_000);

  it("puts two concurrent first writes into one open Worktree, and the losing open leaves one empty Collaboration Worktree (A4.5)", async () => {
    const { origin, database } = await start();
    const { holder, agent, team } = await upstream(origin);
    const [budget, forecast] = [await createSheet(origin, holder, team, "Budget"), await createSheet(origin, holder, team, "Forecast")];
    const fork = await createFork(origin, agent, team, "fix-totals");
    const create = UniverCollabWorktreeService.prototype.createWorktree;
    const opened: { readonly sdk: UniverCollabWorktreeService; readonly worktreeId: string }[] = [];
    let bothArrived!: () => void;
    const arrived = new Promise<void>((resolve) => { bothArrived = resolve; });
    // Both writes reach the Collaboration create only after both saw a clean fork, so the race always happens.
    vi.spyOn(UniverCollabWorktreeService.prototype, "createWorktree").mockImplementation(async function (this: UniverCollabWorktreeService, input, options) {
      opened.push({ sdk: this, worktreeId: input.worktreeID });
      if (opened.length === 2) bothArrived();
      await arrived;
      return create.call(this, input, options);
    });

    const before = await database.rowCounts();
    const writes = await Promise.all([writeThrough(origin, agent, fork, budget), writeThrough(origin, agent, fork, forecast)]);
    expect(writes.map(({ status }) => status)).toEqual([201, 201]);
    const worktreeId = writes[0]!.worktree.id;
    expect(writes[1]!.worktree.id).toBe(worktreeId);
    expect(await database.all("SELECT id FROM worktrees WHERE fork_id = $1 AND processed_at IS NULL", [fork])).toEqual([{ id: worktreeId }]);
    expect((await worktreeDetail(origin, agent, worktreeId)).units.map((unit) => unit.resourceId).sort()).toEqual([budget.resourceId, forecast.resourceId].sort());

    const changed = changedCounts(before, await database.rowCounts());
    expect(changed.worktrees).toBe(1);
    expect(Object.entries(changed).find(([table]) => /^collaboration\.(collaboration_)?worktrees$/.test(table))?.[1]).toBe(2);
    expect(await database.all("SELECT state, last_error_message AS error FROM operations WHERE kind = 'create_worktree' ORDER BY state", []))
      .toEqual([{ state: "completed", error: null }, { state: "failed", error: "The fork already has an open Worktree." }]);
    const orphan = opened.find((entry) => entry.worktreeId !== worktreeId)!;
    const options = collaborationCallOptions(agent.id);
    expect((await orphan.sdk.getWorktree({ worktreeID: orphan.worktreeId }, options)).worktree).toMatchObject({ status: "draft", units: [] });
    // The SDK refuses to create an existing Worktree ID, so racing writes cannot share a deterministic ID.
    await expect(create.call(orphan.sdk, { worktreeID: worktreeId }, options)).rejects.toMatchObject({ code: "WORKTREE_ALREADY_EXISTS" });
  }, 60_000);

  it("refuses writes while proposed, takes them after reopen, and opens a new Worktree after the merge (A4.6, A4.7)", async () => {
    const { origin } = await start();
    const { holder, agent, editor, team } = await upstream(origin);
    const [budget, forecast] = [await createSheet(origin, holder, team, "Budget"), await createSheet(origin, holder, team, "Forecast")];
    const fork = await createFork(origin, agent, team, "fix-totals");
    const { worktree } = await writeThrough(origin, agent, fork, budget);

    expect(await transition(origin, worktree.id, "ready", agent)).toBe("ready");
    expect(await forkView(origin, agent, fork)).toMatchObject({ state: "proposed", worktree: { id: worktree.id } });
    const refused = await expectError(send(origin, "POST", `/api/forks/${fork}/units`, { source: "trunk", resourceId: forecast.resourceId },
      agent.cookie, { "idempotency-key": randomUUID() }), 409, "FORK_WORKTREE_NOT_DRAFT");
    expect(refused.message).toMatch(/ready/);
    expect(await transition(origin, worktree.id, "reopen", agent)).toBe("draft");
    expect(await writeThrough(origin, agent, fork, forecast)).toMatchObject({ status: 201, worktree: { id: worktree.id }, unit: { resourceId: forecast.resourceId } });

    expect(await transition(origin, worktree.id, "ready", agent)).toBe("ready");
    expect(await transition(origin, worktree.id, "merge", editor)).toBe("merged");
    expect(await forkView(origin, agent, fork)).toMatchObject({ state: "clean", worktree: null });
    const next = await writeThrough(origin, agent, fork, budget);
    expect(next).toMatchObject({ status: 201, worktree: { state: "draft" }, unit: { resourceId: budget.resourceId, freshness: { revisionsBehind: 0 } } });
    expect(next.worktree.id).not.toBe(worktree.id);
  }, 60_000);

  it("keeps a merged Unit upstream after a partial conflict, and redoes the other in a new Worktree after discard (A4.8)", async () => {
    const { origin } = await start();
    const { holder, agent, editor, team } = await upstream(origin);
    const [totals, plan] = [await createSheet(origin, holder, team, "Totals"), await createSheet(origin, holder, team, "Plan")];
    const fork = await createFork(origin, agent, team, "fix-totals");
    const first = await writeThrough(origin, agent, fork, totals);
    await committed(origin, agent, first.worktree.id, first.unit, [setCell(totals, 10, "fork-totals")]);
    const second = await writeThrough(origin, agent, fork, plan);
    await committed(origin, agent, first.worktree.id, second.unit, [setCell(plan, 10, "fork-plan")]);
    await changeTrunk(origin, holder, team, plan, removeRow(plan, 10));

    expect(await transition(origin, first.worktree.id, "ready", agent)).toBe("ready");
    expect(await transition(origin, first.worktree.id, "merge", editor)).toBe("ready");
    const results = Object.fromEntries((await worktreeDetail(origin, agent, first.worktree.id)).units.map((unit) => [unit.resourceId, unit.mergeResult]));
    expect(results).toEqual({ [totals.resourceId]: "merged", [plan.resourceId]: "conflict" });
    expect(await trunkText(origin, agent, totals)).toContain("fork-totals");
    expect(await trunkText(origin, agent, plan)).not.toContain("fork-plan");
    expect(await forkView(origin, agent, fork)).toMatchObject({ state: "proposed", worktree: { id: first.worktree.id } });

    expect(await transition(origin, first.worktree.id, "discard", agent)).toBe("discarded");
    expect(await forkView(origin, agent, fork)).toMatchObject({ state: "clean", worktree: null });
    const redo = await writeThrough(origin, agent, fork, plan);
    expect(redo.worktree.id).not.toBe(first.worktree.id);
    await committed(origin, agent, redo.worktree.id, redo.unit, [setCell(plan, 10, "fork-plan-redone")]);
    expect(await transition(origin, redo.worktree.id, "ready", agent)).toBe("ready");
    expect(await transition(origin, redo.worktree.id, "merge", editor)).toBe("merged");
    expect(await trunkText(origin, agent, plan)).toContain("fork-plan-redone");
  }, 90_000);

  it("stops every write through the fork once the upstream removes its owner (A4.9)", async () => {
    const { origin } = await start();
    const { holder, agent, team } = await upstream(origin);
    const [budget, forecast] = [await createSheet(origin, holder, team, "Budget"), await createSheet(origin, holder, team, "Forecast")];
    const [drafting, clean] = [await createFork(origin, agent, team, "fix-totals"), await createFork(origin, agent, team, "add-forecast")];
    const { worktree, unit } = await writeThrough(origin, agent, drafting, budget);
    expect((await send(origin, "DELETE", `/api/team-spaces/${team}/members/${agent.id}`, undefined, holder.cookie)).status).toBe(204);

    for (const fork of [drafting, clean]) {
      await expectError(send(origin, "POST", `/api/forks/${fork}/units`, { source: "trunk", resourceId: forecast.resourceId },
        agent.cookie, { "idempotency-key": randomUUID() }), 404, "NOT_FOUND");
    }
    expect((await commit(origin, agent, worktree.id, unit, [setCell(budget, 1, "after-removal")])).status).toBe(403);

    expect((await send(origin, "PATCH", `/api/spaces/${team}`, { publicRead: true }, holder.cookie)).status).toBe(200);
    for (const [fork, resourceId] of [[drafting, budget.resourceId], [drafting, forecast.resourceId], [clean, forecast.resourceId]] as const) {
      await expectError(send(origin, "POST", `/api/forks/${fork}/units`, { source: "trunk", resourceId },
        agent.cookie, { "idempotency-key": randomUUID() }), 403, "FORBIDDEN");
    }
  }, 60_000);

  it("gives each of two forks of one upstream its own Worktree (A4.11)", async () => {
    const { origin } = await start();
    const { holder, agent, team } = await upstream(origin);
    const [budget, forecast] = [await createSheet(origin, holder, team, "Budget"), await createSheet(origin, holder, team, "Forecast")];
    const [one, two] = [await createFork(origin, agent, team, "fix-totals"), await createFork(origin, agent, team, "add-forecast")];
    const [first, second] = [await writeThrough(origin, agent, one, budget), await writeThrough(origin, agent, two, budget)];
    expect(first.worktree.id).not.toBe(second.worktree.id);

    expect(await transition(origin, first.worktree.id, "ready", agent)).toBe("ready");
    expect(await writeThrough(origin, agent, two, forecast)).toMatchObject({ status: 201, worktree: { id: second.worktree.id } });
    expect(await forkView(origin, agent, two)).toMatchObject({ state: "drafting", worktree: { id: second.worktree.id } });
    expect(await forkView(origin, agent, one)).toMatchObject({ state: "proposed", worktree: { id: first.worktree.id } });
    expect((await worktreeDetail(origin, agent, second.worktree.id)).units.map((entry) => entry.resourceId).sort()).toEqual([budget.resourceId, forecast.resourceId].sort());
  }, 60_000);

  it("links the Worktree to its fork when the failed opening Operation is retried", async () => {
    const { origin, database } = await start();
    const { holder, agent, team } = await upstream(origin);
    const budget = await createSheet(origin, holder, team, "Budget");
    const fork = await createFork(origin, agent, team, "fix-totals");
    vi.spyOn(UniverCollabWorktreeService.prototype, "createWorktree").mockRejectedValueOnce(Object.assign(new Error("Collaboration is unavailable."), { code: "UNAVAILABLE" }));

    const key = randomUUID();
    await expectError(send(origin, "POST", `/api/forks/${fork}/units`, { source: "trunk", resourceId: budget.resourceId },
      agent.cookie, { "idempotency-key": key }), 409, "CONFLICT");
    expect(await forkView(origin, agent, fork)).toMatchObject({ state: "clean" });
    const [failed] = (await database.all("SELECT id FROM operations WHERE kind = 'create_worktree' AND state = 'failed'", [])) as { id: string }[];
    const retried = await send(origin, "POST", `/api/operations/${failed!.id}/retry`, undefined, agent.cookie);
    expect({ status: retried.status, body: await retried.json() }).toMatchObject({ status: 202, body: { state: "completed" } });
    const { worktree } = (await forkView(origin, agent, fork)) as { worktree: { id: string } };
    expect(await forkView(origin, agent, fork)).toMatchObject({ state: "drafting", worktree: { id: worktree.id, unitCount: 0 } });
    expect(await writeThrough(origin, agent, fork, budget, key)).toMatchObject({ status: 201, worktree: { id: worktree.id } });
  }, 60_000);
});

describe("pages through a fork", () => {
  it.each(["viewer", "reader who is not a Space Member"] as const)(
    "lets a %s propose a page alone, which an editor's browser merge publishes", async (proposer) => {
      const { origin, database } = await start();
      const { holder, editor, team, agent } = proposer === "viewer"
        ? await upstream(origin)
        : { ...await publicUpstream(origin, "accountable"), agent: await person(origin, "agent") };
      const page = await publishedPage(origin, holder, team, "Holder");
      const fork = await createFork(origin, agent, team, "fix-page");
      const open = (key = randomUUID()) => send(origin, "POST", `/api/forks/${fork}/worktree`, undefined, agent.cookie, { "idempotency-key": key });

      const opened = await open();
      const { worktree } = (await opened.json()) as { worktree: { id: string; state: string; unitCount: number } };
      expect({ status: opened.status, state: worktree.state, unitCount: worktree.unitCount }).toEqual({ status: 201, state: "draft", unitCount: 0 });
      expect(await database.all("SELECT fork_id FROM worktrees WHERE id = $1", [worktree.id])).toEqual([{ fork_id: fork }]);
      const again = await open();
      expect({ status: again.status, id: ((await again.json()) as { worktree: { id: string } }).worktree.id }).toEqual({ status: 200, id: worktree.id });
      const draft = await send(origin, "POST", "/api/html-view-drafts", { kind: "replace", ...page, html: html("Proposed"), sourceWorktreeId: worktree.id },
        agent.cookie, { "idempotency-key": randomUUID() });
      expect(draft.status).toBe(201);
      const { draft: { id: draftId } } = (await draft.json()) as { draft: { id: string } };

      expect(await transition(origin, worktree.id, "ready", agent)).toBe("ready");
      expect(await worktreeView(origin, editor, worktree.id)).toMatchObject({ visibility: "space", units: [], capabilities: { merge: true } });
      expect((await expectError(open(), 409, "FORK_WORKTREE_NOT_DRAFT")).message).toMatch(/is ready/);
      const merged = await send(origin, "POST", `/api/worktrees/${worktree.id}/merge`, { pageDraftIds: [draftId] }, editor.cookie, { "idempotency-key": randomUUID() });
      expect({ status: merged.status, body: await merged.json() }).toMatchObject({
        status: 200, body: { worktree: { state: "merged" }, publishedPages: [{ name: "Page.univer.html" }] },
      });
      expect(await (await send(origin, "GET", `/api/blob-resources/${page.resourceId}/content`, undefined, holder.cookie)).text()).toContain("Proposed");
      expect(await forkView(origin, agent, fork)).toMatchObject({ state: "clean", worktree: null });
    }, 90_000);

  it("refuses to open the Worktree of another User's fork", async () => {
    const { origin } = await start();
    const { holder, agent, team } = await upstream(origin);
    const fork = await createFork(origin, agent, team, "fix-page");
    await expectError(send(origin, "POST", `/api/forks/${fork}/worktree`, undefined, holder.cookie, { "idempotency-key": randomUUID() }), 404, "NOT_FOUND");
    await expectError(send(origin, "POST", `/api/forks/${fork}/worktree`, undefined, agent.cookie), 400, "INVALID_INPUT");
    expect(await forkView(origin, agent, fork)).toMatchObject({ state: "clean" });
  }, 60_000);
});

describe("files through a fork", () => {
  it("lets a viewer replace a PDF and a PNG through a fork, which only an editor's reviewed browser merge publishes", async () => {
    const { origin, application } = await start();
    const { holder, editor, team, agent } = await upstream(origin);
    const pdf = await uploadedFile(origin, holder, team, "report.pdf", "%PDF-1.4 holder");
    const png = await uploadedFile(origin, holder, team, "chart.png", "\x89PNG holder");
    const page = await publishedPage(origin, holder, team, "Holder");
    const fork = await createFork(origin, agent, team, "fix-files");
    const key = randomUUID();

    const first = await replaceThrough(origin, agent, fork, pdf, "%PDF-1.4 agent", key);
    expect(first).toMatchObject({ status: 201, draft: { kind: "replace", page: false, state: "pending", name: "report.pdf", targetResourceId: pdf.resourceId, baseEtag: pdf.etag } });
    expect(await forkView(origin, agent, fork)).toMatchObject({ state: "drafting", worktree: { id: first.worktree.id, unitCount: 0, pendingPageDrafts: 1 } });
    expect(await replaceThrough(origin, agent, fork, pdf, "%PDF-1.4 agent", key)).toMatchObject({ status: 200, draft: { id: first.draft.id } });
    await expectError(replaceRequest(origin, agent, fork, page, "<html></html>"), 403, "HTML_VIEW_DRAFT_REQUIRED");
    await expectError(replaceRequest(origin, agent, fork, { ...png, etag: pdf.etag }, "stale"), 412, "PRECONDITION_FAILED");
    const chart = await replaceThrough(origin, agent, fork, png, "\x89PNG agent");
    expect(chart).toMatchObject({ status: 201, worktree: { id: first.worktree.id }, draft: { page: false, name: "chart.png" } });

    expect(await transition(origin, first.worktree.id, "ready", agent)).toBe("ready");
    expect((await expectError(replaceRequest(origin, agent, fork, png, "late"), 409, "FORK_WORKTREE_NOT_DRAFT")).message).toMatch(/is ready/);
    const listed = (await (await send(origin, "GET", `/api/worktrees/${first.worktree.id}/html-view-drafts`, undefined, editor.cookie)).json()) as { drafts: { id: string; page: boolean }[] };
    expect(listed.drafts.map(({ id, page }) => ({ id, page }))).toEqual([{ id: first.draft.id, page: false }, { id: chart.draft.id, page: false }]);
    const content = await send(origin, "GET", `/api/html-view-drafts/${first.draft.id}/content`, undefined, editor.cookie);
    expect({
      type: content.headers.get("content-type"), disposition: content.headers.get("content-disposition"),
      csp: content.headers.get("content-security-policy"), sniff: content.headers.get("x-content-type-options"), body: await content.text(),
    }).toEqual({ type: "application/octet-stream", disposition: expect.stringMatching(/^attachment; filename="report\.pdf"/), csp: "sandbox", sniff: "nosniff", body: "%PDF-1.4 agent" });

    const merge = (actor: Actor, pageDraftIds?: string[]) =>
      send(origin, "POST", `/api/worktrees/${first.worktree.id}/merge`, pageDraftIds && { pageDraftIds }, actor.cookie, { "idempotency-key": randomUUID() });
    const reviewed = [first.draft.id, chart.draft.id];
    expect((await expectError(merge(await patSession(origin, application, editor), reviewed), 409, "PAGE_REVIEW_REQUIRED")).message)
      .toMatch(/cannot publish these pages or files alone: report\.pdf, chart\.png\./);
    await expectError(merge(editor, [first.draft.id]), 409, "PAGES_CHANGED");
    expect(await fileBytes(origin, holder, pdf)).toEqual({ body: "%PDF-1.4 holder", etag: pdf.etag });

    const merged = await merge(editor, reviewed);
    expect({ status: merged.status, body: await merged.json() }).toMatchObject({
      status: 200, body: { worktree: { state: "merged" }, publishedPages: [{ draftId: first.draft.id, name: "report.pdf" }, { draftId: chart.draft.id, name: "chart.png" }] },
    });
    for (const [file, bytes, draftId] of [[pdf, "%PDF-1.4 agent", first.draft.id], [png, "\x89PNG agent", chart.draft.id]] as const) {
      const { draft } = (await (await send(origin, "GET", `/api/html-view-drafts/${draftId}`, undefined, agent.cookie)).json()) as { draft: { state: string; published: { etag: string } } };
      expect(draft.state).toBe("published");
      expect(await fileBytes(origin, holder, file)).toEqual({ body: bytes, etag: draft.published.etag });
    }
    expect(await forkView(origin, agent, fork)).toMatchObject({ state: "clean" });
  }, 90_000);

  it("leaves a file someone replaced after the fork's draft conflicted with their bytes, and merges the Sheet in the same pull request", async () => {
    const { origin } = await start();
    const { holder, editor, team, agent } = await upstream(origin);
    const budget = await createSheet(origin, holder, team, "Budget");
    const pdf = await uploadedFile(origin, holder, team, "report.pdf", "%PDF-1.4 holder");
    const fork = await createFork(origin, agent, team, "fix-report");
    const { worktree, unit } = await writeThrough(origin, agent, fork, budget);
    await committed(origin, agent, worktree.id, unit, [setCell(budget, 1, "agent-value")]);
    const { draft } = await replaceThrough(origin, agent, fork, pdf, "%PDF-1.4 agent");

    const replaced = await send(origin, "PUT", `/api/blob-resources/${pdf.resourceId}/content`, undefined, holder.cookie, {
      "idempotency-key": randomUUID(), "if-match": pdf.etag, "content-type": "application/octet-stream",
    }, "%PDF-1.4 holder again");
    expect(replaced.status).toBe(200);
    expect(await transition(origin, worktree.id, "ready", agent)).toBe("ready");
    const merged = await send(origin, "POST", `/api/worktrees/${worktree.id}/merge`, { pageDraftIds: [draft.id] }, editor.cookie, { "idempotency-key": randomUUID() });
    expect({ status: merged.status, body: await merged.json() }).toMatchObject({ status: 200, body: { worktree: { state: "merged" }, publishedPages: [] } });
    expect((await fileBytes(origin, holder, pdf)).body).toBe("%PDF-1.4 holder again");
    expect(await trunkText(origin, holder, budget)).toContain("agent-value");
    const { drafts } = (await (await send(origin, "GET", `/api/worktrees/${worktree.id}/html-view-drafts`, undefined, agent.cookie)).json()) as { drafts: { id: string; state: string }[] };
    expect(drafts).toEqual([expect.objectContaining({ id: draft.id, state: "conflicted" })]);
  }, 90_000);

  it("keeps a page renamed without its suffix a page, which a file replacement refuses and a page draft publishes", async () => {
    const { origin } = await start();
    const { holder, editor, team, agent } = await upstream(origin);
    const page = await publishedPage(origin, holder, team, "Holder");
    const { node } = (await (await send(origin, "GET", `/api/resources/${page.resourceId}`, undefined, holder.cookie)).json()) as { node: { id: string } };
    expect((await send(origin, "PATCH", `/api/nodes/${node.id}`, { name: "Page" }, holder.cookie)).status).toBe(200);
    const fork = await createFork(origin, agent, team, "fix-page");
    await expectError(replaceRequest(origin, agent, fork, page, "<html></html>"), 403, "HTML_VIEW_DRAFT_REQUIRED");

    const { worktree } = (await (await send(origin, "POST", `/api/forks/${fork}/worktree`, undefined, agent.cookie, { "idempotency-key": randomUUID() })).json()) as { worktree: { id: string } };
    const saved = await send(origin, "POST", "/api/html-view-drafts", { kind: "replace", ...page, html: html("Proposed"), sourceWorktreeId: worktree.id },
      agent.cookie, { "idempotency-key": randomUUID() });
    const { draft } = (await saved.json()) as { draft: { id: string; name: string; page: boolean } };
    expect({ status: saved.status, name: draft.name, page: draft.page }).toEqual({ status: 201, name: "Page", page: true });
    expect(await transition(origin, worktree.id, "ready", agent)).toBe("ready");
    const merged = await send(origin, "POST", `/api/worktrees/${worktree.id}/merge`, { pageDraftIds: [draft.id] }, editor.cookie, { "idempotency-key": randomUUID() });
    expect({ status: merged.status, body: await merged.json() }).toMatchObject({ status: 200, body: { publishedPages: [{ draftId: draft.id, name: "Page" }] } });
    expect((await fileBytes(origin, holder, page)).body).toContain("Proposed");
  }, 60_000);

  it("answers a second request with the same key from the stored draft while the first still streams, and supersedes the author's earlier draft of the file", async () => {
    const { origin, database } = await start();
    const { holder, team, agent } = await upstream(origin);
    const pdf = await uploadedFile(origin, holder, team, "report.pdf", "%PDF-1.4 holder");
    const fork = await createFork(origin, agent, team, "fix-report");
    const earlier = await replaceThrough(origin, agent, fork, pdf, "%PDF-1.4 first");
    const key = randomUUID();
    const bytes = "%PDF-1.4 second";
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const streaming = send(origin, "PUT", `/api/forks/${fork}/blob-resources/${pdf.resourceId}/content`, undefined, agent.cookie, {
      "idempotency-key": key, "if-match": pdf.etag, "content-type": "application/octet-stream", "content-length": String(bytes.length),
    }, new ReadableStream({
      async start(controller) {
        controller.enqueue(new TextEncoder().encode(bytes.slice(0, 4)));
        await held;
        controller.enqueue(new TextEncoder().encode(bytes.slice(4)));
        controller.close();
      },
    }));
    await vi.waitFor(async () => expect(await database.all("SELECT state FROM html_view_drafts WHERE idempotency_key = $1", [key])).toEqual([{ state: "receiving" }]));
    expect((await expectError(replaceRequest(origin, agent, fork, pdf, bytes, key), 409, "CONFLICT")).message).toMatch(/still receiving its bytes/);
    release();
    const done = await streaming;
    const { draft } = (await done.json()) as { draft: { id: string; state: string } };
    expect({ status: done.status, state: draft.state }).toEqual({ status: 201, state: "pending" });
    expect(await replaceThrough(origin, agent, fork, pdf, bytes, key)).toMatchObject({ status: 200, draft: { id: draft.id } });
    const { drafts } = (await (await send(origin, "GET", `/api/worktrees/${earlier.worktree.id}/html-view-drafts`, undefined, agent.cookie)).json()) as { drafts: { id: string }[] };
    expect(drafts.map(({ id }) => id)).toEqual([draft.id]);
    expect(await (await send(origin, "GET", `/api/html-view-drafts/${earlier.draft.id}`, undefined, agent.cookie)).json())
      .toMatchObject({ draft: { state: "superseded", supersededBy: draft.id } });
  }, 60_000);
});

describe("proposals from readers who are not Space Members", () => {
  it("admits each kind of reader by the proposals setting, and none while the Space is not public", async () => {
    const { origin } = await start();
    const { holder, editor, team } = await publicUpstream(origin, "members");
    const readers = { person: await person(origin, "reader"), "claimed agent": await outsider(origin, "claimed agent"), "unclaimed agent": await guestAgent(origin) };
    const admitted: Record<string, readonly string[]> = { members: [], accountable: ["person", "claimed agent"], anyone: Object.keys(readers) };

    for (const [proposals, kinds] of Object.entries(admitted)) {
      expect(await settings(origin, holder, team, { proposals })).toMatchObject({ proposals, capabilities: { propose: true } });
      expect(await spaceView(origin, editor, team)).toMatchObject({ affiliation: "member", capabilities: { propose: true } });
      for (const [kind, reader] of Object.entries(readers)) {
        const admits = kinds.includes(kind);
        expect(await spaceView(origin, reader, team)).toMatchObject({
          affiliation: "none", proposals, capabilities: { propose: admits, createIssue: false, createAtRoot: false },
        });
        const created = send(origin, "POST", "/api/forks", { upstreamSpaceId: team, name: `${proposals}-fork` }, reader.cookie);
        if (admits) expect((await created).status).toBe(201);
        else expect((await expectError(created, 403, "FORBIDDEN")).message).toContain(`proposals setting is ${proposals}`);
      }
    }

    expect(await settings(origin, holder, team, { publicRead: false })).toMatchObject({ publicRead: false, proposals: "anyone" });
    for (const reader of Object.values(readers)) {
      expect((await send(origin, "GET", `/api/spaces/${team}`, undefined, reader.cookie)).status).toBe(404);
      await expectError(send(origin, "POST", "/api/forks", { upstreamSpaceId: team, name: "private-fork" }, reader.cookie), 404, "NOT_FOUND");
    }
    expect(await spaceView(origin, editor, team)).toMatchObject({ capabilities: { propose: true } });
    await expectError(send(origin, "PATCH", `/api/spaces/${team}`, { proposals: "everyone" }, holder.cookie), 400, "INVALID_INPUT");
    await expectError(send(origin, "PATCH", `/api/spaces/${await personalSpace(origin, holder)}`, { proposals: "anyone" }, holder.cookie), 400, "INVALID_INPUT");
    await expectError(send(origin, "PATCH", `/api/spaces/${team}`, { proposals: "members" }, editor.cookie), 403, "FORBIDDEN");
    const created = await send(origin, "POST", "/api/team-spaces", { name: "Open", publicRead: true, proposals: "accountable" }, holder.cookie);
    expect({ status: created.status, body: await created.json() }).toMatchObject({ status: 201, body: { proposals: "accountable", publicRead: true } });
  }, 120_000);

  it.each([
    ["person", "accountable"],
    ["claimed agent", "accountable"],
    ["unclaimed agent", "anyone"],
  ] as const)("takes a %s's proposal under %s from its fork to an editor's merge, without making it a member", async (kind, proposals) => {
    const { origin } = await start();
    const { holder, editor, team } = await publicUpstream(origin, proposals);
    const budget = await createSheet(origin, holder, team, "Budget");
    const proposer = await outsider(origin, kind);
    const fork = await createFork(origin, proposer, team, "fix-totals");

    const { worktree, unit } = await writeThrough(origin, proposer, fork, budget);
    expect(await worktreeView(origin, proposer, worktree.id)).toMatchObject({
      visibility: "private", capabilities: { editDraft: true, addUnit: true, markReady: true, merge: false, discard: true },
    });
    await committed(origin, proposer, worktree.id, unit, [setCell(budget, 1, "proposed")]);
    expect(await transition(origin, worktree.id, "ready", proposer)).toBe("ready");
    expect(await transition(origin, worktree.id, "reopen", proposer)).toBe("draft");
    expect(await transition(origin, worktree.id, "ready", proposer)).toBe("ready");
    expect(await worktreeView(origin, proposer, worktree.id)).toMatchObject({ visibility: "space", capabilities: { merge: false } });
    expect(await worktreeView(origin, editor, worktree.id)).toMatchObject({ capabilities: { merge: true } });
    expect(await transition(origin, worktree.id, "merge", editor)).toBe("merged");
    expect(await trunkText(origin, holder, budget)).toContain("proposed");

    const { members } = (await (await send(origin, "GET", `/api/team-spaces/${team}/members`, undefined, holder.cookie)).json()) as { members: { user: { id: string } }[] };
    expect(members.map((member) => member.user.id)).toEqual([editor.id]);
    expect(await spaceView(origin, proposer, team)).toMatchObject({ affiliation: "none", accessRole: "viewer", capabilities: { createIssue: false } });
    await expectError(send(origin, "POST", `/api/spaces/${team}/issues`, { title: "Totals" }, proposer.cookie), 403, "FORBIDDEN");
    if (kind === "unclaimed agent") await expectError(setRole(origin, team, holder, proposer.id, "viewer"), 403, "AGENT_NOT_ALLOWED");
  }, 90_000);

  it("freezes a reader's draft once the setting goes back to members or the Space stops reading publicly, and keeps its ready proposal mergeable", async () => {
    const { origin } = await start();
    const { holder, editor, team } = await publicUpstream(origin, "accountable");
    const [budget, forecast] = [await createSheet(origin, holder, team, "Budget"), await createSheet(origin, holder, team, "Forecast")];
    const proposer = await person(origin, "proposer");
    const [drafting, proposing] = [await createFork(origin, proposer, team, "fix-totals"), await createFork(origin, proposer, team, "add-forecast")];
    const draft = await writeThrough(origin, proposer, drafting, budget);
    const proposed = await writeThrough(origin, proposer, proposing, forecast);
    await committed(origin, proposer, proposed.worktree.id, proposed.unit, [setCell(forecast, 1, "proposed")]);
    expect(await transition(origin, proposed.worktree.id, "ready", proposer)).toBe("ready");

    await settings(origin, holder, team, { proposals: "members" });
    expect((await commit(origin, proposer, draft.worktree.id, draft.unit, [setCell(budget, 1, "late")])).status).toBe(403);
    for (const resourceId of [budget.resourceId, forecast.resourceId]) {
      await expectError(send(origin, "POST", `/api/forks/${drafting}/units`, { source: "trunk", resourceId },
        proposer.cookie, { "idempotency-key": randomUUID() }), 403, "FORBIDDEN");
    }
    expect((await send(origin, "POST", `/api/worktrees/${draft.worktree.id}/ready`, undefined, proposer.cookie, { "idempotency-key": randomUUID() })).status).toBe(403);
    expect(await worktreeView(origin, editor, proposed.worktree.id)).toMatchObject({ state: "ready", capabilities: { merge: true } });
    expect(await transition(origin, proposed.worktree.id, "merge", editor)).toBe("merged");
    expect(await trunkText(origin, holder, forecast)).toContain("proposed");

    await settings(origin, holder, team, { proposals: "accountable" });
    await committed(origin, proposer, draft.worktree.id, draft.unit, [setCell(budget, 1, "thawed")]);
    await settings(origin, holder, team, { publicRead: false });
    const refreshed = (await worktreeView(origin, proposer, draft.worktree.id)) as { capabilities: { editDraft: boolean }; units: Unit[] };
    expect(refreshed.capabilities.editDraft).toBe(false);
    expect((await commit(origin, proposer, draft.worktree.id, refreshed.units[0] ?? draft.unit, [setCell(budget, 2, "private")])).status).toBe(403);
    expect(await transition(origin, draft.worktree.id, "discard", proposer)).toBe("discarded");
  }, 90_000);

  it("holds a reader who is not a Space Member to three open proposals, counting only open ones, and leaves members uncapped", async () => {
    const { origin } = await start();
    const { holder, editor, team } = await publicUpstream(origin, "accountable");
    const budget = await createSheet(origin, holder, team, "Budget");
    const proposer = await person(origin, "proposer");
    const forks: string[] = [];
    for (const name of ["one", "two", "three", "four"]) forks.push(await createFork(origin, proposer, team, name));
    const opened: string[] = [];
    for (const fork of forks.slice(0, 3)) opened.push((await writeThrough(origin, proposer, fork, budget)).worktree.id);

    const refused = await expectError(send(origin, "POST", `/api/forks/${forks[3]}/units`, { source: "trunk", resourceId: budget.resourceId },
      proposer.cookie, { "idempotency-key": randomUUID() }), 403, "FORBIDDEN");
    expect(refused.message).toMatch(/at most 3 open proposals/);
    await expectError(send(origin, "POST", "/api/worktrees", { kind: "team", teamSpaceId: team, visibility: "private", name: "direct", summary: null },
      proposer.cookie, { "idempotency-key": randomUUID() }), 403, "FORBIDDEN");
    expect(await forkView(origin, proposer, forks[3]!)).toMatchObject({ state: "clean", worktree: null });

    expect(await transition(origin, opened[0]!, "discard", proposer)).toBe("discarded");
    expect(await writeThrough(origin, proposer, forks[3]!, budget)).toMatchObject({ status: 201 });
    for (let pull = 0; pull < 4; pull += 1) await createPull(origin, editor, team, budget.resourceId);
  }, 120_000);

  it("never lets a reader who is not a Space Member merge, even a proposal without Units", async () => {
    const { origin } = await start();
    const { holder, editor, team } = await publicUpstream(origin, "accountable");
    const proposer = await person(origin, "proposer");
    const open = async (name: string) => {
      const response = await send(origin, "POST", "/api/worktrees", { kind: "team", teamSpaceId: team, visibility: "private", name, summary: null },
        proposer.cookie, { "idempotency-key": randomUUID() });
      expect(response.status).toBe(201);
      return ((await response.json()) as { id: string }).id;
    };
    const [proposed, frozen] = [await open("empty"), await open("frozen")];

    expect(await transition(origin, proposed, "ready", proposer)).toBe("ready");
    expect(await worktreeView(origin, proposer, proposed)).toMatchObject({ state: "ready", capabilities: { merge: false } });
    expect((await send(origin, "POST", `/api/worktrees/${proposed}/merge`, undefined, proposer.cookie, { "idempotency-key": randomUUID() })).status).toBe(403);
    expect(await worktreeView(origin, editor, proposed)).toMatchObject({ state: "ready", capabilities: { merge: true } });

    await settings(origin, holder, team, { proposals: "members" });
    expect(await worktreeView(origin, proposer, frozen)).toMatchObject({ state: "draft", capabilities: { markReady: false, merge: false } });
    expect((await send(origin, "POST", `/api/worktrees/${frozen}/ready`, undefined, proposer.cookie, { "idempotency-key": randomUUID() })).status).toBe(403);
  }, 90_000);

  it("shows a reader's proposal to its author and, once ready, to members, but never to another reader", async () => {
    const { origin } = await start();
    const { holder, editor, team } = await publicUpstream(origin, "accountable");
    const budget = await createSheet(origin, holder, team, "Budget");
    const [author, other] = [await person(origin, "author"), await person(origin, "other")];
    const { worktree, unit } = await writeThrough(origin, author, await createFork(origin, author, team, "fix-totals"), budget);
    await createFork(origin, other, team, "other-fork");
    const listed = async (actor: Actor) => ((await (await send(origin, "GET", `/api/worktrees?scope=all&kind=team&teamSpaceId=${team}`,
      undefined, actor.cookie)).json()) as { items: { id: string }[] }).items.map((item) => item.id);

    expect({ author: await listed(author), holder: await listed(holder), editor: await listed(editor), other: await listed(other) })
      .toEqual({ author: [worktree.id], holder: [worktree.id], editor: [], other: [] });
    expect(await transition(origin, worktree.id, "ready", author)).toBe("ready");
    expect({ editor: await listed(editor), other: await listed(other) }).toEqual({ editor: [worktree.id], other: [] });
    expect((await send(origin, "GET", `/api/worktrees/${worktree.id}`, undefined, other.cookie)).status).toBe(404);
    const comments = await send(origin, "GET", `/universer-api/comment/unit/${unit.unitId}/list`, undefined, author.cookie);
    expect(comments.status).toBe(200);
  }, 90_000);
});

async function publicUpstream(origin: string, proposals: string) {
  const [holder, editor] = await Promise.all([person(origin, "holder"), person(origin, "editor")]);
  const team = await createRepo(origin, holder, "Team");
  expect((await setRole(origin, team, holder, editor.id, "editor")).status).toBe(200);
  await settings(origin, holder, team, { publicRead: true, proposals });
  return { holder, editor, team };
}

async function outsider(origin: string, kind: "person" | "claimed agent" | "unclaimed agent"): Promise<Actor> {
  if (kind === "person") return person(origin, "outsider");
  const agent = await guestAgent(origin);
  if (kind === "claimed agent") await claim(origin, agent, await person(origin, "claimer"));
  return agent;
}

async function settings(origin: string, actor: Actor, spaceId: string, patch: Record<string, unknown>): Promise<unknown> {
  const response = await send(origin, "PATCH", `/api/spaces/${spaceId}`, patch, actor.cookie);
  if (response.status !== 200) throw new Error(`Space update failed with ${response.status}: ${await response.text()}`);
  return response.json();
}

async function spaceView(origin: string, actor: Actor, spaceId: string): Promise<unknown> {
  return (await send(origin, "GET", `/api/spaces/${spaceId}`, undefined, actor.cookie)).json();
}

async function worktreeView(origin: string, actor: Actor, worktreeId: string): Promise<unknown> {
  return ((await (await send(origin, "GET", `/api/worktrees/${worktreeId}`, undefined, actor.cookie)).json()) as { worktree: unknown }).worktree;
}

interface TestDatabase {
  rowCounts(): Promise<Record<string, number>>;
  run(sql: string, values: readonly unknown[]): Promise<void>;
  all(sql: string, values: readonly unknown[]): Promise<unknown[]>;
}

function testDatabase(config: ProductTestApplication["databaseConfig"]): TestDatabase {
  if (config.provider === "sqlite") {
    const open = (filename: string) => new DatabaseSync(filename);
    const counts = (filename: string, prefix: string) => {
      const db = open(filename);
      try {
        return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()
          .map(({ name }) => [`${prefix}${String(name)}`, Number(db.prepare(`SELECT COUNT(*) AS n FROM "${String(name)}"`).get()?.n)]));
      } finally {
        db.close();
      }
    };
    const withProduct = <T>(operation: (db: DatabaseSync) => T) => {
      const db = open(config.filename);
      try {
        return operation(db);
      } finally {
        db.close();
      }
    };
    return {
      async rowCounts() {
        return { ...counts(config.filename, ""), ...counts(config.collaborationFilename, "collaboration.") };
      },
      async run(sql, values) {
        withProduct((db) => db.prepare(sql.replace(/\$\d+/g, "?")).run(...(values as string[])));
      },
      async all(sql, values) {
        return withProduct((db) => db.prepare(sql.replace(/\$\d+/g, "?")).all(...(values as string[])).map((row) => ({ ...row })));
      },
    };
  }
  const connect = async <T>(operation: (client: Client) => Promise<T>) => {
    const client = new Client({ connectionString: config.connectionString });
    await client.connect();
    try {
      return await operation(client);
    } finally {
      await client.end();
    }
  };
  return {
    rowCounts: () => connect(async (client) => {
      const { rows } = await client.query<{ schema: string; name: string }>(`SELECT table_schema AS schema, table_name AS name
        FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema')`);
      const counts: Record<string, number> = {};
      for (const { schema, name } of rows) {
        counts[schema === "public" ? name : `${schema}.${name}`] = Number((await client.query(`SELECT COUNT(*) AS n FROM "${schema}"."${name}"`)).rows[0].n);
      }
      return counts;
    }),
    run: (sql, values) => connect(async (client) => void await client.query(sql, [...values])),
    all: (sql, values) => connect(async (client) => (await client.query(sql, [...values])).rows),
  };
}

function changedCounts(before: Record<string, number>, after: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.keys({ ...before, ...after })
    .filter((table) => (after[table] ?? 0) !== (before[table] ?? 0))
    .map((table) => [table, (after[table] ?? 0) - (before[table] ?? 0)]));
}

async function start() {
  const directory = mkdtempSync(join(tmpdir(), "workspace-forks-"));
  directories.push(directory);
  const application = await createProductTestApplication({
    host: "127.0.0.1",
    port: 0,
    productFilename: join(directory, "product.sqlite"),
    collaborationDatabaseFilename: join(directory, "collaboration.sqlite"),
    secureCookies: false,
    passwordAuthEnabled: true,
    agentCreateLimitPerHour: 100,
  });
  applications.push(application);
  const server = createServer(application.app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not expose a TCP address");
  return { origin: `http://127.0.0.1:${address.port}`, database: testDatabase(application.databaseConfig), application };
}

function send(origin: string, method: string, path: string, body?: unknown, cookie?: string, headers: Record<string, string> = {},
  raw?: string | Buffer | ReadableStream<Uint8Array>): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(raw === undefined ? {} : { body: raw, duplex: "half" }),
  } as RequestInit);
}

async function expectError(request: Promise<Response>, status: number, code: string): Promise<{ message: string }> {
  const response = await request;
  const body = (await response.json()) as { error: { code: string; message: string } };
  expect({ status: response.status, code: body.error.code }).toEqual({ status, code });
  return body.error;
}

async function signedIn(origin: string, response: Response): Promise<Actor> {
  const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
  const { user } = (await (await send(origin, "GET", "/api/session", undefined, cookie)).json()) as { user: { id: string; username: string } };
  return { id: user.id, username: user.username, cookie };
}

async function person(origin: string, username: string): Promise<Actor> {
  const response = await send(origin, "POST", "/api/auth/password/register", { username, displayName: username, password: "correct horse battery staple" });
  if (response.status !== 201) throw new Error(`Registration failed with ${response.status}`);
  return signedIn(origin, response);
}

async function guestAgent(origin: string): Promise<Actor> {
  const response = await send(origin, "POST", "/api/auth/guest", {});
  if (response.status !== 201) throw new Error(`Guest creation failed with ${response.status}`);
  return signedIn(origin, response);
}

async function claim(origin: string, agent: Actor, human: Actor): Promise<void> {
  const { code } = (await (await send(origin, "POST", "/api/agents/claim-codes", undefined, agent.cookie)).json()) as { code: string };
  const response = await send(origin, "POST", "/api/agents/claim", { code }, human.cookie);
  if (response.status !== 200) throw new Error(`Claim failed with ${response.status}`);
}

async function personalSpace(origin: string, actor: Actor): Promise<string> {
  const { spaces } = (await (await send(origin, "GET", "/api/spaces", undefined, actor.cookie)).json()) as { spaces: { id: string; type: string }[] };
  return spaces.find((space) => space.type === "personal")!.id;
}

async function createRepo(origin: string, actor: Actor, name: string): Promise<string> {
  const response = await send(origin, "POST", "/api/team-spaces", { name }, actor.cookie);
  if (response.status !== 201) throw new Error(`Team Space creation failed with ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { id: string }).id;
}

function setRole(origin: string, spaceId: string, actor: Actor, userId: string, role: string): Promise<Response> {
  return send(origin, "PUT", `/api/team-spaces/${spaceId}/members/${userId}`, { role }, actor.cookie);
}

interface Sheet {
  readonly resourceId: string;
  readonly unitId: string;
  readonly sheetId: string;
}

async function createSheet(origin: string, actor: Actor, spaceId: string, name: string): Promise<Sheet> {
  const { data } = blankUnitData({ unitId: randomUUID(), unitType: "sheet", name }) as { data: { sheetOrder: string[] } };
  const sheetId = data.sheetOrder[0]!;
  const response = await send(origin, "POST", "/api/resources", { kind: "univer", spaceId, parentNodeId: null, name, unitType: "sheet", initialData: data },
    actor.cookie, { "idempotency-key": randomUUID() });
  if (response.status !== 201) throw new Error(`File creation failed with ${response.status}: ${await response.text()}`);
  const { id, unitId } = ((await response.json()) as { node: { resource: { id: string; unitId: string } } }).node.resource;
  return { resourceId: id, unitId, sheetId };
}

async function createFork(origin: string, actor: Actor, upstreamSpaceId: string, name: string): Promise<string> {
  const response = await send(origin, "POST", "/api/forks", { upstreamSpaceId, name }, actor.cookie);
  if (response.status !== 201) throw new Error(`Fork creation failed with ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { id: string }).id;
}

async function forkIds(origin: string, actor: Actor): Promise<string[]> {
  const { forks } = (await (await send(origin, "GET", "/api/forks", undefined, actor.cookie)).json()) as { forks: { id: string }[] };
  return forks.map((fork) => fork.id);
}

async function createPull(origin: string, actor: Actor, spaceId: string, resourceId: string): Promise<string> {
  const created = await send(origin, "POST", "/api/worktrees", { kind: "team", teamSpaceId: spaceId, visibility: "private", name: "fix-totals", summary: null },
    actor.cookie, { "idempotency-key": randomUUID() });
  if (created.status !== 201) throw new Error(`Pull request creation failed with ${created.status}: ${await created.text()}`);
  const { id } = (await created.json()) as { id: string };
  const unit = await send(origin, "POST", `/api/worktrees/${id}/units`, { source: "trunk", resourceId }, actor.cookie, { "idempotency-key": randomUUID() });
  if (unit.status !== 201) throw new Error(`Adding a Unit failed with ${unit.status}: ${await unit.text()}`);
  return id;
}

async function transition(origin: string, worktreeId: string, action: "ready" | "reopen" | "merge" | "discard", actor: Actor): Promise<string> {
  const response = await send(origin, "POST", `/api/worktrees/${worktreeId}/${action}`, undefined, actor.cookie, { "idempotency-key": randomUUID() });
  if (response.status !== 200) throw new Error(`${action} failed with ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { worktree: { state: string } }).worktree.state;
}

interface Unit {
  readonly unitId: string;
  readonly resourceId: string;
  readonly draftHeadRevision: number;
  readonly mergeResult: string;
}

async function upstream(origin: string) {
  const [holder, agent, editor] = await Promise.all([person(origin, "holder"), person(origin, "agent"), person(origin, "editor")]);
  const team = await createRepo(origin, holder, "Team");
  expect((await setRole(origin, team, holder, agent.id, "viewer")).status).toBe(200);
  expect((await setRole(origin, team, holder, editor.id, "editor")).status).toBe(200);
  return { holder, agent, editor, team };
}

async function writeThrough(origin: string, actor: Actor, forkId: string, sheet: Sheet, key = randomUUID()) {
  const response = await send(origin, "POST", `/api/forks/${forkId}/units`, { source: "trunk", resourceId: sheet.resourceId }, actor.cookie, { "idempotency-key": key });
  if (response.status !== 200 && response.status !== 201) throw new Error(`Fork write failed with ${response.status}: ${await response.text()}`);
  return { status: response.status, ...((await response.json()) as { worktree: { id: string; state: string }; unit: Unit }) };
}

const html = (title: string) => `<!doctype html><html><head><title>${title}</title></head><body>${title}</body></html>`;

async function publishedPage(origin: string, actor: Actor, spaceId: string, title: string): Promise<{ resourceId: string; etag: string }> {
  const created = await send(origin, "POST", "/api/html-view-drafts", { kind: "create", spaceId, name: "Page", html: html(title) }, actor.cookie, { "idempotency-key": randomUUID() });
  if (created.status !== 201) throw new Error(`Draft creation failed with ${created.status}: ${await created.text()}`);
  const { draft } = (await created.json()) as { draft: { id: string } };
  const published = await send(origin, "POST", `/api/html-view-drafts/${draft.id}/publish`, undefined, actor.cookie);
  if (published.status !== 200) throw new Error(`Publish failed with ${published.status}: ${await published.text()}`);
  const { resourceId, etag } = ((await published.json()) as { draft: { published: { resourceId: string; etag: string } } }).draft.published;
  return { resourceId, etag };
}

interface StoredFile {
  readonly resourceId: string;
  readonly etag: string;
}

async function uploadedFile(origin: string, actor: Actor, spaceId: string, name: string, text: string): Promise<StoredFile> {
  const bytes = Buffer.from(text);
  const reserved = await send(origin, "POST", "/api/blob-upload-sessions", { spaceId, parentNodeId: null, name, originalFilename: name, byteSize: bytes.length },
    actor.cookie, { "idempotency-key": randomUUID() });
  if (reserved.status !== 201) throw new Error(`Upload reservation failed with ${reserved.status}: ${await reserved.text()}`);
  const { upload } = (await reserved.json()) as { upload: { id: string; resourceId: string } };
  const put = await send(origin, "PUT", `/api/blob-upload-sessions/${upload.id}/content`, undefined, actor.cookie, { "content-type": "application/octet-stream" }, bytes);
  if (put.status !== 204) throw new Error(`Upload failed with ${put.status}: ${await put.text()}`);
  const completed = await send(origin, "POST", `/api/blob-upload-sessions/${upload.id}/complete`, undefined, actor.cookie);
  if (completed.status !== 201) throw new Error(`Upload completion failed with ${completed.status}: ${await completed.text()}`);
  return { resourceId: upload.resourceId, etag: (await fileBytes(origin, actor, upload)).etag };
}

async function fileBytes(origin: string, reader: Actor, file: { readonly resourceId: string }): Promise<{ body: string; etag: string }> {
  const response = await send(origin, "GET", `/api/blob-resources/${file.resourceId}/content`, undefined, reader.cookie);
  if (response.status !== 200) throw new Error(`File read failed with ${response.status}`);
  return { body: await response.text(), etag: response.headers.get("etag")! };
}

function replaceRequest(origin: string, actor: Actor, forkId: string, file: StoredFile, text: string, key = randomUUID()): Promise<Response> {
  return send(origin, "PUT", `/api/forks/${forkId}/blob-resources/${file.resourceId}/content`, undefined, actor.cookie,
    { "idempotency-key": key, "if-match": file.etag, "content-type": "application/octet-stream" }, text);
}

async function replaceThrough(origin: string, actor: Actor, forkId: string, file: StoredFile, text: string, key = randomUUID()) {
  const response = await replaceRequest(origin, actor, forkId, file, text, key);
  if (response.status !== 200 && response.status !== 201) throw new Error(`Fork file write failed with ${response.status}: ${await response.text()}`);
  return { status: response.status, ...((await response.json()) as { worktree: { id: string }; draft: { id: string } }) };
}

/** The same person through a personal access token, as an MCP connection holds it. */
async function patSession(origin: string, application: ProductTestApplication, actor: Actor): Promise<Actor> {
  const created = await send(origin, "POST", "/api/auth/tokens", { name: "agent" }, actor.cookie);
  if (created.status !== 201) throw new Error(`Token creation failed with ${created.status}: ${await created.text()}`);
  const { record } = (await created.json()) as { record: { id: string } };
  const { user } = await application.identity.requireSession(actor.cookie);
  const issued = await application.identity.issueSession(user, "agent", { issuedFor: { kind: "pat", id: record.id } });
  return { ...actor, cookie: `${application.identity.cookieName}=${issued.cookieValue}` };
}

async function forkView(origin: string, actor: Actor, forkId: string): Promise<unknown> {
  return (await send(origin, "GET", `/api/forks/${forkId}`, undefined, actor.cookie)).json();
}

async function worktreeDetail(origin: string, actor: Actor, worktreeId: string): Promise<{ units: Unit[] }> {
  return ((await (await send(origin, "GET", `/api/worktrees/${worktreeId}`, undefined, actor.cookie)).json()) as { worktree: { units: Unit[] } }).worktree;
}

const setCell = (sheet: Sheet, row: number, value: string) => ({
  id: "sheet.mutation.set-range-values",
  data: JSON.stringify({ unitId: sheet.unitId, subUnitId: sheet.sheetId, cellValue: { [row]: { 1: { v: value } } } }),
});

const removeRow = (sheet: Sheet, row: number) => ({
  id: "sheet.mutation.remove-rows",
  data: JSON.stringify({ unitId: sheet.unitId, subUnitId: sheet.sheetId, range: { startRow: row, endRow: row, startColumn: 0, endColumn: 4 } }),
});

function commit(origin: string, actor: Actor, worktreeId: string, unit: Unit, mutations: readonly { id: string; data: string }[]): Promise<Response> {
  return send(origin, "POST", `/api/worktrees/${worktreeId}/units/${unit.unitId}/changesets`, {
    changeset: { unitID: unit.unitId, type: UniverType.UNIVER_SHEET, baseRev: unit.draftHeadRevision, revision: unit.draftHeadRevision + 1, sid: randomUUID(), reqId: 1, mutations },
  }, actor.cookie);
}

async function committed(...args: Parameters<typeof commit>): Promise<void> {
  const response = await commit(...args);
  expect({ status: response.status, body: await response.json() }).toMatchObject({ status: 200, body: { status: "committed" } });
}

async function changeTrunk(origin: string, actor: Actor, spaceId: string, sheet: Sheet, mutation: { id: string; data: string }): Promise<void> {
  const worktreeId = await createPull(origin, actor, spaceId, sheet.resourceId);
  await committed(origin, actor, worktreeId, (await worktreeDetail(origin, actor, worktreeId)).units[0]!, [mutation]);
  expect(await transition(origin, worktreeId, "ready", actor)).toBe("ready");
  expect(await transition(origin, worktreeId, "merge", actor)).toBe("merged");
}

async function trunkText(origin: string, actor: Actor, sheet: Sheet): Promise<string> {
  const response = await send(origin, "GET", `/universer-api/snapshot/${UniverType.UNIVER_SHEET}/unit/${sheet.unitId}/rev/0`, undefined, actor.cookie);
  if (response.status !== 200) throw new Error(`Trunk read failed with ${response.status}`);
  return response.text();
}
