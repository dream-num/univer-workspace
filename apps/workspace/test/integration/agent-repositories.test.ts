import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createProductTestApplication, type ProductTestApplication } from "../support/product-test-application.js";

const applications: ProductTestApplication[] = [];
const servers: Server[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(applications.splice(0).map((application) => application.close()));
});

interface Actor {
  readonly id: string;
  readonly cookie: string;
}

describe("a Team Space an agent owns", () => {
  it("is created, filled, merged and made public by a claimed agent with no human action (A3.1)", async () => {
    const { origin } = await start();
    const agent = await claimedAgent(origin, await person(origin, "claimer"));

    const created = await send(origin, "POST", "/api/team-spaces", { name: "Research" }, agent.cookie);
    expect(created.status).toBe(201);
    const repo = (await created.json()) as { id: string };
    expect(repo).toMatchObject({ owner: { id: agent.id }, accessRole: "owner", affiliation: "owner", publicRead: false });

    const pull = await createPull(origin, agent, repo.id);
    expect(await transition(origin, pull, "ready", agent)).toBe("ready");
    expect(await transition(origin, pull, "merge", agent)).toBe("merged");
    expect(await fileNames(origin, repo.id, agent)).toEqual(["Budget sheet"]);
    expect((await send(origin, "GET", `/api/spaces/${repo.id}/nodes`)).status).toBe(404);

    expect((await send(origin, "PATCH", `/api/spaces/${repo.id}`, { publicRead: true }, agent.cookie)).status).toBe(200);
    expect(await fileNames(origin, repo.id)).toEqual(["Budget sheet"]);
  }, 30_000);

  it("takes another claimed agent as admin with a human admin's capabilities, and a person as editor (A3.2)", async () => {
    const { origin } = await start();
    const [claimer, peerClaimer, admin, editor, viewer] = await Promise.all(
      ["claimer", "peer-claimer", "admin", "editor", "viewer"].map((name) => person(origin, name)),
    );
    const agent = await claimedAgent(origin, claimer);
    const peer = await claimedAgent(origin, peerClaimer);
    const repo = await createRepo(origin, agent, "Research");

    expect((await setRole(origin, repo, agent, peer.id, "admin")).status).toBe(200);
    expect((await setRole(origin, repo, agent, admin.id, "admin")).status).toBe(200);
    expect((await setRole(origin, repo, agent, editor.id, "editor")).status).toBe(200);
    expect(await spaceAccess(origin, repo, peer)).toEqual(await spaceAccess(origin, repo, admin));
    expect(await spaceAccess(origin, repo, peer)).toMatchObject({ accessRole: "admin", capabilities: { manageMembers: true } });
    expect(await spaceAccess(origin, repo, editor)).toMatchObject({ accessRole: "editor" });

    expect((await setRole(origin, repo, peer, viewer.id, "viewer")).status).toBe(200);
    expect(await members(origin, repo, agent)).toEqual([
      [peer.id, "admin"], [admin.id, "admin"], [editor.id, "editor"], [viewer.id, "viewer"],
    ].sort());

    const editorPull = await createPull(origin, editor, repo);
    expect((await send(origin, "POST", `/api/worktrees/${editorPull}/discard`, undefined, agent.cookie, { "idempotency-key": randomUUID() })).status).toBe(200);
  }, 30_000);

  it("gives its claimer owner powers whether the agent created it before or after the claim (A3.5)", async () => {
    const { origin } = await start();
    const [claimer, peerClaimer, member] = await Promise.all(["claimer", "peer-claimer", "member"].map((name) => person(origin, name)));
    const agent = await guestAgent(origin);
    const before = await createRepo(origin, agent, "Before");
    await claim(origin, agent, claimer);
    const after = await createRepo(origin, agent, "After");
    const peer = await claimedAgent(origin, peerClaimer);

    const listed = await mine(origin, claimer);
    for (const repo of [before, after]) {
      expect(listed).toContainEqual({ id: repo, affiliation: "owner", accessRole: "owner" });
      expect((await setRole(origin, repo, claimer, member.id, "editor")).status).toBe(200);
      expect((await setRole(origin, repo, claimer, peer.id, "admin")).status).toBe(200);
      expect(await members(origin, repo, claimer)).toEqual([[member.id, "editor"], [peer.id, "admin"]].sort());

      const memberPull = await createPull(origin, member, repo);
      expect(await transition(origin, memberPull, "ready", member)).toBe("ready");
      expect(await transition(origin, memberPull, "reopen", claimer)).toBe("draft");
      expect(await transition(origin, memberPull, "discard", claimer)).toBe("discarded");
      const claimerPull = await createPull(origin, claimer, repo);
      expect(await transition(origin, claimerPull, "ready", claimer)).toBe("ready");
      expect(await transition(origin, claimerPull, "merge", claimer)).toBe("merged");

      expect((await send(origin, "DELETE", `/api/team-spaces/${repo}/members/${member.id}`, undefined, claimer.cookie)).status).toBe(204);
      expect(await members(origin, repo, claimer)).toEqual([[peer.id, "admin"]]);

      expect((await send(origin, "PATCH", `/api/spaces/${repo}`, { publicRead: true }, claimer.cookie)).status).toBe(200);
      expect((await send(origin, "GET", `/api/spaces/${repo}/nodes`)).status).toBe(200);
      expect((await send(origin, "PATCH", `/api/spaces/${repo}`, { publicRead: false }, claimer.cookie)).status).toBe(200);
      expect((await send(origin, "GET", `/api/spaces/${repo}/nodes`)).status).toBe(404);
    }
  }, 60_000);

  it("is suspended for its members once the claimer stops the agent, Team Worktrees and Issues included (A3.6)", async () => {
    const { origin } = await start();
    const [claimer, peerClaimer] = await Promise.all(["claimer", "peer-claimer"].map((name) => person(origin, name)));
    const agent = await claimedAgent(origin, claimer);
    const peer = await claimedAgent(origin, peerClaimer);
    const repo = await createRepo(origin, agent, "Research");
    const file = await createFile(origin, agent, repo, "Budget");
    expect((await setRole(origin, repo, agent, peer.id, "admin")).status).toBe(200);
    const pull = await createPull(origin, agent, repo);
    const [peerEvents, claimerEvents] = await Promise.all([events(origin, peer), events(origin, claimer)]);
    const issue = await createIssue(origin, agent, repo, "Secret plan");
    expect(await Promise.all([peerEvents.next(), claimerEvents.next()])).toEqual([issuesChanged(repo), issuesChanged(repo)]);
    expect((await send(origin, "GET", `/api/nodes/${file}`, undefined, peer.cookie)).status).toBe(200);
    expect((await mine(origin, peer)).map((space) => space.id)).toContain(repo);
    expect(await reach(origin, repo, pull, peer)).toEqual(reachesAll);
    expect(await reach(origin, repo, pull, claimer)).toEqual(reachesAll);

    expect((await send(origin, "POST", `/api/agents/${agent.id}/stop`, undefined, claimer.cookie)).status).toBe(204);

    expect((await send(origin, "GET", `/api/spaces/${repo}`, undefined, peer.cookie)).status).toBe(404);
    expect((await send(origin, "GET", `/api/nodes/${file}`, undefined, peer.cookie)).status).toBe(404);
    expect((await mine(origin, peer)).map((space) => space.id)).not.toContain(repo);
    expect(await reach(origin, repo, pull, peer)).toEqual(reachesNothing);
    expect(await refusals(origin, pull, peer)).toEqual([404, 404, 404]);

    expect(await spaceAccess(origin, repo, claimer)).toMatchObject({ accessRole: "owner" });
    expect(await reach(origin, repo, pull, claimer)).toEqual(reachesAll);
    const claimerEvent = claimerEvents.next();
    const label = await send(origin, "POST", `/api/spaces/${repo}/issue-labels`, { name: "triage", color: "red" }, claimer.cookie);
    expect(label.status).toBe(201);
    expect(await claimerEvent).toEqual(issuesChanged(repo));
    const { id: labelId } = (await label.json()) as { id: string };
    const triaged = await send(origin, "PATCH", `/api/spaces/${repo}/issues/${issue}`,
      { labelIds: [labelId], assigneeUserIds: [claimer.id] }, claimer.cookie);
    expect({ status: triaged.status, body: await triaged.json() })
      .toMatchObject({ status: 200, body: { labels: [{ id: labelId }], assignees: [{ id: claimer.id }] } });
    expect((await send(origin, "PATCH", `/api/worktrees/${pull}`, { name: "Renamed" }, claimer.cookie)).status).toBe(200);
    expect(await peerEvents.none()).toBe(true);
  }, 30_000);
});

