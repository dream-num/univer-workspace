import { htmlViewDraftGetTool } from "../src/gateway/tools/core/html-view-draft-get.js";
import { htmlViewReadTool } from "../src/gateway/tools/core/html-view-read.js";
import { htmlViewReplaceTool } from "../src/gateway/tools/core/html-view-replace.js";
import { RESULT_LIMIT } from "../src/gateway/paging.js";
import { z } from "zod";
import { LocalStagingStore } from "../src/gateway/staging/local.js";
import { defaultLimits, uploadLinkSchema, type UploadPurpose } from "../src/gateway/staging/model.js";
import { createExecutorLinks } from "../src/gateway/tools/executor-tool.js";
import type { ToolContext, ToolScope } from "../src/gateway/tools/definition.js";
import { fileUploadCreateTool } from "../src/gateway/tools/core/file-upload-create.js";
import { encodeFrame, decodeFrame } from "../src/shared/frame.js";
import { testStagingDirectory } from "./staging-directory.js";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceContentSource } from "@univerjs/univer-workspace-client-core";
import { WorkspaceHttp, workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { htmlViewDraft, htmlViewValidate } from "../src/executor/ops/html-view.js";
import type { OpContext } from "../src/executor/context.js";
import { htmlViewMaxBytes, opSpecs } from "../src/shared/executor-protocol.js";
import { translateError } from "../src/shared/errors.js";
import { UsageAccumulator, zeroCost } from "../src/shared/usage.js";
import { htmlViewCreateTool } from "../src/gateway/tools/files/html-view-create.js";
import { htmlViewValidateTool } from "../src/gateway/tools/files/html-view-validate.js";

const html = '<output data-univer-cell-text="unit:budget:B2"></output>';
const key = "html-retry-key-123";
function setup(page = html, publicRead = false, privateUnits: readonly string[] = []) {
  const draftPosts: object[] = [];
  const resource = {
    id: "resource",
    kind: "blob",
    availability: "ready",
    byteSize: Buffer.byteLength(page),
    mediaType: "text/html",
    capabilities: { downloadContent: true, editContent: false, openContent: true },
  };
  const node = {
    id: "node",
    spaceId: "space",
    name: "Dashboard.univer.html",
    parentNodeId: null,
    hasChildren: false,
    accessRole: "owner",
    updatedAt: "2026-11-08T00:00:00Z",
    resource,
    capabilities: {
      browseChildren: false,
      createChildren: false,
      rename: true,
      move: true,
      trash: true,
      share: true,
    },
  };
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    const request = new Request(url, options);
    if (request.url.includes("/api/unit-resources/")) {
      const unitId = decodeURIComponent(new URL(request.url).pathname.split("/").at(-1) ?? "");
      return Response.json({ node: { ...node, spaceId: privateUnits.includes(unitId) ? "private" : "space", resource: { ...resource, kind: "univer", unitId, unitType: "sheet" } } });
    }
    if (request.url.endsWith("/api/spaces/private")) return Response.json({ id: "private", name: "Private", publicRead: false });
    if (request.url.endsWith("/api/spaces/space")) return Response.json({
      id: "space", name: "Team", type: "team", fullName: "owner/team", slug: "team",
      owner: { id: "owner", username: "owner" }, accessRole: "owner", affiliation: "owner", publicRead,
    });
    if (request.method === "POST" && new URL(request.url).pathname === "/api/html-view-drafts") {
      expect(request.headers.get("idempotency-key")).toBe(key);
      const body = await request.json();
      expect(body.html).toBe(page);
      draftPosts.push(body);
      return Response.json({ draft: draftView(body.kind) }, { status: draftPosts.length === 1 ? 201 : 200 });
    }
    if (request.url.endsWith("/resources/resource")) return Response.json({ node, resource });
    throw new Error(`Unexpected Workspace request ${request.method} ${request.url}`);
  });
  const http = new WorkspaceHttp({
    origin: "https://workspace.test",
    role: "client",
    cookie: "workspace_session=test",
    fetcher,
  });
  const source = new WorkspaceContentSource(http);
  const resolve = vi.spyOn(source, "resolveTrunkRuntimeTarget").mockResolvedValue({
    origin: http.origin,
    scope: { kind: "trunk" },
    unitId: "unit",
    unitType: "sheet",
    revision: 3,
  });
  const exportUnitData = vi.fn<OpContext["runtime"]["exportUnitData"]>(async () =>
    JSON.parse(
      '{"id":"unit","name":"Budget","appVersion":"1","locale":"enUS","styles":{},"sheetOrder":["budget"],"sheets":{"budget":{"rowCount":10,"columnCount":3}}}',
    ),
  );
  const ctx: OpContext = {
    http: () => http,
    source: () => source,
    userId: "owner",
    requestId: "html-view",
    transportOrigin: http.origin,
    signal: new AbortController().signal,
    usage: { executor: "none", cost: { ...zeroCost } },
    runtime: { executeRead: vi.fn(), executeAndCommit: vi.fn(), exportUnitData },
    exchange: { license: "", licenseKey: "" },
  };
  return { ctx, fetcher, resolve, exportUnitData, draftPosts };
}

