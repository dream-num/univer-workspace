import { interactivePrincipal } from "../fixtures/principal.js";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createProductTestApplication, type ProductTestApplication } from "../support/product-test-application.js";

const applications: ProductTestApplication[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(applications.splice(0).map((application) => application.close()));
});

const refused = (code: string) => expect.objectContaining({ code });

describe("Issue verdicts", () => {
  it("lets an assignee submit, whoever may close send back with a reason, and accept to close as completed", async () => {
    const { application, owner, viewerAgent, otherViewer, team } = await setup();
    const { issues } = application;
    const issue = await issues.create(owner, team, { title: "Fix totals", assigneeUserIds: [viewerAgent] });
    const verdict = (userId: string, kind: string, body?: string) =>
      issues.verdict(userId, team, issue.number, body === undefined ? { kind } : { kind, body });

    expect((await issues.get(owner, team, issue.number)).acceptance).toBeNull();
    await expect(verdict(otherViewer, "submitted", "Done")).rejects.toEqual(refused("FORBIDDEN"));
    await expect(verdict(viewerAgent, "submitted")).rejects.toEqual(refused("INVALID_INPUT"));
    await expect(verdict(owner, "accepted")).rejects.toEqual(refused("ISSUE_NOT_SUBMITTED"));

    const submitted = await verdict(viewerAgent, "submitted", "Fixed B12. Checked the totals. Assumed East is new.");
    expect(submitted).toMatchObject({
      state: "open",
      acceptance: { kind: "submitted", actor: { id: viewerAgent }, body: "Fixed B12. Checked the totals. Assumed East is new." },
    });
    expect((await verdict(viewerAgent, "submitted", "Fixed B12. Checked the totals. Assumed East is new.")).acceptance)
      .toEqual(submitted.acceptance);
    await expect(verdict(viewerAgent, "submitted", "Another summary")).rejects.toEqual(refused("ISSUE_ALREADY_SUBMITTED"));
    await expect(verdict(viewerAgent, "accepted")).rejects.toEqual(refused("FORBIDDEN"));
    await expect(verdict(viewerAgent, "sent_back", "Mine")).rejects.toEqual(refused("FORBIDDEN"));
    await expect(verdict(owner, "sent_back")).rejects.toEqual(refused("INVALID_INPUT"));
    await expect(verdict(owner, "sent_back", "  ")).rejects.toEqual(refused("INVALID_INPUT"));
    expect(await numbers(application, viewerAgent, { acceptance: "submitted", assignee: "me" })).toEqual([issue.number]);

    const sentBack = await verdict(owner, "sent_back", "West is missing.");
    expect(sentBack.acceptance).toMatchObject({ kind: "sent_back", actor: { id: owner }, body: "West is missing." });
    expect(await numbers(application, viewerAgent, { acceptance: "sent_back", assignee: "me" })).toEqual([issue.number]);
    expect(await numbers(application, viewerAgent, { acceptance: "submitted" })).toEqual([]);
    expect((await issues.list(owner, team, { acceptance: "sent_back" })).counts).toEqual({ open: 1, closed: 0 });
    await expect(issues.list(owner, team, { acceptance: "accepted" })).rejects.toEqual(refused("INVALID_INPUT"));
    await expect(verdict(owner, "accepted")).rejects.toEqual(refused("ISSUE_NOT_SUBMITTED"));

    await verdict(viewerAgent, "submitted", "Added West.");
    const accepted = await verdict(owner, "accepted");
    expect(accepted).toMatchObject({
      state: "closed", stateReason: "completed", closedBy: { id: owner },
      acceptance: { kind: "accepted", actor: { id: owner }, body: "" },
    });
    expect((await verdict(owner, "accepted")).acceptance).toEqual(accepted.acceptance);
    await expect(verdict(viewerAgent, "submitted", "Again")).rejects.toEqual(refused("ISSUE_CLOSED"));
    expect(await numbers(application, owner, { acceptance: "submitted", state: "all" })).toEqual([]);

    const timeline = (await issues.timeline(otherViewer, team, issue.number, {})).items;
    expect(timeline.filter((item) => item.type === "event").map((item) => [item.kind, item.actor.id, item.payload])).toEqual([
      ["assigned", owner, expect.objectContaining({ userId: viewerAgent })],
      ["submitted", viewerAgent, { body: "Fixed B12. Checked the totals. Assumed East is new." }],
      ["sent_back", owner, { body: "West is missing." }],
      ["submitted", viewerAgent, { body: "Added West." }],
      ["closed", owner, { reason: "completed" }],
      ["accepted", owner, { body: "" }],
    ]);
    const firstPage = await issues.timeline(owner, team, issue.number, { limit: 5 });
    const secondPage = await issues.timeline(owner, team, issue.number, { cursor: firstPage.nextCursor });
    expect([...firstPage.items, ...secondPage.items].map((item) => item.id)).toEqual(timeline.map((item) => item.id));
  });

  it("lets an editor agent that may close the Issue accept its own submission", async () => {
    const { application, owner, editorAgent, team } = await setup();
    const issue = await application.issues.create(owner, team, { title: "Rename tab", assigneeUserIds: [editorAgent] });
    await application.issues.verdict(editorAgent, team, issue.number, { kind: "submitted", body: "Renamed." });
    expect(await application.issues.verdict(editorAgent, team, issue.number, { kind: "accepted" })).toMatchObject({
      state: "closed", stateReason: "completed", closedBy: { id: editorAgent },
      acceptance: { kind: "accepted", actor: { id: editorAgent } },
    });
  });

  it("treats a repeated verdict as a no-op only while the Issue is still as that verdict left it", async () => {
    const { application, owner, viewerAgent, team } = await setup();
    const { issues } = application;
    const issue = await issues.create(owner, team, { title: "Replay", assigneeUserIds: [viewerAgent] });
    const verdict = (userId: string, kind: string, body: string) => issues.verdict(userId, team, issue.number, { kind, body });

    await verdict(viewerAgent, "submitted", "Done.");
    await verdict(owner, "accepted", "");
    await issues.update(owner, team, issue.number, { state: "open" });
    await expect(verdict(owner, "accepted", "")).rejects.toEqual(refused("ISSUE_NOT_SUBMITTED"));
    expect((await issues.get(owner, team, issue.number)).state).toBe("open");

    await verdict(viewerAgent, "submitted", "Done again.");
    await issues.update(owner, team, issue.number, { state: "closed", stateReason: "not_planned" });
    await expect(verdict(viewerAgent, "submitted", "Done again.")).rejects.toEqual(refused("ISSUE_CLOSED"));
  });

  it("closes once and records one verdict when two accepts race", async () => {
    const { application, owner, editorAgent, viewerAgent, team } = await setup();
    const { issues } = application;
    for (const acceptors of [[owner, editorAgent], [owner, owner]]) {
      const issue = await issues.create(owner, team, { title: "Race", assigneeUserIds: [viewerAgent] });
      await issues.verdict(viewerAgent, team, issue.number, { kind: "submitted", body: "Done." });
      const results = await Promise.allSettled(acceptors.map((userId) => issues.verdict(userId, team, issue.number, { kind: "accepted" })));
      const fulfilled = results.filter((result) => result.status === "fulfilled");
      if (acceptors[0] === acceptors[1]) expect(fulfilled).toHaveLength(2);
      else expect(results.map((result) => result.status === "rejected" ? result.reason.code : "ok").sort()).toEqual(["ISSUE_CLOSED", "ok"]);
      const kinds = (await issues.timeline(owner, team, issue.number, {})).items.flatMap((item) => item.type === "event" ? [item.kind] : []);
      expect(kinds.filter((kind) => kind === "accepted")).toHaveLength(1);
      expect(kinds.filter((kind) => kind === "closed")).toHaveLength(1);
    }
  });

  it("serves verdicts over HTTP and shows the acceptance as a closed Issue in Space activity", async () => {
    const { application, owner, team } = await setup();
    const issue = await application.issues.create(owner, team, { title: "Over HTTP", assigneeUserIds: [owner] });
    const server = createServer(application.app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Server did not expose a TCP address");
    const login = await fetch(`http://127.0.0.1:${address.port}/api/auth/password/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "owner", password: "correct horse battery staple" }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const post = (kind: string, body?: string) => fetch(`http://127.0.0.1:${address.port}/api/spaces/${team}/issues/${issue.number}/verdicts`, {
      method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ kind, body }),
    });
    expect((await post("accepted")).status).toBe(409);
    expect((await post("submitted", "Done.")).status).toBe(200);
    const accepted = await post("accepted", "Looks right.");
    expect(await accepted.json()).toMatchObject({ state: "closed", acceptance: { kind: "accepted", body: "Looks right." } });
    const activity = await (await fetch(`http://127.0.0.1:${address.port}/api/spaces/${team}/activity?timeZone=UTC`, { headers: { cookie } })).json();
    expect(activity.events).toContainEqual(expect.objectContaining({
      kind: "issue-closed", actor: expect.objectContaining({ id: owner }), issue: expect.objectContaining({ number: issue.number }),
    }));
  });
});