describe("agent membership ceilings", () => {
  it("refuses any agent as admin of a Team Space a human owns (A3.3)", async () => {
    const { origin } = await start();
    const [owner, claimer, peerClaimer] = await Promise.all(["owner", "claimer", "peer-claimer"].map((name) => person(origin, name)));
    const repo = await createRepo(origin, owner, "Budget");
    for (const agent of [await claimedAgent(origin, claimer), await claimedAgent(origin, peerClaimer)]) {
      await expectRefused(setRole(origin, repo, owner, agent.id, "admin"), "AGENT_NOT_ALLOWED");
      expect((await setRole(origin, repo, owner, agent.id, "editor")).status).toBe(200);
      await expectRefused(setRole(origin, repo, owner, agent.id, "admin"), "AGENT_NOT_ALLOWED");
    }
  });

  it("keeps an unclaimed agent out of every Team Space and from adding members to its own (A3.4)", async () => {
    const { origin } = await start();
    const [claimer, other] = await Promise.all(["claimer", "other"].map((name) => person(origin, name)));
    const agent = await claimedAgent(origin, claimer);
    const unclaimed = await guestAgent(origin);
    const repo = await createRepo(origin, agent, "Research");
    for (const role of ["viewer", "editor", "admin"]) {
      await expectRefused(setRole(origin, repo, agent, unclaimed.id, role), "AGENT_NOT_ALLOWED");
    }

    const own = await createRepo(origin, unclaimed, "Scratch");
    for (const member of [other, agent]) {
      await expectRefused(setRole(origin, own, unclaimed, member.id, "viewer"), "AGENT_NOT_ALLOWED");
    }
    expect(await members(origin, repo, agent)).toEqual([]);
    expect(await members(origin, own, unclaimed)).toEqual([]);
  });
});

