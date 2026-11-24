import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { UniverType } from "@univerjs/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorktreeBackend } from "../../server/src/modules/worktrees/index.js";
import { createProductTestApplication, type ProductTestApplication } from "../support/product-test-application.js";

const applications: ProductTestApplication[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(applications.splice(0).map((application) => application.close()));
});

describe("who takes a pull request to trunk", () => {
  it("is its author or the person who claimed the authoring agent, and for a pull request shared with the Team Space any member who can edit", async () => {
    const { origin, application } = await start();
    const [owner, admin, author, editor, viewer, outsider, claimer, teamClaimer] = await Promise.all(
      ["owner", "admin", "author", "editor", "viewer", "outsider", "claimer", "team-claimer"].map((name) => person(origin, name)),
    );
    const team = await application.spaces.createTeamSpace(owner.id, { name: "Budget" });
    for (const [member, role] of [[admin, "admin"], [author, "editor"], [editor, "editor"], [viewer, "viewer"], [teamClaimer, "editor"]] as const) {
      await application.permissions.upsertTeamMember(owner.id, team.id, member.id, { role });
    }
    const teamAgent = await guestAgent(origin);
    await claim(origin, teamAgent, teamClaimer);
    await application.permissions.upsertTeamMember(owner.id, team.id, teamAgent.id, { role: "editor" });
    const userAgent = await guestAgent(origin);
    await claim(origin, userAgent, claimer);

    const teamPull = await createPull(origin, author, { kind: "team", teamSpaceId: team.id, visibility: "space" }, team.id);
    const privatePull = await createPull(origin, author, { kind: "team", teamSpaceId: team.id, visibility: "private" }, team.id);
    const agentTeamPull = await createPull(origin, teamAgent, { kind: "team", teamSpaceId: team.id, visibility: "space" }, team.id);
    const userPull = await createPull(origin, userAgent, { kind: "user" }, userAgent.spaceId);
    const pulls = [
      { name: "team", id: teamPull, author, others: { "team owner": owner, "team admin": admin, "team editor": editor, "team viewer": viewer, outsider } },
      { name: "private team", id: privatePull, author, others: { "team owner": owner, "team admin": admin, "team editor": editor } },
      { name: "agent's team", id: agentTeamPull, author: teamAgent, others: { "agent owner": teamClaimer } },
      { name: "agent's user", id: userPull, author: userAgent, others: { "agent owner": claimer, outsider } },
    ];
    const matrix: Record<string, string> = {};
    for (const state of ["draft", "ready"] as const) {
      for (const pull of pulls) {
        if (state === "ready") await transition(origin, pull.id, "ready", pull.author);
        for (const [relation, actor] of Object.entries({ author: pull.author, ...pull.others })) {
          matrix[`${pull.name} ${state}: ${relation}`] = await granted(origin, pull.id, actor);
        }
      }
    }
    expect(matrix).toEqual({
      "team draft: author": "review editDraft addUnit changeVisibility markReady discard",
      "team draft: team owner": "review changeVisibility markReady discard",
      "team draft: team admin": "review changeVisibility markReady discard",
      "team draft: team editor": "review markReady",
      "team draft: team viewer": "review",
      "team draft: outsider": "not found",
      "private team draft: author": "review editDraft addUnit changeVisibility markReady discard",
      "private team draft: team owner": "changeVisibility discard",
      "private team draft: team admin": "changeVisibility discard",
      "private team draft: team editor": "not found",
      "agent's team draft: author": "review editDraft addUnit changeVisibility markReady discard",
      "agent's team draft: agent owner": "review markReady discard",
      "agent's user draft: author": "review editDraft addUnit markReady discard",
      "agent's user draft: agent owner": "review markReady discard",
      "agent's user draft: outsider": "not found",
      "team ready: author": "review changeVisibility reopen merge discard",
      "team ready: team owner": "review changeVisibility reopen merge discard",
      "team ready: team admin": "review changeVisibility reopen merge discard",
      "team ready: team editor": "review merge",
      "team ready: team viewer": "review",
      "team ready: outsider": "not found",
      "private team ready: author": "review changeVisibility reopen merge discard",
      "private team ready: team owner": "changeVisibility reopen discard",
      "private team ready: team admin": "changeVisibility reopen discard",
      "private team ready: team editor": "not found",
      "agent's team ready: author": "review changeVisibility reopen merge discard",
      "agent's team ready: agent owner": "review reopen merge discard",
      "agent's user ready: author": "review reopen merge discard",
      "agent's user ready: agent owner": "review reopen merge discard",
      "agent's user ready: outsider": "not found",
    });

    for (const refused of [owner, admin]) {
      const response = await send(origin, "POST", `/api/worktrees/${privatePull}/merge`, undefined, refused.cookie, { "idempotency-key": randomUUID() });
      expect({ status: response.status, body: await response.json() }).toEqual({
        status: 403,
        body: { error: { code: "FORBIDDEN", message: "Only the author, author (@author), can merge this pull request." } },
      });
    }
    expect(await mergeAs(origin, teamPull, viewer, randomUUID())).toEqual({
      status: 403,
      message: "You cannot merge this pull request without edit access to every file and folder it changes.",
    });
    for (const hidden of [[privatePull, editor], [teamPull, outsider]] as const) {
      expect((await mergeAs(origin, hidden[0], hidden[1], randomUUID())).status).toBe(404);
    }
    expect(await transition(origin, teamPull, "merge", editor)).toBe("merged");
    expect(await mergedBy(origin, team.id, teamPull, owner)).toBe("editor");
    expect(await transition(origin, privatePull, "merge", author)).toBe("merged");
    expect(await transition(origin, agentTeamPull, "merge", teamClaimer)).toBe("merged");
    expect(await transition(origin, userPull, "merge", claimer)).toBe("merged");

    const unclaimed = await guestAgent(origin);
    const own = await createPull(origin, unclaimed, { kind: "user" }, unclaimed.spaceId);
    await transition(origin, own, "ready", unclaimed);
    expect(await transition(origin, own, "merge", unclaimed)).toBe("merged");
  }, 30_000);

  it("names the agent's owner when refusing, tells an owner without edit access why, and lists the pull request to that owner", async () => {
    const { origin, application } = await start();
    const [owner, claimer] = await Promise.all(["owner", "claimer"].map((name) => person(origin, name)));
    const team = await application.spaces.createTeamSpace(owner.id, { name: "Budget" });
    const agent = await guestAgent(origin);
    await claim(origin, agent, claimer);
    await application.permissions.upsertTeamMember(owner.id, team.id, agent.id, { role: "editor" });
    const pull = await createPull(origin, agent, { kind: "team", teamSpaceId: team.id, visibility: "private" }, team.id);
    await transition(origin, pull, "ready", agent);

    const listed = (await (await send(origin, "GET", "/api/worktrees?scope=all", undefined, claimer.cookie)).json()) as { items: { id: string }[] };
    expect(listed.items.map((item) => item.id)).toEqual([pull]);
    expect(await mergeAs(origin, pull, owner, randomUUID())).toEqual({
      status: 403,
      message: `Only the author, ${agent.displayName} (@${agent.username}), or claimer (@claimer) who claimed it, can merge this pull request.`,
    });
    expect(await mergeAs(origin, pull, claimer, randomUUID())).toEqual({
      status: 403,
      message: "You cannot merge this pull request without edit access to every file and folder it changes.",
    });
  }, 30_000);

  it("names the person who claimed an agent author to whoever can see the pull request, and to nobody else", async () => {
    const { origin, application } = await start();
    const [owner, member, claimer, outsider] = await Promise.all(["owner", "member", "claimer", "outsider"].map((name) => person(origin, name)));
    const team = await application.spaces.createTeamSpace(owner.id, { name: "Budget" });
    await application.permissions.upsertTeamMember(owner.id, team.id, member.id, { role: "editor" });
    const agent = await guestAgent(origin);
    await claim(origin, agent, claimer);
    await application.permissions.upsertTeamMember(owner.id, team.id, agent.id, { role: "editor" });
    const unclaimed = await guestAgent(origin);
    const agentPull = await createPull(origin, agent, { kind: "team", teamSpaceId: team.id, visibility: "space" }, team.id);
    const personPull = await createPull(origin, member, { kind: "team", teamSpaceId: team.id, visibility: "space" }, team.id);
    const unclaimedPull = await createPull(origin, unclaimed, { kind: "user" }, unclaimed.spaceId);
    const claimerSeen = async (worktreeId: string, viewer: Actor) => {
      const response = await send(origin, "GET", `/api/worktrees/${worktreeId}`, undefined, viewer.cookie);
      const body = await response.text();
      if (response.status !== 200) return { status: response.status, namesClaimer: body.includes("claimer") };
      return (JSON.parse(body) as { worktree: { claimer: { id: string; username: string; displayName: string } | null } }).worktree.claimer;
    };
    const named = { id: claimer.id, username: "claimer", displayName: "claimer", avatarUrl: null };
    expect({
      "claimed agent's pull, seen by a Space member": await claimerSeen(agentPull, member),
      "claimed agent's pull, seen by the claimer": await claimerSeen(agentPull, claimer),
      "claimed agent's pull, seen by the agent": await claimerSeen(agentPull, agent),
      "claimed agent's pull, asked for by an outsider": await claimerSeen(agentPull, outsider),
      "person's pull, seen by the Space owner": await claimerSeen(personPull, owner),
      "unclaimed agent's pull, seen by the agent": await claimerSeen(unclaimedPull, unclaimed),
    }).toEqual({
      "claimed agent's pull, seen by a Space member": named,
      "claimed agent's pull, seen by the claimer": named,
      "claimed agent's pull, seen by the agent": named,
      "claimed agent's pull, asked for by an outsider": { status: 404, namesClaimer: false },
      "person's pull, seen by the Space owner": null,
      "unclaimed agent's pull, seen by the agent": null,
    });
    const listed = (await (await send(origin, "GET", "/api/worktrees?scope=all", undefined, member.cookie)).json()) as {
      items: { id: string; claimer: { username: string } | null }[];
    };
    expect(Object.fromEntries(listed.items.map((item) => [item.id, item.claimer?.username ?? null])))
      .toEqual({ [agentPull]: "claimer", [personPull]: null });
  }, 30_000);
});

