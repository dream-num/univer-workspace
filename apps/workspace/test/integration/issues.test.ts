import { interactivePrincipal } from "../fixtures/principal.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createProductTestApplication,
  type ProductTestApplication,
} from "../support/product-test-application.js";
import {
  createIssuesModule,
  type IssueProductChange,
} from "../../server/src/modules/issues/index.js";

const applications: ProductTestApplication[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map((application) => application.close()));
});

const forbidden = expect.objectContaining({ code: "FORBIDDEN" });
const notFound = expect.objectContaining({ code: "NOT_FOUND" });
const invalid = expect.objectContaining({ code: "INVALID_INPUT" });

describe("Issues", () => {
  it("is available only in team spaces", async () => {
    const { application, issues, owner } = await setup();
    const personal = (await application.spaces.list(owner)).spaces.find((space) => space.type === "personal");
    if (!personal) throw new Error("Personal space is missing");
    const conflict = expect.objectContaining({ code: "CONFLICT", status: 409 });
    await expect(issues.list(owner, personal.id, {})).rejects.toThrow(conflict);
    await expect(issues.create(owner, personal.id, { title: "x" })).rejects.toThrow(conflict);
    expect((await application.spaces.get(owner, personal.id)).capabilities).toMatchObject({
      createIssue: false,
      triageIssues: false,
      manageIssueLabels: false,
    });
  });

  it("derives Issue rights from the Space role", async () => {
    const { application, issues, team, hidden, owner, admin, editor, viewer, reader, stranger } = await setup();

    const capabilities = async (userId: string) => (await application.spaces.get(userId, team)).capabilities;
    expect(await capabilities(owner)).toMatchObject({ createIssue: true, triageIssues: true, manageIssueLabels: true });
    expect(await capabilities(admin)).toMatchObject({ createIssue: true, triageIssues: true, manageIssueLabels: true });
    expect(await capabilities(editor)).toMatchObject({ createIssue: true, triageIssues: true, manageIssueLabels: false });
    expect(await capabilities(viewer)).toMatchObject({ createIssue: true, triageIssues: false, manageIssueLabels: false });
    expect(await capabilities(reader)).toMatchObject({ createIssue: false, triageIssues: false, manageIssueLabels: false });

    const first = await issues.create(viewer, team, { title: "  Q3 budget misses East  ", body: "details" });
    expect(first).toMatchObject({
      number: 1,
      title: "Q3 budget misses East",
      state: "open",
      author: { id: viewer },
      capabilities: { edit: true, close: true, triage: false, comment: true },
    });
    expect((await issues.create(editor, team, { title: "Second" })).number).toBe(2);

    expect(await issues.get(reader, team, "1")).toMatchObject({
      capabilities: { edit: false, close: false, triage: false, comment: false },
    });
    await expect(issues.get(stranger, hidden, "1")).rejects.toThrow(notFound);
    await expect(issues.create(reader, team, { title: "no" })).rejects.toThrow(forbidden);
    await expect(issues.createComment(reader, team, "1", { body: "no" })).rejects.toThrow(forbidden);
    await expect(issues.update(reader, team, "1", { title: "no" })).rejects.toThrow(forbidden);

    const label = await issues.createLabel(admin, team, { name: "bug", color: "red" });
    await expect(issues.createLabel(editor, team, { name: "x", color: "red" })).rejects.toThrow(forbidden);
    await expect(issues.create(viewer, team, { title: "t", labelIds: [label.id] })).rejects.toThrow(forbidden);
    await expect(issues.update(viewer, team, "1", { labelIds: [label.id] })).rejects.toThrow(forbidden);
    await expect(issues.update(viewer, team, "2", { title: "not mine" })).rejects.toThrow(forbidden);
    await expect(issues.update(viewer, team, "2", { state: "closed" })).rejects.toThrow(forbidden);
    expect((await issues.update(viewer, team, "1", { title: "Renamed by author" })).title).toBe("Renamed by author");
    expect(await issues.update(editor, team, "1", { labelIds: [label.id], assigneeUserIds: [viewer] })).toMatchObject({
      labels: [{ name: "bug", color: "red" }],
      assignees: [{ id: viewer }],
    });
  });

  it("records state changes and relation changes on the timeline", async () => {
    const { application, issues, team, owner, editor, viewer } = await setup();
    const bug = await issues.createLabel(owner, team, { name: "Bug", color: "red" });
    await expect(issues.createLabel(owner, team, { name: "bug", color: "blue" })).rejects.toThrow(
      expect.objectContaining({ code: "CONFLICT" }),
    );
    await expect(issues.createLabel(owner, team, { name: "x", color: "#ff0000" })).rejects.toThrow(invalid);

    const node = await application.nodes.create(owner, { spaceId: team, parentNodeId: null, name: "Budget" });
    const created = await issues.create(editor, team, {
      title: "Fix budget",
      labelIds: [bug.id],
      assigneeUserIds: [viewer],
      nodeIds: [node.id],
    });
    expect(created.references).toEqual([
      expect.objectContaining({ nodeId: node.id, available: true, name: "Budget" }),
    ]);
    expect(created.referenceCount).toBe(1);

    await issues.createComment(viewer, team, "1", { body: "On it" });
    await issues.update(editor, team, "1", { state: "closed" });
    await issues.update(editor, team, "1", { state: "closed", stateReason: "not_planned" });
    await issues.update(editor, team, "1", { state: "open", labelIds: [] });
    const reopened = await issues.get(owner, team, "1");
    expect(reopened).toMatchObject({ state: "open", stateReason: null, closedAt: null, closedBy: null, commentCount: 1 });

    const kinds = (await issues.timeline(owner, team, "1", {})).items.map((item) =>
      item.type === "comment" ? "comment" : item.kind,
    );
    expect(kinds.filter((kind) => kind !== "comment").sort()).toEqual(
      ["assigned", "closed", "closed", "labeled", "node_referenced", "reopened", "unlabeled"].sort(),
    );
    expect(kinds).toContain("comment");

    const firstPage = await issues.timeline(owner, team, "1", { limit: 3 });
    expect(firstPage.items).toHaveLength(3);
    const secondPage = await issues.timeline(owner, team, "1", { limit: 100, cursor: firstPage.nextCursor });
    expect(secondPage.nextCursor).toBeNull();
    expect([...firstPage.items, ...secondPage.items].map((item) => item.id)).toEqual(
      (await issues.timeline(owner, team, "1", {})).items.map((item) => item.id),
    );

    await application.trash.trashNode(owner, node.id);
    expect((await issues.get(owner, team, "1")).references).toEqual([
      { nodeId: node.id, available: false, name: null, resource: null },
    ]);
  });

  it("validates assignees, labels and referenced files", async () => {
    const { application, issues, team, owner, stranger } = await setup();
    const other = await application.spaces.createTeamSpace(interactivePrincipal(owner), { name: "Other" });
    const foreignNode = await application.nodes.create(owner, { spaceId: other.id, parentNodeId: null, name: "Elsewhere" });
    const foreignLabel = await issues.createLabel(owner, other.id, { name: "foreign", color: "gray" });
    await issues.create(owner, team, { title: "base" });

    await expect(issues.update(owner, team, "1", { assigneeUserIds: [stranger] })).rejects.toThrow(invalid);
    await expect(issues.update(owner, team, "1", { nodeIds: [foreignNode.id] })).rejects.toThrow(invalid);
    await expect(issues.update(owner, team, "1", { labelIds: [foreignLabel.id] })).rejects.toThrow(invalid);
    await expect(issues.update(owner, team, "1", {})).rejects.toThrow(invalid);
    await expect(issues.update(owner, team, "1", { stateReason: "completed" })).rejects.toThrow(invalid);
    await expect(issues.update(owner, team, "1", { unknown: 1 })).rejects.toThrow(invalid);
    await expect(issues.create(owner, team, { title: "" })).rejects.toThrow(invalid);
    await expect(issues.get(owner, team, "0")).rejects.toThrow(invalid);
    await expect(issues.get(owner, team, "99")).rejects.toThrow(notFound);
    // Rejected updates leave no partial rows behind.
    expect((await issues.timeline(owner, team, "1", {})).items).toEqual([]);
  });

  it("filters, counts and paginates the list", async () => {
    const { application, issues, team, owner, editor, viewer } = await setup();
    const bug = await issues.createLabel(owner, team, { name: "bug", color: "red" });
    const docs = await issues.createLabel(owner, team, { name: "docs", color: "blue" });
    await issues.create(owner, team, { title: "Alpha 100%", labelIds: [bug.id], assigneeUserIds: [editor] });
    await issues.create(viewer, team, { title: "Beta", labelIds: [] });
    await issues.create(owner, team, { title: "Gamma", labelIds: [bug.id, docs.id] });
    await issues.update(owner, team, "3", { state: "closed" });

    const titles = async (query: Record<string, unknown>, userId = owner) =>
      (await issues.list(userId, team, query)).items.map((item) => item.title);
    expect(await titles({})).toEqual(["Beta", "Alpha 100%"]);
    expect(await titles({ state: "all" })).toEqual(["Gamma", "Beta", "Alpha 100%"]);
    expect(await titles({ state: "closed" })).toEqual(["Gamma"]);
    expect(await titles({ state: "all", label: "BUG" })).toEqual(["Gamma", "Alpha 100%"]);
    expect(await titles({ state: "all", label: ["bug", "docs"] })).toEqual(["Gamma"]);
    expect(await titles({ assignee: "me" }, editor)).toEqual(["Alpha 100%"]);
    expect(await titles({ assignee: "none" })).toEqual(["Beta"]);
    expect(await titles({ author: "me" }, viewer)).toEqual(["Beta"]);
    expect(await titles({ q: "100%" })).toEqual(["Alpha 100%"]);
    expect(await titles({ q: "%" })).toEqual(["Alpha 100%"]);
    expect(await titles({ state: "all", order: "asc" })).toEqual(["Alpha 100%", "Beta", "Gamma"]);
    expect((await issues.list(owner, team, { label: "bug" })).counts).toEqual({ open: 1, closed: 1 });

    const page = await issues.list(owner, team, { state: "all", limit: 2 });
    expect(page.items).toHaveLength(2);
    const rest = await issues.list(owner, team, { state: "all", limit: 2, cursor: page.nextCursor });
    expect(rest.nextCursor).toBeNull();
    expect([...page.items, ...rest.items].map((item) => item.number)).toEqual([3, 2, 1]);
    await expect(issues.list(owner, team, { limit: 0 })).rejects.toThrow(invalid);
    await expect(issues.list(owner, team, { cursor: "garbage" })).rejects.toThrow(invalid);
  });

  it("lists cross-space Issues only for spaces the caller belongs to", async () => {
    const { application, issues, team, owner, reader } = await setup();
    const other = await application.spaces.createTeamSpace(interactivePrincipal(owner), { name: "Private" });
    await issues.create(owner, team, { title: "Shared" });
    await issues.create(owner, other.id, { title: "Owner only" });

    const mine = (await issues.listMine(owner, {})).items;
    expect(mine.map((item) => item.title).sort()).toEqual(["Owner only", "Shared"]);
    expect(mine.find((item) => item.title === "Shared")?.space).toEqual({ id: team, name: "Team" });
    // The public-read viewer can read the Space directly but is not a participant of it.
    expect((await issues.listMine(reader, {})).items).toEqual([]);
    expect((await issues.list(reader, team, {})).items).toHaveLength(1);
  });

  it("limits comment edits to the author and deletion to the author or managers", async () => {
    const { issues, team, owner, admin, editor, viewer, reader } = await setup();
    await issues.create(viewer, team, { title: "Thread" });
    const comment = await issues.createComment(viewer, team, "1", { body: "first" });
    const before = (await issues.get(owner, team, "1")).updatedAt;

    await expect(issues.createComment(viewer, team, "1", { body: "   " })).rejects.toThrow(invalid);
    await expect(issues.updateComment(editor, comment.id, { body: "hijack" })).rejects.toThrow(forbidden);
    await expect(issues.updateComment(reader, comment.id, { body: "hijack" })).rejects.toThrow(forbidden);
    expect((await issues.updateComment(viewer, comment.id, { body: "edited" })).body).toBe("edited");
    await expect(issues.deleteComment(editor, comment.id)).rejects.toThrow(forbidden);
    await issues.deleteComment(admin, comment.id);
    expect((await issues.get(owner, team, "1")).commentCount).toBe(0);
    expect((await issues.get(owner, team, "1")).updatedAt >= before).toBe(true);
    await expect(issues.deleteComment(admin, comment.id)).rejects.toThrow(notFound);
  });

  it("removes a deleted label from Issues while keeping the timeline readable", async () => {
    const { issues, team, owner } = await setup();
    const label = await issues.createLabel(owner, team, { name: "temp", color: "green" });
    await issues.create(owner, team, { title: "Tagged", labelIds: [label.id] });
    expect((await issues.listLabels(owner, team)).labels).toEqual([expect.objectContaining({ name: "temp", openIssueCount: 1 })]);
    expect(await issues.updateLabel(owner, label.id, { name: "renamed", description: "d" })).toMatchObject({
      name: "renamed",
      description: "d",
      color: "green",
    });
    await issues.deleteLabel(owner, label.id);
    expect((await issues.get(owner, team, "1")).labels).toEqual([]);
    expect((await issues.timeline(owner, team, "1", {})).items).toEqual([
      expect.objectContaining({ kind: "labeled", payload: expect.objectContaining({ name: "temp" }) }),
    ]);
  });

  it("returns each committed Issue, comment and label edit during concurrent updates", async () => {
    const { issues, team, owner, editor } = await setup();
    const label = await issues.createLabel(owner, team, { name: "initial", color: "red" });
    await Promise.all([
      issues.updateLabel(owner, label.id, { name: "renamed" }),
      issues.updateLabel(owner, label.id, { color: "green" }),
    ]);
    expect((await issues.listLabels(owner, team)).labels[0]).toMatchObject({ name: "renamed", color: "green" });

    const issue = await issues.create(owner, team, { title: "initial" });
    const [first, second] = await Promise.all([
      issues.update(editor, team, issue.number, { title: "first", labelIds: [label.id] }),
      issues.update(editor, team, issue.number, { title: "second", labelIds: [] }),
    ]);
    expect(first).toMatchObject({ title: "first", labels: [{ id: label.id }] });
    expect(second).toMatchObject({ title: "second", labels: [] });

    const comment = await issues.createComment(owner, team, issue.number, { body: "initial" });
    const edits = await Promise.all([
      issues.updateComment(owner, comment.id, { body: "first" }),
      issues.updateComment(owner, comment.id, { body: "second" }),
    ]);
    expect(edits.map(({ body }) => body)).toEqual(["first", "second"]);
  });

  it("allocates distinct issue numbers for concurrent authors", async () => {
    const { issues, team, owner, editor } = await setup();
    const rows = await Promise.all([owner, editor].map(userId => issues.create(userId, team, { title: "Concurrent" })));
    expect(rows.map(row => row.number).sort()).toEqual([1, 2]);
  });

  it("rechecks Issue permissions when membership changes before the write", async () => {
    const { application, issues, team, owner, editor } = await setup();
    const issue = await issues.create(owner, team, { title: "original" });
    const repository = application.repositories.issues;
    const update = repository.updateIssue.bind(repository);
    vi.spyOn(repository, "updateIssue").mockImplementationOnce(async (...args) => {
      await application.permissions.removeTeamMember(owner, team, editor);
      return update(...args);
    });
    await expect(issues.update(editor, team, issue.number, { title: "edited" })).rejects.toThrow(forbidden);
    expect((await issues.get(owner, team, issue.number)).title).toBe("original");
  });

  it("notifies the Space audience after committed writes only", async () => {
    const changes: IssueProductChange[] = [];
    const { issues, team, owner, viewer, admin, editor } = await setup(changes);
    await issues.create(viewer, team, { title: "One" });
    await expect(issues.create(viewer, team, { title: "" })).rejects.toThrow(invalid);
    await issues.get(owner, team, "1");
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      spaceId: team,
      audienceUserIds: [owner, admin, editor, viewer].sort(),
    });
  });
});