describe("unclaimed agent quotas", () => {
  it("caps an unclaimed agent at three Team Spaces, also when creations race, and no claimed agent (A3.7)", async () => {
    const { origin } = await start();
    const unclaimed = await guestAgent(origin);
    for (const name of ["One", "Two", "Three"]) await createRepo(origin, unclaimed, name);
    const refused = await send(origin, "POST", "/api/team-spaces", { name: "Four" }, unclaimed.cookie);
    expect({ status: refused.status, body: await refused.json() }).toMatchObject({ status: 403, body: { error: {
      code: "AGENT_QUOTA_EXCEEDED",
      message: "An unclaimed agent can own at most 3 Team Spaces. Work in one you already own, or give a person a claim link so they can claim you, which lifts this limit.",
    } } });

    const racing = await guestAgent(origin);
    const statuses = await Promise.all(
      ["A", "B", "C", "D", "E"].map(async (name) => (await send(origin, "POST", "/api/team-spaces", { name }, racing.cookie)).status),
    );
    expect(statuses.sort()).toEqual([201, 201, 201, 403, 403]);

    const claimed = await claimedAgent(origin, await person(origin, "claimer"));
    for (const name of ["One", "Two", "Three", "Four"]) await createRepo(origin, claimed, name);
  });

  it("counts an unclaimed agent's files across every Space it owns, pending pull-request files included (A3.8)", async () => {
    const { origin } = await start();
    const unclaimed = await guestAgent(origin);
    const repo = await createRepo(origin, unclaimed, "Research");
    const pull = await createPull(origin, unclaimed, repo);
    for (let index = 1; index <= 10; index += 1) await createFile(origin, unclaimed, unclaimed.spaceId, `Personal ${index}`);
    for (let index = 1; index <= 9; index += 1) await createFile(origin, unclaimed, repo, `Team ${index}`);

    for (const spaceId of [repo, unclaimed.spaceId]) {
      await expectRefused(createFileRequest(origin, unclaimed, spaceId, "One too many"), "AGENT_QUOTA_EXCEEDED");
    }
    expect((await send(origin, "POST", `/api/worktrees/${pull}/discard`, undefined, unclaimed.cookie, { "idempotency-key": randomUUID() })).status).toBe(200);
    expect((await createFileRequest(origin, unclaimed, repo, "Team 10")).status).toBe(201);
  }, 30_000);

  it("keeps an unclaimed agent from making a Space public, and suspends its Team Spaces with its Personal Space when it expires (A3.9)", async () => {
    const { origin, repositories } = await start();
    const unclaimed = await guestAgent(origin);
    const repo = await createRepo(origin, unclaimed, "Research");
    for (const spaceId of [repo, unclaimed.spaceId]) {
      await expectRefused(send(origin, "PATCH", `/api/spaces/${spaceId}`, { publicRead: true }, unclaimed.cookie), "AGENT_NOT_ALLOWED");
    }
    const refused = await send(origin, "POST", "/api/team-spaces", { name: "Public", publicRead: true }, unclaimed.cookie);
    expect({ status: refused.status, body: await refused.json() }).toMatchObject({ status: 403, body: { error: {
      code: "AGENT_NOT_ALLOWED",
      message: "An unclaimed agent cannot make a Space public. Keep it private, or give a person a claim link so they can claim you, which lifts this limit. Claiming also lets that person open every Space you own.",
    } } });

    // Only the repository, below the ceiling, can publish these Spaces, so a reader can see the suspension.
    for (const spaceId of [repo, unclaimed.spaceId]) {
      await repositories.spaces.updateSettings(unclaimed.id, spaceId, { publicRead: true }, Date.now());
      expect((await send(origin, "GET", `/api/spaces/${spaceId}/nodes`)).status).toBe(200);
    }
    // Likewise only the repository can give this Space a member, so the member path can be seen to close.
    const member = await person(origin, "member");
    await repositories.permissions.upsertMember({ spaceId: repo, userId: member.id, role: "admin", grantedBy: unclaimed.id, now: Date.now() });
    const pull = await createPull(origin, unclaimed, repo);
    await createIssue(origin, unclaimed, repo, "Secret plan");
    expect(await reach(origin, repo, pull, member)).toEqual(reachesAll);

    await repositories.identity.touchAgent({ userId: unclaimed.id }, Date.now(), Date.now() + 1, Date.now() - 1);
    for (const spaceId of [repo, unclaimed.spaceId]) {
      expect((await send(origin, "GET", `/api/spaces/${spaceId}/nodes`)).status).toBe(404);
    }
    expect(await reach(origin, repo, pull, member)).toEqual(reachesNothing);
    expect(await refusals(origin, pull, member)).toEqual([404, 404, 404]);
  }, 30_000);
});

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
  application.attachWebSocket(server);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not expose a TCP address");
  return { origin: `http://127.0.0.1:${address.port}`, repositories: application.repositories };
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
  const response = await send(origin, "POST", "/api/auth/password/register", { username, displayName: username, password: "correct horse battery staple" });
  if (response.status !== 201) throw new Error(`Registration failed with ${response.status}`);
  return signedIn(origin, response);
}

