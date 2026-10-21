import { describe, expect, it } from "vitest";
import { WorkspaceHttp, WorkspaceIssueFeature } from "../src/index.js";

const user = (id: string) => ({ id, username: id, displayName: id, avatarUrl: null });
const label = (id: string, name: string, openIssueCount = 0) => ({
  id, name, color: "red", description: "", openIssueCount,
});

function rawIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "i1", number: 7, space: { id: "s1", name: "Team" }, title: "Bug", body: "text",
    state: "open", stateReason: null, author: user("u1"), closedBy: null, closedAt: null,
    labels: [{ id: "l1", name: "bug", color: "red", description: "" }],
    assignees: [user("u2")], commentCount: 0, referenceCount: 1,
    createdAt: "2026-09-29T00:00:00.000Z", updatedAt: "2026-09-29T00:00:00.000Z",
    references: [{ nodeId: "n1", available: false, name: null, resource: null }],
    capabilities: { edit: true, close: true, triage: true, comment: true },
    ...overrides,
  };
}

interface Call { readonly method: string; readonly path: string; readonly body: unknown }

function feature(handler: (call: Call) => unknown): { feature: WorkspaceIssueFeature; calls: Call[] } {
  const calls: Call[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const text = await request.text();
    const call = { method: request.method, path: url.pathname + url.search, body: text ? JSON.parse(text) : undefined };
    calls.push(call);
    return Response.json(handler(call));
  };
  const http = new WorkspaceHttp({
    cookie: "workspace_session=test", fetcher, origin: "https://workspace.test", role: "client",
  });
  return { feature: new WorkspaceIssueFeature(async () => http), calls };
}

const labelList = { labels: [label("l1", "bug"), label("l2", "Docs")] };
const session = { authenticated: true, user: user("me-id") };

const owner = { ...user("owner-id"), username: "qaowner" };
const editor = { ...user("editor-id"), username: "qaeditor" };
const uuidUser = { ...user("87aa3bdd-a648-4a82-b718-136161971d18"), username: "uuid-user" };

function userDirectoryFeature(
  people = [owner, editor, uuidUser],
  searchResult: unknown = { users: people.slice(1) },
) {
  const self = people[0]!;
  let current = rawIssue({ author: self, assignees: [people[1]!] });
  return feature(({ path, method, body }) => {
    if (path === "/api/session") return { authenticated: true, user: self };
    if (path.startsWith("/api/users/search?")) return searchResult;
    if (method !== "GET") {
      const input = body as Record<string, unknown>;
      const ids = input["assigneeUserIds"] as string[] | undefined;
      current = {
        ...current,
        ...input,
        ...(ids === undefined ? {} : { assignees: ids.flatMap((id) => people.filter((person) => person.id === id)) }),
      };
      return current;
    }
    if (/\/issues(?:\?|$)/.test(path)) {
      const query = new URL(path, "https://workspace.test").searchParams;
      const author = query.get("author");
      const assignee = query.get("assignee");
      const authorMatches = author === null || (author === "me" ? self.id : author) === self.id;
      const assigneeMatches = assignee === null || (assignee === "none"
        ? (current["assignees"] as { id: string }[]).length === 0
        : (current["assignees"] as { id: string }[]).some((person) => person.id === (assignee === "me" ? self.id : assignee)));
      return { items: authorMatches && assigneeMatches ? [current] : [], nextCursor: null, counts: { open: 1, closed: 0 } };
    }
    return current;
  });
}

