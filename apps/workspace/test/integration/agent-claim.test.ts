import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorktreeBackend } from "../../server/src/modules/worktrees/index.js";
import { createProductTestApplication, type ProductTestApplication } from "../support/product-test-application.js";

const HOUR = 60 * 60 * 1000;
const applications: ProductTestApplication[] = [];
const servers: Server[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const socket of sockets.splice(0)) socket.close();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(applications.splice(0).map((application) => application.close()));
});

describe("claiming an agent", () => {
  it("lets a signed-in human claim an unclaimed agent once, through a code the agent asked for", async () => {
    const origin = await start();
    const agent = await guestAgent(origin);
    const nodeId = await createFile(origin, agent.cookie, "Budget");
    expect((await send(origin, "PUT", `/api/nodes/${nodeId}/link-sharing`, { enabled: true, role: "viewer" }, agent.cookie)).status).toBe(200);

    const created = await send(origin, "POST", "/api/agents/claim-codes", undefined, agent.cookie);
    expect(created.status).toBe(201);
    const { code, claimUrl, expiresIn } = (await created.json()) as { code: string; claimUrl: string; expiresIn: number };
    expect({ claimUrl, expiresIn }).toEqual({ claimUrl: `/claim/${code}`, expiresIn: 600 });

    const alice = await register(origin, "alice");
    const preview = await send(origin, "GET", `/api/agents/claim?code=${code}`, undefined, alice.cookie);
    expect(await preview.json()).toMatchObject({ claimed: false, agent: { id: agent.id, username: agent.username, files: 1, stopped: false } });

    const claimed = await send(origin, "POST", "/api/agents/claim", { code }, alice.cookie);
    expect(claimed.status).toBe(200);
    expect(await claimed.json()).toMatchObject({ agent: { id: agent.id, files: 1 } });
    expect(await sessionUser(origin, agent.cookie)).toMatchObject({ kind: "agent", claimed: true });
    const sharing = (await (await send(origin, "GET", `/api/nodes/${nodeId}/link-sharing`, undefined, alice.cookie)).json()) as { owner: unknown; expiresAt: unknown };
    expect(sharing).toMatchObject({ owner: { kind: "agent", claimed: true }, expiresAt: null });
    expect((await fetch(`${origin}/api/nodes/${nodeId}`)).status).toBe(200);

    expect((await send(origin, "POST", "/api/agents/claim", { code }, alice.cookie)).status).toBe(200);
    expect(await (await send(origin, "GET", `/api/agents/claim?code=${code}`, undefined, alice.cookie)).json()).toMatchObject({ claimed: true });
    const bob = await register(origin, "bob");
    await expectError(send(origin, "POST", "/api/agents/claim", { code }, bob.cookie), 409, "AGENT_ALREADY_CLAIMED");
    await expectError(send(origin, "GET", `/api/agents/claim?code=${code}`, undefined, bob.cookie), 409, "AGENT_ALREADY_CLAIMED");
    await expectError(send(origin, "POST", "/api/agents/claim-codes", undefined, agent.cookie), 409, "AGENT_ALREADY_CLAIMED");
  });

  it("refuses an agent, a CLI session, an unknown code and a code older than ten minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const origin = await start();
    const agent = await guestAgent(origin);
    const code = await claimCode(origin, agent.cookie);

    await expectError(send(origin, "POST", "/api/agents/claim", { code }, agent.cookie), 403, "FORBIDDEN");
    await expectError(send(origin, "POST", "/api/agents/claim", { code }, (await guestAgent(origin)).cookie), 403, "FORBIDDEN");
    await register(origin, "carol");
    const cli = await send(origin, "POST", "/api/auth/cli/password/login", { username: "carol", password: PASSWORD });
    await expectError(send(origin, "POST", "/api/agents/claim", { code }, cookieOf(cli)), 403, "FORBIDDEN");
    await expectError(send(origin, "POST", "/api/agents/claim-codes", undefined, cookieOf(cli)), 403, "FORBIDDEN");

    const dave = await register(origin, "dave");
    await expectError(send(origin, "POST", "/api/agents/claim", { code: "not-a-code" }, dave.cookie), 404, "AGENT_CLAIM_INVALID");
    vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1);
    await expectError(send(origin, "POST", "/api/agents/claim", { code }, dave.cookie), 410, "AGENT_CLAIM_EXPIRED");
    expect(await sessionUser(origin, agent.cookie)).toMatchObject({ claimed: false });
    expect((await send(origin, "POST", "/api/agents/claim", { code: await claimCode(origin, agent.cookie) }, dave.cookie)).status).toBe(200);
  });

  it("makes the human an owner of the agent's Space and gives the agent nothing of the human's", async () => {
    const origin = await start();
    const agent = await guestAgent(origin);
    const agentNodeId = await createFile(origin, agent.cookie, "Agent sheet");
    const alice = await register(origin, "alice");
    const aliceNodeId = await createFile(origin, alice.cookie, "Private");
    const aliceSpaceId = await personalSpaceId(origin, alice.cookie);
    const agentSpaceId = await personalSpaceId(origin, agent.cookie);
    const bob = await register(origin, "bob");
    expect(await accessRole(origin, agentNodeId, alice.cookie)).toBeNull();

    expect((await send(origin, "POST", "/api/agents/claim", { code: await claimCode(origin, agent.cookie) }, alice.cookie)).status).toBe(200);

    expect(await accessRole(origin, agentNodeId, alice.cookie)).toBe("owner");
    expect(await (await send(origin, "GET", `/api/spaces/${agentSpaceId}`, undefined, alice.cookie)).json()).toMatchObject({ accessRole: "owner" });
    expect((await send(origin, "PATCH", `/api/nodes/${agentNodeId}`, { name: "Kept sheet" }, alice.cookie)).status).toBe(200);
    expect((await send(origin, "PUT", `/api/nodes/${agentNodeId}/link-sharing`, { enabled: true, role: "viewer" }, alice.cookie)).status).toBe(200);
    expect(await accessRole(origin, agentNodeId, bob.cookie)).toBe("viewer");

    expect(await accessRole(origin, aliceNodeId, agent.cookie)).toBeNull();
    expect((await send(origin, "GET", `/api/spaces/${aliceSpaceId}`, undefined, agent.cookie)).status).toBe(404);
    expect(await accessRole(origin, aliceNodeId, bob.cookie)).toBeNull();
    expect(await personalSpaceId(origin, agent.cookie)).toBe(agentSpaceId);
    expect(await personalSpaceId(origin, alice.cookie)).toBe(aliceSpaceId);
  });

  it("makes the human an owner of the agent's Space wherever ownership decides, and the agent nothing of the human's", async () => {
    const origin = await start();
    const { repositories } = applications.at(-1)!;
    const agent = await guestAgent(origin);
    const agentNodeId = await createFile(origin, agent.cookie, "Agent sheet");
    const agentPull = await createPull(origin, agent.cookie, "Agent draft");
    const agentSpaceId = await personalSpaceId(origin, agent.cookie);
    const alice = await register(origin, "alice");
    const aliceId = ((await sessionUser(origin, alice.cookie)) as { id: string }).id;
    const aliceNodeId = await createFile(origin, alice.cookie, "Private");
    const alicePull = await createPull(origin, alice.cookie, "Alice draft");
    const aliceSpaceId = await personalSpaceId(origin, alice.cookie);
    const bob = await register(origin, "bob");
    const agentPullByNumber = `/api/spaces/${agentSpaceId}/worktrees/${agentPull.number}`;
    expect((await send(origin, "GET", agentPullByNumber, undefined, alice.cookie)).status).toBe(404);

    expect((await send(origin, "POST", "/api/agents/claim", { code: await claimCode(origin, agent.cookie) }, alice.cookie)).status).toBe(200);

    expect(await mine(origin, alice.cookie)).toEqual([
      { id: aliceSpaceId, affiliation: "owner", accessRole: "owner" },
      { id: agentSpaceId, affiliation: "owner", accessRole: "owner" },
    ]);
    expect(await ownedNodeIds(origin, alice.cookie)).toEqual([aliceNodeId, agentNodeId].sort());
    const activity = await send(origin, "GET", `/api/spaces/${agentSpaceId}/activity?timeZone=UTC`, undefined, alice.cookie);
    expect(activity.status).toBe(200);
    expect(((await activity.json()) as { events: { pull?: { id: string } }[] }).events.map((event) => event.pull?.id)).toEqual([agentPull.id]);
    const byNumber = await send(origin, "GET", agentPullByNumber, undefined, alice.cookie);
    expect(await byNumber.json()).toMatchObject({ worktree: { id: agentPull.id, capabilities: { review: true, editDraft: false } } });
    expect(await userPullIds(origin, alice.cookie)).toEqual([agentPull.id, alicePull.id].sort());
    expect(await repositories.worktrees.audience(agentPull.id)).toContain(aliceId);
    expect(await repositories.contentPermissions.candidateUserIds(await unitIdOf(origin, agentNodeId, alice.cookie))).toContain(aliceId);
    expect((await send(origin, "PATCH", `/api/spaces/${agentSpaceId}`, { publicRead: true }, alice.cookie)).status).toBe(200);
    expect(await exploreIds(origin, alice.cookie)).toEqual([]);
    expect(await exploreIds(origin, bob.cookie)).toEqual([agentSpaceId]);

    expect(await mine(origin, agent.cookie)).toEqual([{ id: agentSpaceId, affiliation: "owner", accessRole: "owner" }]);
    expect(await ownedNodeIds(origin, agent.cookie)).toEqual([agentNodeId]);
    expect((await send(origin, "GET", `/api/spaces/${aliceSpaceId}/activity?timeZone=UTC`, undefined, agent.cookie)).status).toBe(404);
    expect((await send(origin, "GET", `/api/spaces/${aliceSpaceId}/worktrees/${alicePull.number}`, undefined, agent.cookie)).status).toBe(404);
    expect((await send(origin, "GET", `/api/worktrees/${alicePull.id}`, undefined, agent.cookie)).status).toBe(404);
    expect(await userPullIds(origin, agent.cookie)).toEqual([agentPull.id]);
    expect(await repositories.worktrees.audience(alicePull.id)).toEqual([aliceId]);
    const agentId = ((await sessionUser(origin, agent.cookie)) as { id: string }).id;
    expect(await repositories.contentPermissions.candidateUserIds(await unitIdOf(origin, aliceNodeId, alice.cookie))).not.toContain(agentId);
  });

  it("lists the human's agents with their last activity and lets the human stop one", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const origin = await start();
    const agent = await guestAgent(origin);
    const nodeId = await createFile(origin, agent.cookie, "Report");
    expect((await send(origin, "PUT", `/api/nodes/${nodeId}/link-sharing`, { enabled: true, role: "viewer" }, agent.cookie)).status).toBe(200);
    const alice = await register(origin, "alice");
    const bob = await register(origin, "bob");
    expect((await send(origin, "POST", "/api/agents/claim", { code: await claimCode(origin, agent.cookie) }, alice.cookie)).status).toBe(200);
    expect(await agents(origin, bob.cookie)).toEqual([]);

    vi.setSystemTime(Date.now() + 25 * HOUR);
    const activeAt = Date.now();
    expect((await send(origin, "GET", "/api/spaces", undefined, agent.cookie)).status).toBe(200);
    expect(await agents(origin, alice.cookie)).toEqual([{
      id: agent.id, username: agent.username, displayName: "agent", avatarUrl: null,
      spaceId: await personalSpaceId(origin, agent.cookie), files: 1, lastActiveAt: activeAt, stopped: false,
    }]);

    await expectError(send(origin, "POST", `/api/agents/${agent.id}/stop`, undefined, bob.cookie), 404, "NOT_FOUND");
    expect((await send(origin, "POST", `/api/agents/${agent.id}/stop`, undefined, alice.cookie)).status).toBe(204);
    expect((await send(origin, "GET", "/api/spaces", undefined, agent.cookie)).status).toBe(401);
    expect(await accessRole(origin, nodeId, undefined)).toBeNull();
    expect(await accessRole(origin, nodeId, alice.cookie)).toBe("owner");
    expect(await agents(origin, alice.cookie)).toMatchObject([{ id: agent.id, stopped: true }]);
    expect((await send(origin, "POST", `/api/agents/${agent.id}/stop`, undefined, alice.cookie)).status).toBe(204);
  });

  it("closes the collaboration sockets the agent holds when its owner stops it", async () => {
    const origin = await start({ realtime: true });
    const agent = await guestAgent(origin);
    const alice = await register(origin, "alice");
    expect((await send(origin, "POST", "/api/agents/claim", { code: await claimCode(origin, agent.cookie) }, alice.cookie)).status).toBe(200);
    const held = await connectBoth(origin, agent.cookie);
    const control = await connectBoth(origin, alice.cookie);
    const closed = Promise.all(held.map((socket) => socketClosed(socket)));

    expect((await send(origin, "POST", `/api/agents/${agent.id}/stop`, undefined, alice.cookie)).status).toBe(204);

    expect(await closed).toEqual([1008, 1008]);
    expect(control.map((socket) => socket.readyState)).toEqual([WebSocket.OPEN, WebSocket.OPEN]);
  });
});

