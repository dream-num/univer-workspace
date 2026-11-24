import { toolError } from "./tool-error.js";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { opSpecs, PROTOCOL_VERSION } from "../src/shared/executor-protocol.js";
import { parseGatewayConfig } from "../src/shared/config.js";
import { decodeFrame, encodeFrame } from "../src/shared/frame.js";
import { zeroCost } from "../src/shared/usage.js";
import { createGateway } from "./gateway.js";
import { listenGateway } from "./listen-gateway.js";
import { testStagingDirectory } from "./staging-directory.js";

const origin = "https://workspace.example";
const UPSTREAM = {
  accessRole: "viewer", capabilities: {}, description: "", fullName: "hana/team", id: "s1", name: "Team",
  owner: { id: "h1", username: "hana" }, publicRead: false, slug: "team", type: "team",
};
const summary = { id: "w1", name: "fix", number: 7, state: "draft", teamSpace: { id: "s1" } };
const fork = (state: "clean" | "drafting" | "removed") => ({
  createdAt: "2026-11-23T00:00:00.000Z", fullName: "agent/fix", id: "f1", name: "fix",
  owner: { id: "a1", username: "agent" }, state: state === "drafting" ? state : "clean",
  upstream: state === "removed" ? null : UPSTREAM, worktree: state === "drafting" ? summary : null,
});
const unit = (overrides: Record<string, unknown> = {}) => ({
  activationState: "notApplicable", change: "modified", draftHeadRevision: 1, freshness: null,
  mergeResult: "pending", name: "Budget", nodeId: "n1", resourceId: "r1", source: "trunk", target: null,
  unitId: "u1", unitType: "sheet", ...overrides,
});
const created = unit({ change: "added", name: "Notes", nodeId: "n5", resourceId: "r5", source: "worktree", target: { parentNodeId: null, spaceId: "s1" }, unitId: "u5", unitType: "doc" });
const removed = unit({ change: "deleted", name: "Old", nodeId: "n3", resourceId: "r3", unitId: "u3" });
const worktree = (units: readonly unknown[]) => ({ ...summary, units, updatedAt: "2026-11-23T01:00:00.000Z" });
const fileNode = (id: string, name: string, unitId: string) => ({
  accessRole: "viewer", hasChildren: false, id, name, parentNodeId: null, spaceId: "s1", updatedAt: "2026-11-23T00:00:00.000Z",
  capabilities: { browseChildren: false, createChildren: false, move: false, rename: false, share: false, trash: false },
  resource: { capabilities: { downloadContent: false, editContent: false, openContent: true }, id: `r-${unitId}`, kind: "univer", unitId, unitType: "sheet" },
});
const page = (nodes: readonly unknown[]) => ({
  breadcrumbs: [], navigationRootNodeId: null, nextCursor: null, nodes, parentNode: null,
  space: { id: "s1", name: "Team", publicRead: false, type: "team" },
});

const pageNode = {
  accessRole: "viewer", hasChildren: false, id: "pn", name: "Page.univer.html", parentNodeId: null, spaceId: "s1", updatedAt: "2026-11-23T00:00:00.000Z",
  capabilities: { browseChildren: false, createChildren: false, move: false, rename: false, share: false, trash: false },
  resource: { availability: "ready", byteSize: 15, capabilities: { downloadContent: true, editContent: false, openContent: true }, id: "page-1", kind: "blob", mediaType: "text/html" },
};
const pageDraft = (overrides: Record<string, unknown> = {}) => ({
  id: "d1", author: { id: "a1", username: "agent" }, kind: "replace", state: "pending", publishWhen: "merge", supersededBy: null,
  spaceId: "s1", sourceWorktreeId: "w1", parentNodeId: null, name: "Page.univer.html", targetResourceId: "page-1", baseEtag: '"up-1"',
  byteSize: 12, createdAt: "2026-11-23T00:00:00.000Z", expiresAt: "2026-11-30T00:00:00.000Z", decidedAt: null, published: null, ...overrides,
});

interface Call { readonly method: string; readonly path: string; readonly body: unknown }

let drafts: unknown[];
let worktreeState: "draft" | "ready";
let forkState: "clean" | "drafting" | "removed";
let calls: Call[];
let executorInputs: { op: string; input: Record<string, unknown> }[];
let executor: Server;
let gateway: ReturnType<typeof createGateway>;
let client: Client;