async function numbers(application: ProductTestApplication, userId: string, query: Record<string, string>): Promise<number[]> {
  return (await application.issues.listMine(userId, query)).items.map((item) => item.number);
}

async function setup() {
  const application = await createProductTestApplication({
    host: "127.0.0.1", port: 0, productFilename: ":memory:", collaborationDatabaseFilename: ":memory:",
    secureCookies: false, sessionTtlMs: 60_000, passwordAuthEnabled: true, agentCreateLimitPerHour: 100,
  });
  applications.push(application);
  const register = async (username: string) => (await application.identity.registerWithPassword({
    username, displayName: username, password: "correct horse battery staple",
  })).view.user.id;
  const [owner, otherViewer] = [await register("owner"), await register("other-viewer")];
  const agent = async (label: string) => {
    const { user } = await application.identity.createAgent({ label, originIp: "203.0.113.9" });
    await application.repositories.identity.claimAgent(user.id, owner, Date.now());
    return user.id;
  };
  const [viewerAgent, editorAgent] = [await agent("viewer-agent"), await agent("editor-agent")];
  const { id: team } = await application.spaces.createTeamSpace(interactivePrincipal(owner), { name: "Team" });
  await application.permissions.upsertTeamMember(interactivePrincipal(owner), team, viewerAgent, { role: "viewer" });
  await application.permissions.upsertTeamMember(interactivePrincipal(owner), team, otherViewer, { role: "viewer" });
  await application.permissions.upsertTeamMember(interactivePrincipal(owner), team, editorAgent, { role: "editor" });
  return { application, owner, otherViewer, viewerAgent, editorAgent, team };
}