describe("finishing a merge that a Team Admin started on a pull request they may not merge", () => {
  it.each(["merging", "merged"] as const)(
    "lets the author, the agent's owner and the Admin who started it finish a %s pull request, and nobody else",
    async (stage) => {
      const stopped = stoppedBackend();
      const { origin, application, repositories } = await start(stopped.backend);
      const [owner, admin, author, claimer] = await Promise.all(["owner", "admin", "author", "claimer"].map((name) => person(origin, name)));
      const team = await application.spaces.createTeamSpace(owner.id, { name: "Budget" });
      await application.permissions.upsertTeamMember(owner.id, team.id, admin.id, { role: "admin" });
      await application.permissions.upsertTeamMember(owner.id, team.id, author.id, { role: "editor" });
      await application.permissions.upsertTeamMember(owner.id, team.id, claimer.id, { role: "editor" });
      const agent = await guestAgent(origin);
      await repositories.permissions.upsertMember({ spaceId: team.id, userId: agent.id, role: "editor", grantedBy: owner.id, now: Date.now() });
      await claim(origin, agent, claimer);
      const startedByAdmin = async (creator: Actor) => {
        const id = await createPull(origin, creator, { kind: "team", teamSpaceId: team.id, visibility: "private" }, team.id);
        await transition(origin, id, "ready", creator);
        const operationId = randomUUID();
        await repositories.worktrees.reserveOperation({ id: operationId, kind: "merge_worktree", actorUserId: admin.id, payload: { worktreeId: id }, createdAt: Date.now() });
        stopped.stop(id, stage);
        return { id, operationId };
      };
      const finished = { state: "merged", files: ["completed"] };

      const refused = await startedByAdmin(author);
      for (const actor of [owner, admin]) {
        expect(await mergeAs(origin, refused.id, actor, randomUUID())).toEqual({
          status: 403,
          message: "Only the author, author (@author), can merge this pull request.",
        });
      }
      expect(await outcome(origin, refused.id, author)).toEqual({ state: stage, files: [stage === "merged" ? "pending" : "waitingForMerge"] });

      const byAuthor = await startedByAdmin(author);
      expect((await mergeAs(origin, byAuthor.id, author, randomUUID())).status).toBe(200);
      expect(await outcome(origin, byAuthor.id, author)).toEqual(finished);

      const byClaimer = await startedByAdmin(agent);
      expect((await mergeAs(origin, byClaimer.id, claimer, randomUUID())).status).toBe(200);
      expect(await outcome(origin, byClaimer.id, agent)).toEqual(finished);

      const byStarter = await startedByAdmin(author);
      expect((await mergeAs(origin, byStarter.id, admin, byStarter.operationId)).status).toBe(200);
      expect(await outcome(origin, byStarter.id, author)).toEqual(finished);

      const byRetry = await startedByAdmin(author);
      await repositories.worktrees.failOperation(byRetry.operationId, { code: "INTERNAL_ERROR", message: "Interrupted" }, Date.now());
      const retried = await send(origin, "POST", `/api/operations/${byRetry.operationId}/retry`, undefined, admin.cookie);
      expect({ status: retried.status, state: ((await retried.json()) as { state: string }).state }).toEqual({ status: 202, state: "completed" });
      expect(await outcome(origin, byRetry.id, author)).toEqual(finished);
    },
    30_000,
  );

  it("does not let the Admin begin a merge that never reached the collaboration service", async () => {
    const { origin, application, repositories } = await start(stoppedBackend().backend);
    const [owner, admin, author] = await Promise.all(["owner", "admin", "author"].map((name) => person(origin, name)));
    const team = await application.spaces.createTeamSpace(owner.id, { name: "Budget" });
    await application.permissions.upsertTeamMember(owner.id, team.id, admin.id, { role: "admin" });
    await application.permissions.upsertTeamMember(owner.id, team.id, author.id, { role: "editor" });
    const pull = await createPull(origin, author, { kind: "team", teamSpaceId: team.id, visibility: "private" }, team.id);
    await transition(origin, pull, "ready", author);
    const operationId = randomUUID();
    await repositories.worktrees.reserveOperation({ id: operationId, kind: "merge_worktree", actorUserId: admin.id, payload: { worktreeId: pull }, createdAt: Date.now() });

    expect(await mergeAs(origin, pull, admin, operationId)).toEqual({
      status: 403,
      message: "Only the author, author (@author), can merge this pull request.",
    });
    expect(await outcome(origin, pull, author)).toEqual({ state: "ready", files: ["waitingForMerge"] });
    expect((await mergeAs(origin, pull, author, randomUUID())).status).toBe(200);
  }, 30_000);

  it("keeps whoever merged as the merger when an earlier Operation arrives after the merge", async () => {
    const { origin, application, repositories } = await start(stoppedBackend().backend);
    const [owner, admin, author, claimer] = await Promise.all(["owner", "admin", "author", "claimer"].map((name) => person(origin, name)));
    const team = await application.spaces.createTeamSpace(owner.id, { name: "Budget" });
    await application.permissions.upsertTeamMember(owner.id, team.id, admin.id, { role: "admin" });
    await application.permissions.upsertTeamMember(owner.id, team.id, author.id, { role: "editor" });
    const agent = await guestAgent(origin);
    await claim(origin, agent, claimer);
    const earlier = async (pull: string, actor: Actor, state: "pending" | "failed") => {
      const id = randomUUID();
      await repositories.worktrees.reserveOperation({ id, kind: "merge_worktree", actorUserId: actor.id, payload: { worktreeId: pull }, createdAt: Date.now() });
      if (state === "failed") await repositories.worktrees.failOperation(id, { code: "INTERNAL_ERROR", message: "Interrupted" }, Date.now());
      return id;
    };
    const retry = async (operationId: string, actor: Actor) => {
      const response = await send(origin, "POST", `/api/operations/${operationId}/retry`, undefined, actor.cookie);
      return { status: response.status, message: ((await response.json()) as { error?: { message: string } }).error?.message };
    };

    const teamPull = await createPull(origin, author, { kind: "team", teamSpaceId: team.id, visibility: "space" }, team.id);
    await transition(origin, teamPull, "ready", author);
    const [adminPending, adminFailed] = [await earlier(teamPull, admin, "pending"), await earlier(teamPull, admin, "failed")];
    expect(await transition(origin, teamPull, "merge", author)).toBe("merged");
    const alreadyMerged = { status: 403, message: "This Worktree action is not allowed." };
    expect(await mergeAs(origin, teamPull, admin, adminPending)).toEqual(alreadyMerged);
    expect(await retry(adminFailed, admin)).toEqual(alreadyMerged);
    expect(await mergedBy(origin, team.id, teamPull, owner)).toBe("author");

    const agentPull = await createPull(origin, agent, { kind: "user" }, agent.spaceId);
    await transition(origin, agentPull, "ready", agent);
    const [claimerPending, claimerFailed] = [await earlier(agentPull, claimer, "pending"), await earlier(agentPull, claimer, "failed")];
    expect(await transition(origin, agentPull, "merge", agent)).toBe("merged");
    expect(await mergeAs(origin, agentPull, claimer, claimerPending)).toEqual(alreadyMerged);
    expect(await retry(claimerFailed, claimer)).toEqual(alreadyMerged);
    expect(await mergedBy(origin, agent.spaceId, agentPull, claimer)).toBe(agent.username);
  }, 30_000);

  it("records the merger whose Operation stopped after the merge applied, when they send it again", async () => {
    const { origin, application, repositories } = await start(stoppedBackend().backend);
    const [owner, author] = await Promise.all(["owner", "author"].map((name) => person(origin, name)));
    const team = await application.spaces.createTeamSpace(owner.id, { name: "Budget" });
    await application.permissions.upsertTeamMember(owner.id, team.id, author.id, { role: "editor" });
    const pull = await createPull(origin, author, { kind: "team", teamSpaceId: team.id, visibility: "space" }, team.id);
    await transition(origin, pull, "ready", author);
    const operationId = randomUUID();
    const complete = vi.spyOn(repositories.worktrees, "completeOperation").mockRejectedValueOnce(new Error("Connection lost"));
    expect((await mergeAs(origin, pull, author, operationId)).status).toBe(500);
    complete.mockRestore();
    expect(await mergedBy(origin, team.id, pull, owner)).toBeNull();

    expect(await mergeAs(origin, pull, author, operationId)).toEqual({ status: 200 });
    expect(await outcome(origin, pull, author)).toEqual({ state: "merged", files: ["completed"] });
    expect(await mergedBy(origin, team.id, pull, owner)).toBe("author");
  }, 30_000);

  it.each(["ready", "merging", "merged"] as const)(
    "tells a Team author who lost edit access why they cannot merge a %s pull request, with any key",
    async (stage) => {
      const stopped = stoppedBackend();
      const { origin, application, repositories } = await start(stopped.backend);
      const [owner, author] = await Promise.all(["owner", "author"].map((name) => person(origin, name)));
      const team = await application.spaces.createTeamSpace(owner.id, { name: "Budget" });
      await application.permissions.upsertTeamMember(owner.id, team.id, author.id, { role: "editor" });
      const pull = await createPull(origin, author, { kind: "team", teamSpaceId: team.id, visibility: "space" }, team.id);
      await transition(origin, pull, "ready", author);
      const own = randomUUID();
      await repositories.worktrees.reserveOperation({ id: own, kind: "merge_worktree", actorUserId: author.id, payload: { worktreeId: pull }, createdAt: Date.now() });
      if (stage !== "ready") stopped.stop(pull, stage);
      await application.permissions.upsertTeamMember(owner.id, team.id, author.id, { role: "viewer" });

      for (const key of [own, randomUUID()]) {
        expect(await mergeAs(origin, pull, author, key)).toEqual({
          status: 403,
          message: "You cannot merge this pull request without edit access to every file and folder it changes.",
        });
      }
      expect(await outcome(origin, pull, author)).toEqual({ state: stage, files: [stage === "merged" ? "pending" : "waitingForMerge"] });
    },
    30_000,
  );
});