async function setup(changes?: IssueProductChange[]) {
  const application = await createApplication();
  let clock = 1_000_000;
  // A strictly increasing clock keeps created_at ordering deterministic.
  const issues = createIssuesModule({
    repository: application.repositories.issues,
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
  const { id: team } = await application.spaces.createTeamSpace(interactivePrincipal(owner), { name: "Team", publicRead: true });
  await application.permissions.upsertTeamMember(interactivePrincipal(owner), team, admin, { role: "admin" });
  await application.permissions.upsertTeamMember(interactivePrincipal(owner), team, editor, { role: "editor" });
  await application.permissions.upsertTeamMember(interactivePrincipal(owner), team, viewer, { role: "viewer" });
  // Not public, so `stranger` cannot discover it at all.
  const { id: hidden } = await application.spaces.createTeamSpace(interactivePrincipal(owner), { name: "Hidden" });
  return { application, issues, team, hidden, owner, admin, editor, viewer, reader, stranger };
}

async function createApplication(): Promise<ProductTestApplication> {
  const application = await createProductTestApplication(
    {
      host: "127.0.0.1",
      port: 3020,
      productFilename: ":memory:",
      collaborationDatabaseFilename: ":memory:",
      secureCookies: false,
      sessionTtlMs: 60_000,
    },
    { unitStore: { createUnit: async (input) => ({ unitId: input.unitId, headRevision: 1 }) } },
  );
  applications.push(application);
  return application;
}

async function register(application: ProductTestApplication, username: string): Promise<string> {
  return (
    await application.identity.registerWithPassword({
      username,
      displayName: username,
      password: "correct horse battery staple",
    })
  ).view.user.id;
}