it("validates a page through the executor's bound trunk export", async () => {
  const f = setup();
  expect(await htmlViewValidate(f.ctx, { html })).toEqual({
    output: { valid: true, unitIds: ["unit"], bindingCount: 1 },
  });
  expect(f.exportUnitData).toHaveBeenCalledWith({
    target: expect.objectContaining({ scope: { kind: "trunk" }, revision: 3 }),
  });
  expect(f.fetcher).not.toHaveBeenCalled();
});

it("preserves missing Sheet errors and rejects missing worksheets and out-of-bounds ranges", async () => {
  const f = setup();
  f.resolve.mockRejectedValueOnce(workspaceError("NOT_FOUND", "Sheet not found"));
  await expect(htmlViewValidate(f.ctx, { html })).rejects.toMatchObject({ code: "NOT_FOUND" });
  for (const invalid of [
    html.replace("budget", "missing"),
    '<div data-univer-range-subscribe="unit:budget:A1:D11"></div>',
  ])
    await expect(htmlViewValidate(f.ctx, { html: invalid })).rejects.toMatchObject({
      code: "workspace-html-view-source-invalid",
    });
  expect(f.fetcher).not.toHaveBeenCalled();
});

it("rejects oversized HTML in UTF-8 bytes at both tool and operation boundaries", () => {
  const tooLarge = "界".repeat(Math.floor(htmlViewMaxBytes / 3) + 1);
  for (const schema of [opSpecs["htmlView.validate"].input, htmlViewValidateTool.inputSchema]) {
    const result = schema.safeParse({ html: tooLarge });
    expect(result.success).toBe(false);
    expect(translateError(result.error)).toMatchObject({
      code: "workspace-argument-invalid",
      message: expect.stringContaining("512 KiB"),
    });
  }
  expect(
    opSpecs["htmlView.draft"].input.safeParse({
      kind: "create",
      html: tooLarge,
      spaceId: "space",
      name: "View",
      idempotencyKey: key,
    }).success,
  ).toBe(false);
  expect(
    htmlViewCreateTool.inputSchema.safeParse({
      html: tooLarge,
      space: "space",
      name: "View",
      idempotency_key: key,
    }).success,
  ).toBe(false);
});