describe("a proposal from a member who can only read the Team Space", () => {
  it("lets a viewer propose alone, leaves Trunk as it was, and lands when an editor merges it", async () => {
    const { origin, application } = await start();
    const s = await budgetSpace(origin, application);
    const { owner, editor, viewer } = s;

    const pull = await openPull(origin, viewer, s.id, "private");
    const budget = await addFile(origin, viewer, pull, { source: "trunk", resourceId: s.budget.resourceId });
    const forecast = await addFile(origin, viewer, pull, newSheet(s.id));
    for (const unit of [budget, forecast]) {
      expect(await writeDraft(origin, viewer, pull, unit.unitId, await sheetIn(origin, viewer, pull, unit.unitId), "proposed")).toBe("committed");
    }
    const ready = await post(origin, viewer, `/api/worktrees/${pull}/ready`);
    expect({ status: ready.status, ...((await ready.json()) as { worktree: object }).worktree }).toMatchObject({
      status: 200, state: "ready", visibility: "space", capabilities: { merge: false },
    });
    expect(await mergeAs(origin, pull, viewer, randomUUID())).toEqual({
      status: 403,
      message: "You cannot merge this pull request without edit access to every file and folder it changes.",
    });
    expect(await sheetIn(origin, viewer, pull, budget.unitId)).toMatchObject({
      draft: "proposed", trunk: null, trunkRevision: budget.draftHeadRevision,
    });
    expect(await filesIn(origin, editor, s.id)).toEqual(["Budget"]);

    const listed = (await (await send(origin, "GET", `/api/worktrees?scope=all&teamSpaceId=${s.id}`, undefined, editor.cookie)).json()) as {
      items: { id: string; state: string; creator: { username: string }; capabilities: { merge: boolean } }[];
    };
    expect(listed.items.map((item) => ({ id: item.id, state: item.state, author: item.creator.username, merge: item.capabilities.merge })))
      .toEqual([{ id: pull, state: "ready", author: "viewer", merge: true }]);
    expect(await transition(origin, pull, "merge", editor)).toBe("merged");
    expect(await mergedBy(origin, s.id, pull, owner)).toBe("editor");
    expect(await filesIn(origin, editor, s.id)).toEqual(["Budget", "Forecast"]);
    expect(await trunkA1(origin, owner, s.id, s.budget.resourceId)).toBe("proposed");
    expect(await trunkA1(origin, owner, s.id, forecast.resourceId)).toBe("proposed");
    // Creating the file gave its proposer nothing beyond the role they already had.
    expect((await post(origin, viewer, `/api/nodes/${forecast.nodeId}/trash`)).status).toBe(403);
  }, 30_000);

  it("refuses every direct write to Trunk from a viewer whose proposal is open", async () => {
    const { origin, application } = await start();
    const s = await budgetSpace(origin, application);
    const { viewer } = s;
    const pull = await openPull(origin, viewer, s.id, "private");
    const budget = await addFile(origin, viewer, pull, { source: "trunk", resourceId: s.budget.resourceId });
    expect(await writeDraft(origin, viewer, pull, budget.unitId, await sheetIn(origin, viewer, pull, budget.unitId), "proposed")).toBe("committed");
    const status = async (response: Promise<Response>) => (await response).status;
    const inSpace = { spaceId: s.id, parentNodeId: null };

    expect({
      "create a file": await status(post(origin, viewer, "/api/resources", { ...inSpace, kind: "univer", name: "Mine", unitType: "sheet" })),
      "create a folder": await status(post(origin, viewer, "/api/nodes", { ...inSpace, name: "Mine" })),
      "rename a file": await status(send(origin, "PATCH", `/api/nodes/${s.budget.nodeId}`, { name: "Mine" }, viewer.cookie)),
      "trash a file": await status(post(origin, viewer, `/api/nodes/${s.budget.nodeId}/trash`)),
      "upload a file": await status(post(origin, viewer, "/api/blob-upload-sessions", { ...inSpace, name: "notes.txt", originalFilename: "notes.txt", byteSize: 5 })),
      "protect a range": await status(post(origin, viewer, "/universer-api/authz/3/object", {
        objectType: 3, selectRangeObject: { unitID: s.budget.unitId, name: "A1", collaborators: [], scope: { read: 1, edit: 2 } },
      })),
      "remove a file through the pull request": await status(post(origin, viewer, `/api/worktrees/${pull}/units/${budget.unitId}/removal`, { removed: true })),
      "merge the draft pull request": await status(post(origin, viewer, `/api/worktrees/${pull}/merge`)),
      "merge the ready pull request": await status(post(origin, viewer, `/api/worktrees/${pull}/ready`).then(() => post(origin, viewer, `/api/worktrees/${pull}/merge`))),
    }).toEqual({
      "create a file": 403,
      "create a folder": 403,
      "rename a file": 403,
      "trash a file": 403,
      "upload a file": 403,
      "protect a range": 403,
      "remove a file through the pull request": 403,
      "merge the draft pull request": 403,
      "merge the ready pull request": 403,
    });
    expect(await sheetIn(origin, viewer, pull, budget.unitId)).toMatchObject({ trunk: null, trunkRevision: budget.draftHeadRevision });
    expect(await filesIn(origin, viewer, s.id)).toEqual(["Budget"]);
  }, 30_000);

  it("shows the proposal and its files to nobody outside the Team Space", async () => {
    const { origin, application } = await start();
    const s = await budgetSpace(origin, application);
    const { viewer, outsider } = s;
    const pull = await openPull(origin, viewer, s.id, "private");
    const budget = await addFile(origin, viewer, pull, { source: "trunk", resourceId: s.budget.resourceId });
    const forecast = await addFile(origin, viewer, pull, newSheet(s.id));
    await transition(origin, pull, "ready", viewer);
    const get = async (path: string) => (await send(origin, "GET", path, undefined, outsider.cookie)).status;
    const open = async (unit: Unit) => (await post(origin, outsider, `/api/worktrees/${pull}/units/${unit.unitId}/open`, { mode: "draft" })).status;
    const sheet = UniverType.UNIVER_SHEET;

    expect({
      "pull requests listed": ((await (await send(origin, "GET", "/api/worktrees?scope=all", undefined, outsider.cookie)).json()) as { items: unknown[] }).items.length,
      "the pull request": await get(`/api/worktrees/${pull}`),
      "the pull request by number": await get(`/api/spaces/${s.id}/worktrees/1`),
      "the changed file's draft": await open(budget),
      "the changed file's comparison": await get(`/universer-api/worktrees/${pull}/units/${budget.unitId}/comparison`),
      "the changed file's draft content": await get(`/universer-api/worktrees/${pull}/snapshot/${sheet}/unit/${budget.unitId}/rev/0`),
      "the changed file on Trunk": await get(`/api/resources/${s.budget.resourceId}`),
      "the new file's draft": await open(forecast),
      "the new file's draft content": await get(`/universer-api/worktrees/${pull}/snapshot/${sheet}/unit/${forecast.unitId}/rev/0`),
      "the new file": await get(`/api/resources/${forecast.resourceId}`),
    }).toEqual({
      "pull requests listed": 0,
      "the pull request": 404,
      "the pull request by number": 404,
      "the changed file's draft": 404,
      "the changed file's comparison": 404,
      "the changed file's draft content": 403,
      "the changed file on Trunk": 404,
      "the new file's draft": 404,
      "the new file's draft content": 403,
      "the new file": 404,
    });
  }, 30_000);

  it("lets an admin discard the proposal, after which the file it changed can be deleted for good", async () => {
    const { origin, application } = await start();
    const s = await budgetSpace(origin, application);
    const { admin, viewer } = s;
    const pull = await openPull(origin, viewer, s.id, "private");
    await addFile(origin, viewer, pull, { source: "trunk", resourceId: s.budget.resourceId });
    await transition(origin, pull, "ready", viewer);
    const { id: batch } = await made<{ id: string }>(await post(origin, admin, `/api/nodes/${s.budget.nodeId}/trash`));
    const remove = async () => {
      const response = await send(origin, "DELETE", `/api/trash-batches/${batch}`, undefined, admin.cookie);
      return response.status === 204 ? 204 : ((await response.json()) as { error: { code: string } }).error.code;
    };

    expect(await remove()).toBe("ACTIVE_WORKTREE_RESOURCE_REFERENCE");
    expect((await post(origin, admin, `/api/worktrees/${pull}/discard`)).status).toBe(200);
    expect(await remove()).toBe(204);
  }, 30_000);

  it("keeps a ready proposal visible to the Space while its author cannot merge it", async () => {
    const { origin, application } = await start();
    const s = await budgetSpace(origin, application);
    const { admin, editor, viewer } = s;
    const pull = await openPull(origin, viewer, s.id, "private");
    await addFile(origin, viewer, pull, { source: "trunk", resourceId: s.budget.resourceId });
    await transition(origin, pull, "ready", viewer);
    const hide = async (actor: Actor, id = pull) => {
      const response = await send(origin, "PATCH", `/api/worktrees/${id}`, { visibility: "private" }, actor.cookie);
      const body = (await response.json()) as { worktree: { visibility: string }; error: object };
      return response.ok ? body.worktree.visibility : { status: response.status, ...body.error };
    };
    const refused = {
      status: 403,
      code: "FORBIDDEN",
      message: "This pull request is ready and its author cannot merge it, so it stays visible to the Space for a member with edit access to merge. Move it back to draft before making it private.",
    };

    expect(await hide(viewer)).toEqual(refused);
    expect(await hide(admin)).toEqual(refused);
    expect(await granted(origin, pull, editor)).toBe("review merge");
    expect((await send(origin, "PATCH", `/api/worktrees/${pull}`, { name: "Renamed" }, viewer.cookie)).status).toBe(200);

    expect((await post(origin, viewer, `/api/worktrees/${pull}/reopen`)).status).toBe(200);
    expect(await hide(viewer), "a draft proposal can still be private").toBe("private");
    const own = await openPull(origin, editor, s.id, "space");
    await addFile(origin, editor, own, { source: "trunk", resourceId: s.budget.resourceId });
    await transition(origin, own, "ready", editor);
    expect(await hide(editor, own), "an author who can merge still makes a ready one private").toBe("private");
  }, 30_000);

  it("places a viewer's new file only in a folder that is live in the Team Space", async () => {
    const { origin, application } = await start();
    const s = await budgetSpace(origin, application);
    const { owner, editor, viewer } = s;
    const folder = async (spaceId: string, name: string) =>
      (await made<{ id: string }>(await post(origin, owner, "/api/nodes", { spaceId, parentNodeId: null, name }))).id;
    const reports = await folder(s.id, "Reports");
    const trashed = await folder(s.id, "Old");
    expect((await post(origin, owner, `/api/nodes/${trashed}/trash`)).status).toBe(201);
    const elsewhere = await application.spaces.createTeamSpace(owner.id, { name: "Elsewhere" });
    await application.permissions.upsertTeamMember(owner.id, elsewhere.id, viewer.id, { role: "viewer" });
    const foreign = await folder(elsewhere.id, "Foreign");
    const pull = await openPull(origin, viewer, s.id, "private");
    const propose = async (parentNodeId: string) =>
      (await post(origin, viewer, `/api/worktrees/${pull}/units`, { ...newSheet(s.id), targetParentNodeId: parentNodeId })).status;

    expect({
      trashed: await propose(trashed),
      "in another Space": await propose(foreign),
      missing: await propose(randomUUID()),
      live: await propose(reports),
    }).toEqual({ trashed: 404, "in another Space": 404, missing: 404, live: 201 });
    await transition(origin, pull, "ready", viewer);
    expect(await transition(origin, pull, "merge", editor)).toBe("merged");
    const { nodes } = (await (await send(origin, "GET", `/api/nodes/${reports}/children`, undefined, viewer.cookie)).json()) as { nodes: { name: string }[] };
    expect(nodes.map((node) => node.name)).toEqual(["Forecast"]);
  }, 30_000);
});

