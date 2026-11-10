import { testStagingDirectory } from "./staging-directory.js";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { pino } from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { createGateway } from "./gateway.js";
import type { ToolScope } from "../src/gateway/tools/definition.js";
import { opSpecs, PROTOCOL_VERSION } from "../src/shared/executor-protocol.js";
import { parseGatewayConfig } from "../src/shared/config.js";
import { toolScopes } from "./tool-names.js";

const origin = "https://workspace.example";
const user = { id: "user-1", username: "user-1", displayName: "user-1" };
const team = {
  id: "team-1",
  name: "Team",
  type: "team",
  accessRole: "admin",
  affiliation: "member",
  fullName: "bob/team",
  owner: { id: "u2", username: "bob" },
  publicRead: false,
  slug: "team",
};
const capabilities = {
  browseChildren: true,
  createChildren: true,
  move: true,
  rename: true,
  share: true,
  trash: true,
};
const node = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: id,
  accessRole: "owner",
  capabilities,
  hasChildren: false,
  parentNodeId: null,
  resource: null,
  spaceId: "team-1",
  updatedAt: "2026-09-29T00:00:00.000Z",
  ...overrides,
});
const sheetResource = {
  id: "r-sheet",
  kind: "univer",
  unitId: "u-sheet",
  unitType: "sheet",
  capabilities: { downloadContent: false, editContent: true, openContent: true },
};
const blobResource = {
  id: "r-blob",
  kind: "blob",
  availability: "ready",
  byteSize: 3,
  mediaType: "text/plain",
  capabilities: { downloadContent: true, editContent: false, openContent: false },
};
const page = (nodes: unknown[], parent?: { id: string; name: string }) => ({
  breadcrumbs: parent === undefined ? [] : [parent],
  navigationRootNodeId: null,
  nextCursor: null,
  nodes,
  parentNode: parent === undefined ? null : node(parent.id, { name: parent.name, hasChildren: true }),
  space: { id: "team-1", name: "Team", type: "team" },
});
const unit = (overrides: Record<string, unknown> = {}) => ({
  activationState: "notApplicable",
  change: "added",
  draftHeadRevision: 0,
  mergeResult: "pending",
  name: "Budget",
  nodeId: "n-new",
  resourceId: "r-new",
  source: "worktree",
  target: { parentNodeId: "dir", spaceId: "team-1" },
  unitId: "u-new",
  unitType: "sheet",
  ...overrides,
});
const worktree = (state = "draft", units: unknown[] = []) => ({
  id: "wt-3",
  name: "PR",
  state,
  number: 3,
  summary: null,
  kind: "team",
  visibility: "private",
  teamSpace: { id: "team-1", name: "Team" },
  creator: user,
  createdAt: "2026-09-29T00:00:00.000Z",
  updatedAt: "2026-09-29T00:00:00.000Z",
  units,
});
const prUrl = `${origin}/spaces/team-1/pulls/3`;