it("saves one validated creation draft per call with its key and identity preview URL", async () => {
  const f = setup();
  const onWrite = vi.fn(() => {
    expect(f.exportUnitData).toHaveBeenCalledOnce();
    expect(f.fetcher.mock.calls.some(([url]) => String(url).endsWith("/api/spaces/space"))).toBe(true);
    expect(f.draftPosts).toEqual([]);
  });
  f.ctx.onCreateUnit = onWrite;
  const input = { kind: "create" as const, html, name: "Dashboard", spaceId: "space", parentNodeId: "folder", idempotencyKey: key };
  const first = await htmlViewDraft(f.ctx, input);
  expect(first.output).toEqual({ draft: {
    id: "draft-1", kind: "create", state: "pending", name: "Dashboard.univer.html", space: "space",
    previewUrl: "https://workspace.test/drafts/draft-1", expiresAt: "2026-11-19T00:00:00Z",
    repositoryVisibility: "private", privateSourceUnitIds: ["unit"],
  } });
  expect(f.draftPosts).toEqual([{ kind: "create", html, name: "Dashboard.univer.html", spaceId: "space", parentNodeId: "folder" }]);
  expect(onWrite).toHaveBeenCalledOnce();
  expect(f.fetcher.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  expect(f.fetcher.mock.calls.some(([url]) => /blob-upload-sessions|blob-resources.*content/.test(String(url)))).toBe(false);
  delete f.ctx.onCreateUnit;
  expect(await htmlViewDraft(f.ctx, input)).toEqual(first);
});

it("does not send a draft or mark a write when validation fails", async () => {
  const f = setup();
  const onWrite = vi.fn();
  await expect(htmlViewDraft({ ...f.ctx, onCreateUnit: onWrite }, {
    kind: "create", html: html.replace("budget", "missing"), name: "Dashboard", spaceId: "space", idempotencyKey: key,
  })).rejects.toMatchObject({ code: "workspace-html-view-source-invalid" });
  expect(onWrite).not.toHaveBeenCalled();
  expect(f.draftPosts).toEqual([]);
});

it.each(["short", "bad key with spaces", "x".repeat(201)])(
  "rejects an invalid creation key %s",
  (idempotency_key) => {
    expect(
      htmlViewCreateTool.inputSchema.safeParse({
        html,
        name: "View",
        space: "space",
        idempotency_key,
      }).success,
    ).toBe(false);
  },
);

it("keeps result-unknown retry guidance and removes staging paths", () => {
  expect(
    translateError(
      workspaceError("workspace-result-unknown", "unconfirmed", {
        sourcePath: "/tmp/private/view.univer.html",
        request: { sourcePath: "/tmp/private/view.univer.html", idempotencyKey: key },
      }),
    ),
  ).toMatchObject({
    code: "workspace-result-unknown",
    message: expect.stringContaining("same idempotency_key"),
    detail: { request: { idempotencyKey: key } },
  });
});


const stores: LocalStagingStore[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(stores.splice(0).map((store) => store.close()));
});
function uploadContext(options: ConstructorParameters<typeof LocalStagingStore>[2] = {}) {
  const store = new LocalStagingStore(testStagingDirectory(), "http://mcp.test/mcp", options);
  stores.push(store);
  const f = setup();
  const usage = new UsageAccumulator();
  const user = { id: "owner", name: "Owner" };
  const scopes = new Set<ToolScope>(["read", "write"]);
  const context: ToolContext = {
    staging: store, usage, user, scopes,
    http: f.ctx.http(), identityOrigin: "https://workspace.test", requestId: "html-upload",
    resources: () => { throw new Error("unused"); },
    executor: createExecutorLinks({ urls: ["http://executor.test"], executorToken: "token-".repeat(8) })(
      { authKind: "dev", session: "session", obtainedAt: Date.now(), expiresAt: Date.now() + 60_000, user, scopes, clientId: "dev" },
      user, "html-upload", Date.now() + 30_000, usage,
    ),
  };
  return { store, context };
}
async function upload(store: LocalStagingStore, bytes: Uint8Array, purpose: UploadPurpose = "html-view", owner = "owner") {
  const { upload } = await store.createUpload(owner, {
    purpose, file_name: "view.html", media_type: "text/html",
  });
  expect((await store.handle(new Request(upload.upload_url, { method: "PUT", body: new Uint8Array(bytes) }))).status).toBe(204);
  return upload.upload_id;
}
const createArgs = { space: "space", name: "Dashboard", idempotency_key: key };