const members = ["author", "claimer", "owner", "admin", "editor", "viewer", "outsider"] as const;
const told = ["review", "editDraft", "addUnit", "markReady", "reopen", "merge", "discard"] as const;

describe("what each member can do with a Team pull request", () => {
  // One row per row of the Team Worktree capability table in the Agent Mode spec (5.4): the capability, then who has it.
  // The author is an agent and the claimer the person who claimed it; both are members of the Team Space.
  const tables = [
    {
      author: "viewer", visibility: "space", onceReady: "space",
      can: {
        "create a Team pull request": "author claimer owner admin editor viewer",
        review: "author claimer owner admin editor viewer",
        editDraft: "author",
        addUnit: "author",
        "add a Trunk file": "author",
        "remove a Trunk file": "",
        markReady: "author claimer owner admin editor",
        reopen: "author claimer owner admin",
        merge: "claimer owner admin editor",
        discard: "author claimer owner admin",
      },
    },
    {
      // Marking it ready shares it, because its author cannot merge it.
      author: "viewer", visibility: "private", onceReady: "space",
      can: {
        "create a Team pull request": "author claimer owner admin editor viewer",
        review: "author claimer",
        editDraft: "author",
        addUnit: "author",
        "add a Trunk file": "author",
        "remove a Trunk file": "",
        markReady: "author claimer",
        reopen: "author claimer owner admin",
        merge: "claimer owner admin editor",
        discard: "author claimer owner admin",
      },
    },
    {
      author: "editor", visibility: "space", onceReady: "space",
      can: {
        "create a Team pull request": "author claimer owner admin editor viewer",
        review: "author claimer owner admin editor viewer",
        editDraft: "author",
        addUnit: "author",
        "add a Trunk file": "author",
        "remove a Trunk file": "",
        markReady: "author claimer owner admin editor",
        reopen: "author claimer owner admin",
        merge: "author claimer owner admin editor",
        discard: "author claimer owner admin",
      },
    },
    {
      author: "editor", visibility: "private", onceReady: "private",
      can: {
        "create a Team pull request": "author claimer owner admin editor viewer",
        review: "author claimer",
        editDraft: "author",
        addUnit: "author",
        "add a Trunk file": "author",
        "remove a Trunk file": "",
        markReady: "author claimer",
        reopen: "author claimer owner admin",
        merge: "author claimer",
        discard: "author claimer owner admin",
      },
    },
  ] as const;
  it.each(tables.map((table) => [table.visibility, table.author, table] as const))("a %s pull request whose author has the %s role", async (visibility, role, { onceReady, can }) => {
    const { origin, application } = await start();
    const s = await budgetSpace(origin, application);
    const claimer = await person(origin, "claimer");
    await application.permissions.upsertTeamMember(s.owner.id, s.id, claimer.id, { role: "editor" });
    const author = await guestAgent(origin);
    await claim(origin, author, claimer);
    await application.permissions.upsertTeamMember(s.owner.id, s.id, author.id, { role });
    const other = await trunkSheet(origin, s.owner, s.id, "Other");
    const allowed = async (response: Promise<Response>) => (await response).ok;
    const flags = async (pull: string, actor: Actor): Promise<Record<string, boolean>> => {
      const response = await send(origin, "GET", `/api/worktrees/${pull}`, undefined, actor.cookie);
      return response.ok ? ((await response.json()) as { worktree: { capabilities: Record<string, boolean> } }).worktree.capabilities : {};
    };

    const did: Record<string, string[]> = {};
    const wasTold: Record<string, string[]> = {};
    const visibilities = new Set<string>();
    for (const name of members) {
      const actor = { ...s, author, claimer }[name];
      const own = post(origin, actor, "/api/worktrees", teamPull(s.id, visibility));
      const pull = await openPull(origin, author, s.id, visibility);
      const unit = await addFile(origin, author, pull, { source: "trunk", resourceId: s.budget.resourceId });
      const drafted = await sheetIn(origin, author, pull, unit.unitId);
      expect(await writeDraft(origin, author, pull, unit.unitId, drafted, "proposed")).toBe("committed");
      const draft = await flags(pull, actor);
      const outcome: Record<string, boolean> = {
        "create a Team pull request": await allowed(own),
        review: await allowed(post(origin, actor, `/api/worktrees/${pull}/units/${unit.unitId}/open`, { mode: "draft" })),
        editDraft: (await writeDraft(origin, actor, pull, unit.unitId, { ...drafted, head: drafted.head + 1 }, "edited")) === "committed",
        addUnit: await allowed(post(origin, actor, `/api/worktrees/${pull}/units`, newSheet(s.id))),
        "add a Trunk file": await allowed(post(origin, actor, `/api/worktrees/${pull}/units`, { source: "trunk", resourceId: other.resourceId })),
        "remove a Trunk file": await allowed(post(origin, actor, `/api/worktrees/${pull}/units/${unit.unitId}/removal`, { removed: true })),
        markReady: await allowed(post(origin, actor, `/api/worktrees/${pull}/ready`)),
      };
      if (!outcome.markReady) await transition(origin, pull, "ready", author);
      const ready = await flags(pull, actor);
      visibilities.add(((await (await send(origin, "GET", `/api/worktrees/${pull}`, undefined, author.cookie)).json()) as { worktree: { visibility: string } }).worktree.visibility);
      outcome.reopen = await allowed(post(origin, actor, `/api/worktrees/${pull}/reopen`));
      if (outcome.reopen) await transition(origin, pull, "ready", author);
      outcome.merge = await allowed(post(origin, actor, `/api/worktrees/${pull}/merge`));
      const spare = await openPull(origin, author, s.id, visibility);
      const fresh = await flags(spare, actor);
      outcome.discard = await allowed(post(origin, actor, `/api/worktrees/${spare}/discard`));

      for (const [capability, yes] of Object.entries(outcome)) (did[capability] ??= []).push(...(yes ? [name] : []));
      for (const capability of told) {
        const flag = { reopen: ready, merge: ready, discard: fresh }[capability as string] ?? draft;
        (wasTold[capability] ??= []).push(...(flag[capability] ? [name] : []));
      }
    }

    const who = (names: Record<string, string[]>) => Object.fromEntries(Object.entries(names).map(([capability, list]) => [capability, list.join(" ")]));
    expect(who(did)).toEqual(can);
    expect(who(wasTold)).toEqual(Object.fromEntries(told.map((capability) => [capability, can[capability]])));
    expect([...visibilities]).toEqual([onceReady]);
  }, 120_000);
});

