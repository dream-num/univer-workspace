import { toolError } from "./tool-error.js";
import { testStagingDirectory } from "./staging-directory.js";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { pino } from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { createGateway } from "./gateway.js";
import { listenGateway } from "./listen-gateway.js";
import type { ToolScope } from "../src/gateway/tools/definition.js";
import { worktreeSchema } from "../src/gateway/tools/schemas.js";
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
  let prUnits = [unit()];
  let created: Record<string, unknown> = team;
  let linkSharing = { enabled: false, role: "viewer" };
  let needsConfirm = false;
  let sessionUser: Record<string, unknown> = user;
  let ownedByClaimedAgent = false;
  let checksRequired: string | null = null;
  let teamFile = false;

  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const target = new URL(request.url);
    const text = await request.text();
    const path = target.pathname + target.search;
    const body: unknown = text ? JSON.parse(text) : undefined;
    requests.push({ method: request.method, path, body, key: request.headers.get("idempotency-key") });
    const fields = (body ?? {}) as Record<string, unknown>;
    const at = (method: string, pathname: string) => request.method === method && target.pathname === pathname;
    if (target.pathname === "/api/session") return Response.json({ authenticated: true, user: sessionUser });
    if (at("POST", "/api/agents/claim-codes")) {
      return sessionUser["kind"] === "agent"
        ? Response.json({ code: "c0de", claimUrl: "/claim/c0de", expiresIn: 600 }, { status: 201 })
        : Response.json({ error: { code: "FORBIDDEN", message: "Only an agent can ask to be claimed." } }, { status: 403 });
    }
    if (target.pathname === "/api/spaces/lookup") return Response.json(team);
    if (at("GET", "/api/spaces/team-1")) return Response.json(team);
    if (needsConfirm && fields["publicRead"] === true) {
      return Response.json(
        { error: { code: "INTERACTIVE_SESSION_REQUIRED", message: "A person confirms it.", url: "/confirm/public?space=team-1" } },
        { status: 403 },
      );
    }
    if (at("PATCH", "/api/spaces/team-2")) return Response.json({ ...created, ...fields });
    if (at("PATCH", "/api/spaces/team-1")) return Response.json({ ...team, ...fields });
    if (at("POST", "/api/team-spaces")) {
      const input = body as { name: string; slug: string; publicRead?: boolean; proposals?: string };
      created = {
        ...team,
        id: "team-2",
        name: input.name,
        slug: input.slug,
        fullName: `user-1/${input.slug}`,
        publicRead: input.publicRead ?? false,
        proposals: input.proposals ?? "members",
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
    if (at("GET", "/api/nodes/sheet")) {
      return Response.json({
        node: node("sheet", { name: "Budget", resource: sheetResource }),
        space: { id: "team-1", name: "Team" },
        breadcrumbs: [{ id: "sheet", name: "Budget" }],
        navigationRootNodeId: null,
      });
    }
    if (target.pathname === "/api/nodes/sheet/link-sharing" && teamFile) {
      return Response.json({ error: { code: "NOT_FOUND", message: "The resource was not found." } }, { status: 404 });
    }
    if (target.pathname === "/api/nodes/sheet/link-sharing" && request.method !== "GET" && needsConfirm) {
      return Response.json(
        { error: { code: "INTERACTIVE_SESSION_REQUIRED", message: "A person confirms it.", url: "/confirm/link-sharing?node=sheet&role=viewer" } },
        { status: 403 },
      );
    }
    if (target.pathname === "/api/nodes/sheet/link-sharing") {
      if (request.method === "PUT") linkSharing = body as typeof linkSharing;
      return Response.json({
        ...linkSharing,
        ...(sessionUser["kind"] === "agent" || ownedByClaimedAgent
          ? { owner: { username: "budget-x7k2", kind: "agent", claimed: sessionUser["claimed"] ?? true }, expiresAt: "2026-12-14T00:00:00.000Z" }
          : { owner: { username: "user-1", kind: "human" }, expiresAt: null }),
        createdBy: null,
        updatedBy: null,
        createdAt: null,
        updatedAt: null,
      });
    }
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
    if (at("GET", "/api/worktrees/wt-3")) return Response.json({ worktree: worktree(prState, prUnits) });
    if (at("GET", "/api/spaces/team-1/worktrees/3")) return Response.json({ worktree: worktree(prState, prUnits) });
    if (at("POST", "/api/worktrees/wt-3/units")) {
      const input = body as { source: string };
      return Response.json(
        { unit: input.source === "trunk" ? unit({ source: "trunk", target: null }) : unit() },
        { status: 201 },
      );
    }
    if (at("POST", "/api/nodes/sheet/copies")) return Response.json({ operation: { id: "k2" }, unit: unit() }, { status: 201 });
    if (at("POST", "/api/worktrees/wt-3/merge") && checksRequired !== null) {
      return Response.json({ error: { code: "CHECKS_REQUIRED", message: checksRequired } }, { status: 403 });
    }
    if (at("POST", "/api/worktrees/wt-3/merge")) {
      prState = "merged";
      return Response.json({ worktree: worktree("merged") });
    }
    if (at("POST", "/api/worktrees/wt-3/discard")) return Response.json({ worktree: worktree("discarded") });
    const revertItem = {
      action: "restore", state: "blocked", name: "North", nodeId: "n1", unitId: "u1", unitType: "sheet", targetRevision: 1, headRevision: 4,
      laterEdits: [{ user: { id: "e", username: "eve", displayName: "Eve", avatarUrl: null }, revisions: 1, lastEditedAt: null }],
      reason: "Edited on Trunk after this task's merge.",
    };
    if (at("GET", "/api/spaces/team-1/issues/7/revert")) {
      return Response.json({ pullRequests: [{ id: "wt-3", number: 3, title: "Fix" }], items: [revertItem], capabilities: { revert: true, force: false }, refusal: null });
    }
    if (at("POST", "/api/spaces/team-1/issues/7/revert")) {
      return Response.json({ operation: { id: "op-2", state: "failed", error: { code: "CONFLICT", message: "Nothing was reverted." } }, items: [revertItem] }, { status: 201 });
    }
    if (at("POST", "/api/worktrees/wt-3/revert")) {
      return Response.json({ operation: { id: "op-1", state: "completed" }, items: [revertItem, { ...revertItem, action: "trash", state: "done", laterEdits: [], reason: null }] }, { status: 201 });
    }
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
    ({ gateway, url } = await listenGateway((url) =>
      createGateway(
        parseGatewayConfig({ MCP_DEV_SESSION_PASSTHROUGH: "1", WORKSPACE_ORIGIN: origin, MCP_STAGING_DIRECTORY: testStagingDirectory(), MCP_PUBLIC_URL: url, ...(executorUrl ? { MCP_EXECUTOR_URLS: executorUrl, MCP_EXECUTOR_TOKEN: "t".repeat(32) } : {}) }),
        { logger: pino({ level: "silent" }), fetcher, ...(scopes === undefined ? {} : { scopes }) },
      ),
    ));
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
    prUnits = [unit()];
    linkSharing = { enabled: false, role: "viewer" };
    needsConfirm = false;
    sessionUser = user;
    ownedByClaimedAgent = false;
    teamFile = false;
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
    const tools = await client.listTools();
    expect(tools.tools.find(({ name }) => name === "space_find")?.inputSchema).toMatchObject({
      required: expect.arrayContaining(["repo", "query"]),
    });
    const found = await call("space_find", { repo: "bob/team", query: "BL", resource_kind: "blob" });
    expect(found.structuredContent).toMatchObject({ nodes: [{ nodeId: "blob" }] });
    for (const bad of [
      { name: "space_browse", arguments: { repo: "team-1", resource_kind: "blob", unit_type: "sheet" } },
      { name: "space_find", arguments: { repo: "team-1", query: "x", resource_kind: "none", unit_type: "doc" } },
      { name: "space_find", arguments: { repo: "team-1", query: "  " } },
      { name: "space_browse", arguments: { repo: "team-1", unit_type: "pdf" } },
    ]) {
      expect(toolError(await client.callTool(bad))).toMatchObject({ code: "workspace-argument-invalid" });
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
    expect(toolError(invalid)).toMatchObject({ code: "workspace-argument-invalid" });
  });

  it("copies a shared file into a pull request with unit_create from, changing tools/list by that one optional parameter", async () => {
    const client = await connect();
    const tool = (await client.listTools()).tools.find(({ name }) => name === "unit_create")!;
    expect(tool).toMatchObject({
      title: "Create file in pull request",
      description:
        "Create a new file (sheet, doc, slide, base or board) in a pull request's Worktree, empty or, with from, a copy of a file you can open; it joins the repository when the pull request is merged. Generate an idempotency_key before creating and reuse it on retry, so a retry returns the same file instead of a duplicate.",
      inputSchema: { required: ["worktree", "space", "type", "name"] },
    });
    expect(Object.keys(tool.inputSchema.properties!)).toEqual(["worktree", "space", "type", "name", "parent", "from", "idempotency_key"]);
    expect(tool.inputSchema.properties!["from"]).toMatchObject({
      type: "string",
      description: expect.stringContaining("records that file as its source"),
    });

    const args = { worktree: "wt-3", space: "bob/team", type: "sheet", name: "Budget", parent: "dir", idempotency_key: "k2" };
    const copied = await client.callTool({ name: "unit_create", arguments: { ...args, from: `${origin}/nodes/sheet` } });
    expect(copied.structuredContent).toMatchObject({ unit: { name: "Budget", type: "sheet", url: `${prUrl}?unit=u-new` } });
    expect(requests.filter((request) => request.method === "POST")).toEqual([{
      method: "POST",
      path: "/api/nodes/sheet/copies",
      key: "k2",
      body: { name: "Budget", target: { kind: "worktree", worktreeId: "wt-3", spaceId: "team-1", parentNodeId: "dir" } },
    }]);

    requests.length = 0;
    for (const [bad, code] of [
      [{ ...args, type: "doc", from: "sheet" }, "workspace-argument-invalid"],
      [{ ...args, from: "https://elsewhere.example/nodes/sheet" }, "workspace-origin-mismatch"],
      [{ ...args, from: "hidden" }, "workspace-not-found"],
    ] as const) {
      expect(toolError(await client.callTool({ name: "unit_create", arguments: bad }))).toMatchObject({ code });
    }
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(0);
  });

  it("gets a Blob's node and resource", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "blob_get", arguments: { resource: "r-blob" } });
    expect(result.structuredContent).toMatchObject({
      node: { nodeId: "blob", url: `${origin}/nodes/blob` },
      resource: { kind: "blob", byteSize: 3, mediaType: "text/plain" },
    });
    const missing = await client.callTool({ name: "blob_get", arguments: { resource: "r-none" } });
    expect(toolError(missing)).toMatchObject({ code: "workspace-not-found" });
  });

  it("creates a repository in two calls, defaulting the name and capping the description", async () => {
    const client = await connect();
    const created = await client.callTool({
      name: "repo_create",
      arguments: { slug: "docs", description: "Handbook" },
    });
    expect(created.structuredContent).toMatchObject({
      id: "team-2",
      name: "docs",
      slug: "docs",
      publicRead: false,
      url: `${origin}/spaces/team-2`,
    });
    expect(writesOf()).toEqual([
      { method: "POST", path: "/api/team-spaces", body: { name: "docs", slug: "docs" } },
      { method: "PATCH", path: "/api/spaces/team-2", body: { description: "Handbook" } },
    ]);
    requests.length = 0;
    const tooLong = await client.callTool({
      name: "repo_create",
      arguments: { slug: "docs", description: "x".repeat(351) },
    });
    expect(toolError(tooLong)).toMatchObject({ code: "workspace-argument-invalid", message: "description must contain at most 350 characters." });
    expect(writesOf()).toEqual([]);
  });

  it("edits a repository only when something changes and maps visibility to publicRead", async () => {
    const client = await connect();
    const nothing = await client.callTool({ name: "repo_edit", arguments: { repo: "bob/team" } });
    expect(toolError(nothing)).toMatchObject({ code: "workspace-argument-invalid", message: "Nothing to change: pass name, description, visibility, proposals, acceptAfterHours, landing or slug." });
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

  it("sets who may propose when creating and editing a repository", async () => {
    const client = await connect();
    const created = await client.callTool({
      name: "repo_create",
      arguments: { slug: "docs", proposals: "accountable" },
    });
    expect(created.structuredContent).toMatchObject({ proposals: "accountable" });
    const edited = await client.callTool({ name: "repo_edit", arguments: { repo: "bob/team", proposals: "anyone" } });
    expect(edited.structuredContent).toMatchObject({ proposals: "anyone" });
    expect(writesOf()).toEqual([
      { method: "POST", path: "/api/team-spaces", body: { name: "docs", slug: "docs", proposals: "accountable" } },
      { method: "PATCH", path: "/api/spaces/team-1", body: { proposals: "anyone" } },
    ]);
    requests.length = 0;
    const invalid = await client.callTool({ name: "repo_edit", arguments: { repo: "bob/team", proposals: "everyone" } });
    expect(invalid.isError).toBe(true);
    expect(writesOf()).toEqual([]);
  });

  it("turns the acceptance deadline on and off", async () => {
    const client = await connect();
    const on = await client.callTool({ name: "repo_edit", arguments: { repo: "bob/team", acceptAfterHours: 72 } });
    expect(on.structuredContent).toMatchObject({ acceptAfterHours: 72 });
    const off = await client.callTool({ name: "repo_edit", arguments: { repo: "bob/team", acceptAfterHours: null } });
    expect(off.structuredContent).toMatchObject({ acceptAfterHours: null });
    expect(writesOf()).toEqual([
      { method: "PATCH", path: "/api/spaces/team-1", body: { acceptAfterHours: 72 } },
      { method: "PATCH", path: "/api/spaces/team-1", body: { acceptAfterHours: null } },
    ]);
    requests.length = 0;
    for (const hours of [0, 721, 1.5]) {
      expect((await client.callTool({ name: "repo_edit", arguments: { repo: "bob/team", acceptAfterHours: hours } })).isError).toBe(true);
    }
    expect(writesOf()).toEqual([]);
  });

  it("makes a repository require checks before an agent lands a change", async () => {
    const client = await connect();
    const edited = await client.callTool({ name: "repo_edit", arguments: { repo: "bob/team", landing: "checks" } });
    expect(edited.structuredContent).toMatchObject({ landing: "checks" });
    expect(toolError(await client.callTool({ name: "repo_edit", arguments: { repo: "bob/team", landing: "strict" } })))
      .toMatchObject({ code: "workspace-argument-invalid" });
    expect(writesOf()).toEqual([{ method: "PATCH", path: "/api/spaces/team-1", body: { landing: "checks" } }]);
  });

  it("returns the confirm link for the user when the server refuses to make a repository public, and creates only private ones", async () => {
    const client = await connect();
    needsConfirm = true;
    const confirm = `${origin}/confirm/public?space=team-1`;
    const edited = await client.callTool({ name: "repo_edit", arguments: { repo: "bob/team", visibility: "public" } });
    expect(toolError(edited)).toMatchObject({
      code: "INTERACTIVE_SESSION_REQUIRED",
      message: `A person confirms it. Give the user this link so they can confirm it in the browser: ${confirm}`,
      detail: { url: confirm },
    });
    const create = (await client.listTools()).tools.find((tool) => tool.name === "repo_create")!;
    expect(Object.keys(create.inputSchema.properties!)).toEqual(["slug", "name", "description", "proposals"]);
    expect(
      (await client.callTool({ name: "repo_edit", arguments: { repo: "bob/team", visibility: "private" } })).structuredContent,
    ).toMatchObject({ publicRead: false });
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
      expect(toolError(await call(bad))).toMatchObject({ code: "workspace-argument-invalid" });
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
      expect(toolError(await call(bad))).toMatchObject({ code: "workspace-argument-invalid" });
    }
    expect(writesOf()).toEqual([]);
  });

  it.each(["3", prUrl, "wt-3"])("returns the merged Units shown by pr_view for %s", async (number) => {
    const client = await connect();
    prState = "ready";
    prUnits = [
      unit(),
      unit({ name: "Plan", unitId: "u-plan", nodeId: "n-plan", resourceId: "r-plan", source: "trunk", target: null, change: "modified" }),
      unit({ name: "Old", unitId: "u-old", nodeId: "n-old", resourceId: "r-old", source: "trunk", target: null, change: "deleted" }),
    ];
    const viewed = await client.callTool({ name: "pr_view", arguments: { repo: "bob/team", number } });
    const merged = await client.callTool({ name: "pr_merge", arguments: { repo: "bob/team", number } });
    expect(merged.isError).not.toBe(true);
    expect(merged.structuredContent).toMatchObject({
      id: "wt-3", state: "merged", url: prUrl,
      units: [
        { name: "Budget", unitId: "u-new", nodeId: "n-new", change: "added" },
        { name: "Plan", unitId: "u-plan", nodeId: "n-plan", change: "modified" },
        { name: "Old", unitId: "u-old", nodeId: "n-old", change: "deleted" },
      ],
    });
    expect(worktreeSchema.parse(merged.structuredContent).units).toEqual(worktreeSchema.parse(viewed.structuredContent).units);
    expect(writesOf()).toEqual([{ method: "POST", path: "/api/worktrees/wt-3/merge", body: undefined }]);
  });

  it("passes on the checks a merge still needs", async () => {
    const client = await connect();
    prState = "ready";
    checksRequired = "This repository requires every declared check to pass before an agent merges. Not passed on the current content: smoke (missing). Report each declared check on this content, then merge.";
    expect(toolError(await client.callTool({ name: "pr_merge", arguments: { repo: "bob/team", number: "3" } })))
      .toMatchObject({ code: "CHECKS_REQUIRED", message: checksRequired });
    checksRequired = null;
  });

  it.each(["merging", "merged"])("finishes a merge that stopped while %s, with the number sent as a number", async (state) => {
    const client = await connect();
    prState = state;
    const merged = await client.callTool({ name: "pr_merge", arguments: { repo: "bob/team", number: 3 } });
    expect(merged.structuredContent).toMatchObject({ id: "wt-3", state: "merged", url: prUrl });
    expect(writesOf()).toEqual([{ method: "POST", path: "/api/worktrees/wt-3/merge", body: undefined }]);
  });

  it("refuses a pull request number that is neither a string nor a non-negative integer", async () => {
    const client = await connect();
    prState = "ready";
    for (const number of [null, true, {}, [], [3], 1.5, -3, 1e21, undefined]) {
      const result = await client.callTool({ name: "pr_merge", arguments: { repo: "bob/team", number } });
      expect(toolError(result)).toMatchObject({ code: "workspace-argument-invalid" });
      expect(JSON.stringify(result.content)).toContain("expected string");
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
    expect((await call("pr_discard", "#3")).structuredContent).toMatchObject({ state: "discarded", units: [], url: prUrl });
    expect(toolError(await call("pr_merge"))).toMatchObject({ code: "workspace-lifecycle-invalid" });
    expect(writesOf()).toEqual([
      { method: "POST", path: "/api/worktrees/wt-3/merge", body: undefined },
      { method: "POST", path: "/api/worktrees/wt-3/discard", body: undefined },
    ]);
  });

  it("reads Link Sharing without a write, sets each link value and points an unclaimed owner to claim without making a claim code", async () => {
    sessionUser = { ...user, kind: "agent", claimed: false };
    const client = await connect();
    const share = async (args: Record<string, unknown>) => await client.callTool({ name: "share", arguments: args });
    const drop = {
      url: `${origin}/nodes/sheet`,
      name: "Budget",
      owner: { username: "budget-x7k2", kind: "agent", claimed: false },
      expiresAt: "2026-12-14T00:00:00.000Z",
      claimHint: "To let the user keep this file, make a claim link with claim (uvw claim in the CLI) and give it to them.",
    };
    const access =
      "Only this agent can open the link until a person claims it. To let anyone with the link read it, call share with node sheet and link viewer.";
    const read = await share({ node: `${origin}/nodes/sheet` });
    expect(read.structuredContent).toEqual({ ...drop, link: "off", access });
    expect(read.content).toEqual([{
      type: "text",
      text: `Budget  ${origin}/nodes/sheet\nLink Sharing: off. ${access}\n${drop.claimHint}`,
    }]);
    expect(writesOf()).toEqual([]);
    for (const [link, body] of [
      ["editor", { enabled: true, role: "editor" }],
      ["viewer", { enabled: true, role: "viewer" }],
      ["off", { enabled: false, role: "viewer" }],
    ] as const) {
      requests = [];
      expect((await share({ node: "sheet", link })).structuredContent).toEqual({ ...drop, link, access: expect.any(String) });
      expect(writesOf()).toEqual([{ method: "PUT", path: "/api/nodes/sheet/link-sharing", body }]);
    }
    expect(toolError((await share({ node: "sheet", link: "owner" })))).toMatchObject({
      code: "workspace-argument-invalid",
    });
    const description = (await client.listTools()).tools.find((tool) => tool.name === "share")!.description!;
    expect(description).toContain("drop");
    expect(description).toContain("unit with trunk: true to read, find, inspect, outline or screenshot");
  });

  it("refuses a file link of another Workspace, and returns the confirm link for the user when the server refuses to turn a link on", async () => {
    const client = await connect();
    expect(
      toolError(await client.callTool({ name: "share", arguments: { node: "https://elsewhere.example/nodes/sheet", link: "viewer" } })),
    ).toMatchObject({ code: "workspace-origin-mismatch" });
    expect(requests.filter((request) => request.path !== "/api/session")).toEqual([]);
    needsConfirm = true;
    const refused = await client.callTool({ name: "share", arguments: { node: "sheet", link: "viewer" } });
    const confirm = `${origin}/confirm/link-sharing?node=sheet&role=viewer`;
    expect(toolError(refused)).toMatchObject({
      code: "INTERACTIVE_SESSION_REQUIRED",
      message: `A person confirms it. Give the user this link so they can confirm it in the browser: ${confirm}`,
      detail: { url: confirm },
    });
    expect((await client.callTool({ name: "share", arguments: { node: "sheet" } })).structuredContent).toMatchObject({
      link: "off",
    });
  });

  it.each([
    ["a claimed agent", { ...user, kind: "agent", claimed: true }, false,
      "Only people with access to the repository can open the link. To let anyone with the link read it, call share with node sheet and link viewer."],
    ["a person", user, false,
      "Only people with access to the repository can open the link. Only if the user asks, call share with node sheet and link viewer to let anyone with the link read it."],
    ["a person reading the file of an agent they claimed", user, true,
      "Only people with access to the repository can open the link. Only if the user asks, call share with node sheet and link viewer to let anyone with the link read it."],
  ] as const)("gives %s a next step it can take for a link that is off", async (_caller, principal, agentFile, access) => {
    sessionUser = principal;
    ownedByClaimedAgent = agentFile;
    const client = await connect();
    const read = await client.callTool({ name: "share", arguments: { node: `${origin}/nodes/sheet` } });
    expect(read.structuredContent).toMatchObject({ link: "off", access });
    expect(read.content).toEqual([{ type: "text", text: `Budget  ${origin}/nodes/sheet\nLink Sharing: off. ${access}` }]);
  });

  it.each([
    ["a person", user],
    ["a claimed agent", { ...user, kind: "agent", claimed: true }],
    ["an unclaimed agent", { ...user, kind: "agent", claimed: false }],
  ] as const)("gives %s a share result that the outputSchema in tools/list accepts", async (_caller, principal) => {
    sessionUser = principal;
    const client = await connect();
    await client.listTools();
    const read = await client.callTool({ name: "share", arguments: { node: "sheet" } });
    expect(read.structuredContent).toMatchObject({ link: "off", access: expect.stringContaining("Only") });
  });

  it("makes no claim code when an unclaimed agent retries share on a Team Space file, so the link it gave keeps working", async () => {
    sessionUser = { ...user, kind: "agent", claimed: false };
    teamFile = true;
    const client = await connect();
    expect((await client.callTool({ name: "claim", arguments: {} })).structuredContent).toMatchObject({ claimUrl: `${origin}/claim/c0de` });
    for (let attempt = 0; attempt < 11; attempt += 1) {
      expect(toolError(await client.callTool({ name: "share", arguments: { node: "sheet", link: "viewer" } }))).toMatchObject({
        code: "workspace-argument-invalid",
        message: `Link Sharing works only for files in a Personal Space, and "Budget" is in the repository bob/team. To let more people open it, add them as members with repo_member_write (uvw repo member add in the CLI), or make the repository public with repo_edit (uvw repo edit --visibility public in the CLI). Either one needs the user, and the server's answer says what to give them.`,
        detail: { url: `${origin}/nodes/sheet` },
      });
    }
    expect(writesOf().filter(({ path }) => path === "/api/agents/claim-codes")).toHaveLength(1);
  });

  it("hands an unclaimed agent a claim link on this Workspace that lasts ten minutes", async () => {
    sessionUser = { ...user, kind: "agent", claimed: false };
    const client = await connect();
    const listed = (await client.listTools()).tools.find((tool) => tool.name === "claim");
    expect(listed?._meta).toEqual({ "univer.workspace/scope": "publish" });
    expect(listed?.description).toContain("Give the returned claimUrl to the user");
    const before = Date.now();
    const { structuredContent } = await client.callTool({ name: "claim", arguments: {} });
    expect(structuredContent).toEqual({ claimUrl: `${origin}/claim/c0de`, expiresAt: expect.any(String) });
    const expiresAt = Date.parse((structuredContent as { expiresAt: string }).expiresAt);
    expect(expiresAt - before).toBeGreaterThanOrEqual(600_000);
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(600_000);
  });

  it("states immediate effect, the slug warning, the irreversible discard rule and the merge pointer in the descriptions", async () => {
    const tools = (await (await connect()).listTools()).tools;
    const description = (name: string) => tools.find((tool) => tool.name === name)!.description!;
    for (const name of ["repo_create", "repo_edit", "space_node", "label_write"]) {
      expect(description(name)).toMatch(/^Takes effect immediately, without review\./);
    }
    expect(description("repo_edit")).toContain("breaks");
    expect(description("label_write")).toContain("removes the label from every Issue");
    expect(description("pr_discard")).toContain("Unless the user explicitly asked you to discard it");
    expect(description("pr_merge")).toContain("The notice from whoami, or without one the server instructions, says when to merge");
    expect(description("pr_merge")).not.toContain("Unless the user");
  });

  it("plans an Issue's revert without writing, reverts one pull request without force, and needs exactly one target", async () => {
    const client = await connect();
    prState = "merged";
    const plan = await client.callTool({ name: "pr_revert", arguments: { repo: "bob/team", issue: "7" } });
    expect(plan.structuredContent).toMatchObject({
      applied: false, canRevert: true, refusal: null, pullRequests: [{ number: 3 }],
      items: [{ state: "blocked", laterEdits: [{ user: { username: "eve" }, revisions: 1 }] }],
    });
    expect(writesOf()).toEqual([]);
    const done = await client.callTool({ name: "pr_revert", arguments: { repo: "bob/team", number: 3, apply: true } });
    expect(done.structuredContent).toMatchObject({ applied: true, operation: { id: "op-1", state: "completed" }, items: [{ state: "blocked" }, { action: "trash", state: "done" }] });
    expect(writesOf()).toEqual([{ method: "POST", path: "/api/worktrees/wt-3/revert", body: undefined }]);
    expect(requests.find((request) => request.path === "/api/worktrees/wt-3/revert")?.key).toMatch(/^[0-9a-f-]{36}$/u);
    const nothing = await client.callTool({ name: "pr_revert", arguments: { repo: "bob/team", issue: "7", apply: true } });
    expect(nothing.structuredContent).toMatchObject({
      applied: true, operation: { state: "failed", error: { code: "CONFLICT", message: "Nothing was reverted." } }, items: [{ state: "blocked" }],
    });
    for (const target of [{}, { number: "3", issue: "7" }]) {
      expect(toolError(await client.callTool({ name: "pr_revert", arguments: { repo: "bob/team", ...target } }))).toMatchObject({ code: "workspace-argument-invalid" });
    }
    expect(writesOf()).toHaveLength(2);
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
      expect(toolError(await client.callTool({ name, arguments: args[name] ?? {} }))).toMatchObject({ code: "workspace-scope-required", detail: { required: scope } });
    }
    expect(requests.filter((request) => request.path !== "/api/session")).toEqual([]);
    const reads = ["space_browse", "label_list", "blob_get"] as const;
    expect(await client.callTool({ name: reads[1], arguments: { repo: "team-1" } })).not.toHaveProperty("isError", true);
  });

  it("refuses pr_merge and pr_discard without worktree:merge even with read, write and publish", async () => {
    const client = await connect(new Set<ToolScope>(["read", "write", "publish"]));
    for (const name of ["pr_merge", "pr_discard"]) {
      expect(toolError(await client.callTool({ name, arguments: { repo: "team-1", number: "3" } }))).toMatchObject({ code: "workspace-scope-required", detail: { required: "worktree:merge" } });
    }
    expect(requests.filter((request) => request.path !== "/api/session")).toEqual([]);
  });
});
