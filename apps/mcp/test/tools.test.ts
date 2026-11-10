import { testStagingDirectory } from "./staging-directory.js";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { Writable } from "node:stream";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createGateway } from "./gateway.js";
import { whoamiTool } from "../src/gateway/tools/core/whoami.js";
import type { ToolScope } from "../src/gateway/tools/definition.js";
import { parseGatewayConfig } from "../src/shared/config.js";
import { coreNames } from "./tool-names.js";

const identityOrigin = "https://workspace.example";
const session = "test-session-secret";
const user = (id: string) => ({ id, username: id, displayName: id });
const label = { id: "l1", name: "bug", color: "red", description: "" };
const rawIssue = (number: number, overrides: Record<string, unknown> = {}) => ({
  id: `issue-${String(number)}`,
  number,
  space: { id: "team-1", name: "Team" },
  title: `Issue ${String(number)}`,
  body: "text",
  state: "open",
  stateReason: null,
  author: user("u1"),
  closedBy: null,
  closedAt: null,
  labels: [label],
  assignees: [],
  commentCount: 0,
  referenceCount: 0,
  createdAt: "2026-09-29T00:00:00.000Z",
  updatedAt: "2026-09-29T00:00:00.000Z",
  references: [],
  capabilities: { edit: true, close: true, triage: true, comment: true },
  ...overrides,
});
const personal = {
  id: "personal-1",
  name: "user-1",
  type: "personal",
  accessRole: "owner",
  affiliation: "owner",
  fullName: "user-1/personal",
  owner: { id: "user-1", username: "user-1" },
  slug: null,
};
const rawWorktree = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `PR ${id}`,
  state: "draft",
  number: 3,
  summary: null,
  kind: "team",
  visibility: "private",
  teamSpace: { id: "team-1", name: "Team" },
  creator: user("user-1"),
  createdAt: "2026-09-29T00:00:00.000Z",
  updatedAt: "2026-09-29T00:00:00.000Z",
  units: [],
  ...overrides,
});
const rawUserWorktree = (id: string, number: number) =>
  rawWorktree(id, { number, kind: "user", teamSpace: null });
const team = {
  id: "team-1",
  name: "Team",
  type: "team",
  accessRole: "admin",
  affiliation: "member",
  fullName: "bob/team",
  owner: { id: "u2", username: "bob" },
  publicRead: true,
  slug: "team",
};

