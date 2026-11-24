import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createProductTestApplication, type ProductTestApplication } from "../support/product-test-application.js";

const applications: ProductTestApplication[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(applications.splice(0).map((application) => application.close()));
});

// Rows compare millisecond times, so each phase starts in a later millisecond than the one before.
const nextMillisecond = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("the Issue acceptance panel's data", () => {
  it("hides a linked private pull request and its files from a member who may not see it", async () => {
    const { application, register, team, owner } = await setup();
    const editor = await register("editor");
    const viewer = await register("viewer");
    await application.permissions.upsertTeamMember(owner.id, team, editor.id, { role: "editor" });
    await application.permissions.upsertTeamMember(owner.id, team, viewer.id, { role: "viewer" });
    const sheet = await application.resources.create(owner.id, randomUUID(), {
      kind: "univer", spaceId: team, parentNodeId: null, name: "Totals", unitType: "sheet",
    });
    if (sheet.status === 202) throw new Error("Resource creation pending");
    const issue = await application.issues.create(owner.id, team, { title: "Fix totals", assigneeUserIds: [editor.id] });
    const pull = async (visibility: "space" | "private") => {
      const { id } = (await application.worktrees.create(editor.id, randomUUID(), {
        kind: "team", teamSpaceId: team, visibility, name: visibility, summary: null, issueNumber: issue.number,
      })).body;
      const { unitId } = (await application.worktrees.addUnit(editor.id, id, randomUUID(), {
        source: "trunk", resourceId: sheet.body.node.resource!.id,
      })).body.unit;
      return { id, unitId };
    };
    const shared = await pull("space");
    const hidden = await pull("private");

    expect((await application.issues.get(viewer.id, team, issue.number)).pullRequests.map((item) => item.id)).toEqual([shared.id]);
    expect((await application.worktrees.get(viewer.id, shared.id)).worktree.units.map((unit) => unit.unitId)).toEqual([shared.unitId]);
    await expect(application.worktrees.get(viewer.id, hidden.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const origin = await listen(application);
    const files = (id: string, unitId: string) =>
      fetch(`${origin}/universer-api/worktrees/${id}/units/${unitId}/comparison`, { headers: { cookie: viewer.cookie } });
    expect((await files(shared.id, shared.unitId)).status).toBe(200);
    expect((await files(hidden.id, hidden.unitId)).status).toBe(404);
    expect((await fetch(`${origin}/api/worktrees/${hidden.id}/html-view-drafts`, { headers: { cookie: viewer.cookie } })).status).toBe(404);
  }, 60_000);

  it("lists only the Team Space memberships an assignee granted after its assignment, as they stand now", async () => {
    const { application, register, team, owner } = await setup();
    const assignee = await register("assignee");
    const [early, later, byOwner, regranted] = [
      await register("early"), await register("later"), await register("by-owner"), await register("regranted"),
    ];
    await application.permissions.upsertTeamMember(owner.id, team, assignee.id, { role: "admin" });
    await application.permissions.upsertTeamMember(assignee.id, team, early.id, { role: "viewer" });
    await application.permissions.upsertTeamMember(assignee.id, team, regranted.id, { role: "viewer" });
    await nextMillisecond();
    const issue = await application.issues.create(owner.id, team, { title: "Invite the reviewers", assigneeUserIds: [assignee.id] });
    await nextMillisecond();
    await application.permissions.upsertTeamMember(assignee.id, team, later.id, { role: "editor" });
    await application.permissions.upsertTeamMember(owner.id, team, byOwner.id, { role: "viewer" });
    await nextMillisecond();
    await application.permissions.upsertTeamMember(assignee.id, team, regranted.id, { role: "editor" });
    await application.permissions.upsertTeamMember(assignee.id, team, byOwner.id, { role: "editor" });
    await nextMillisecond();
    await application.permissions.upsertTeamMember(owner.id, team, byOwner.id, { role: "viewer" });

    const changes = await application.issues.accessChanges(owner.id, team, issue.number);
    expect(changes.members.map((row) => [row.user.id, row.role, row.grantedBy.id])).toEqual([
      [regranted.id, "editor", assignee.id],
      [later.id, "editor", assignee.id],
    ]);
    expect(changes).toMatchObject({ publicRead: false, membersTruncated: false, personalSharing: null });

    await application.spaces.update(owner.id, team, { publicRead: true });
    expect((await application.issues.accessChanges(owner.id, team, issue.number)).publicRead).toBe(true);
    await application.issues.update(owner.id, team, issue.number, { assigneeUserIds: [] });
    expect((await application.issues.accessChanges(owner.id, team, issue.number)).members).toEqual([]);
  }, 60_000);

  it("shows an assignee's Personal Space sharing to that assignee and its claimer, and to nobody else", async () => {
    const { application, register, team, owner: claimer } = await setup();
    const member = await register("member");
    const grantee = await register("grantee");
    await application.permissions.upsertTeamMember(claimer.id, team, member.id, { role: "editor" });
    const { user: agent } = await application.identity.createAgent({ label: "worker", originIp: "203.0.113.9" });
    await application.repositories.identity.claimAgent(agent.id, claimer.id, Date.now());
    await application.permissions.upsertTeamMember(claimer.id, team, agent.id, { role: "editor" });
    const personal = (await application.spaces.list(agent.id)).spaces.find((space) => space.type === "personal")!.id;
    const node = (name: string) => application.nodes.create(agent.id, { spaceId: personal, parentNodeId: null, name });
    const [before, shared, granted] = [await node("Before"), await node("Shared"), await node("Granted")];
    await application.permissions.updateNodeLinkSharing(agent.id, before.id, { enabled: true, role: "viewer" });
    await nextMillisecond();
    const issue = await application.issues.create(claimer.id, team, { title: "Publish totals", assigneeUserIds: [agent.id] });
    await nextMillisecond();
    await application.permissions.updateNodeLinkSharing(agent.id, shared.id, { enabled: true, role: "viewer" });
    await application.permissions.upsertNodeGrant(agent.id, granted.id, grantee.id, { role: "editor" });

    const read = (userId: string) => application.issues.accessChanges(userId, team, issue.number);
    const expected = {
      items: expect.arrayContaining([
        expect.objectContaining({ kind: "link", actor: expect.objectContaining({ id: agent.id }), node: { id: shared.id, name: "Shared" }, enabled: true }),
        expect.objectContaining({ kind: "grant", node: { id: granted.id, name: "Granted" }, role: "editor", user: expect.objectContaining({ id: grantee.id }) }),
      ]),
      truncated: false,
    };
    for (const reader of [claimer.id, agent.id]) {
      const { personalSharing } = await read(reader);
      expect(personalSharing).toEqual(expected);
      expect(personalSharing!.items).toHaveLength(2);
    }
    expect((await read(member.id)).personalSharing).toBeNull();

    const origin = await listen(application);
    const response = await fetch(`${origin}/api/spaces/${team}/issues/${issue.number}/access-changes`, { headers: { cookie: member.cookie } });
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain(shared.id);
  }, 60_000);
});

async function listen(application: ProductTestApplication): Promise<string> {
  const server = createServer(application.app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not expose a TCP address");
  return `http://127.0.0.1:${address.port}`;
}

async function setup() {
  const application = await createProductTestApplication({
    host: "127.0.0.1", port: 0, productFilename: ":memory:", collaborationDatabaseFilename: ":memory:",
    secureCookies: false, sessionTtlMs: 60_000, passwordAuthEnabled: true, agentCreateLimitPerHour: 100,
  });
  applications.push(application);
  const register = async (username: string) => {
    const issued = await application.identity.registerWithPassword({
      username, displayName: username, password: "correct horse battery staple",
    });
    return { id: issued.view.user.id, cookie: `${application.identity.cookieName}=${issued.cookieValue}` };
  };
  const owner = await register("owner");
  const { id: team } = await application.spaces.createTeamSpace(owner.id, { name: "Team" });
  return { application, register, owner, team };
}