describe("the claimer deciding the agent's pull requests", () => {
  it("readies, reopens, merges and discards them as the recorded actor, without editing them", async () => {
    const origin = await start({ realtime: true });
    const { repositories } = applications.at(-1)!;
    const agent = await guestAgent(origin);
    const agentSpaceId = await personalSpaceId(origin, agent.cookie);
    const kept = await createPull(origin, agent.cookie, "Budget");
    const sheet = await addLocalSheet(origin, agent.cookie, kept.id, agentSpaceId, "Budget sheet");
    const dropped = await createPull(origin, agent.cookie, "Scratch");
    await addLocalSheet(origin, agent.cookie, dropped.id, agentSpaceId, "Scratch sheet");
    const alice = await register(origin, "alice");
    const aliceId = ((await sessionUser(origin, alice.cookie)) as { id: string }).id;
    expect((await send(origin, "POST", "/api/agents/claim", { code: await claimCode(origin, agent.cookie) }, alice.cookie)).status).toBe(200);

    expect(await capabilities(origin, kept.id, alice.cookie)).toEqual({
      review: true, editDraft: false, addUnit: false, changeVisibility: false,
      markReady: true, reopen: false, merge: false, discard: true,
    });
    for (const write of claimerEdits(kept.id, sheet, agentSpaceId)) {
      await expectError(send(origin, write.method, write.path, write.body, alice.cookie, { "idempotency-key": randomUUID() }), 403, "FORBIDDEN");
    }
    const draft = await send(origin, "POST", `/api/worktrees/${kept.id}/units/${sheet}/open`, { mode: "draft" }, alice.cookie);
    expect(await draft.json()).toMatchObject({ unit: { editorMode: "readOnly" } });

    expect(await transition(origin, kept.id, "ready", alice.cookie)).toBe("ready");
    expect(await capabilities(origin, kept.id, alice.cookie)).toMatchObject({ editDraft: false, reopen: true, merge: true, discard: true });
    expect(await transition(origin, kept.id, "reopen", alice.cookie)).toBe("draft");
    expect(await transition(origin, kept.id, "ready", alice.cookie)).toBe("ready");
    const mergeKey = randomUUID();
    expect(await transition(origin, kept.id, "merge", alice.cookie, mergeKey, { revision: await revisionOf(origin, kept.id, alice.cookie) })).toBe("merged");
    const discardKey = randomUUID();
    expect(await transition(origin, dropped.id, "discard", alice.cookie, discardKey)).toBe("discarded");

    expect((await repositories.worktrees.getOperation(mergeKey))?.actor_user_id).toBe(aliceId);
    expect((await repositories.worktrees.getOperation(discardKey))?.actor_user_id).toBe(aliceId);
    const activity = await send(origin, "GET", `/api/spaces/${agentSpaceId}/activity?timeZone=UTC`, undefined, alice.cookie);
    const { events } = (await activity.json()) as { events: { kind: string; actor: { id: string } | null; pull: { id: string } }[] };
    expect(events.filter((event) => event.kind === "pull-merged")).toEqual([
      expect.objectContaining({ actor: expect.objectContaining({ id: aliceId }), pull: expect.objectContaining({ id: kept.id }) }),
    ]);
    expect(await spaceFileNames(origin, agentSpaceId, alice.cookie)).toEqual(["Budget sheet"]);
  });

  it("merges only the revision the claimer viewed, and nothing after the pull request changed", async () => {
    const origin = await start({ realtime: true });
    const agent = await guestAgent(origin);
    const agentSpaceId = await personalSpaceId(origin, agent.cookie);
    const pull = await createPull(origin, agent.cookie, "Quarterly budget");
    await addLocalSheet(origin, agent.cookie, pull.id, agentSpaceId, "First sheet");
    expect(await transition(origin, pull.id, "ready", agent.cookie)).toBe("ready");
    const alice = await register(origin, "alice");
    expect((await send(origin, "POST", "/api/agents/claim", { code: await claimCode(origin, agent.cookie) }, alice.cookie)).status).toBe(200);
    const reviewed = await revisionOf(origin, pull.id, alice.cookie);
    expect(await revisionOf(origin, pull.id, agent.cookie)).toBe(reviewed);

    expect(await transition(origin, pull.id, "reopen", agent.cookie)).toBe("draft");
    expect(await transition(origin, pull.id, "ready", agent.cookie)).toBe("ready");
    expect(await revisionOf(origin, pull.id, alice.cookie)).toBe(reviewed);
    expect((await send(origin, "PATCH", `/api/worktrees/${pull.id}`, { name: "Quarterly budget, renamed" }, agent.cookie)).status).toBe(200);
    const renamed = await revisionOf(origin, pull.id, alice.cookie);
    expect(renamed).not.toBe(reviewed);
    expect(await transition(origin, pull.id, "reopen", agent.cookie)).toBe("draft");
    await addLocalSheet(origin, agent.cookie, pull.id, agentSpaceId, "Second sheet");
    expect(await transition(origin, pull.id, "ready", agent.cookie)).toBe("ready");
    const current = await revisionOf(origin, pull.id, alice.cookie);
    expect(current).not.toBe(renamed);

    for (const body of [{ revision: reviewed }, { revision: renamed }, undefined, {}]) {
      await expectError(send(origin, "POST", `/api/worktrees/${pull.id}/merge`, body, alice.cookie, { "idempotency-key": randomUUID() }), 412, "PRECONDITION_FAILED");
    }
    await expectError(send(origin, "POST", `/api/worktrees/${pull.id}/merge`, { revision: 7 }, alice.cookie, { "idempotency-key": randomUUID() }), 400, "INVALID_INPUT");
    expect(await capabilities(origin, pull.id, alice.cookie)).toMatchObject({ merge: true });
    expect(await spaceFileNames(origin, agentSpaceId, alice.cookie)).toEqual([]);

    expect(await transition(origin, pull.id, "merge", alice.cookie, randomUUID(), { revision: current })).toBe("merged");
    expect(await spaceFileNames(origin, agentSpaceId, alice.cookie)).toEqual(["First sheet", "Second sheet"]);
  });

  it("lets the creator merge its own pull request without naming a revision, but never a stale one", async () => {
    const origin = await start({ realtime: true });
    const agent = await guestAgent(origin);
    const agentSpaceId = await personalSpaceId(origin, agent.cookie);
    const pull = await createPull(origin, agent.cookie, "Own work");
    await addLocalSheet(origin, agent.cookie, pull.id, agentSpaceId, "Own file");
    const before = await revisionOf(origin, pull.id, agent.cookie);
    expect((await send(origin, "PATCH", `/api/worktrees/${pull.id}`, { summary: "Edited" }, agent.cookie)).status).toBe(200);
    expect(await transition(origin, pull.id, "ready", agent.cookie)).toBe("ready");
    await expectError(send(origin, "POST", `/api/worktrees/${pull.id}/merge`, { revision: before }, agent.cookie, { "idempotency-key": randomUUID() }), 412, "PRECONDITION_FAILED");
    expect(await transition(origin, pull.id, "merge", agent.cookie)).toBe("merged");
    expect(await spaceFileNames(origin, agentSpaceId, agent.cookie)).toEqual(["Own file"]);
  });

  it("lets the claimer finish a stopped agent's pull requests and gives everyone else the unknown-pull-request answer", async () => {
    const origin = await start({ realtime: true });
    const agent = await guestAgent(origin);
    const agentSpaceId = await personalSpaceId(origin, agent.cookie);
    const kept = await createPull(origin, agent.cookie, "Budget");
    const sheet = await addLocalSheet(origin, agent.cookie, kept.id, agentSpaceId, "Budget sheet");
    const dropped = await createPull(origin, agent.cookie, "Scratch");
    const alice = await register(origin, "alice");
    const bob = await register(origin, "bob");
    expect((await send(origin, "POST", "/api/agents/claim", { code: await claimCode(origin, agent.cookie) }, alice.cookie)).status).toBe(200);
    expect((await send(origin, "POST", `/api/agents/${agent.id}/stop`, undefined, alice.cookie)).status).toBe(204);

    const unknown = { id: randomUUID(), number: 99 };
    for (const pull of [kept, dropped]) {
      for (const action of strangerActions(pull, agentSpaceId, sheet)) {
        const asStranger = await send(origin, action.method, action.path, action.body, bob.cookie, { "idempotency-key": randomUUID() });
        const asUnknown = await send(origin, action.method, action.of(unknown), action.body, bob.cookie, { "idempotency-key": randomUUID() });
        expect({ action: action.name, status: asStranger.status, body: await asStranger.json() })
          .toEqual({ action: action.name, status: asUnknown.status, body: await asUnknown.json() });
        expect(asStranger.status, action.name).toBe(404);
      }
    }

    expect(await transition(origin, kept.id, "ready", alice.cookie)).toBe("ready");
    expect(await transition(origin, kept.id, "merge", alice.cookie, randomUUID(), { revision: await revisionOf(origin, kept.id, alice.cookie) })).toBe("merged");
    expect(await transition(origin, dropped.id, "discard", alice.cookie)).toBe("discarded");
    expect(await spaceFileNames(origin, agentSpaceId, alice.cookie)).toEqual(["Budget sheet"]);
  });
});