describe("Issue tools and gateway infrastructure", () => {
  let gateway: ReturnType<typeof createGateway>;
  let url: string;
  let logs: string;
  let clients: Client[];
  let requests: { method: string; path: string; body: unknown }[];
  let failComments: boolean;
  let wt3State: string;
  let idempotencyKeys: (string | null)[];
  let current7: Record<string, unknown>;
  const listPages = new Map<string, unknown>();

  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const target = new URL(request.url);
    const text = await request.text();
    const path = target.pathname + target.search;
    requests.push({ method: request.method, path, body: text ? JSON.parse(text) : undefined });
    if (target.pathname === "/api/session") {
      return Response.json({ authenticated: true, user: user("user-1") });
    }
    if (target.pathname === "/api/spaces/lookup") {
      return Response.json(target.searchParams.get("slug") === "personal" ? personal : team);
    }
    if (target.pathname === "/api/spaces/team-1" || target.pathname === "/api/spaces/personal-1") {
      return Response.json(target.pathname.endsWith("team-1") ? team : personal);
    }
    if (target.pathname === "/api/worktrees" && request.method === "GET") {
      return Response.json({
        items: target.searchParams.get("kind") === "team" ? [rawWorktree("wt-3")] : [rawUserWorktree("wt-u2", 2)],
        nextCursor: null,
      });
    }
    if (target.pathname === "/api/worktrees" && request.method === "POST") {
      idempotencyKeys.push(request.headers.get("idempotency-key"));
      const kind = (JSON.parse(text) as { kind: string }).kind;
      return Response.json(kind === "user" ? rawUserWorktree("wt-u2", 2) : rawWorktree("wt-3"), { status: 201 });
    }
    if (target.pathname === "/api/spaces/team-1/worktrees/3") {
      return Response.json({ worktree: rawWorktree("wt-3") });
    }
    if (target.pathname === "/api/spaces/personal-1/worktrees/2") {
      return Response.json({ worktree: rawUserWorktree("wt-u2", 2) });
    }
    if (target.pathname === "/api/spaces/personal-bob") {
      return Response.json({ ...personal, id: "personal-bob", owner: { id: "u2", username: "bob" } });
    }
    if (target.pathname === "/api/worktrees/wt-3") {
      return Response.json({
        worktree: rawWorktree("wt-3", {
          name: request.method === "PATCH" ? "Edited" : "PR wt-3",
          state: wt3State,
        }),
      });
    }
    if (target.pathname === "/api/worktrees/wt-3/ready") {
      return Response.json({ worktree: rawWorktree("wt-3", { state: "ready" }) });
    }
    if (target.pathname === "/api/worktrees/wt-3/reopen") {
      return Response.json({ worktree: rawWorktree("wt-3", { state: "draft" }) });
    }
    if (target.pathname === "/api/spaces/team-1/issue-labels") {
      return Response.json({
        labels: ["bug", "docs", "ux"].map((name, index) => ({
          id: `l${String(index + 1)}`,
          name,
          color: "red",
          description: "",
          openIssueCount: 0,
        })),
      });
    }
    if (target.pathname === "/api/users/search") {
      return Response.json({ users: [{ id: "a1", username: "alice" }] });
    }
    if (target.pathname === "/api/spaces/team-1/issues" && request.method === "POST") {
      return Response.json(rawIssue(8), { status: 201 });
    }
    if (target.pathname === "/api/spaces/team-1/issues/7" && request.method === "PATCH") {
      return Response.json(rawIssue(7));
    }
    if (target.pathname === "/api/issues" || target.pathname === "/api/spaces/team-1/issues") {
      return Response.json(listPages.get(target.searchParams.get("cursor") ?? ""));
    }
    if (target.pathname === "/api/spaces/team-1/issues/7") {
      return Response.json(current7);
    }
    if (target.pathname === "/api/spaces/team-1/issues/7/comments") {
      if (failComments) throw new Error("socket hang up");
      return Response.json({
        id: "c1",
        type: "comment",
        author: user("user-1"),
        body: "hello",
        createdAt: "2026-09-29T00:00:00.000Z",
        updatedAt: "2026-09-29T00:00:00.000Z",
      });
    }
    if (target.pathname === "/api/spaces/team-1/issues/7/timeline") {
      return Response.json({ items: [], nextCursor: null });
    }
    return Response.json(
      { error: { code: "workspace-not-found", message: "Not found." } },
      { status: 404 },
    );
  };

  async function start(scopes?: ReadonlySet<ToolScope>) {
    const logOutput = new Writable({
      write(chunk, _encoding, callback) {
        logs += chunk.toString();
        callback();
      },
    });
    const socket = createServer();
    socket.listen(0, "127.0.0.1");
    await once(socket, "listening");
    const address = socket.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP server");
    const port = address.port;
    await new Promise((resolve) => socket.close(resolve));
    url = `http://127.0.0.1:${String(port)}/mcp`;
    gateway = createGateway(
      parseGatewayConfig({
        MCP_DEV_SESSION_PASSTHROUGH: "1",
        WORKSPACE_ORIGIN: identityOrigin,
        MCP_STAGING_DIRECTORY: testStagingDirectory(), MCP_PUBLIC_URL: url,
      }),
      { logger: pino({}, logOutput), fetcher, ...(scopes === undefined ? {} : { scopes }) },
    );
    gateway.server.listen(port, "127.0.0.1");
    await once(gateway.server, "listening");
  }
  async function connect(suffix = "") {
    const client = new Client({ name: "tools-test", version: "1.0.0" });
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url + suffix), {
        requestInit: { headers: { Authorization: `Bearer ${session}` } },
      }),
    );
    return client;
  }
  function events() {
    return logs
      .trim()
      .split("\n")
      .map((line) => z.record(z.string(), z.unknown()).parse(JSON.parse(line)))
      .filter((line) => line["event"] === "mcp.tool_call");
  }
  beforeEach(() => {
    clients = [];
    logs = "";
    requests = [];
    failComments = false;
    wt3State = "draft";
    idempotencyKeys = [];
    current7 = rawIssue(7);
    listPages.clear();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(clients.map((client) => client.close()));
    await gateway.close();
    gateway.server.closeAllConnections();
    await new Promise((resolve) => gateway.server.close(resolve));
  });

  it("lists the core tools in registry order and describes the Issue list input", async () => {
    await start();
    const core = await (await connect("?toolsets=core")).listTools();
    expect(core.tools.map((tool) => tool.name)).toEqual(
      coreNames.filter((name) => !["execute", "inspect", "screenshot", "import", "export", "job_get"].includes(name)),
    );
    const list = core.tools.find((tool) => tool.name === "issue_list")!;
    expect(list.inputSchema).toMatchObject({
      required: ["repo"],
      properties: { state: { enum: ["open", "closed", "all"] }, limit: { minimum: 1 } },
    });
  });

  it("attaches url to an Issue and reports the resolved Space", async () => {
    await start();
    const client = await connect();
    const result = await client.callTool({
      name: "issue_view",
      arguments: { repo: "bob/team", number: "#7", comments: true },
    });
    expect(result.structuredContent).toMatchObject({
      number: 7,
      url: `${identityOrigin}/spaces/team-1/issues/7`,
      timeline: [],
    });
    expect(events()[0]).toMatchObject({ tool: "issue_view", repo: "team-1", outcome: "ok" });
  });

  it("follows cursors up to limit and wraps the Issues", async () => {
    await start();
    const page = (numbers: number[], nextCursor: string | null) => ({
      items: numbers.map((number) => rawIssue(number)),
      counts: { open: 3, closed: 0 },
      nextCursor,
    });
    listPages.set("", page([1, 2], "c2"));
    listPages.set("c2", page([3], null));
    const client = await connect();
    const all = await client.callTool({ name: "issue_list", arguments: { repo: "team-1" } });
    expect(all.structuredContent).toMatchObject({
      issues: [1, 2, 3].map((number) => ({
        number,
        url: `${identityOrigin}/spaces/team-1/issues/${String(number)}`,
      })),
    });
    const limited = await client.callTool({
      name: "issue_list",
      arguments: { repo: "team-1", limit: 2, labels: ["bug"], assignee: "@me" },
    });
    expect((limited.structuredContent as { issues: unknown[] }).issues).toHaveLength(2);
    const query = requests.filter((request) => request.path.includes("/issues?")).at(-1)!.path;
    expect(query).toContain("limit=2");
    expect(query).toContain("label=bug");
    expect(query).toContain("assignee=me");
  });

  it("returns workspace-scope-required without running the tool", async () => {
    await start(new Set<ToolScope>(["read"]));
    const client = await connect();
    const result = await client.callTool({
      name: "issue_comment",
      arguments: { repo: "team-1", number: "7", body: "hello" },
    });
    expect(result).toMatchObject({
      isError: true,
      structuredContent: { code: "workspace-scope-required", detail: { required: "write" } },
    });
    expect(requests.map((request) => request.path)).toEqual(requests.map(() => "/api/session"));
    expect(events()[0]).toMatchObject({
      outcome: "tool_error",
      error_code: "workspace-scope-required",
    });
  });

  it("maps an unknown write result to workspace-result-unknown", async () => {
    await start();
    failComments = true;
    const client = await connect();
    const result = await client.callTool({
      name: "issue_comment",
      arguments: { repo: "team-1", number: "7", body: "hello" },
    });
    expect(result).toMatchObject({
      isError: true,
      structuredContent: { code: "workspace-result-unknown" },
    });
    expect(JSON.stringify(result.structuredContent)).toContain("idempotency_key");
    expect(events()[0]).toMatchObject({
      outcome: "tool_error",
      error_code: "workspace-result-unknown",
    });
  });

  it("rejects reason and comment when reopening, before any request", async () => {
    await start();
    const client = await connect();
    const result = await client.callTool({
      name: "issue_set_state",
      arguments: { repo: "team-1", number: "7", state: "open", reason: "completed" },
    });
    expect(result).toMatchObject({
      isError: true,
      structuredContent: { code: "workspace-argument-invalid" },
    });
    expect(requests.some((request) => request.path.includes("/issues"))).toBe(false);
  });

  const writesOf = () => requests.filter((request) => request.method !== "GET");

  it("sends labels, assignees and nodes when creating an Issue", async () => {
    await start();
    const result = await (
      await connect()
    ).callTool({
      name: "issue_create",
      arguments: {
        repo: "team-1",
        title: "T",
        body: "B",
        labels: ["Bug", "docs"],
        assignees: ["@me", "alice"],
        nodes: ["n1"],
      },
    });
    expect(result.structuredContent).toMatchObject({
      number: 8,
      url: expect.stringContaining("/issues/8"),
    });
    expect(writesOf()).toEqual([
      {
        method: "POST",
        path: "/api/spaces/team-1/issues",
        body: {
          title: "T",
          body: "B",
          labelIds: ["l1", "l2"],
          assigneeUserIds: ["user-1", "a1"],
          nodeIds: ["n1"],
        },
      },
    ]);
  });

  it("applies all six add and remove arrays when editing an Issue", async () => {
    await start();
    current7 = rawIssue(7, {
      labels: [label],
      assignees: [user("a1")],
      references: ["n1", "n2"].map((nodeId) => ({
        nodeId,
        available: true,
        name: nodeId,
        resource: null,
      })),
    });
    await (
      await connect()
    ).callTool({
      name: "issue_edit",
      arguments: {
        repo: "team-1",
        number: "7",
        add_labels: ["docs"],
        remove_labels: ["bug"],
        add_assignees: ["@me"],
        remove_assignees: ["alice"],
        add_nodes: ["n3"],
        remove_nodes: ["n1"],
      },
    });
    expect(writesOf()).toEqual([
      {
        method: "PATCH",
        path: "/api/spaces/team-1/issues/7",
        body: { labelIds: ["l2"], assigneeUserIds: ["user-1"], nodeIds: ["n2", "n3"] },
      },
    ]);
  });

  it("posts the comment before closing with the reason", async () => {
    await start();
    await (
      await connect()
    ).callTool({
      name: "issue_set_state",
      arguments: {
        repo: "team-1",
        number: "7",
        state: "closed",
        reason: "not_planned",
        comment: "Out of scope",
      },
    });
    expect(writesOf()).toEqual([
      {
        method: "POST",
        path: "/api/spaces/team-1/issues/7/comments",
        body: { body: "Out of scope" },
      },
      {
        method: "PATCH",
        path: "/api/spaces/team-1/issues/7",
        body: { state: "closed", stateReason: "not_planned" },
      },
    ]);
  });

  const teamUrl = `${identityOrigin}/spaces/team-1/pulls/3`;
  const personalUrl = `${identityOrigin}/spaces/personal-1/pulls/2`;
  const call = async (name: string, args: Record<string, unknown>) =>
    await (await connect()).callTool({ name, arguments: args });

  it("lists Team and Personal Space pull requests with their Browser URLs", async () => {
    await start();
    const client = await connect();
    const teamList = await client.callTool({
      name: "pr_list",
      arguments: { repo: "bob/team", state: "merged", author: "@me", search: "x", limit: 5 },
    });
    expect(teamList.structuredContent).toMatchObject({ prs: [{ id: "wt-3", url: teamUrl }] });
    expect(requests.find((r) => r.path.startsWith("/api/worktrees?"))!.path).toBe(
      "/api/worktrees?scope=processed&kind=team&teamSpaceId=team-1&state=merged&search=x&limit=100",
    );
    requests.length = 0;
    const personalList = await client.callTool({ name: "pr_list", arguments: { repo: "user-1/personal" } });
    expect(personalList.structuredContent).toMatchObject({ prs: [{ id: "wt-u2", url: personalUrl }] });
    expect(requests.find((r) => r.path.startsWith("/api/worktrees?"))!.path).toBe(
      "/api/worktrees?scope=active&kind=user&limit=30",
    );
    expect(events().map((event) => event["repo"])).toEqual(["team-1", "personal-1"]);
  });

  it("views a pull request by number, URL and Worktree ID", async () => {
    await start();
    const client = await connect();
    for (const number of ["3", "#3", teamUrl, "wt-3"]) {
      const result = await client.callTool({ name: "pr_view", arguments: { repo: "bob/team", number } });
      expect(result.structuredContent).toMatchObject({ id: "wt-3", number: 3, url: teamUrl });
    }
    const own = await client.callTool({ name: "pr_view", arguments: { repo: "user-1/personal", number: "2" } });
    expect(own.structuredContent).toMatchObject({ id: "wt-u2", url: personalUrl });
    expect(events().map((event) => event["repo"])).toEqual([
      "team-1",
      "team-1",
      "team-1",
      "team-1",
      "personal-1",
    ]);
  });

  it("creates a pull request in a Personal or Team Space and passes the idempotency key through", async () => {
    await start();
    const personalResult = await call("pr_create", {
      repo: "user-1/personal",
      title: "Mine",
      body: "B",
      idempotency_key: "key-1",
    });
    expect(personalResult.structuredContent).toMatchObject({ id: "wt-u2", url: personalUrl });
    const teamResult = await call("pr_create", { repo: "bob/team", title: "T", visibility: "space" });
    expect(teamResult.structuredContent).toMatchObject({ id: "wt-3", url: teamUrl });
    expect(requests.filter((r) => r.method === "POST" && r.path === "/api/worktrees").map((r) => r.body)).toEqual([
      { kind: "user", name: "Mine", summary: "B" },
      { kind: "team", name: "T", summary: null, teamSpaceId: "team-1", visibility: "space" },
    ]);
    expect(idempotencyKeys[0]).toBe("key-1");
    expect(idempotencyKeys[1]).toEqual(expect.any(String));
    expect(events().map((event) => event["repo"])).toEqual(["personal-1", "team-1"]);
  });

  it("refuses another user's Personal Space and an empty pr_edit", async () => {
    await start();
    const spaceOfBob = await call("pr_create", { repo: "personal-bob", title: "x" });
    expect(spaceOfBob).toMatchObject({
      isError: true,
      structuredContent: { code: "workspace-argument-invalid" },
    });
    expect(writesOf()).toEqual([]);
    const nothing = await call("pr_edit", { repo: "bob/team", number: "3" });
    expect(nothing).toMatchObject({
      isError: true,
      structuredContent: { code: "workspace-argument-invalid" },
    });
    expect(writesOf().filter((r) => r.method === "PATCH")).toEqual([]);
  });

  it("edits the title, body and visibility and moves a pull request between draft and ready", async () => {
    await start();
    const edited = await call("pr_edit", {
      repo: "bob/team",
      number: "#3",
      title: "Edited",
      body: "New",
      visibility: "space",
    });
    expect(edited.structuredContent).toMatchObject({ name: "Edited", url: teamUrl });
    const ready = await call("pr_ready", { repo: "bob/team", number: "3" });
    expect(ready.structuredContent).toMatchObject({ state: "ready", url: teamUrl });
    expect(writesOf()).toEqual([
      { method: "PATCH", path: "/api/worktrees/wt-3", body: { name: "Edited", summary: "New", visibility: "space" } },
      { method: "POST", path: "/api/worktrees/wt-3/ready", body: undefined },
    ]);
  });

  it("moves a ready pull request back to draft with undo", async () => {
    await start();
    wt3State = "ready";
    const undone = await call("pr_ready", { repo: "bob/team", number: "3", undo: true });
    expect(undone.structuredContent).toMatchObject({ state: "draft", url: teamUrl });
    expect(writesOf().map((r) => r.path)).toEqual(["/api/worktrees/wt-3/reopen"]);
    wt3State = "draft";
    const draftAgain = await call("pr_ready", { repo: "bob/team", number: "3", undo: true });
    expect(draftAgain).toMatchObject({
      isError: true,
      structuredContent: { code: "workspace-lifecycle-invalid" },
    });
  });

  it("searches Issues and pull requests without a repository", async () => {
    await start();
    listPages.set("", { items: [rawIssue(1)], counts: { open: 1, closed: 0 }, nextCursor: null });
    const issues = await call("search", { kind: "issues", assignee: "@me", labels: ["bug"] });
    expect(issues.structuredContent).toMatchObject({
      issues: [{ number: 1, url: `${identityOrigin}/spaces/team-1/issues/1` }],
    });
    const prs = await call("search", { kind: "prs", state: "all", author: "@me", limit: 2 });
    expect(prs.structuredContent).toMatchObject({ prs: [{ id: "wt-u2", url: personalUrl }] });
    expect(requests.find((r) => r.path.startsWith("/api/worktrees?"))!.path).toBe(
      "/api/worktrees?scope=all&limit=100",
    );
    for (const bad of [
      { kind: "issues", state: "merged" },
      { kind: "prs", state: "closed" },
      { kind: "prs", labels: ["bug"] },
    ]) {
      expect(await call("search", bad)).toMatchObject({
        isError: true,
        structuredContent: { code: "workspace-argument-invalid" },
      });
    }
    expect(events().map((event) => event["repo"])).toEqual([null, null, null, null, null]);
  });

  it("browses a repository, a pull request and an Issue, and reports a missing item", async () => {
    await start();
    const client = await connect();
    const browse = async (args: Record<string, unknown>) =>
      (await client.callTool({ name: "browse", arguments: { repo: "bob/team", ...args } })).structuredContent;
    expect(await browse({})).toEqual({ url: `${identityOrigin}/spaces/team-1` });
    expect(await browse({ number: "3", unit: "u1" })).toEqual({ url: `${teamUrl}?unit=u1` });
    expect(await browse({ number: "7" })).toEqual({ url: `${identityOrigin}/spaces/team-1/issues/7` });
    expect(await browse({ number: "99" })).toMatchObject({ code: "workspace-not-found" });
    expect(await browse({ number: teamUrl })).toEqual({ url: teamUrl });
    expect(await browse({ number: "wt-3" })).toEqual({ url: teamUrl });
    expect(events().map((event) => event["repo"])).toEqual(["team-1", "team-1", "team-1", null, "team-1", "team-1"]);
  });

  it("turns every invalid argument into workspace-argument-invalid with an event", async () => {
    await start();
    const client = await connect();
    const invalid = [
      { name: "issue_list", arguments: { state: "open" } },
      { name: "issue_list", arguments: { repo: "team-1", state: "reopened" } },
      { name: "issue_list", arguments: { repo: "team-1", limit: 0 } },
    ];
    for (const call of invalid) {
      const result = await client.callTool(call);
      expect(result).toMatchObject({
        isError: true,
        structuredContent: {
          code: "workspace-argument-invalid",
          detail: { issues: expect.any(Array) },
        },
      });
    }
    expect(events().map((event) => [event["outcome"], event["error_code"]])).toEqual(
      Array(3).fill(["tool_error", "workspace-argument-invalid"]),
    );
    expect(JSON.stringify(events())).not.toContain("reopened");
    expect(requests.some((request) => request.path.includes("/issues"))).toBe(false);
  });

  it("logs an output that violates the output schema as an internal error", async () => {
    await start();
    vi.spyOn(whoamiTool, "run").mockResolvedValue({ output: { secret: "leak-me" }, repo: null });
    const result = await (await connect()).callTool({ name: "whoami", arguments: {} });
    expect(result).toMatchObject({
      isError: true,
      structuredContent: { code: "workspace-internal-error", message: "Internal tool error." },
    });
    expect(JSON.stringify(result)).not.toContain("leak-me");
    expect(events()[0]).toMatchObject({ outcome: "internal_error", error_code: null });
  });

  it("treats output that is not JSON as an internal error, not an argument error", async () => {
    await start();
    vi.spyOn(whoamiTool, "run").mockResolvedValue({ output: { subject: undefined }, repo: null });
    const result = await (await connect()).callTool({ name: "whoami", arguments: {} });
    expect(result).toMatchObject({
      isError: true,
      structuredContent: { code: "workspace-internal-error" },
    });
    expect(events()[0]).toMatchObject({ outcome: "internal_error", error_code: null });
  });
});