describe("Issue user resolution", () => {
  it.each([undefined, "s1"])("resolves exact author and assignee usernames for list/search in %s", async (spaceId) => {
    const fuzzy = { ...user("wrong-id"), username: "aaa-qaeditor", displayName: "qaeditor" };
    const { feature: issues } = userDirectoryFeature([owner, editor, fuzzy], { users: [fuzzy, editor] });
    const page = await issues.list({ ...(spaceId === undefined ? {} : { spaceId }), author: "QAOWNER", assignee: "QAEDITOR" });
    expect(page.issues).toHaveLength(1);
    expect(page.issues[0]).toMatchObject({ author: { id: owner.id }, assignees: [{ id: editor.id }] });
  });

  it("creates with usernames, @me and existing UUID or opaque user IDs", async () => {
    const { feature: issues } = userDirectoryFeature();
    const created = await issues.create({ spaceId: "s1", title: "assigned", assignees: ["QAEDITOR", "@me", uuidUser.id] });
    expect(created.assignees.map((person) => person.id)).toEqual([editor.id, owner.id, uuidUser.id]);
    const byId = await issues.create({ spaceId: "s1", title: "IDs", assignees: [editor.id, owner.id] });
    expect(byId.assignees.map((person) => person.id)).toEqual([editor.id, owner.id]);
  });

  it("adds and removes assignees by username without leaving the removed user assigned", async () => {
    const { feature: issues } = userDirectoryFeature();
    const updated = await issues.update("s1", 7, { addAssignees: ["qaowner"], removeAssignees: ["QAEDITOR"] });
    expect(updated.assignees.map((person) => person.id)).toEqual([owner.id]);
  });

  it("keeps me/@me, none and UUID filter semantics", async () => {
    const { feature: issues, calls } = userDirectoryFeature([owner, uuidUser]);
    expect((await issues.list({ author: "@me", assignee: uuidUser.id })).issues).toHaveLength(1);
    expect((await issues.list({ author: "me", assignee: "none" })).issues).toEqual([]);
    expect(calls.some((call) => call.path.startsWith("/api/users/search?query=none"))).toBe(false);
  });

  it("accepts one-character usernames, including the current user", async () => {
    const self = { ...owner, username: "x" };
    const other = { ...editor, username: "中" };
    const { feature: issues } = userDirectoryFeature([self, other]);
    const created = await issues.create({ spaceId: "s1", title: "one character", assignees: ["x", "中"] });
    expect(created.assignees.map((person) => person.id)).toEqual([self.id, other.id]);
  });

  it("does not fold Unicode case onto a different account or the current user", async () => {
    const self = { ...owner, username: "Älpha" };
    const other = { ...editor, username: "älpha" };
    const fuzzy = { ...user("fuzzy-id"), username: "AAA", displayName: "älpha" };
    const { feature: issues } = userDirectoryFeature([self, other, fuzzy], { users: [fuzzy, self, other] });
    const created = await issues.create({ spaceId: "s1", title: "Unicode", assignees: ["älphA"] });
    expect(created.assignees.map((person) => person.id)).toEqual([other.id]);
  });

  const missingUserOperations = {
    author: (issues: WorkspaceIssueFeature) => issues.list({ author: "missing" }),
    assignee: (issues: WorkspaceIssueFeature) => issues.list({ spaceId: "s1", assignee: "missing" }),
    create: (issues: WorkspaceIssueFeature) => issues.create({ spaceId: "s1", title: "invalid", assignees: ["missing"] }),
    add: (issues: WorkspaceIssueFeature) => issues.update("s1", 7, { addAssignees: ["missing"] }),
    remove: (issues: WorkspaceIssueFeature) => issues.update("s1", 7, { removeAssignees: ["missing"] }),
  };
  it.each(Object.entries(missingUserOperations))("rejects unknown usernames before %s can return misleading results or write", async (_name, run) => {
    const fuzzy = { ...user("wrong-id"), username: "missing-suffix", displayName: "missing" };
    const { feature: issues, calls } = userDirectoryFeature([owner, editor, fuzzy], { users: [fuzzy] });
    await expect(run(issues)).rejects.toMatchObject({ code: "issue-user-not-found", message: expect.stringContaining("missing") });
    expect(calls.some((call) => call.method !== "GET")).toBe(false);
  });

  it("rejects a Unicode case variant when only the other account exists", async () => {
    const self = { ...owner, username: "Älpha" };
    const { feature: issues } = userDirectoryFeature([self, editor], { users: [self] });
    await expect(issues.create({ spaceId: "s1", title: "invalid", assignees: ["älpha"] }))
      .rejects.toMatchObject({ code: "issue-user-not-found" });
  });

  it.each([{}, { users: [{}] }, { users: [{ id: 42, username: "qaeditor" }] }])("rejects malformed user-search responses: %j", async (result) => {
    const { feature: issues, calls } = userDirectoryFeature(undefined, result);
    await expect(issues.create({ spaceId: "s1", title: "invalid", assignees: ["qaeditor"] }))
      .rejects.toMatchObject({ code: "workspace-invalid-response" });
    expect(calls.some((call) => call.method !== "GET")).toBe(false);
  });
});