it.each([htmlViewValidateTool, htmlViewCreateTool])("$name requires exactly one HTML source", async (tool) => {
  const { context } = uploadContext();
  const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected executor call"));
  for (const source of [{}, { html, html_upload_id: "upload" }]) {
    try {
      await tool.run(context, { ...createArgs, ...source });
      expect.fail("Expected invalid arguments");
    } catch (error) {
      expect(translateError(error)).toMatchObject({ code: "workspace-argument-invalid" });
    }
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it("validates and drafts uploaded UTF-8 bytes unchanged, including BOM, across retries", async () => {
  const page = "\ufeff" + html + "<!-- 界 😀 -->\r\n";
  const f = setup(page);
  const { store, context } = uploadContext();
  const executor = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
    const header = z.object({
      op: z.enum(["htmlView.validate", "htmlView.draft"]), input: z.unknown(),
    }).parse(decodeFrame(Buffer.from(await new Response(options?.body).arrayBuffer())).header);
    expect(header.input).toMatchObject({ html: page });
    const result = header.op === "htmlView.validate"
      ? await htmlViewValidate(f.ctx, opSpecs["htmlView.validate"].input.parse(header.input))
      : await htmlViewDraft(f.ctx, opSpecs["htmlView.draft"].input.parse(header.input));
    return new Response(new Uint8Array(encodeFrame({ ok: true, output: result.output, meta: f.ctx.usage })));
  });
  const html_upload_id = await upload(store, Buffer.from(page));
  expect((await htmlViewValidateTool.run(context, { html_upload_id })).output).toEqual({ valid: true, unitIds: ["unit"], bindingCount: 1 });
  const first = await htmlViewCreateTool.run(context, { ...createArgs, html_upload_id });
  expect(await htmlViewCreateTool.run(context, { ...createArgs, html_upload_id })).toEqual(first);
  expect(first.output).toMatchObject({ draft: { id: "draft-1", previewUrl: "https://workspace.test/drafts/draft-1" } });
  expect(f.draftPosts).toHaveLength(2);
  expect(executor).toHaveBeenCalledTimes(3);
  expect(context.usage?.snapshot().cost.upload_bytes).toBe(3 * Buffer.byteLength(page));
  expect((await store.requireUpload("owner", html_upload_id, "html-view")).state).toBe("ready");
});

it.each([htmlViewValidateTool, htmlViewCreateTool])("$name rejects invalid UTF-8, oversize and wrong-purpose uploads", async (tool) => {
  const { store, context } = uploadContext({ limits: { ...defaultLimits, "html-view": htmlViewMaxBytes + 1 } });
  const fetcher = vi.spyOn(globalThis, "fetch");
  const invalid = await upload(store, new Uint8Array([0xc3, 0x28]));
  const oversize = await upload(store, Buffer.alloc(htmlViewMaxBytes + 1, 32));
  const wrong = await upload(store, Buffer.from(html), "blob");
  const foreign = await upload(store, Buffer.from(html), "html-view", "other");
  for (const [html_upload_id, code] of [
    [invalid, "workspace-argument-invalid"], [oversize, "workspace-argument-invalid"],
    [wrong, "workspace-upload-purpose-mismatch"], [foreign, "workspace-upload-not-found"],
  ]) {
    try {
      await tool.run(context, { ...createArgs, html_upload_id });
      expect.fail("Expected invalid upload");
    } catch (error) {
      expect(translateError(error)).toMatchObject({ code });
    }
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it("advertises the html-view upload purpose and caps staged HTML at 512 KiB", async () => {
  const { store, context } = uploadContext();
  const result = await fileUploadCreateTool.run(context, { purpose: "html-view", file_name: "view.html", media_type: "text/html" });
  const { upload } = uploadLinkSchema.parse(result.output);
  expect(upload.max_bytes).toBe(htmlViewMaxBytes);
  expect((await store.handle(new Request(upload.upload_url, { method: "PUT", body: Buffer.alloc(htmlViewMaxBytes + 1) }))).status).toBe(413);
  await expect(store.createUpload("owner", { purpose: "html-view", file_name: "view.zip", media_type: "application/zip" })).rejects.toMatchObject({ code: "workspace-upload-media-type-invalid" });
});

it.each([
  { publicRead: true, privateUnits: [], visibility: "public", expected: [] },
  { publicRead: false, privateUnits: [], visibility: "private", expected: ["unit"] },
  { publicRead: true, privateUnits: ["unit"], visibility: "public", expected: ["unit"] },
])("MCP returns sharing fields for $visibility with private sources $privateUnits", async ({ publicRead, privateUnits, visibility, expected }) => {
  const f = setup(html, publicRead, privateUnits);
  const { context } = uploadContext();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
    const { input } = z.object({ input: opSpecs["htmlView.draft"].input }).parse(decodeFrame(Buffer.from(await new Response(options?.body).arrayBuffer())).header);
    const result = await htmlViewDraft(f.ctx, input);
    return new Response(new Uint8Array(encodeFrame({ ok: true, output: result.output, meta: f.ctx.usage })));
  });
  const result = await htmlViewCreateTool.run(context, { ...createArgs, html });
  expect(result.output).toMatchObject({ draft: { previewUrl: "https://workspace.test/drafts/draft-1", repositoryVisibility: visibility, privateSourceUnitIds: expected } });
  expect(opSpecs["htmlView.draft"].output.parse(result.output)).toEqual(result.output);
});

function revisionSetup(page = html, name = "Dashboard.univer.html", stale = false) {
  const f = setup(page, true, ["unit"]);
  const original = f.fetcher.getMockImplementation();
  if (!original) throw new Error("Expected product fetcher");
  const writes: string[] = [];
  const recorded = new Map<string, object>();
  f.fetcher.mockImplementation(async (url, options) => {
    const request = new Request(url, options);
    if (request.url.endsWith("/download")) return new Response(page, { headers: {
      "content-type": "text/html", "content-length": String(Buffer.byteLength(page)), etag: '"v1"',
    } });
    if (request.url.endsWith("/resources/resource")) {
      const body = await (await original(url, options)).json();
      return Response.json({ ...body, node: { ...body.node, name } });
    }
    if (request.method === "POST" && request.url.endsWith("/api/html-view-drafts")) {
      expect(request.headers.get("idempotency-key")).toBe(key);
      const idempotencyKey = request.headers.get("idempotency-key") ?? "";
      if (stale) return Response.json({ error: { code: "PRECONDITION_FAILED", message: "ETag conflict" } }, { status: 412 });
      if (!recorded.has(idempotencyKey)) {
        const body = await request.json();
        expect(body).toEqual({ kind: "replace", html: page, resourceId: "resource", etag: '"v1"' });
        writes.push(body.html);
        recorded.set(idempotencyKey, { draft: draftView("replace") });
      }
      return Response.json(recorded.get(idempotencyKey));
    }
    return await original(url, options);
  });
  return { ...f, writes };
}

it("reads a page inline with a strong ETag and immersive link", async () => {
  const { context } = uploadContext();
  const f = revisionSetup();
  const result = await htmlViewReadTool.run({ ...context, http: f.ctx.http() }, { resource: "resource" });
  expect(result).toEqual({ repo: "space", output: {
    resource: "resource", node: "node", space: "space", name: "Dashboard.univer.html",
    html, etag: '"v1"', shareUrl: "https://workspace.test/nodes/node?view=immersive",
  } });
  expect(htmlViewReadTool.outputSchema.parse(result.output)).toEqual(result.output);
});

it("refuses non-pages and oversize pages rather than returning partial HTML", async () => {
  const { context } = uploadContext();
  for (const [page, name, code] of [
    [html, "page.html", "workspace-resource-kind-mismatch"],
    ["x".repeat(RESULT_LIMIT), "Page.univer.html", "workspace-result-too-large"],
    ['"'.repeat(RESULT_LIMIT / 2), "Page.univer.html", "workspace-result-too-large"],
  ]) {
    const f = revisionSetup(page, name);
    await expect(htmlViewReadTool.run({ ...context, http: f.ctx.http() }, { resource: "resource" })).rejects.toMatchObject({ code });
  }
});

const replaceArgs = { resource: "resource", html, etag: '"v1"', idempotency_key: key };
function connectReplacement(ctx: OpContext) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
    const { input } = z.object({ input: opSpecs["htmlView.draft"].input }).parse(
      decodeFrame(Buffer.from(await new Response(options?.body).arrayBuffer())).header,
    );
    try {
      const result = await htmlViewDraft(ctx, input);
      return new Response(new Uint8Array(encodeFrame({ ok: true, output: result.output, meta: ctx.usage })));
    } catch (error) {
      return new Response(new Uint8Array(encodeFrame({ ok: false, error: translateError(error), meta: ctx.usage })));
    }
  });
}