async function guestAgent(origin: string): Promise<Actor & { readonly spaceId: string }> {
  const response = await send(origin, "POST", "/api/auth/guest", {});
  if (response.status !== 201) throw new Error(`Guest creation failed with ${response.status}`);
  const agent = await signedIn(origin, response);
  const { spaces } = (await (await send(origin, "GET", "/api/spaces", undefined, agent.cookie)).json()) as { spaces: { id: string; type: string }[] };
  return { ...agent, spaceId: spaces.find((space) => space.type === "personal")!.id };
}

async function claim(origin: string, agent: Actor, human: Actor): Promise<void> {
  const { code } = (await (await send(origin, "POST", "/api/agents/claim-codes", undefined, agent.cookie)).json()) as { code: string };
  const response = await send(origin, "POST", "/api/agents/claim", { code }, human.cookie);
  if (response.status !== 200) throw new Error(`Claim failed with ${response.status}`);
}

async function claimedAgent(origin: string, human: Actor): Promise<Actor> {
  const agent = await guestAgent(origin);
  await claim(origin, agent, human);
  return agent;
}

async function createRepo(origin: string, actor: Actor, name: string): Promise<string> {
  const response = await send(origin, "POST", "/api/team-spaces", { name }, actor.cookie);
  if (response.status !== 201) throw new Error(`Team Space creation failed with ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { id: string }).id;
}

function setRole(origin: string, spaceId: string, actor: Actor, userId: string, role: string): Promise<Response> {
  return send(origin, "PUT", `/api/team-spaces/${spaceId}/members/${userId}`, { role }, actor.cookie);
}

async function members(origin: string, spaceId: string, actor: Actor): Promise<string[][]> {
  const response = await send(origin, "GET", `/api/team-spaces/${spaceId}/members`, undefined, actor.cookie);
  const body = (await response.json()) as { members: { user: { id: string }; role: string }[] };
  return body.members.map(({ user, role }) => [user.id, role]).sort();
}

async function spaceAccess(origin: string, spaceId: string, actor: Actor): Promise<unknown> {
  const { accessRole, affiliation, capabilities } = (await (await send(origin, "GET", `/api/spaces/${spaceId}`, undefined, actor.cookie)).json()) as Record<string, unknown>;
  return { accessRole, affiliation, capabilities };
}

async function mine(origin: string, actor: Actor): Promise<{ id: string; affiliation: string; accessRole: string }[]> {
  const { spaces } = (await (await send(origin, "GET", "/api/spaces", undefined, actor.cookie)).json()) as { spaces: { id: string; affiliation: string; accessRole: string }[] };
  return spaces.map(({ id, affiliation, accessRole }) => ({ id, affiliation, accessRole }));
}

function createFileRequest(origin: string, actor: Actor, spaceId: string, name: string): Promise<Response> {
  return send(origin, "POST", "/api/resources", { kind: "univer", spaceId, parentNodeId: null, name, unitType: "sheet" },
    actor.cookie, { "idempotency-key": randomUUID() });
}

async function createFile(origin: string, actor: Actor, spaceId: string, name: string): Promise<string> {
  const response = await createFileRequest(origin, actor, spaceId, name);
  if (response.status !== 201) throw new Error(`File creation failed with ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { node: { id: string } }).node.id;
}