const PASSWORD = "correct horse battery staple";

async function start(options: { readonly realtime?: boolean } = {}): Promise<string> {
  const application = await createProductTestApplication({
    host: "127.0.0.1",
    port: 0,
    productFilename: ":memory:",
    collaborationDatabaseFilename: ":memory:",
    secureCookies: false,
    sessionTtlMs: 48 * HOUR,
    passwordAuthEnabled: true,
    agentCreateLimitPerHour: 100,
  }, options.realtime ? {} : {
    unitStore: { createUnit: async (input) => ({ unitId: input.unitId, headRevision: 1 }) },
    worktreeBackend: draftWorktreeBackend(),
  });
  applications.push(application);
  const server = createServer(application.app);
  application.attachWebSocket(server);
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

function cookieOf(response: Response): string {
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

async function guestAgent(origin: string): Promise<{ id: string; username: string; cookie: string }> {
  const response = await send(origin, "POST", "/api/auth/guest", {});
  if (response.status !== 201) throw new Error(`Guest creation failed with ${response.status}`);
  return { ...((await response.json()) as { agent: { id: string; username: string } }).agent, cookie: cookieOf(response) };
}

async function register(origin: string, username: string): Promise<{ cookie: string }> {
  const response = await send(origin, "POST", "/api/auth/password/register", { username, displayName: username, password: PASSWORD });
  if (response.status !== 201) throw new Error(`Registration failed with ${response.status}`);
  return { cookie: cookieOf(response) };
}

async function claimCode(origin: string, cookie: string): Promise<string> {
  return ((await (await send(origin, "POST", "/api/agents/claim-codes", undefined, cookie)).json()) as { code: string }).code;
}

/** The caller's own Personal Space, which the Space list puts first. */
async function personalSpaceId(origin: string, cookie: string): Promise<string> {
  const { spaces } = (await (await send(origin, "GET", "/api/spaces", undefined, cookie)).json()) as { spaces: { id: string; type: string }[] };
  return spaces.find((space) => space.type === "personal")!.id;
}

async function mine(origin: string, cookie: string): Promise<unknown> {
  const { spaces } = (await (await send(origin, "GET", "/api/spaces", undefined, cookie)).json()) as { spaces: { id: string; affiliation: string; accessRole: string }[] };
  return spaces.map(({ id, affiliation, accessRole }) => ({ id, affiliation, accessRole }));
}

async function exploreIds(origin: string, cookie: string): Promise<string[]> {
  const { spaces } = (await (await send(origin, "GET", "/api/spaces/explore", undefined, cookie)).json()) as { spaces: { id: string }[] };
  return spaces.map((space) => space.id);
}

async function ownedNodeIds(origin: string, cookie: string): Promise<string[]> {
  const { items } = (await (await send(origin, "GET", "/api/owned-by-me", undefined, cookie)).json()) as { items: { node: { id: string } }[] };
  return items.map((item) => item.node.id).sort();
}

async function unitIdOf(origin: string, nodeId: string, cookie: string): Promise<string> {
  return ((await (await send(origin, "GET", `/api/nodes/${nodeId}`, undefined, cookie)).json()) as { node: { resource: { unitId: string } } }).node.resource.unitId;
}

async function createPull(origin: string, cookie: string, name: string): Promise<{ id: string; number: number }> {
  const response = await send(origin, "POST", "/api/worktrees", { kind: "user", name, summary: null, visibility: "private" },
    cookie, { "idempotency-key": randomUUID() });
  if (response.status !== 201) throw new Error(`Pull request creation failed with ${response.status}`);
  return (await response.json()) as { id: string; number: number };
}

async function addLocalSheet(origin: string, cookie: string, worktreeId: string, spaceId: string, name: string): Promise<string> {
  const response = await send(origin, "POST", `/api/worktrees/${worktreeId}/units`,
    { source: "worktree", name, unitType: "sheet", targetSpaceId: spaceId, targetParentNodeId: null },
    cookie, { "idempotency-key": randomUUID() });
  if (response.status !== 201) throw new Error(`Adding a Sheet failed with ${response.status}`);
  return ((await response.json()) as { unit: { unitId: string } }).unit.unitId;
}

async function revisionOf(origin: string, worktreeId: string, cookie: string): Promise<string> {
  return ((await (await send(origin, "GET", `/api/worktrees/${worktreeId}`, undefined, cookie)).json()) as { worktree: { revision: string } }).worktree.revision;
}

async function capabilities(origin: string, worktreeId: string, cookie: string): Promise<unknown> {
  return ((await (await send(origin, "GET", `/api/worktrees/${worktreeId}`, undefined, cookie)).json()) as { worktree: { capabilities: unknown } }).worktree.capabilities;
}

async function transition(origin: string, worktreeId: string, action: "ready" | "reopen" | "merge" | "discard", cookie: string, key = randomUUID(), body?: unknown): Promise<string> {
  const response = await send(origin, "POST", `/api/worktrees/${worktreeId}/${action}`, body, cookie, { "idempotency-key": key });
  if (response.status !== 200) throw new Error(`${action} failed with ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { worktree: { state: string } }).worktree.state;
}

function claimerEdits(worktreeId: string, unitId: string, spaceId: string) {
  return [
    { method: "PATCH", path: `/api/worktrees/${worktreeId}`, body: { name: "Renamed" } },
    { method: "POST", path: `/api/worktrees/${worktreeId}/units`, body: { source: "worktree", name: "Extra", unitType: "sheet", targetSpaceId: spaceId, targetParentNodeId: null } },
    { method: "POST", path: `/api/worktrees/${worktreeId}/units/${unitId}/removal`, body: { removed: true } },
    { method: "POST", path: `/api/worktrees/${worktreeId}/units/${unitId}/changesets`, body: {} },
  ];
}

function strangerActions(pull: { id: string; number: number }, spaceId: string, unitId: string) {
  const byId = (name: string, method: string, tail: string, body?: unknown) =>
    ({ name, method, body, path: `/api/worktrees/${pull.id}${tail}`, of: (other: { id: string }) => `/api/worktrees/${other.id}${tail}` });
  return [
    byId("view", "GET", ""),
    { name: "view by number", method: "GET", body: undefined, path: `/api/spaces/${spaceId}/worktrees/${pull.number}`,
      of: (other: { number: number }) => `/api/spaces/${spaceId}/worktrees/${other.number}` },
    byId("edit", "PATCH", "", { name: "Renamed" }),
    byId("add a file", "POST", "/units", { source: "worktree", name: "Extra", unitType: "sheet", targetSpaceId: spaceId, targetParentNodeId: null }),
    byId("open a file", "POST", `/units/${unitId}/open`, { mode: "draft" }),
    byId("remove a file", "POST", `/units/${unitId}/removal`, { removed: true }),
    byId("edit cells", "POST", `/units/${unitId}/changesets`, {}),
    byId("ready", "POST", "/ready"),
    byId("reopen", "POST", "/reopen"),
    byId("merge", "POST", "/merge"),
    byId("discard", "POST", "/discard"),
  ];
}

async function spaceFileNames(origin: string, spaceId: string, cookie: string): Promise<string[]> {
  const { nodes } = (await (await send(origin, "GET", `/api/spaces/${spaceId}/nodes`, undefined, cookie)).json()) as { nodes: { name: string }[] };
  return nodes.map((node) => node.name).sort();
}

async function userPullIds(origin: string, cookie: string): Promise<string[]> {
  const { items } = (await (await send(origin, "GET", "/api/worktrees?kind=user", undefined, cookie)).json()) as { items: { id: string }[] };
  return items.map((item) => item.id).sort();
}

function draftWorktreeBackend(): WorktreeBackend {
  const unused = async (): Promise<never> => { throw new Error("Unused by claim tests"); };
  const draft = async (worktreeID: string) => ({ worktreeID, status: "draft" as const, units: [] });
  return {
    createWorktree: draft, getWorktree: draft, addUnit: unused, createUnit: unused, markReady: unused,
    setUnitRemoved: unused, reopen: unused, merge: unused, discard: unused, submitChangeset: unused,
  };
}

async function createFile(origin: string, cookie: string, name: string): Promise<string> {
  const response = await send(origin, "POST", "/api/resources",
    { kind: "univer", spaceId: await personalSpaceId(origin, cookie), parentNodeId: null, name, unitType: "sheet" },
    cookie, { "idempotency-key": randomUUID() });
  if (response.status !== 201) throw new Error(`File creation failed with ${response.status}`);
  return ((await response.json()) as { node: { id: string } }).node.id;
}

async function accessRole(origin: string, nodeId: string, cookie: string | undefined): Promise<string | null> {
  const response = await send(origin, "GET", `/api/nodes/${nodeId}`, undefined, cookie);
  if (response.status === 404) return null;
  return ((await response.json()) as { node: { accessRole: string } }).node.accessRole;
}

async function sessionUser(origin: string, cookie: string): Promise<unknown> {
  return ((await (await send(origin, "GET", "/api/session", undefined, cookie)).json()) as { user: unknown }).user;
}

async function agents(origin: string, cookie: string): Promise<unknown> {
  return ((await (await send(origin, "GET", "/api/agents", undefined, cookie)).json()) as { agents: unknown }).agents;
}

async function expectError(request: Promise<Response>, status: number, code: string): Promise<void> {
  const response = await request;
  expect({ status: response.status, body: await response.json() }).toMatchObject({ status, body: { error: { code } } });
}

async function connectBoth(origin: string, cookie: string): Promise<WebSocket[]> {
  return Promise.all(["/universer-api/comb/connect", "/api/worktree-events"].map(async (path) => {
    const { ticket } = (await (await send(origin, "GET", "/universer-api/user/session-ticket", undefined, cookie)).json()) as { ticket: string };
    const socket = new WebSocket(`${origin.replace(/^http/u, "ws")}${path}?sessionTicket=${encodeURIComponent(ticket)}`);
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("WebSocket upgrade failed")), { once: true });
    });
    return socket;
  }));
}

function socketClosed(socket: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket did not close within 1 s")), 1000);
    socket.addEventListener("close", (event) => { clearTimeout(timer); resolve(event.code); }, { once: true });
  });
}
