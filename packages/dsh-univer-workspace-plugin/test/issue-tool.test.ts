import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceApiError } from "../src/provider/api-errors.ts";
import { listIssues, readIssue } from "../src/provider/issues-api.ts";
import type { WorkspaceHttpClient } from "../src/provider/workspace-contract.ts";
import { registerIssueTool } from "../src/tools/issue.ts";

const summary = { number: 7, title: "Fix" };
const detail = {
  view: { number: 7, title: "Fix", timeline: [] },
  sets: { labelIds: ["l-bug"], assigneeUserIds: ["u-other"], nodeIds: ["n-old"] },
};
const service = {
  resolveSpaceForSession: async () => ({ userId: "u-me", spaceId: "space-team" }),
  listIssues: vi.fn(async () => ({ issues: [], counts: { open: 0, closed: 0 }, nextCursor: null })),
  readIssue: vi.fn(async () => detail),
  createIssue: vi.fn(async () => summary),
  updateIssue: vi.fn(async () => summary),
  commentOnIssue: vi.fn(async () => ({ id: "c1" })),
  listIssueLabels: vi.fn(async () => [
    { id: "l-bug", name: "bug" },
    { id: "l-docs", name: "Docs" },
  ]),
  openDocument: vi.fn(async (_user: string, resourceId: string) => ({ nodeId: `node-of-${resourceId}` })),
};
let tool: ToolDefinition;
const exec = { agent: { session: { header: { cwd: "/tmp/linked" } } } } as ToolRunContext;
const run = (args: Record<string, unknown>) => tool.execute(args as never, exec);

beforeEach(() => {
  vi.clearAllMocks();
  const ctx = {
    get: (name: string) => (name === "univerWorkspace" ? service : undefined),
    tools: {
      register: (definition: ToolDefinition) => {
        tool = definition;
        return () => undefined;
      },
    },
  } as unknown as Context;
  registerIssueTool(ctx);
});