async function fileNames(origin: string, spaceId: string, actor?: Actor): Promise<string[]> {
  const response = await send(origin, "GET", `/api/spaces/${spaceId}/nodes`, undefined, actor?.cookie);
  if (response.status !== 200) throw new Error(`Listing failed with ${response.status}`);
  return ((await response.json()) as { nodes: { name: string }[] }).nodes.map((node) => node.name).sort();
}

async function createPull(origin: string, actor: Actor, spaceId: string): Promise<string> {
  const created = await send(origin, "POST", "/api/worktrees", { kind: "team", teamSpaceId: spaceId, visibility: "space", name: "Budget", summary: null },
    actor.cookie, { "idempotency-key": randomUUID() });
  if (created.status !== 201) throw new Error(`Pull request creation failed with ${created.status}: ${await created.text()}`);
  const { id } = (await created.json()) as { id: string };
  const unit = await send(origin, "POST", `/api/worktrees/${id}/units`,
    { source: "worktree", name: "Budget sheet", unitType: "sheet", targetSpaceId: spaceId, targetParentNodeId: null },
    actor.cookie, { "idempotency-key": randomUUID() });
  if (unit.status !== 201) throw new Error(`Adding a Sheet failed with ${unit.status}: ${await unit.text()}`);
  return id;
}

