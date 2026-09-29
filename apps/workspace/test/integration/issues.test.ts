import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkspaceApplication,
  type WorkspaceApplication,
} from "../../server/src/app.js";
import {
  createIssuesModule,
  IssuesRepository,
  type IssueProductChange,
} from "../../server/src/modules/issues/index.js";

const applications: WorkspaceApplication[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map((application) => application.close()));
});

const forbidden = expect.objectContaining({ code: "FORBIDDEN" });
const notFound = expect.objectContaining({ code: "NOT_FOUND" });
const invalid = expect.objectContaining({ code: "INVALID_INPUT" });

describe("Issues", () => {
  it("is available only in team spaces", async () => {
    const { application, issues, owner } = await setup();
    const personal = application.spaces.list(owner).spaces.find((space) => space.type === "personal");
    if (!personal) throw new Error("Personal space is missing");
    const conflict = expect.objectContaining({ code: "CONFLICT", status: 409 });
    expect(() => issues.list(owner, personal.id, {})).toThrow(conflict);
    expect(() => issues.create(owner, personal.id, { title: "x" })).toThrow(conflict);
    expect(application.spaces.get(owner, personal.id).capabilities).toMatchObject({
      createIssue: false,
      triageIssues: false,
      manageIssueLabels: false,
    });
  });

  it("derives Issue rights from the Space role", async () => {
    const { application, issues, team, hidden, owner, admin, editor, viewer, reader, stranger } = await setup();

    const capabilities = (userId: string) => application.spaces.get(userId, team).capabilities;
    expect(capabilities(owner)).toMatchObject({ createIssue: true, triageIssues: true, manageIssueLabels: true });
    expect(capabilities(admin)).toMatchObject({ createIssue: true, triageIssues: true, manageIssueLabels: true });
    expect(capabilities(editor)).toMatchObject({ createIssue: true, triageIssues: true, manageIssueLabels: false });
    expect(capabilities(viewer)).toMatchObject({ createIssue: true, triageIssues: false, manageIssueLabels: false });
    expect(capabilities(reader)).toMatchObject({ createIssue: false, triageIssues: false, manageIssueLabels: false });

    const first = issues.create(viewer, team, { title: "  Q3 budget misses East  ", body: "details" });
    expect(first).toMatchObject({
      number: 1,
      title: "Q3 budget misses East",
      state: "open",
      author: { id: viewer },
      capabilities: { edit: true, close: true, triage: false, comment: true },
    });
    expect(issues.create(editor, team, { title: "Second" }).number).toBe(2);

    expect(issues.get(reader, team, "1")).toMatchObject({
      capabilities: { edit: false, close: false, triage: false, comment: false },
    });
    expect(() => issues.get(stranger, hidden, "1")).toThrow(notFound);
    expect(() => issues.create(reader, team, { title: "no" })).toThrow(forbidden);
    expect(() => issues.createComment(reader, team, "1", { body: "no" })).toThrow(forbidden);
    expect(() => issues.update(reader, team, "1", { title: "no" })).toThrow(forbidden);

    const label = issues.createLabel(admin, team, { name: "bug", color: "red" });
    expect(() => issues.createLabel(editor, team, { name: "x", color: "red" })).toThrow(forbidden);
    expect(() => issues.create(viewer, team, { title: "t", labelIds: [label.id] })).toThrow(forbidden);
    expect(() => issues.update(viewer, team, "1", { labelIds: [label.id] })).toThrow(forbidden);
    expect(() => issues.update(viewer, team, "2", { title: "not mine" })).toThrow(forbidden);
    expect(() => issues.update(viewer, team, "2", { state: "closed" })).toThrow(forbidden);
    expect(issues.update(viewer, team, "1", { title: "Renamed by author" }).title).toBe("Renamed by author");
    expect(issues.update(editor, team, "1", { labelIds: [label.id], assigneeUserIds: [viewer] })).toMatchObject({
      labels: [{ name: "bug", color: "red" }],
      assignees: [{ id: viewer }],
    });
  });

  it("records state changes and relation changes on the timeline", async () => {
    const { application, issues, team, owner, editor, viewer } = await setup();
    const bug = issues.createLabel(owner, team, { name: "Bug", color: "red" });
    expect(() => issues.createLabel(owner, team, { name: "bug", color: "blue" })).toThrow(
      expect.objectContaining({ code: "CONFLICT" }),
    );
    expect(() => issues.createLabel(owner, team, { name: "x", color: "#ff0000" })).toThrow(invalid);

    const node = application.nodes.create(owner, { spaceId: team, parentNodeId: null, name: "Budget" });
    const created = issues.create(editor, team, {
      title: "Fix budget",
      labelIds: [bug.id],
      assigneeUserIds: [viewer],
      nodeIds: [node.id],
    });
    expect(created.references).toEqual([
      expect.objectContaining({ nodeId: node.id, available: true, name: "Budget" }),
    ]);
    expect(created.referenceCount).toBe(1);

    issues.createComment(viewer, team, "1", { body: "On it" });
    issues.update(editor, team, "1", { state: "closed" });
    issues.update(editor, team, "1", { state: "closed", stateReason: "not_planned" });
    issues.update(editor, team, "1", { state: "open", labelIds: [] });
    const reopened = issues.get(owner, team, "1");
    expect(reopened).toMatchObject({ state: "open", stateReason: null, closedAt: null, closedBy: null, commentCount: 1 });

    const kinds = issues.timeline(owner, team, "1", {}).items.map((item) =>
      item.type === "comment" ? "comment" : item.kind,
    );
    expect(kinds.filter((kind) => kind !== "comment").sort()).toEqual(
      ["assigned", "closed", "closed", "labeled", "node_referenced", "reopened", "unlabeled"].sort(),
    );
    expect(kinds).toContain("comment");

    const firstPage = issues.timeline(owner, team, "1", { limit: 3 });
    expect(firstPage.items).toHaveLength(3);
    const secondPage = issues.timeline(owner, team, "1", { limit: 100, cursor: firstPage.nextCursor });
    expect(secondPage.nextCursor).toBeNull();
    expect([...firstPage.items, ...secondPage.items].map((item) => item.id)).toEqual(
      issues.timeline(owner, team, "1", {}).items.map((item) => item.id),
    );

    application.trash.trashNode(owner, node.id);
    expect(issues.get(owner, team, "1").references).toEqual([
      { nodeId: node.id, available: false, name: null, resource: null },
    ]);
  });

  it("validates assignees, labels and referenced files", async () => {
    const { application, issues, team, owner, stranger } = await setup();
    const other = application.spaces.createTeamSpace(owner, { name: "Other" });
    const foreignNode = application.nodes.create(owner, { spaceId: other.id, parentNodeId: null, name: "Elsewhere" });
    const foreignLabel = issues.createLabel(owner, other.id, { name: "foreign", color: "gray" });
    issues.create(owner, team, { title: "base" });

    expect(() => issues.update(owner, team, "1", { assigneeUserIds: [stranger] })).toThrow(invalid);
    expect(() => issues.update(owner, team, "1", { nodeIds: [foreignNode.id] })).toThrow(invalid);
    expect(() => issues.update(owner, team, "1", { labelIds: [foreignLabel.id] })).toThrow(invalid);
    expect(() => issues.update(owner, team, "1", {})).toThrow(invalid);
    expect(() => issues.update(owner, team, "1", { stateReason: "completed" })).toThrow(invalid);
    expect(() => issues.update(owner, team, "1", { unknown: 1 })).toThrow(invalid);
    expect(() => issues.create(owner, team, { title: "" })).toThrow(invalid);
    expect(() => issues.get(owner, team, "0")).toThrow(invalid);
    expect(() => issues.get(owner, team, "99")).toThrow(notFound);
    // Rejected updates leave no partial rows behind.
    expect(issues.timeline(owner, team, "1", {}).items).toEqual([]);
  });

  it("filters, counts and paginates the list", async () => {
    const { application, issues, team, owner, editor, viewer } = await setup();
    const bug = issues.createLabel(owner, team, { name: "bug", color: "red" });
    const docs = issues.createLabel(owner, team, { name: "docs", color: "blue" });
    issues.create(owner, team, { title: "Alpha 100%", labelIds: [bug.id], assigneeUserIds: [editor] });
    issues.create(viewer, team, { title: "Beta", labelIds: [] });
    issues.create(owner, team, { title: "Gamma", labelIds: [bug.id, docs.id] });
    issues.update(owner, team, "3", { state: "closed" });

    const titles = (query: Record<string, unknown>, userId = owner) =>
      issues.list(userId, team, query).items.map((item) => item.title);
    expect(titles({})).toEqual(["Beta", "Alpha 100%"]);
    expect(titles({ state: "all" })).toEqual(["Gamma", "Beta", "Alpha 100%"]);
    expect(titles({ state: "closed" })).toEqual(["Gamma"]);
    expect(titles({ state: "all", label: "BUG" })).toEqual(["Gamma", "Alpha 100%"]);
    expect(titles({ state: "all", label: ["bug", "docs"] })).toEqual(["Gamma"]);
    expect(titles({ assignee: "me" }, editor)).toEqual(["Alpha 100%"]);
    expect(titles({ assignee: "none" })).toEqual(["Beta"]);
    expect(titles({ author: "me" }, viewer)).toEqual(["Beta"]);
    expect(titles({ q: "100%" })).toEqual(["Alpha 100%"]);
    expect(titles({ q: "%" })).toEqual(["Alpha 100%"]);
    expect(titles({ state: "all", order: "asc" })).toEqual(["Alpha 100%", "Beta", "Gamma"]);
    expect(issues.list(owner, team, { label: "bug" }).counts).toEqual({ open: 1, closed: 1 });

    const page = issues.list(owner, team, { state: "all", limit: 2 });
    expect(page.items).toHaveLength(2);
    const rest = issues.list(owner, team, { state: "all", limit: 2, cursor: page.nextCursor });
    expect(rest.nextCursor).toBeNull();
    expect([...page.items, ...rest.items].map((item) => item.number)).toEqual([3, 2, 1]);
    expect(() => issues.list(owner, team, { limit: 0 })).toThrow(invalid);
    expect(() => issues.list(owner, team, { cursor: "garbage" })).toThrow(invalid);
  });

  it("lists cross-space Issues only for spaces the caller belongs to", async () => {
    const { application, issues, team, owner, reader } = await setup();
    const other = application.spaces.createTeamSpace(owner, { name: "Private" });
    issues.create(owner, team, { title: "Shared" });
    issues.create(owner, other.id, { title: "Owner only" });

    const mine = issues.listMine(owner, {}).items;
    expect(mine.map((item) => item.title).sort()).toEqual(["Owner only", "Shared"]);
    expect(mine.find((item) => item.title === "Shared")?.space).toEqual({ id: team, name: "Team" });
    // The public-read viewer can read the Space directly but is not a participant of it.
    expect(issues.listMine(reader, {}).items).toEqual([]);
    expect(issues.list(reader, team, {}).items).toHaveLength(1);
  });

  it("limits comment edits to the author and deletion to the author or managers", async () => {
    const { issues, team, owner, admin, editor, viewer, reader } = await setup();
    issues.create(viewer, team, { title: "Thread" });
    const comment = issues.createComment(viewer, team, "1", { body: "first" });
    const before = issues.get(owner, team, "1").updatedAt;

    expect(() => issues.createComment(viewer, team, "1", { body: "   " })).toThrow(invalid);
    expect(() => issues.updateComment(editor, comment.id, { body: "hijack" })).toThrow(forbidden);
    expect(() => issues.updateComment(reader, comment.id, { body: "hijack" })).toThrow(forbidden);
    expect(issues.updateComment(viewer, comment.id, { body: "edited" }).body).toBe("edited");
    expect(() => issues.deleteComment(editor, comment.id)).toThrow(forbidden);
    issues.deleteComment(admin, comment.id);
    expect(issues.get(owner, team, "1").commentCount).toBe(0);
    expect(issues.get(owner, team, "1").updatedAt >= before).toBe(true);
    expect(() => issues.deleteComment(admin, comment.id)).toThrow(notFound);
  });

  it("removes a deleted label from Issues while keeping the timeline readable", async () => {
    const { issues, team, owner } = await setup();
    const label = issues.createLabel(owner, team, { name: "temp", color: "green" });
    issues.create(owner, team, { title: "Tagged", labelIds: [label.id] });
    expect(issues.listLabels(owner, team).labels).toEqual([expect.objectContaining({ name: "temp", openIssueCount: 1 })]);
    expect(issues.updateLabel(owner, label.id, { name: "renamed", description: "d" })).toMatchObject({
      name: "renamed",
      description: "d",
      color: "green",
    });
    issues.deleteLabel(owner, label.id);
    expect(issues.get(owner, team, "1").labels).toEqual([]);
    expect(issues.timeline(owner, team, "1", {}).items).toEqual([
      expect.objectContaining({ kind: "labeled", payload: expect.objectContaining({ name: "temp" }) }),
    ]);
  });

  it("notifies the Space audience after committed writes only", async () => {
    const changes: IssueProductChange[] = [];
    const { issues, team, owner, viewer, admin, editor } = await setup(changes);
    issues.create(viewer, team, { title: "One" });
    expect(() => issues.create(viewer, team, { title: "" })).toThrow(invalid);
    issues.get(owner, team, "1");
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      spaceId: team,
      audienceUserIds: [owner, admin, editor, viewer].sort(),
    });
  });
});