describe("space, unit, repository admin, label and merge tools", () => {
  let gateway: ReturnType<typeof createGateway> | undefined;
  let url: string;
  let executor: Server | undefined;
  let clients: Client[] = [];
  let requests: { method: string; path: string; body: unknown; key: string | null }[] = [];
  let prState = "draft";
  let created: Record<string, unknown> = team;

  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const target = new URL(request.url);
    const text = await request.text();
    const path = target.pathname + target.search;
    const body: unknown = text ? JSON.parse(text) : undefined;
    requests.push({ method: request.method, path, body, key: request.headers.get("idempotency-key") });
    const fields = (body ?? {}) as Record<string, unknown>;
    const at = (method: string, pathname: string) => request.method === method && target.pathname === pathname;
    if (target.pathname === "/api/session") return Response.json({ authenticated: true, user });
    if (target.pathname === "/api/spaces/lookup") return Response.json(team);
    if (at("GET", "/api/spaces/team-1")) return Response.json(team);
    if (at("PATCH", "/api/spaces/team-2")) return Response.json({ ...created, ...fields });
    if (at("PATCH", "/api/spaces/team-1")) return Response.json({ ...team, ...fields });
    if (at("POST", "/api/team-spaces")) {
      const input = body as { name: string; slug: string; publicRead?: boolean };
      created = {
        ...team,
        id: "team-2",
        name: input.name,
        slug: input.slug,
        fullName: `user-1/${input.slug}`,
        publicRead: input.publicRead ?? false,
      };
      return Response.json(created, { status: 201 });
    }
    if (at("GET", "/api/spaces/team-1/nodes")) {
      return Response.json(
        page([
          node("dir", { hasChildren: true }),
          node("sheet", { resource: sheetResource }),
          node("blob", { resource: blobResource }),
        ]),
      );
    }
    if (at("GET", "/api/nodes/dir/children")) {
      return Response.json(page([node("deep", { parentNodeId: "dir", resource: sheetResource })], { id: "dir", name: "dir" }));
    }
    if (at("GET", "/api/resources/r-blob")) return Response.json({ node: node("blob", { resource: blobResource }), resource: blobResource });
    if (at("POST", "/api/nodes")) {
      const input = body as { name: string; parentNodeId: string | null };
      return Response.json(node("created", { name: input.name, parentNodeId: input.parentNodeId }), { status: 201 });
    }
    if (at("PATCH", "/api/nodes/n1")) return Response.json(node("n1", fields));
    if (at("POST", "/api/nodes/n1/trash")) {
      return Response.json({
        id: "trash-1",
        capabilities: { restore: true, removePermanently: true },
        nodeCount: 2,
        originalLocation: { breadcrumbs: [{ id: "n1", name: "n1" }] },
        removeBlockedBy: null,
        restoreBlockedBy: null,
        root: { id: "n1", name: "n1", resource: null },
        spaceId: "team-1",
        trashedAt: "2026-09-29T00:00:00.000Z",
        trashedBy: { id: "user-1", username: "user-1", displayName: "user-1", avatarUrl: null },
      });
    }
    if (at("GET", "/api/worktrees/wt-3")) return Response.json({ worktree: worktree(prState, [unit()]) });
    if (at("GET", "/api/spaces/team-1/worktrees/3")) return Response.json({ worktree: worktree(prState) });
    if (at("POST", "/api/worktrees/wt-3/units")) {
      const input = body as { source: string };
      return Response.json(
        { unit: input.source === "trunk" ? unit({ source: "trunk", target: null }) : unit() },
        { status: 201 },
      );
    }
    if (at("POST", "/api/worktrees/wt-3/merge")) return Response.json({ worktree: worktree("merged") });
    if (at("POST", "/api/worktrees/wt-3/discard")) return Response.json({ worktree: worktree("discarded") });
    const labels = [
      { id: "l1", name: "bug", color: "red", description: "", openIssueCount: 2 },
      { id: "l2", name: "docs", color: "blue", description: "d", openIssueCount: 0 },
    ];
    if (at("GET", "/api/spaces/team-1/issue-labels")) return Response.json({ labels });
    if (at("POST", "/api/spaces/team-1/issue-labels")) return Response.json({ id: "l3", description: "", ...fields }, { status: 201 });
    if (at("PATCH", "/api/issue-labels/l1")) return Response.json({ id: "l1", name: "bug", color: "red", description: "", ...fields });
    if (at("DELETE", "/api/issue-labels/l1")) return new Response(null, { status: 204 });
    return Response.json({ error: { code: "workspace-not-found", message: "Not found." } }, { status: 404 });
  };

  async function connect(scopes?: ReadonlySet<ToolScope>) {
    const socket = createServer();
    socket.listen(0, "127.0.0.1");
    await once(socket, "listening");
    const address = socket.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP server");
    const port = address.port;
    await new Promise((resolve) => socket.close(resolve));
    url = `http://127.0.0.1:${String(port)}/mcp`;
    let executorUrl: string | undefined;
    if (scopes) {
      executor = createServer((request, response) => {
        if (request.url !== "/rpc/v1/capabilities") throw new Error("Scope check must precede executor dispatch");
        response.end(JSON.stringify({ v: PROTOCOL_VERSION, operations: Object.keys(opSpecs) }));
      });
      executor.listen(0, "127.0.0.1");
      await once(executor, "listening");
      const address = executor.address();
      if (!address || typeof address === "string") throw new Error("Expected TCP address");
      executorUrl = `http://127.0.0.1:${address.port}`;
    }
    gateway = createGateway(
      parseGatewayConfig({ MCP_DEV_SESSION_PASSTHROUGH: "1", WORKSPACE_ORIGIN: origin, MCP_STAGING_DIRECTORY: testStagingDirectory(), MCP_PUBLIC_URL: url, ...(executorUrl ? { MCP_EXECUTOR_URLS: executorUrl, MCP_EXECUTOR_TOKEN: "t".repeat(32) } : {}) }),
      { logger: pino({ level: "silent" }), fetcher, ...(scopes === undefined ? {} : { scopes }) },
    );
    gateway.server.listen(port, "127.0.0.1");
    await once(gateway.server, "listening");
    const client = new Client({ name: "space-admin-test", version: "1.0.0" });
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${url}?toolsets=all`), {
        requestInit: { headers: { Authorization: "Bearer test-session-secret" } },
      }),
    );
    return client;
  }
  const writesOf = () => requests.filter((request) => request.method !== "GET").map(({ key: _key, ...rest }) => rest);

  afterEach(async () => {
    await Promise.all(clients.map((client) => client.close()));
    clients = [];
    if (executor) {
      await new Promise<void>((resolve) => executor!.close(() => resolve()));
      executor = undefined;
    }
    requests = [];
    prState = "draft";
    if (gateway !== undefined) {
      await gateway.close();
      gateway.server.closeAllConnections();
      await new Promise((resolve) => gateway!.server.close(resolve));
      gateway = undefined;
    }
  });

  it("browses and finds Nodes with filters and attaches a Browser url to each", async () => {
    const client = await connect();
    const call = async (name: string, args: Record<string, unknown>) =>
      await client.callTool({ name, arguments: args });
    const root = await call("space_browse", { repo: "bob/team" });
    expect(root.structuredContent).toMatchObject({
      nodes: [
        { nodeId: "dir", path: "/dir", url: `${origin}/nodes/dir` },
        { nodeId: "sheet", resource: { unitType: "sheet" } },
        { nodeId: "blob", resource: { kind: "blob" } },
      ],
    });
    const filtered = await call("space_browse", {
      repo: "team-1",
      recursive: true,
      resource_kind: "univer",
      unit_type: "sheet",
    });
    expect((filtered.structuredContent as { nodes: { nodeId: string }[] }).nodes.map((n) => n.nodeId)).toEqual([
      "deep",
      "sheet",
    ]);
    const below = await call("space_browse", { repo: "team-1", parent: "dir" });
    expect(below.structuredContent).toMatchObject({ nodes: [{ nodeId: "deep", path: "/dir/deep" }] });
    expect(requests.map((request) => request.path).filter((path) => path.startsWith("/api/nodes"))).toEqual([
      "/api/nodes/dir/children",
      "/api/nodes/dir/children",
    ]);
    const found = await call("space_find", { space: "bob/team", query: "BL", resource_kind: "blob" });
    expect(found.structuredContent).toMatchObject({ nodes: [{ nodeId: "blob" }] });
    for (const bad of [
      { name: "space_browse", arguments: { repo: "team-1", resource_kind: "blob", unit_type: "sheet" } },
      { name: "space_find", arguments: { space: "team-1", query: "x", resource_kind: "none", unit_type: "doc" } },
      { name: "space_find", arguments: { space: "team-1", query: "  " } },
      { name: "space_browse", arguments: { repo: "team-1", unit_type: "pdf" } },
    ]) {
      expect(await client.callTool(bad)).toMatchObject({
        isError: true,
        structuredContent: { code: "workspace-argument-invalid" },
      });
    }
  });

  it("lists, adds and creates Units of a pull request with the file's page url", async () => {
    const client = await connect();
    const unitUrl = `${prUrl}?unit=u-new`;
    const listed = await client.callTool({ name: "unit_list", arguments: { worktree: "wt-3" } });
    expect(listed.structuredContent).toMatchObject({ units: [{ unitId: "u-new", url: unitUrl }] });
    expect(requests.filter((request) => request.path === "/api/worktrees/wt-3")).toHaveLength(1);
    requests.length = 0;
    const added = await client.callTool({ name: "unit_add", arguments: { worktree: "wt-3", resource: "r-new" } });
    expect(added.structuredContent).toMatchObject({ unit: { source: "trunk", url: unitUrl } });
    const created = await client.callTool({
      name: "unit_create",
      arguments: { worktree: "wt-3", space: "bob/team", type: "sheet", name: "Budget", parent: "dir", idempotency_key: "k1" },
    });
    expect(created.structuredContent).toMatchObject({ unit: { name: "Budget", type: "sheet", url: unitUrl } });
    expect(requests.filter((request) => request.path === "/api/worktrees/wt-3")).toHaveLength(2);
    expect(requests.filter((request) => request.method === "POST")).toMatchObject([
      { path: "/api/worktrees/wt-3/units", body: { resourceId: "r-new", source: "trunk" } },
      {
        path: "/api/worktrees/wt-3/units",
        key: "k1",
        body: { name: "Budget", source: "worktree", targetParentNodeId: "dir", targetSpaceId: "team-1", unitType: "sheet" },
      },
    ]);
    const invalid = await client.callTool({
      name: "unit_create",
      arguments: { worktree: "wt-3", space: "team-1", type: "pdf", name: "x" },
    });
    expect(invalid).toMatchObject({ isError: true, structuredContent: { code: "workspace-argument-invalid" } });
  });

  it("gets a Blob's node and resource", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "blob_get", arguments: { resource: "r-blob" } });
    expect(result.structuredContent).toMatchObject({
      node: { nodeId: "blob", url: `${origin}/nodes/blob` },
      resource: { kind: "blob", byteSize: 3, mediaType: "text/plain" },
    });
    const missing = await client.callTool({ name: "blob_get", arguments: { resource: "r-none" } });
    expect(missing).toMatchObject({ isError: true, structuredContent: { code: "workspace-not-found" } });
  });

  it("creates a repository in two calls, defaulting the name and capping the description", async () => {
    const client = await connect();
    const created = await client.callTool({
      name: "repo_create",
      arguments: { slug: "docs", description: "Handbook", public: true },
    });
    expect(created.structuredContent).toMatchObject({
      id: "team-2",
      name: "docs",
      slug: "docs",
      publicRead: true,
      url: `${origin}/spaces/team-2`,
    });
    expect(writesOf()).toEqual([
      { method: "POST", path: "/api/team-spaces", body: { name: "docs", slug: "docs", publicRead: true } },
      { method: "PATCH", path: "/api/spaces/team-2", body: { description: "Handbook" } },
    ]);
    requests.length = 0;
    const tooLong = await client.callTool({
      name: "repo_create",
      arguments: { slug: "docs", description: "x".repeat(351) },
    });
    expect(tooLong).toMatchObject({
      isError: true,
      structuredContent: { code: "workspace-argument-invalid", message: "description must contain at most 350 characters." },
    });
    expect(writesOf()).toEqual([]);
  });

  it("edits a repository only when something changes and maps visibility to publicRead", async () => {
    const client = await connect();
    const nothing = await client.callTool({ name: "repo_edit", arguments: { repo: "bob/team" } });
    expect(nothing).toMatchObject({
      isError: true,
      structuredContent: { code: "workspace-argument-invalid", message: "Nothing to change: pass name, description, visibility or slug." },
    });
    expect(requests.filter((request) => request.path !== "/api/session")).toEqual([]);
    const edited = await client.callTool({
      name: "repo_edit",
      arguments: { repo: "bob/team", name: "Renamed", description: "", visibility: "public", slug: "renamed" },
    });
    expect(edited.structuredContent).toMatchObject({ name: "Renamed", slug: "renamed", publicRead: true, url: `${origin}/spaces/team-1` });
    expect(writesOf()).toEqual([
      {
        method: "PATCH",
        path: "/api/spaces/team-1",
        body: { name: "Renamed", description: "", publicRead: true, slug: "renamed" },
      },
    ]);
  });

  it("lists labels with usage and creates, edits and deletes one by name", async () => {
    const client = await connect();
    const call = async (args: Record<string, unknown>) =>
      await client.callTool({ name: "label_write", arguments: { repo: "bob/team", ...args } });
    const listed = await client.callTool({ name: "label_list", arguments: { repo: "bob/team" } });
    expect(listed.structuredContent).toMatchObject({ labels: [{ name: "bug", openIssueCount: 2 }, { name: "docs" }] });
    expect((await call({ action: "create", name: "ux", color: "pink", description: "UX" })).structuredContent).toMatchObject({
      id: "l3",
      name: "ux",
      color: "pink",
    });
    expect((await call({ action: "edit", name: "BUG", new_name: "defect", color: "orange" })).structuredContent).toMatchObject({
      name: "defect",
      color: "orange",
    });
    expect((await call({ action: "delete", name: "bug" })).structuredContent).toEqual({ deleted: "bug" });
    expect(writesOf()).toEqual([
      { method: "POST", path: "/api/spaces/team-1/issue-labels", body: { name: "ux", color: "pink", description: "UX" } },
      { method: "PATCH", path: "/api/issue-labels/l1", body: { name: "defect", color: "orange" } },
      { method: "DELETE", path: "/api/issue-labels/l1", body: undefined },
    ]);
    requests.length = 0;
    for (const bad of [
      { action: "create", name: "ux" },
      { action: "create", name: "ux", color: "teal" },
      { action: "delete", name: "bug", color: "red" },
      { action: "create", name: "ux", color: "red", new_name: "y" },
    ]) {
      expect(await call(bad)).toMatchObject({ isError: true, structuredContent: { code: "workspace-argument-invalid" } });
    }
    expect(writesOf()).toEqual([]);
  });

  it("creates, renames, moves and trashes Nodes and requires exactly one of parent and root", async () => {
    const client = await connect();
    const call = async (args: Record<string, unknown>) =>
      await client.callTool({ name: "space_node", arguments: args });
    expect((await call({ action: "create", repo: "bob/team", name: " Plans ", parent: "dir" })).structuredContent).toMatchObject({
      node: { nodeId: "created", name: "Plans", parentNodeId: "dir", url: `${origin}/nodes/created` },
    });
    expect((await call({ action: "rename", node: "n1", name: "Renamed" })).structuredContent).toMatchObject({
      node: { nodeId: "n1", name: "Renamed" },
    });
    expect((await call({ action: "move", node: "n1", parent: "dir" })).structuredContent).toMatchObject({
      node: { parentNodeId: "dir" },
    });
    expect((await call({ action: "move", node: "n1", root: true })).structuredContent).toMatchObject({
      node: { parentNodeId: null },
    });
    expect((await call({ action: "trash", node: "n1" })).structuredContent).toMatchObject({
      trashBatch: { trashBatchId: "trash-1", nodeCount: 2, root: { nodeId: "n1" } },
    });
    expect(writesOf()).toEqual([
      { method: "POST", path: "/api/nodes", body: { name: "Plans", parentNodeId: "dir", spaceId: "team-1" } },
      { method: "PATCH", path: "/api/nodes/n1", body: { name: "Renamed" } },
      { method: "PATCH", path: "/api/nodes/n1", body: { parentNodeId: "dir" } },
      { method: "PATCH", path: "/api/nodes/n1", body: { parentNodeId: null } },
      { method: "POST", path: "/api/nodes/n1/trash", body: undefined },
    ]);
    requests.length = 0;
    for (const bad of [
      { action: "move", node: "n1" },
      { action: "move", node: "n1", parent: "dir", root: true },
      { action: "create", name: "x" },
      { action: "rename", node: "n1" },
      { action: "trash" },
      { action: "create", repo: "bob/team", name: "x", root: true },
      { action: "create", repo: "bob/team", name: "x", node: "n1" },
      { action: "rename", node: "n1", name: "x", repo: "bob/team" },
      { action: "rename", node: "n1", name: "x", parent: "dir" },
      { action: "move", node: "n1", root: true, name: "x" },
      { action: "trash", node: "n1", name: "x" },
      { action: "trash", node: "n1", root: false },
    ]) {
      expect(await call(bad)).toMatchObject({ isError: true, structuredContent: { code: "workspace-argument-invalid" } });
    }
    expect(writesOf()).toEqual([]);
  });

  it("merges a ready pull request, discards a draft one and refuses an invalid transition", async () => {
    const client = await connect();
    const call = async (name: string, number = "3") =>
      await client.callTool({ name, arguments: { repo: "bob/team", number } });
    prState = "ready";
    expect((await call("pr_merge")).structuredContent).toMatchObject({ id: "wt-3", state: "merged", url: prUrl });
    prState = "draft";
    expect((await call("pr_discard", "#3")).structuredContent).toMatchObject({ state: "discarded", url: prUrl });
    expect(await call("pr_merge")).toMatchObject({
      isError: true,
      structuredContent: { code: "workspace-lifecycle-invalid" },
    });
    expect(writesOf()).toEqual([
      { method: "POST", path: "/api/worktrees/wt-3/merge", body: undefined },
      { method: "POST", path: "/api/worktrees/wt-3/discard", body: undefined },
    ]);
  });

  it("states immediate effect, the slug warning and the leave-it-to-the-user rule in the descriptions", async () => {
    const tools = (await (await connect()).listTools()).tools;
    const description = (name: string) => tools.find((tool) => tool.name === name)!.description!;
    for (const name of ["repo_create", "repo_edit", "space_node", "label_write"]) {
      expect(description(name)).toMatch(/^Takes effect immediately, without review\./);
    }
    expect(description("repo_edit")).toContain("breaks");
    expect(description("label_write")).toContain("removes the label from every Issue");
    for (const name of ["pr_merge", "pr_discard"]) {
      expect(description(name)).toContain("Unless the user explicitly asked");
      expect(description(name)).toContain("leave");
    }
  });

  it("rejects every write, publish and merge tool under read-only scopes before any request", async () => {
    const client = await connect(new Set<ToolScope>(["read"]));
    const args: Record<string, Record<string, unknown>> = {
      unit_add: { worktree: "wt-3", resource: "r-new" },
      unit_create: { worktree: "wt-3", space: "team-1", type: "sheet", name: "x" },
      repo_create: { slug: "docs" },
      repo_edit: { repo: "team-1", name: "x" },
      label_write: { repo: "team-1", action: "delete", name: "bug" },
      space_node: { action: "trash", node: "n1" },
      pr_merge: { repo: "team-1", number: "3" },
      pr_discard: { repo: "team-1", number: "3" },
    };
    for (const [name, scope] of Object.entries(toolScopes).filter(([, scope]) => scope !== "read")) {
      expect(await client.callTool({ name, arguments: args[name] ?? {} })).toMatchObject({
        isError: true,
        structuredContent: { code: "workspace-scope-required", detail: { required: scope } },
      });
    }
    expect(requests.filter((request) => request.path !== "/api/session")).toEqual([]);
    const reads = ["space_browse", "label_list", "blob_get"] as const;
    expect(await client.callTool({ name: reads[1], arguments: { repo: "team-1" } })).not.toHaveProperty("isError", true);
  });

  it("refuses pr_merge and pr_discard without worktree:merge even with read, write and publish", async () => {
    const client = await connect(new Set<ToolScope>(["read", "write", "publish"]));
    for (const name of ["pr_merge", "pr_discard"]) {
      expect(await client.callTool({ name, arguments: { repo: "team-1", number: "3" } })).toMatchObject({
        isError: true,
        structuredContent: { code: "workspace-scope-required", detail: { required: "worktree:merge" } },
      });
    }
    expect(requests.filter((request) => request.path !== "/api/session")).toEqual([]);
  });
});