describe("univer_issue tool", () => {
  it("defaults to the session Space and lists across Spaces for scope=mine", async () => {
    await run({ action: "list" });
    await run({ action: "list", scope: "mine", assignee: "me" });
    expect(service.listIssues.mock.calls).toEqual([
      ["u-me", { spaceId: "space-team" }],
      ["u-me", { assignee: "me" }],
    ]);
  });

  it("returns the readable view, not the ID sets used for updates", async () => {
    await expect(run({ action: "get", number: 7 })).resolves.toEqual({
      ok: true,
      operation: "issue",
      result: detail.view,
    });
    expect(service.readIssue).toHaveBeenCalledWith("u-me", "space-team", 7, { timeline: true });
  });

  it("turns names, `me` and Resource IDs into the IDs the API takes on create", async () => {
    await run({
      action: "create",
      title: "New",
      labels: ["docs"],
      assignees: ["me", "u-other"],
      resourceIds: ["r1"],
      nodeIds: ["n-blob"],
    });
    expect(service.createIssue).toHaveBeenCalledWith("u-me", "space-team", {
      title: "New",
      labelIds: ["l-docs"],
      assigneeUserIds: ["u-me", "u-other"],
      nodeIds: ["n-blob", "node-of-r1"],
    });
  });

  it("applies add/remove edits to the current sets and sends the whole result", async () => {
    await run({
      action: "update",
      number: 7,
      addLabels: ["Docs"],
      removeLabels: ["BUG"],
      addAssignees: ["me"],
      removeAssignees: ["u-other"],
      addResourceIds: ["r2"],
      removeNodeIds: ["n-old"],
    });
    expect(service.readIssue).toHaveBeenCalledWith("u-me", "space-team", 7, { timeline: false });
    expect(service.updateIssue).toHaveBeenCalledWith("u-me", "space-team", 7, {
      labelIds: ["l-docs"],
      assigneeUserIds: ["u-me"],
      nodeIds: ["node-of-r2"],
    });
  });

  it("rejects an unknown label before writing and names the known ones", async () => {
    await expect(run({ action: "update", number: 7, addLabels: ["nope"] })).rejects.toMatchObject({
      code: "ISSUE_LABEL_NOT_FOUND",
      message: expect.stringContaining("bug, docs"),
    });
    expect(service.updateIssue).not.toHaveBeenCalled();
  });

  it("posts the closing comment before the state change", async () => {
    const order: string[] = [];
    service.commentOnIssue.mockImplementationOnce(async () => (order.push("comment"), { id: "c" }));
    service.updateIssue.mockImplementationOnce(async () => (order.push("update"), summary));
    await run({ action: "close", number: 7, comment: "Done, see review", reason: "not_planned" });
    expect(order).toEqual(["comment", "update"]);
    expect(service.updateIssue).toHaveBeenCalledWith("u-me", "space-team", 7, {
      state: "closed",
      stateReason: "not_planned",
    });
  });

  it("explains a Personal Space instead of the generic concurrency conflict", async () => {
    service.listIssues.mockRejectedValueOnce(
      new WorkspaceApiError("workspace issues list failed: Issues are available only in team spaces.", 409, "CONFLICT"),
    );
    await expect(run({ action: "list" })).rejects.toMatchObject({ code: "ISSUES_TEAM_SPACE_ONLY" });
  });

  it("validates required arguments", async () => {
    await expect(run({ action: "get" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(run({ action: "comment", number: 7, body: " " })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(run({ action: "update", number: 7 })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
});

describe("Issue provider", () => {
  function client(routes: Record<string, unknown>): WorkspaceHttpClient & { paths: string[] } {
    const paths: string[] = [];
    return {
      origin: "https://w.test",
      sessionToken: "t",
      paths,
      request: async (path: string) => {
        paths.push(path);
        const key = path.split("?")[0]!;
        return Response.json(routes[path] ?? routes[key] ?? {});
      },
    };
  }
  const user = (id: string) => ({ id, username: id, displayName: `Name ${id}`, avatarUrl: null });
  const issue = {
    number: 7, title: "Fix", state: "closed", stateReason: "not_planned", author: user("a"),
    space: { id: "s", name: "Team" }, labels: [{ id: "l1", name: "bug" }], assignees: [user("b")],
    commentCount: 1, referenceCount: 1, createdAt: "t1", updatedAt: "t2", body: "text",
    references: [{ nodeId: "n1", available: true, name: "Budget", resource: { id: "r1", kind: "univer", unitId: "u", unitType: "sheet" } }],
    capabilities: { edit: true, triage: false, comment: true },
  };

  it("compacts users, labels and events, and keeps IDs only in `sets`", async () => {
    const http = client({
      "/api/spaces/s/issues/7": issue,
      "/api/spaces/s/issues/7/timeline": {
        items: [
          { type: "comment", author: user("a"), body: "hello", createdAt: "t3" },
          { type: "event", kind: "labeled", actor: user("b"), payload: { name: "bug" }, createdAt: "t4" },
          { type: "event", kind: "closed", actor: user("a"), payload: { reason: "not_planned" }, createdAt: "t5" },
        ],
        nextCursor: null,
      },
    });
    const { view, sets } = await readIssue(http, "s", 7, { timeline: true });
    expect(view).toMatchObject({
      author: "Name a", labels: ["bug"], assignees: ["Name b"], stateReason: "not_planned",
      references: [{ nodeId: "n1", resourceId: "r1", kind: "univer", name: "Budget" }],
      timeline: [
        { type: "comment", author: "Name a", text: "hello" },
        { type: "event", author: "Name b", text: "added label bug" },
        { type: "event", author: "Name a", text: "closed as not planned" },
      ],
    });
    expect(sets).toEqual({ labelIds: ["l1"], assigneeUserIds: ["b"], nodeIds: ["n1"] });
    expect(JSON.stringify(view)).not.toContain("avatarUrl");
    await readIssue(http, "s", 7, { timeline: false });
    expect(http.paths.filter((path) => path.includes("timeline"))).toHaveLength(1);
  });

  it("encodes filters and rejects malformed responses", async () => {
    const http = client({ "/api/issues": { items: [], counts: { open: 0, closed: 0 }, nextCursor: null } });
    await listIssues(http, { state: "all", labels: ["a b", "c"], assignee: "me", search: "x y", limit: 5 });
    expect(http.paths[0]).toBe("/api/issues?state=all&label=a+b&label=c&assignee=me&q=x+y&limit=5");
    await expect(listIssues(client({ "/api/issues": { items: [{ nope: 1 }], counts: {} } }), {})).rejects.toBeInstanceOf(WorkspaceApiError);
  });
});