async function setup(changes?: IssueProductChange[]) {
  const application = createApplication();
  let clock = 1_000_000;
  // A strictly increasing clock keeps created_at ordering deterministic.
  const issues = createIssuesModule({
    repository: new IssuesRepository(application.database),
    access: application.access,
    now: () => ++clock,
    ...(changes ? { onChanged: (change: IssueProductChange) => void changes.push(change) } : {}),
  });
  const owner = await register(application, "owner");
  const admin = await register(application, "admin");
  const editor = await register(application, "editor");
  const viewer = await register(application, "viewer");
  const reader = await register(application, "reader");
  const stranger = await register(application, "stranger");
  const team = application.spaces.createTeamSpace(owner, { name: "Team", publicRead: true }).id;
  application.permissions.upsertTeamMember(owner, team, admin, { role: "admin" });
  application.permissions.upsertTeamMember(owner, team, editor, { role: "editor" });
  application.permissions.upsertTeamMember(owner, team, viewer, { role: "viewer" });
  // Not public, so `stranger` cannot discover it at all.
  const hidden = application.spaces.createTeamSpace(owner, { name: "Hidden" }).id;
  return { application, issues, team, hidden, owner, admin, editor, viewer, reader, stranger };
}

function createApplication(): WorkspaceApplication {
  const application = createWorkspaceApplication(
    {
      host: "127.0.0.1",
      port: 3020,
      databaseFilename: ":memory:",
      collaborationDatabaseFilename: ":memory:",
      secureCookies: false,
      sessionTtlMs: 60_000,
    },
    { unitStore: { createUnit: async (input) => ({ unitId: input.unitId, headRevision: 1 }) } },
  );
  applications.push(application);
  return application;
}

async function register(application: WorkspaceApplication, username: string): Promise<string> {
  return (
    await application.identity.registerWithPassword({
      username,
      displayName: username,
      password: "correct horse battery staple",
    })
  ).view.user.id;
}