describe("who sees the pages a pull request publishes", () => {
  it("shows them to whoever may review it, only to them, and keeps them as reviewed while it is ready", async () => {
    const { origin, application } = await start();
    const s = await budgetSpace(origin, application);
    const { owner, admin, editor, viewer, outsider } = s;
    const pull = await openPull(origin, editor, s.id, "space");
    const budget = await addFile(origin, editor, pull, { source: "trunk", resourceId: s.budget.resourceId });
    const { sheetId, head } = await sheetIn(origin, editor, pull, budget.unitId);
    expect(await writeDraft(origin, editor, pull, budget.unitId, { sheetId, head }, "proposed")).toBe("committed");
    const page = (unitId: string, title: string) =>
      `<!doctype html><html><head><title>${title}</title></head><body><output data-univer-cell-text="${unitId}:${sheetId}:A1">-</output></body></html>`;
    const save = (body: object) => post(origin, editor, "/api/html-view-drafts", body);
    const first = await made<{ draft: { id: string } }>(await save({ kind: "create", spaceId: s.id, name: "Budget page", html: page(budget.unitId, "First"), sourceWorktreeId: pull }));
    const read = (actor: Actor, path: string) => send(origin, "GET", path, undefined, actor.cookie);

    for (const reviewer of [owner, admin, viewer]) {
      const listed = await read(reviewer, `/api/worktrees/${pull}/html-view-drafts`);
      expect(listed.status).toBe(200);
      const { drafts } = (await listed.json()) as { drafts: { id: string; author: { username: string }; state: string; publishWhen: string }[] };
      expect(drafts.map((draft) => ({ id: draft.id, author: draft.author.username, state: draft.state, publishWhen: draft.publishWhen })))
        .toEqual([{ id: first.draft.id, author: "editor", state: "pending", publishWhen: "merge" }]);
      expect((await read(reviewer, `/api/html-view-drafts/${first.draft.id}`)).status).toBe(200);
      expect(await (await read(reviewer, `/api/html-view-drafts/${first.draft.id}/content`)).text()).toBe(page(budget.unitId, "First"));
      for (const action of ["publish", "reject"]) {
        expect((await send(origin, "POST", `/api/html-view-drafts/${first.draft.id}/${action}`, undefined, reviewer.cookie)).status).toBe(404);
      }
    }
    const preview = await post(origin, owner, `/api/worktrees/${pull}/units/${budget.unitId}/open`, { mode: "draft" });
    expect((await preview.json()) as object).toMatchObject({ unit: { editorMode: "readOnly" }, collaborationScope: { kind: "worktree", worktreeId: pull } });
    expect((await sheetIn(origin, owner, pull, budget.unitId)).draft).toBe("proposed");

    for (const path of [`/api/worktrees/${pull}/html-view-drafts`, `/api/html-view-drafts/${first.draft.id}`, `/api/html-view-drafts/${first.draft.id}/content`]) {
      expect((await read(outsider, path)).status).toBe(404);
    }
    const hidden = await openPull(origin, editor, s.id, "private");
    const hiddenDraft = await made<{ draft: { id: string } }>(await save({ kind: "create", spaceId: s.id, name: "Hidden page", html: page(budget.unitId, "Hidden"), sourceWorktreeId: hidden }));
    for (const path of [`/api/worktrees/${hidden}/html-view-drafts`, `/api/html-view-drafts/${hiddenDraft.draft.id}`, `/api/html-view-drafts/${hiddenDraft.draft.id}/content`]) {
      expect((await read(owner, path)).status).toBe(404);
    }

    expect(await transition(origin, pull, "ready", editor)).toBe("ready");
    const revise = { kind: "revise", draftId: first.draft.id, html: page(budget.unitId, "Revised") };
    for (const refused of [revise, { kind: "create", spaceId: s.id, name: "Late page", html: page(budget.unitId, "Late"), sourceWorktreeId: pull }]) {
      const response = await save(refused);
      expect({ status: response.status, message: ((await response.json()) as { error: { message: string } }).error.message })
        .toEqual({ status: 409, message: expect.stringContaining("Reopen it to change its pages.") });
    }
    expect((await post(origin, editor, `/api/worktrees/${pull}/reopen`)).status).toBe(200);
    const revised = await made<{ draft: { id: string } }>(await save(revise));
    const listed = (await (await read(owner, `/api/worktrees/${pull}/html-view-drafts`)).json()) as { drafts: { id: string }[] };
    expect(listed.drafts.map((draft) => draft.id)).toEqual([revised.draft.id]);

    const { spaces } = (await (await read(owner, "/api/spaces")).json()) as { spaces: { id: string; type: string }[] };
    const ownersSheet = await trunkSheet(origin, owner, spaces.find((space) => space.type === "personal")!.id, "Salaries");
    for (const unitId of [ownersSheet.unitId, "no-such-unit"]) {
      const response = await save({ kind: "create", spaceId: s.id, name: "Leaky page", html: page(unitId, "Leaky"), sourceWorktreeId: pull });
      expect({ status: response.status, message: ((await response.json()) as { error: { message: string } }).error.message })
        .toEqual({ status: 403, message: `The page binds a Sheet you cannot read: ${unitId}.` });
    }
    const forecast = await addFile(origin, editor, pull, newSheet(s.id));
    expect((await save({ kind: "create", spaceId: s.id, name: "Forecast page", html: page(forecast.unitId, "Forecast"), sourceWorktreeId: pull })).status).toBe(201);
  }, 60_000);
});