it("validates a replacement before writing and accepts inline HTML only", async () => {
  const { context } = uploadContext();
  const f = revisionSetup();
  const executor = connectReplacement(f.ctx);
  for (const args of [
    { ...replaceArgs, html: undefined, html_upload_id: "upload" },
    { ...replaceArgs, html_upload_id: "upload" },
  ]) await expect(htmlViewReplaceTool.run(context, args)).rejects.toBeInstanceOf(z.ZodError);
  expect(executor).not.toHaveBeenCalled();
  await expect(htmlViewReplaceTool.run(context, {
    ...replaceArgs, html: html.replace("budget", "missing"),
  })).rejects.toMatchObject({ wire: { code: "workspace-html-view-source-invalid" } });
  expect(f.writes).toEqual([]);
});

it("returns a stale ETag conflict to the model", async () => {
  const { context } = uploadContext();
  const f = revisionSetup(html, undefined, true);
  connectReplacement(f.ctx);
  await expect(htmlViewReplaceTool.run(context, replaceArgs)).rejects.toMatchObject({
    wire: { code: "PRECONDITION_FAILED", detail: { status: 412 } },
  });
  expect(f.writes).toEqual([]);
});

it("returns the recorded replacement for a repeated key, including the access summary", async () => {
  const { context } = uploadContext();
  const f = revisionSetup();
  connectReplacement(f.ctx);
  const first = await htmlViewReplaceTool.run(context, replaceArgs);
  expect(await htmlViewReplaceTool.run(context, replaceArgs)).toEqual(first);
  expect(first.output).toMatchObject({
    draft: { id: "draft-1", kind: "replace", state: "pending", resource: "resource",
      previewUrl: "https://workspace.test/drafts/draft-1", expiresAt: "2026-11-19T00:00:00Z",
      repositoryVisibility: "public", privateSourceUnitIds: ["unit"] },
  });
  expect(f.writes).toEqual([html]);
  expect(f.ctx.usage.repo).toBe("space");
});

