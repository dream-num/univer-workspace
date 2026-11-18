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
  });
});

interface Actor {
  readonly id: string;
  readonly cookie: string;
}

async function start() {
  const application = await createProductTestApplication({
    host: "127.0.0.1",
    port: 0,
    productFilename: ":memory:",
    collaborationDatabaseFilename: ":memory:",
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
  const { user } = (await (await send(new URL(response.url).origin, "GET", "/api/session", undefined, cookie)).json()) as { user: { id: string } };
  return { id: user.id, cookie };
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

async function transition(origin: string, worktreeId: string, action: "ready" | "merge", actor: Actor): Promise<string> {
  const response = await send(origin, "POST", `/api/worktrees/${worktreeId}/${action}`, undefined, actor.cookie, { "idempotency-key": randomUUID() });
  if (response.status !== 200) throw new Error(`${action} failed with ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { worktree: { state: string } }).worktree.state;
}