interface Actor {
  readonly id: string;
  readonly cookie: string;
  readonly username: string;
  readonly displayName: string;
}

/** Pull requests that a test can leave mid-merge, as an interrupted merge leaves them. */
function stoppedBackend() {
  type Worktree = Awaited<ReturnType<WorktreeBackend["getWorktree"]>>;
  const worktrees = new Map<string, Worktree>();
  const save = (worktree: Worktree) => {
    worktrees.set(worktree.worktreeID, worktree);
    return worktree;
  };
  const merged = (worktreeID: string): Worktree => {
    const current = worktrees.get(worktreeID)!;
    return { ...current, status: "merged", units: current.units.map((unit) => ({ ...unit, mergeResult: { status: "merged", trunkRevision: 2 } })) } as Worktree;
  };
  const backend: Pick<WorktreeBackend, "createWorktree" | "getWorktree" | "createUnit" | "markReady" | "merge"> = {
    async createWorktree(worktreeID) {
      return save({ worktreeID, status: "draft", units: [] });
    },
    async getWorktree(worktreeID) {
      return worktrees.get(worktreeID)!;
    },
    async createUnit(input) {
      const current = worktrees.get(input.worktreeId)!;
      return save({ ...current, units: [...current.units, { unitID: input.unitId, type: UniverType.UNIVER_SHEET, source: "worktree", draftHeadRevision: 1 }] } as Worktree);
    },
    async markReady(worktreeID) {
      return save({ ...worktrees.get(worktreeID)!, status: "ready" });
    },
    async merge(worktreeID) {
      return save(merged(worktreeID));
    },
  };
  return {
    backend: backend as WorktreeBackend,
    stop: (worktreeID: string, stage: "merging" | "merged") =>
      save(stage === "merged" ? merged(worktreeID) : { ...worktrees.get(worktreeID)!, status: "merging" }),
  };
}