function routes(call: Call): unknown {
  const opened = forkState === "drafting" ? [unit(), created, removed] : [];
  const table: Record<string, () => unknown> = {
    "GET /api/session": () => ({ authenticated: true, user: { id: "a1", displayName: "agent", kind: "agent", claimed: true } }),
    "GET /api/forks/lookup?name=fix&owner=agent": () => fork(forkState),
    "GET /api/forks": () => ({ forks: [fork(forkState)] }),
    "POST /api/forks": () => Response.json(fork("clean"), { status: 201 }),
    "DELETE /api/forks/f1": () => ({ fork: { id: "f1" }, worktree: forkState === "drafting" ? summary : null }),
    "GET /api/worktrees/w1": () => ({ worktree: worktree(opened) }),
    "GET /api/unit-resources/u2": () => ({ node: fileNode("n2", "Plan", "u2") }),
    "POST /api/forks/f1/units": () => {
      const body = call.body as Record<string, unknown>;
      const added = body["source"] === "trunk"
        ? unit({ change: "unchanged", name: "Plan", nodeId: "n2", resourceId: String(body["resourceId"]), unitId: "u2" })
        : { ...created, name: body["name"], unitType: body["unitType"] };
      return Response.json({ unit: added, worktree: worktree([...opened, added]) }, { status: 201 });
    },
    "POST /api/forks/f1/worktree": () => worktreeState === "draft"
      ? Response.json({ worktree: summary }, { status: forkState === "clean" ? 201 : 200 })
      : Response.json({ error: { code: "FORK_WORKTREE_NOT_DRAFT", message: "The fork's Worktree is ready, and only a draft takes writes." } }, { status: 409 }),
    "GET /api/worktrees/w1/html-view-drafts": () => ({ drafts }),
    "GET /api/html-view-drafts/d1": () => ({ draft: pageDraft() }),
    "GET /api/html-view-drafts/d1/content": () => new Response("<p>draft</p>"),
    "GET /api/resources/page-1": () => ({ node: pageNode, resource: pageNode.resource }),
    "GET /api/blob-resources/page-1/download": () => new Response("<p>upstream</p>", { headers: { "content-type": "text/html", etag: '"up-1"' } }),
    "GET /api/spaces": () => ({ spaces: [] }),
    "GET /api/spaces/lookup?owner=hana&slug=team": () => UPSTREAM,
    "GET /api/spaces/s1": () => UPSTREAM,
    "GET /api/spaces/s1/star": () => ({ starCount: 2, starred: false }),
    "GET /api/spaces/s1/nodes": () => page([fileNode("n1", "Budget", "u1"), fileNode("n2", "Plan", "u2"), fileNode("n3", "Old", "u3")]),
  };
  const route = table[`${call.method} ${call.path}`];
  return route ? route() : Response.json({ error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
}

const outputs: Record<string, (input: Record<string, unknown>) => object> = {
  "content.sheet-lens": () => ({ text: "A1 = 1", json: null, revision: 3, warnings: [] }),
  "content.inspect": (input) => ({ kind: "workbook", unitId: input["unitId"] }),
  "render.screenshot": (input) => ({ unitId: input["unitId"], unitType: "sheet", images: [] }),
  "render.printPdf": (input) => ({ unitId: input["unitId"], unitType: "sheet", name: "Budget", mediaType: "application/pdf", pageCount: 1 }),
  "content.execute": () => ({ committed: true, revision: 2 }),
  "htmlView.draft": (input) => input["kind"] === "dryRun"
    ? { dryRun: true, valid: true, bindings: [], bindingCount: 0 }
    : { draft: { id: "d2", kind: "replace", state: "pending", name: "Page.univer.html", space: "s1", sourceWorktreeId: "w1", publishWhen: "merge",
        previewUrl: `${origin}/drafts/d2`, expiresAt: "2026-11-30T00:00:00.000Z", repositoryVisibility: "private", privateSourceUnitIds: [] },
      bindings: [], bindingCount: 0 },
};

beforeEach(async () => {
  drafts = [];
  worktreeState = "draft";
  forkState = "drafting";
  calls = [];
  executorInputs = [];
  executor = createServer(async (request, response) => {
    if (request.url === "/rpc/v1/capabilities") {
      response.end(JSON.stringify({ v: PROTOCOL_VERSION, operations: Object.keys(opSpecs) }));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const op = request.url!.replace("/rpc/v1/", "");
    const { input } = decodeFrame(Buffer.concat(chunks)).header as { input: Record<string, unknown> };
    executorInputs.push({ op, input });
    response.setHeader("Content-Type", "application/octet-stream");
    response.end(encodeFrame(
      { ok: true, output: outputs[op]!(input), meta: { executor: "none", cost: zeroCost } },
      op === "render.printPdf" ? new Uint8Array([37, 80, 68, 70]) : undefined,
    ));
  });
  executor.listen(0, "127.0.0.1");
  await once(executor, "listening");
  const address = executor.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP address");
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const text = await request.text();
    const call = { method: request.method, path: url.pathname + url.search, body: text ? JSON.parse(text) as unknown : undefined };
    calls.push(call);
    const value = routes(call);
    return value instanceof Response ? value : Response.json(value);
  };
  let url: string;
  ({ gateway, url } = await listenGateway((url) =>
    createGateway(
      parseGatewayConfig({
        MCP_DEV_SESSION_PASSTHROUGH: "1",
        WORKSPACE_ORIGIN: origin,
        MCP_STAGING_DIRECTORY: testStagingDirectory(),
        MCP_PUBLIC_URL: url,
        MCP_EXECUTOR_URLS: `http://127.0.0.1:${address.port}`,
        MCP_EXECUTOR_TOKEN: "t".repeat(32),
      }),
      { logger: pino({ level: "silent" }), fetcher },
    ),
  ));
  client = new Client({ name: "fork-tools-test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${url}?toolsets=all`), {
      requestInit: { headers: { Authorization: "Bearer test-session-secret" } },
    }),
  );
});

afterEach(async () => {
  await client.close();
  await gateway.close();
  gateway.server.closeAllConnections();
  await new Promise((resolve) => gateway.server.close(resolve));
  await new Promise((resolve) => executor.close(resolve));
});

const call = async (name: string, args: Record<string, unknown>) => {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  return result.structuredContent as Record<string, unknown>;
};
const writes = () => calls.filter((entry) => entry.method !== "GET");

const reads: [string, Record<string, unknown>][] = [
  ["read", { range: "Sheet1!A1" }],
  ["find", { terms: ["1"] }],
  ["outline", {}],
  ["inspect", { target: "workbook" }],
  ["screenshot", {}],
  ["print_pdf", {}],
];

describe("fork addresses in read tools", () => {
  it.each(reads)("%s reads a file the fork changed from its Worktree", async (name, args) => {
    await call(name, { ...args, unit: "u1", worktree: "agent/fix" });
    expect(executorInputs).toMatchObject([{ input: { unitId: "u1", scope: { kind: "worktree", worktreeId: "w1" } } }]);
    expect(writes()).toEqual([]);
  });

  it.each(reads)("%s reads an untouched file from the upstream trunk and opens nothing", async (name, args) => {
    await call(name, { ...args, unit: "u2", worktree: "agent/fix" });
    expect(executorInputs).toMatchObject([{ input: { unitId: "u2", scope: { kind: "trunk" } } }]);
    expect(writes()).toEqual([]);
  });
});

describe("fork addresses in write tools", () => {
  it("execute always writes the fork's Worktree, adding an untouched upstream file first", async () => {
    forkState = "clean";
    await call("execute", { worktree: "agent/fix", unit: "u2", code: "return 1" });
    expect(writes()).toEqual([{ method: "POST", path: "/api/forks/f1/units", body: { resourceId: "r-u2", source: "trunk" } }]);
    expect(executorInputs).toEqual([{ op: "content.execute", input: { worktreeId: "w1", unitId: "u2", code: "return 1" } }]);
  });

  it("execute writes a file the fork already holds without adding it again", async () => {
    await call("execute", { worktree: "agent/fix", unit: "u5", code: "return 1" });
    expect(writes()).toEqual([]);
    expect(executorInputs).toMatchObject([{ input: { worktreeId: "w1", unitId: "u5" } }]);
  });

  it("unit_add and unit_create write through the fork route and return the Worktree they joined", async () => {
    forkState = "clean";
    const added = await call("unit_add", { worktree: "agent/fix", resource: "r-u2" });
    expect(added).toMatchObject({ unit: { unitId: "u2", worktreeId: "w1", url: `${origin}/spaces/s1/pulls/7?unit=u2` } });
    const made = await call("unit_create", { worktree: "agent/fix", space: "agent/fix", type: "doc", name: "Notes", idempotency_key: "create-notes-0001" });
    expect(made).toMatchObject({ unit: { unitId: "u5", worktreeId: "w1", source: "worktree" } });
    expect(writes().map(({ body }) => body)).toEqual([
      { resourceId: "r-u2", source: "trunk" },
      { name: "Notes", source: "worktree", targetParentNodeId: null, targetSpaceId: "s1", unitType: "doc" },
    ]);
  });

  it("unit_create refuses from with a fork address before any write", async () => {
    const error = toolError(await client.callTool({
      name: "unit_create",
      arguments: { worktree: "agent/fix", space: "hana/team", type: "sheet", name: "Copy", from: "n1" },
    }));
    expect(error).toMatchObject({ code: "workspace-argument-invalid", message: expect.stringContaining("fork_view") });
    expect(writes()).toEqual([]);
  });

  it("unit_list lists the fork's pull request, nothing for a clean fork, and refuses once the upstream is unreadable", async () => {
    expect(await call("unit_list", { worktree: "agent/fix" })).toMatchObject({ units: [{ unitId: "u1" }, { unitId: "u5" }, { unitId: "u3" }] });
    forkState = "clean";
    expect(await call("unit_list", { worktree: "agent/fix" })).toEqual({ units: [] });
    forkState = "removed";
    expect(toolError(await client.callTool({ name: "unit_list", arguments: { worktree: "agent/fix" } }))).toMatchObject({
      code: "workspace-not-found",
      message: "You can no longer read the upstream of fork agent/fix.",
    });
  });
});

describe("pages through a fork", () => {
  const save = { page: "page-1", etag: '"up-1"', html: "<p>mine</p>", idempotency_key: "page-key-000000001" };

  it("html_view_read returns the upstream page, or your pending draft of it in the fork's pull request", async () => {
    forkState = "clean";
    expect(await call("html_view_read", { resource: "page-1", worktree: "agent/fix" }))
      .toMatchObject({ resource: "page-1", etag: '"up-1"', html: "<p>upstream</p>" });
    forkState = "drafting";
    drafts = [pageDraft({ id: "theirs", author: { id: "h1", username: "hana" } }), pageDraft({ id: "old", state: "conflicted" }), pageDraft()];
    expect(await call("html_view_read", { resource: "page-1", worktree: "agent/fix" })).toEqual({
      draft: "d1", resource: "page-1", etag: '"up-1"', space: "s1", name: "Page.univer.html", html: "<p>draft</p>", previewUrl: `${origin}/drafts/d1`,
    });
    expect(writes()).toEqual([]);
  });

  it("html_view_save opens a clean fork's pull request, attaches the page to it, and revises your pending draft on the next save", async () => {
    forkState = "clean";
    await call("html_view_save", { ...save, worktree: "agent/fix" });
    expect(writes().map(({ method, path }) => `${method} ${path}`)).toEqual(["POST /api/forks/f1/worktree"]);
    forkState = "drafting";
    drafts = [pageDraft()];
    await call("html_view_save", { ...save, worktree: "agent/fix" });
    await call("html_view_save", { ...save, etag: '"stale"', worktree: "agent/fix" });
    expect(executorInputs.map(({ input: { html: _html, idempotencyKey: _key, ...input } }) => input)).toEqual([
      { kind: "replace", resourceId: "page-1", etag: '"up-1"', sourceWorktreeId: "w1" },
      { kind: "revise", draftId: "d1", sourceWorktreeId: "w1" },
      { kind: "replace", resourceId: "page-1", etag: '"stale"', sourceWorktreeId: "w1" },
    ]);
  });

  it("a dry run reads the fork's pull request, or trunk while the fork is clean, and opens nothing", async () => {
    await call("html_view_save", { html: "<p>mine</p>", dryRun: true, worktree: "agent/fix" });
    forkState = "clean";
    await call("html_view_save", { html: "<p>mine</p>", dryRun: true, worktree: "agent/fix" });
    expect(executorInputs.map(({ input }) => input["sourceWorktreeId"])).toEqual(["w1", undefined]);
    expect(writes()).toEqual([]);
  });

  it("refuses a save while the fork's pull request is ready, and a worktree beside repo and pr", async () => {
    worktreeState = "ready";
    const refused = toolError(await client.callTool({ name: "html_view_save", arguments: { ...save, worktree: "agent/fix" } }));
    expect(refused).toMatchObject({ code: "FORK_WORKTREE_NOT_DRAFT", detail: { path: "/api/forks/f1/worktree", status: 409 } });
    const both = toolError(await client.callTool({ name: "html_view_save", arguments: { ...save, worktree: "agent/fix", repo: "hana/team", pr: 7 } }));
    expect(both).toMatchObject({ code: "workspace-argument-invalid", message: "Provide worktree or repo with pr, not both." });
    expect(executorInputs).toEqual([]);
  });
});

describe("fork addresses in listing tools", () => {
  it("space_browse and space_find list the upstream with the fork's changes", async () => {
    const listed = async (name: string, args: Record<string, unknown>) =>
      ((await call(name, { ...args, repo: "agent/fix" })) as { nodes: { name: string; url: string }[] }).nodes
        .map((node) => [node.name, node.url]);
    expect(await listed("space_browse", {})).toEqual([
      ["Budget", `${origin}/nodes/n1`],
      ["Plan", `${origin}/nodes/n2`],
      ["Notes", `${origin}/spaces/s1/pulls/7?unit=u5`],
    ]);
    expect(await listed("space_find", { query: "notes" })).toEqual([["Notes", `${origin}/spaces/s1/pulls/7?unit=u5`]]);
    expect(await listed("space_find", { query: "old" })).toEqual([]);
    expect(writes()).toEqual([]);
  });

  it("repo_view shows a fork's upstream", async () => {
    expect(await call("repo_view", { repo: "agent/fix" })).toMatchObject({ id: "s1", fullName: "hana/team", url: `${origin}/spaces/s1` });
  });
});

describe("tools that write the repository itself", () => {
  const trunkWriters: [string, Record<string, unknown>][] = [
    ["pr_create", { repo: "agent/fix", title: "Change" }],
    ["pr_ready", { repo: "agent/fix", number: "7" }],
    ["pr_merge", { repo: "agent/fix", number: "7" }],
    ["issue_create", { repo: "agent/fix", title: "Bug" }],
    ["issue_comment", { repo: "agent/fix", number: "1", body: "Done" }],
    ["label_write", { repo: "agent/fix", action: "create", name: "bug", color: "red" }],
    ["repo_edit", { repo: "agent/fix", description: "x" }],
    ["space_node", { action: "create", repo: "agent/fix", name: "Folder" }],
    ["html_view_save", { space: "agent/fix", name: "Page", html: "<p>x</p>", idempotency_key: "page-key-000000001" }],
    ["fork_create", { repo: "agent/fix", name: "again" }],
  ];
  it.each(trunkWriters)("%s refuses a fork address and names its upstream and pull request", async (name, args) => {
    const error = toolError(await client.callTool({ name, arguments: args }));
    expect(error).toMatchObject({
      code: "workspace-argument-invalid",
      message: "agent/fix is a fork of hana/team, not a repository. Pass it as worktree to read and write its files, and as repo to space_browse or space_find to list them. Its pull request is #7 in hana/team.",
    });
    expect(writes()).toEqual([]);
    expect(executorInputs).toEqual([]);
  });
});

describe("tools not wired for forks", () => {
  const plain: [string, Record<string, unknown>][] = [
    ["export", { unit: "u1", format: "xlsx" }],
    ["export_markdown", { unit: "u1", source_map: {}, blocks: ["b1"] }],
    ["asset_download", { id: "asset-1" }],
    ["lint", { unit: "u1" }],
    ["compile_markdown", { markdown: "# x", space: "hana/team" }],
    ["compile_svg", { svg: "<svg/>", unit: "u1", page: 1 }],
    ["compile_typst", { bundle_upload_id: "b", space: "hana/team" }],
  ];
  it.each(plain)("%s refuses a fork address and points to fork_view", async (name, args) => {
    const error = toolError(await client.callTool({ name, arguments: { ...args, worktree: "agent/fix" } }));
    expect(error.code).toBe("workspace-argument-invalid");
    expect(error.message).toContain("worktree: This tool takes a Worktree ID, not a fork address. Use the worktree.id from fork_view");
    expect(calls.filter((entry) => entry.path.startsWith("/api/forks"))).toEqual([]);
    expect(executorInputs).toEqual([]);
  });
});

describe("fork tools", () => {
  it("creates, lists, views and deletes a fork with Browser links", async () => {
    const pull = { id: "w1", number: 7, url: `${origin}/spaces/s1/pulls/7` };
    const upstream = { id: "s1", fullName: "hana/team", accessRole: "viewer", url: `${origin}/spaces/s1` };
    expect(await call("fork_create", { repo: "hana/team", name: "fix" })).toMatchObject({ fullName: "agent/fix", state: "clean", worktree: null, upstream });
    expect(calls.find((entry) => entry.method === "POST")).toMatchObject({ path: "/api/forks", body: { name: "fix", upstreamSpaceId: "s1" } });
    expect(await call("fork_list", {})).toMatchObject({ forks: [{ fullName: "agent/fix", state: "drafting", worktree: pull }] });
    expect(await call("fork_view", { fork: "agent/fix" })).toMatchObject({ id: "f1", upstream, worktree: pull });
    expect(await call("fork_delete", { fork: "agent/fix" })).toMatchObject({ fork: { fullName: "agent/fix" }, worktree: pull });
    expect(writes().map(({ method, path }) => `${method} ${path}`)).toEqual(["POST /api/forks", "DELETE /api/forks/f1"]);
  });
});