function draftView(kind: "create" | "replace" = "create", state = "pending") {
  return { id: "draft-1", kind, state, spaceId: "space", parentNodeId: null,
    name: "Dashboard.univer.html", targetResourceId: kind === "replace" ? "resource" : null,
    baseEtag: kind === "replace" ? '"v1"' : null, byteSize: Buffer.byteLength(html),
    createdAt: "2026-11-12T00:00:00Z", expiresAt: "2026-11-19T00:00:00Z", decidedAt: null,
    published: state === "published" ? { nodeId: "node/1", resourceId: "resource", etag: '"v2"' } : null };
}

it.each(["create", "replace"] as const)("reads every %s draft state over HTTP without an executor", async (kind) => {
  for (const state of ["pending", "published", "rejected", "expired", "conflicted"]) {
    const { context } = uploadContext();
    const fetcher = vi.fn<typeof fetch>(async (url, options) => {
      expect(new URL(String(url)).pathname).toBe("/api/html-view-drafts/draft-1");
      expect(options?.method).toBe("GET");
      return Response.json({ draft: draftView(kind, state) });
    });
    const http = new WorkspaceHttp({ origin: "https://workspace.test", transportOrigin: "http://internal.test", role: "client", cookie: "session=test", fetcher });
    const { executor: _executor, ...withoutExecutor } = context;
    const result = await htmlViewDraftGetTool.run({ ...withoutExecutor, http }, { draft: "draft-1" });
    expect(result.output).toMatchObject({ draft: { id: "draft-1", state, previewUrl: "https://workspace.test/drafts/draft-1" } });
    const output = htmlViewDraftGetTool.outputSchema.parse(result.output);
    expect(output).toEqual(result.output);
    if (state === "published") expect(result.output).toMatchObject({ draft: {
      resource: "resource", node: "node/1", etag: '"v2"', shareUrl: "https://workspace.test/nodes/node%2F1?view=immersive",
    } });
    else for (const key of ["shareUrl", "node", "resource", "etag"]) expect(result.output).not.toHaveProperty(`draft.${key}`);
    expect(fetcher).toHaveBeenCalledOnce();
  }
});

it("rejects mismatched drafts and malformed publication results", async () => {
  const { context } = uploadContext();
  for (const draft of [ { ...draftView(), id: "other" }, { ...draftView(), state: "published" },
    { ...draftView("create", "published"), published: { nodeId: "node", resourceId: "resource", etag: 'W/"v2"' } },
    { ...draftView(), published: { nodeId: "node", resourceId: "resource", etag: '"v2"' } } ]) {
    const http = new WorkspaceHttp({ origin: context.identityOrigin, role: "client", cookie: "session=test", fetcher: async () => Response.json({ draft }) });
    await expect(htmlViewDraftGetTool.run({ ...context, http }, { draft: "draft-1" })).rejects.toBeInstanceOf(Error);
  }
});

it("sends exactly one replacement draft POST and never uses Blob publishing endpoints", async () => {
  const f = revisionSetup();
  const { context } = uploadContext();
  connectReplacement(f.ctx);
  const result = await htmlViewReplaceTool.run(context, replaceArgs);
  expect(result.output).toMatchObject({ draft: { id: "draft-1", kind: "replace", state: "pending", previewUrl: "https://workspace.test/drafts/draft-1" } });
  expect(f.writes).toEqual([html]);
  expect(f.fetcher.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  expect(f.fetcher.mock.calls.some(([url]) => /blob-upload-sessions|blob-resources.*content/.test(String(url)))).toBe(false);
});
