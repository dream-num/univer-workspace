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
  it("is its author, or the person who claimed the authoring agent, for User and Team pull requests alike", async () => {
    const { origin, application, repositories } = await start();
    const [owner, admin, author, editor, viewer, outsider, claimer, teamClaimer] = await Promise.all(
      ["owner", "admin", "author", "editor", "viewer", "outsider", "claimer", "team-claimer"].map((name) => person(origin, name)),
    );
    const team = await application.spaces.createTeamSpace(owner.id, { name: "Budget" });
    for (const [member, role] of [[admin, "admin"], [author, "editor"], [editor, "editor"], [viewer, "viewer"], [teamClaimer, "editor"]] as const) {
      await application.permissions.upsertTeamMember(owner.id, team.id, member.id, { role });
    }
    // No agent can join a Team Space now; this membership stands for one that predates that rule.
    const teamAgent = await guestAgent(origin);
    await repositories.permissions.upsertMember({ spaceId: team.id, userId: teamAgent.id, role: "editor", grantedBy: owner.id, now: Date.now() });
    await claim(origin, teamAgent, teamClaimer);
    const userAgent = await guestAgent(origin);
    await claim(origin, userAgent, claimer);

    const teamPull = await createPull(origin, author, { kind: "team", teamSpaceId: team.id, visibility: "space" }, team.id);
    const agentTeamPull = await createPull(origin, teamAgent, { kind: "team", teamSpaceId: team.id, visibility: "space" }, team.id);
    const userPull = await createPull(origin, userAgent, { kind: "user" }, userAgent.spaceId);
    const pulls = [
      { name: "team", id: teamPull, author, others: { "team owner": owner, "team admin": admin, "team editor": editor, "team viewer": viewer, outsider } },
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
      "team draft: team owner": "review changeVisibility discard",
      "team draft: team admin": "review changeVisibility discard",
      "team draft: team editor": "review",
      "team draft: team viewer": "review",
      "team draft: outsider": "not found",
      "agent's team draft: author": "review editDraft addUnit changeVisibility markReady discard",
      "agent's team draft: agent owner": "review markReady discard",
      "agent's user draft: author": "review editDraft addUnit markReady discard",
      "agent's user draft: agent owner": "review markReady discard",
      "agent's user draft: outsider": "not found",
      "team ready: author": "review changeVisibility reopen merge discard",
      "team ready: team owner": "review changeVisibility reopen discard",
      "team ready: team admin": "review changeVisibility reopen discard",
      "team ready: team editor": "review",
      "team ready: team viewer": "review",
      "team ready: outsider": "not found",
      "agent's team ready: author": "review changeVisibility reopen merge discard",
      "agent's team ready: agent owner": "review reopen merge discard",
      "agent's user ready: author": "review reopen merge discard",
      "agent's user ready: agent owner": "review reopen merge discard",
      "agent's user ready: outsider": "not found",
    });

    for (const refused of [owner, admin, editor, viewer]) {
      const response = await send(origin, "POST", `/api/worktrees/${teamPull}/merge`, undefined, refused.cookie, { "idempotency-key": randomUUID() });
      expect({ status: response.status, body: await response.json() }).toEqual({
        status: 403,
        body: { error: { code: "FORBIDDEN", message: "Only the author, author (@author), can merge this pull request." } },
      });
    }
    expect((await send(origin, "POST", `/api/worktrees/${teamPull}/merge`, undefined, outsider.cookie, { "idempotency-key": randomUUID() })).status).toBe(404);
    expect(await transition(origin, teamPull, "merge", author)).toBe("merged");
    expect(await transition(origin, agentTeamPull, "merge", teamClaimer)).toBe("merged");
    expect(await transition(origin, userPull, "merge", claimer)).toBe("merged");

    const unclaimed = await guestAgent(origin);
    const own = await createPull(origin, unclaimed, { kind: "user" }, unclaimed.spaceId);
    await transition(origin, own, "ready", unclaimed);
    expect(await transition(origin, own, "merge", unclaimed)).toBe("merged");
  }, 30_000);

  it("names the agent's owner when refusing, tells an owner without edit access why, and lists the pull request to that owner", async () => {
    const { origin, application, repositories } = await start();
    const [owner, claimer] = await Promise.all(["owner", "claimer"].map((name) => person(origin, name)));
    const team = await application.spaces.createTeamSpace(owner.id, { name: "Budget" });
    // No agent can join a Team Space now; this membership stands for one that predates that rule.
    const agent = await guestAgent(origin);
    await repositories.permissions.upsertMember({ spaceId: team.id, userId: agent.id, role: "editor", grantedBy: owner.id, now: Date.now() });
    await claim(origin, agent, claimer);
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
});

describe("finishing a merge started while Team Admins could merge anyone's pull request", () => {
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
        const id = await createPull(origin, creator, { kind: "team", teamSpaceId: team.id, visibility: "space" }, team.id);
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
    const pull = await createPull(origin, author, { kind: "team", teamSpaceId: team.id, visibility: "space" }, team.id);
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
    const onlyAuthor = { status: 403, message: "Only the author, author (@author), can merge this pull request." };
    expect(await mergeAs(origin, teamPull, admin, adminPending)).toEqual(onlyAuthor);
    expect(await retry(adminFailed, admin)).toEqual(onlyAuthor);
    expect(await mergedBy(origin, team.id, teamPull, owner)).toBe("author");

    const agentPull = await createPull(origin, agent, { kind: "user" }, agent.spaceId);
    await transition(origin, agentPull, "ready", agent);
    const [claimerPending, claimerFailed] = [await earlier(agentPull, claimer, "pending"), await earlier(agentPull, claimer, "failed")];
    expect(await transition(origin, agentPull, "merge", agent)).toBe("merged");
    const alreadyMerged = { status: 403, message: "This Worktree action is not allowed." };
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
