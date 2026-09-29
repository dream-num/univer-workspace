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

  it("posts the closing comment before closing with the default reason", async () => {
    const { feature: issues, calls } = feature(({ path }) =>
      path.endsWith("/comments")
        ? { id: "c1", author: user("u1"), body: "done", createdAt: "2026-09-29T00:00:00.000Z", updatedAt: "2026-09-29T00:00:00.000Z" }
        : rawIssue({ state: "closed", stateReason: "completed", closedAt: "2026-09-29T00:00:00.000Z", closedBy: user("u1") }));
    const closed = await issues.close("s1", 7, { comment: "done" });
    expect(closed.state).toBe("closed");
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /api/spaces/s1/issues/7/comments",
      "PATCH /api/spaces/s1/issues/7",
    ]);
    expect(calls[1]?.body).toEqual({ state: "closed", stateReason: "completed" });
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