async function start(worktreeBackend?: WorktreeBackend) {
  const application = await createProductTestApplication({
    host: "127.0.0.1",
    port: 0,
    productFilename: ":memory:",
    collaborationDatabaseFilename: ":memory:",
    secureCookies: false,
    passwordAuthEnabled: true,
    agentCreateLimitPerHour: 100,
  }, worktreeBackend && {
    unitStore: { async createUnit(input) { return { unitId: input.unitId, headRevision: 1 }; } },
    worktreeBackend,
  });
  applications.push(application);
  const server = createServer(application.app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not expose a TCP address");
  return { origin: `http://127.0.0.1:${address.port}`, application, repositories: application.repositories };
}

function send(origin: string, method: string, path: string, body?: unknown, cookie?: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function signedIn(response: Response): Promise<Actor> {
  const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
  const { user } = (await (await send(new URL(response.url).origin, "GET", "/api/session", undefined, cookie)).json()) as {
    user: { id: string; username: string; displayName: string };
  };
  return { id: user.id, cookie, username: user.username, displayName: user.displayName };
}

async function person(origin: string, username: string): Promise<Actor> {
  const response = await send(origin, "POST", "/api/auth/password/register", { username, displayName: username, password: "correct horse battery staple" });
  if (response.status !== 201) throw new Error(`Registration failed with ${response.status}`);
  return signedIn(response);
}

async function guestAgent(origin: string): Promise<Actor & { readonly spaceId: string }> {
  const response = await send(origin, "POST", "/api/auth/guest", {});
  if (response.status !== 201) throw new Error(`Guest creation failed with ${response.status}`);
  const agent = await signedIn(response);
  const { spaces } = (await (await send(origin, "GET", "/api/spaces", undefined, agent.cookie)).json()) as { spaces: { id: string; type: string }[] };
  return { ...agent, spaceId: spaces.find((space) => space.type === "personal")!.id };
}

async function claim(origin: string, agent: Actor, human: Actor): Promise<void> {
  const { code } = (await (await send(origin, "POST", "/api/agents/claim-codes", undefined, agent.cookie)).json()) as { code: string };
  const response = await send(origin, "POST", "/api/agents/claim", { code }, human.cookie);
  if (response.status !== 200) throw new Error(`Claim failed with ${response.status}`);
}

async function createPull(origin: string, actor: Actor, kind: Record<string, string>, targetSpaceId: string): Promise<string> {
  const created = await send(origin, "POST", "/api/worktrees", { ...kind, name: "Budget", summary: null }, actor.cookie, { "idempotency-key": randomUUID() });
  if (created.status !== 201) throw new Error(`Pull request creation failed with ${created.status}: ${await created.text()}`);
  const { id } = (await created.json()) as { id: string };
  const unit = await send(origin, "POST", `/api/worktrees/${id}/units`,
    { source: "worktree", name: "Budget sheet", unitType: "sheet", targetSpaceId, targetParentNodeId: null },
    actor.cookie, { "idempotency-key": randomUUID() });
  if (unit.status !== 201) throw new Error(`Adding a Sheet failed with ${unit.status}: ${await unit.text()}`);
  return id;
}

async function granted(origin: string, worktreeId: string, actor: Actor): Promise<string> {
  const response = await send(origin, "GET", `/api/worktrees/${worktreeId}`, undefined, actor.cookie);
  if (response.status === 404) return "not found";
  const { worktree } = (await response.json()) as { worktree: { capabilities: Record<string, boolean> } };
  return Object.entries(worktree.capabilities).filter(([, allowed]) => allowed).map(([name]) => name).join(" ");
}

async function mergeAs(origin: string, worktreeId: string, actor: Actor, key: string): Promise<{ status: number; message?: string }> {
  const response = await send(origin, "POST", `/api/worktrees/${worktreeId}/merge`, undefined, actor.cookie, { "idempotency-key": key });
  const body = (await response.json()) as { error?: { message: string } };
  return response.status === 200 ? { status: 200 } : { status: response.status, message: body.error?.message };
}

async function outcome(origin: string, worktreeId: string, actor: Actor): Promise<{ state: string; files: string[] }> {
  const response = await send(origin, "GET", `/api/worktrees/${worktreeId}`, undefined, actor.cookie);
  const { worktree } = (await response.json()) as { worktree: { state: string; units: { activationState: string }[] } };
  return { state: worktree.state, files: worktree.units.map((unit) => unit.activationState) };
}

async function mergedBy(origin: string, spaceId: string, worktreeId: string, viewer: Actor): Promise<string | null> {
  const response = await send(origin, "GET", `/api/spaces/${spaceId}/activity?timeZone=UTC`, undefined, viewer.cookie);
  const { events } = (await response.json()) as { events: { kind: string; actor: { username: string } | null; pull?: { id: string } }[] };
  return events.find((event) => event.kind === "pull-merged" && event.pull?.id === worktreeId)?.actor?.username ?? null;
}

async function transition(origin: string, worktreeId: string, action: "ready" | "merge", actor: Actor): Promise<string> {
  const response = await send(origin, "POST", `/api/worktrees/${worktreeId}/${action}`, undefined, actor.cookie, { "idempotency-key": randomUUID() });
  if (response.status !== 200) throw new Error(`${action} failed with ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { worktree: { state: string } }).worktree.state;
}

interface Unit {
  readonly unitId: string;
  readonly resourceId: string;
  readonly nodeId: string | null;
  readonly draftHeadRevision: number;
}

function post(origin: string, actor: Actor, path: string, body?: unknown): Promise<Response> {
  return send(origin, "POST", path, body, actor.cookie, { "idempotency-key": randomUUID() });
}

async function made<T>(response: Response): Promise<T> {
  if (response.status !== 201) throw new Error(`${response.url} answered ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

/** A private Team Space with a member of each role, a stranger, and one Sheet on Trunk. */
async function budgetSpace(origin: string, application: ProductTestApplication) {
  const [owner, admin, editor, viewer, outsider] = await Promise.all(
    ["owner", "admin", "editor", "viewer", "outsider"].map((name) => person(origin, name)),
  );
  const team = await application.spaces.createTeamSpace(owner!.id, { name: "Budget" });
  for (const [member, role] of [[admin, "admin"], [editor, "editor"], [viewer, "viewer"]] as const) {
    await application.permissions.upsertTeamMember(owner!.id, team.id, member!.id, { role });
  }
  return {
    id: team.id, owner: owner!, admin: admin!, editor: editor!, viewer: viewer!, outsider: outsider!,
    budget: await trunkSheet(origin, owner!, team.id, "Budget"),
  };
}

async function trunkSheet(origin: string, actor: Actor, spaceId: string, name: string) {
  const { node } = await made<{ node: { id: string; resource: { id: string; unitId: string } } }>(
    await post(origin, actor, "/api/resources", { kind: "univer", spaceId, parentNodeId: null, name, unitType: "sheet" }),
  );
  return { nodeId: node.id, resourceId: node.resource.id, unitId: node.resource.unitId };
}

const teamPull = (teamSpaceId: string, visibility: "private" | "space") => ({ kind: "team", teamSpaceId, visibility, name: "Budget", summary: null });
const newSheet = (spaceId: string) => ({ source: "worktree", name: "Forecast", unitType: "sheet", targetSpaceId: spaceId, targetParentNodeId: null });

async function openPull(origin: string, actor: Actor, teamSpaceId: string, visibility: "private" | "space"): Promise<string> {
  return (await made<{ id: string }>(await post(origin, actor, "/api/worktrees", teamPull(teamSpaceId, visibility)))).id;
}

async function addFile(origin: string, actor: Actor, pull: string, file: object): Promise<Unit> {
  return (await made<{ unit: Unit }>(await post(origin, actor, `/api/worktrees/${pull}/units`, file))).unit;
}

/** Cell A1 of a Sheet in a pull request, in its draft and on Trunk, as the review screen reads them. */
async function sheetIn(origin: string, reviewer: Actor, pull: string, unitId: string) {
  type Side = { readonly revision: number; readonly unitData: null | { readonly sheetOrder: string[]; readonly sheets: Record<string, { cellData?: Record<string, Record<string, { v?: unknown }>> }> } };
  const response = await send(origin, "GET", `/universer-api/worktrees/${pull}/units/${unitId}/comparison`, undefined, reviewer.cookie);
  if (response.status !== 200) throw new Error(`Comparison answered ${response.status}: ${await response.text()}`);
  const { left, right } = (await response.json()) as { left: Side | null; right: Side };
  const a1 = (side: Side | null) => side?.unitData?.sheets[side.unitData.sheetOrder[0]!]?.cellData?.[0]?.[0]?.v ?? null;
  return { trunk: a1(left), trunkRevision: left?.revision ?? null, draft: a1(right), head: right.revision, sheetId: right.unitData!.sheetOrder[0]! };
}

/** Writes cell A1 of a draft Sheet. Answers what the collaboration service decided, or the status that refused the request. */
async function writeDraft(origin: string, actor: Actor, pull: string, unitId: string, draft: { readonly head: number; readonly sheetId: string }, value: string): Promise<string | number> {
  const response = await post(origin, actor, `/api/worktrees/${pull}/units/${unitId}/changesets`, {
    changeset: {
      unitID: unitId, type: UniverType.UNIVER_SHEET, baseRev: draft.head, revision: draft.head + 1, sid: randomUUID(), reqId: 1,
      mutations: [{ id: "sheet.mutation.set-range-values", data: JSON.stringify({ unitId, subUnitId: draft.sheetId, cellValue: { 0: { 0: { v: value } } } }) }],
    },
  });
  return response.status === 200 ? ((await response.json()) as { status: string }).status : response.status;
}

/** Cell A1 of a Sheet on Trunk, read through a pull request that is thrown away. */
async function trunkA1(origin: string, reader: Actor, teamSpaceId: string, resourceId: string) {
  const pull = await openPull(origin, reader, teamSpaceId, "private");
  const unit = await addFile(origin, reader, pull, { source: "trunk", resourceId });
  const { trunk } = await sheetIn(origin, reader, pull, unit.unitId);
  await post(origin, reader, `/api/worktrees/${pull}/discard`);
  return trunk;
}

async function filesIn(origin: string, reader: Actor, spaceId: string): Promise<string[]> {
  const { nodes } = (await (await send(origin, "GET", `/api/spaces/${spaceId}/nodes`, undefined, reader.cookie)).json()) as { nodes: { name: string }[] };
  return nodes.map((node) => node.name).sort();
}