async function transition(origin: string, worktreeId: string, action: "ready" | "reopen" | "merge" | "discard", actor: Actor): Promise<string> {
  const response = await send(origin, "POST", `/api/worktrees/${worktreeId}/${action}`, undefined, actor.cookie, { "idempotency-key": randomUUID() });
  if (response.status !== 200) throw new Error(`${action} failed with ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { worktree: { state: string } }).worktree.state;
}

async function expectRefused(request: Promise<Response>, code: string): Promise<void> {
  const response = await request;
  expect({ status: response.status, body: await response.json() }).toMatchObject({ status: 403, body: { error: { code } } });
}

async function createIssue(origin: string, actor: Actor, spaceId: string, title: string): Promise<number> {
  const response = await send(origin, "POST", `/api/spaces/${spaceId}/issues`, { title }, actor.cookie);
  if (response.status !== 201) throw new Error(`Issue creation failed with ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { number: number }).number;
}

const reachesAll = { listed: true, listedInRepo: true, get: 200, getByNumber: 200, issues: ["Secret plan"] };
const reachesNothing = { listed: false, listedInRepo: false, get: 404, getByNumber: 404, issues: [] };

/** What the actor sees of the Space's pull request, which is its first numbered item, and of its Issues. */
async function reach(origin: string, spaceId: string, worktreeId: string, actor: Actor) {
  const listed = async (query: string) => {
    const { items } = (await (await send(origin, "GET", `/api/worktrees?${query}`, undefined, actor.cookie)).json()) as { items: { id: string }[] };
    return items.some((item) => item.id === worktreeId);
  };
  const { items } = (await (await send(origin, "GET", "/api/issues", undefined, actor.cookie)).json()) as { items: { title: string; space: { id: string } }[] };
  return {
    listed: await listed("scope=all"),
    listedInRepo: await listed(`kind=team&teamSpaceId=${spaceId}`),
    get: (await send(origin, "GET", `/api/worktrees/${worktreeId}`, undefined, actor.cookie)).status,
    getByNumber: (await send(origin, "GET", `/api/spaces/${spaceId}/worktrees/1`, undefined, actor.cookie)).status,
    issues: items.filter((item) => item.space.id === spaceId).map((item) => item.title),
  };
}

/** Renaming, hiding and discarding the pull request, each of which an admin may do while the Space is live. */
async function refusals(origin: string, worktreeId: string, actor: Actor): Promise<number[]> {
  return [
    (await send(origin, "PATCH", `/api/worktrees/${worktreeId}`, { name: "Renamed" }, actor.cookie)).status,
    (await send(origin, "PATCH", `/api/worktrees/${worktreeId}`, { visibility: "private" }, actor.cookie)).status,
    (await send(origin, "POST", `/api/worktrees/${worktreeId}/discard`, undefined, actor.cookie, { "idempotency-key": randomUUID() })).status,
  ];
}

function issuesChanged(spaceId: string) {
  return { event: "issuesChanged", spaceId };
}

/** The live product events the actor's Browser receives. */
async function events(origin: string, actor: Actor) {
  const { ticket } = (await (await send(origin, "GET", "/universer-api/user/session-ticket", undefined, actor.cookie)).json()) as { ticket: string };
  const socket = new WebSocket(`${origin.replace("http:", "ws:")}/api/worktree-events?sessionTicket=${encodeURIComponent(ticket)}`);
  sockets.push(socket);
  const queue: unknown[] = [];
  const waiting: ((message: unknown) => void)[] = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as unknown;
    const resolve = waiting.shift();
    if (resolve) resolve(message);
    else queue.push(message);
  });
  // A message that never comes reads as null after a few seconds, so the assertion names it.
  const next = () => queue.length ? Promise.resolve(queue.shift()) : new Promise<unknown>((resolve) => {
    const deliver = (message: unknown) => {
      clearTimeout(timer);
      resolve(message);
    };
    const timer = setTimeout(() => {
      waiting.splice(waiting.indexOf(deliver), 1);
      resolve(null);
    }, 3_000);
    waiting.push(deliver);
  });
  expect(await next()).toEqual({ event: "worktreeChangeFeedReady" });
  return {
    next,
    /** Waits out messages still in flight, then reports whether none arrived. */
    none: async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return queue.length === 0;
    },
  };
}