describe("Workspace Issue feature", () => {
  it("lists one Space or every Team Space with repeated label filters", async () => {
    const page = { items: [rawIssue()], nextCursor: null, counts: { open: 1, closed: 0 } };
    const { feature: issues, calls } = feature(() => page);
    await issues.list({ spaceId: "s 1", state: "all", labels: ["bug", "docs"], assignee: "me", search: "a b" });
    await issues.list({ assignee: "me" });
    expect(calls.map((call) => call.path)).toEqual([
      "/api/spaces/s%201/issues?state=all&label=bug&label=docs&assignee=me&q=a+b",
      "/api/issues?assignee=me",
    ]);
  });

  it("turns label names, `me` and set edits into one full-set PATCH", async () => {
    const { feature: issues, calls } = feature(({ path, method }) => {
      if (path === "/api/session") return session;
      if (path.startsWith("/api/users/search?")) return { users: [user("u2")] };
      if (path.endsWith("/issue-labels")) return labelList;
      return method === "PATCH" ? rawIssue({ title: "patched" }) : rawIssue();
    });
    const result = await issues.update("s1", 7, {
      addLabels: ["docs"], removeLabels: ["BUG"], addAssignees: ["me"], removeAssignees: ["u2"],
      addNodes: ["n2"], removeNodes: ["n1"],
    });
    expect(result.title).toBe("patched");
    expect(calls.at(-1)).toMatchObject({
      method: "PATCH",
      path: "/api/spaces/s1/issues/7",
      body: { labelIds: ["l2"], assigneeUserIds: ["me-id"], nodeIds: ["n2"] },
    });
  });

  it("rejects an unknown label before writing anything", async () => {
    const { feature: issues, calls } = feature(({ path }) =>
      path.endsWith("/issue-labels") ? labelList : rawIssue());
    await expect(issues.update("s1", 7, { addLabels: ["nope"] })).rejects.toMatchObject({
      code: "issue-label-not-found",
    });
    expect(calls.some((call) => call.method === "PATCH")).toBe(false);
  });

  it("refuses to comment when the caller cannot close, leaving no stray comment", async () => {
    const { feature: issues, calls } = feature(({ path }) =>
      path === "/api/spaces/s1/issues/7"
        ? { ...rawIssue({ number: 7 }), capabilities: { edit: false, close: false, triage: false, comment: true } }
        : rawIssue({ number: 7 }));
    await expect(issues.close("s1", 7, { comment: "closing note" })).rejects.toMatchObject({
      code: "issue-close-forbidden",
    });
    expect(calls.map((call) => call.method)).toEqual(["GET"]);
    expect(calls.some((call) => call.path.endsWith("/comments"))).toBe(false);
    expect(calls.some((call) => call.method === "PATCH")).toBe(false);
  });

  it("posts the closing comment before closing with the default reason", async () => {
    const { feature: issues, calls } = feature(({ path }) =>
      path.endsWith("/comments")
        ? { id: "c1", author: user("u1"), body: "done", createdAt: "2026-09-29T00:00:00.000Z", updatedAt: "2026-09-29T00:00:00.000Z" }
        : rawIssue({ state: "closed", stateReason: "completed", closedAt: "2026-09-29T00:00:00.000Z", closedBy: user("u1") }));
    const closed = await issues.close("s1", 7, { comment: "done" });
    expect(closed.state).toBe("closed");
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/spaces/s1/issues/7",
      "POST /api/spaces/s1/issues/7/comments",
      "PATCH /api/spaces/s1/issues/7",
    ]);
    expect(calls[2]?.body).toEqual({ state: "closed", stateReason: "completed" });
  });

  it("follows timeline cursors and rejects malformed items", async () => {
    const comment = (id: string) => ({
      type: "comment", id, author: user("u1"), body: id,
      createdAt: "2026-09-29T00:00:00.000Z", updatedAt: "2026-09-29T00:00:00.000Z",
    });
    const { feature: issues, calls } = feature(({ path }) =>
      path.includes("cursor=next")
        ? { items: [comment("b")], nextCursor: null }
        : { items: [comment("a")], nextCursor: "next" });
    expect((await issues.timeline("s1", 7)).map((item) => item.id)).toEqual(["a", "b"]);
    expect(calls).toHaveLength(2);
    const broken = feature(() => ({ items: [{ type: "comment", id: "x" }], nextCursor: null }));
    await expect(broken.feature.timeline("s1", 7)).rejects.toMatchObject({ code: "workspace-invalid-response" });
  });
});
