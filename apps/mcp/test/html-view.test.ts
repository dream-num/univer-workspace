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
import { htmlViewCreate, htmlViewValidate } from "../src/executor/ops/html-view.js";
import type { OpContext } from "../src/executor/context.js";
import { htmlViewMaxBytes, opSpecs } from "../src/shared/executor-protocol.js";
import { translateError } from "../src/shared/errors.js";
import { UsageAccumulator, zeroCost } from "../src/shared/usage.js";
import { htmlViewCreateTool } from "../src/gateway/tools/files/html-view-create.js";
import { htmlViewValidateTool } from "../src/gateway/tools/files/html-view-validate.js";

const html = '<output data-univer-cell-text="unit:budget:B2"></output>';
const key = "html-retry-key-123";
function setup(page = html, publicRead = false, privateUnits: readonly string[] = []) {
  let completed = false;
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
  const envelope = () => ({
    operation: {
      id: key,
      kind: "createBlobResource",
      state: completed ? "completed" : "pending",
      result: null,
      error: null,
      createdAt: "now",
      updatedAt: "now",
    },
    upload: {
      id: "upload",
      operationId: key,
      nodeId: "node",
      resourceId: "resource",
      state: completed ? "completed" : "waitingForUpload",
      name: node.name,
      originalFilename: "view.univer.html",
      byteSize: resource.byteSize,
      receivedSize: completed ? resource.byteSize : null,
      detectedMediaType: completed ? "text/html" : null,
      sha256: null,
      expiresAt: "later",
      createdAt: "now",
      updatedAt: "now",
    },
    uploadTarget: completed
      ? null
      : { method: "PUT", contentUrl: "/api/blob-upload-sessions/upload/content" },
  });
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
    if (request.method === "POST") {
      expect(request.headers.get("idempotency-key")).toBe(key);
      return Response.json(envelope());
    }
    if (request.method === "PUT") {
      expect(Buffer.from(await request.arrayBuffer())).toEqual(Buffer.from(page));
      completed = true;
      return new Response(null, { status: 204 });
    }
    if (request.url.endsWith("/resources/resource")) return Response.json({ node, resource });
    return Response.json(envelope());
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
  return { ctx, fetcher, resolve, exportUnitData };
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
    opSpecs["htmlView.create"].input.safeParse({
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

it("publishes the validated bytes and preserves the key and Node across an idempotent retry", async () => {
  const f = setup();
  const input = { html, name: "Dashboard", spaceId: "space", idempotencyKey: key };
  const first = await htmlViewCreate(f.ctx, input);
  const second = await htmlViewCreate(f.ctx, input);
  expect(second).toEqual(first);
  expect(first.output).toMatchObject({
    nodeId: "node",
    originalFilename: "view.univer.html",
    workspaceUrl: "https://workspace.test/nodes/node",
  });
  expect(f.fetcher.mock.calls.filter(([, options]) => options?.method === "PUT")).toHaveLength(1);
  expect(f.ctx.usage).toMatchObject({ executor: "none", cost: zeroCost, repo: "space" });
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
  const scopes = new Set<ToolScope>(["read", "publish"]);
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

it("validates and publishes uploaded UTF-8 bytes unchanged, including BOM, across retries", async () => {
  const page = "\ufeff" + html + "<!-- 界 😀 -->\r\n";
  const f = setup(page);
  const { store, context } = uploadContext();
  const executor = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
    const header = z.object({
      op: z.enum(["htmlView.validate", "htmlView.create"]), input: z.unknown(),
    }).parse(decodeFrame(Buffer.from(await new Response(options?.body).arrayBuffer())).header);
    expect(header.input).toMatchObject({ html: page });
    const result = header.op === "htmlView.validate"
      ? await htmlViewValidate(f.ctx, opSpecs["htmlView.validate"].input.parse(header.input))
      : await htmlViewCreate(f.ctx, opSpecs["htmlView.create"].input.parse(header.input));
    return new Response(new Uint8Array(encodeFrame({ ok: true, output: result.output, meta: f.ctx.usage })));
  });
  const html_upload_id = await upload(store, Buffer.from(page));
  expect((await htmlViewValidateTool.run(context, { html_upload_id })).output).toEqual({ valid: true, unitIds: ["unit"], bindingCount: 1 });
  const first = await htmlViewCreateTool.run(context, { ...createArgs, html_upload_id });
  expect(await htmlViewCreateTool.run(context, { ...createArgs, html_upload_id })).toEqual(first);
  expect(first.output).toMatchObject({ nodeId: "node", originalFilename: "view.univer.html" });
  expect(f.fetcher.mock.calls.filter(([, options]) => options?.method === "PUT")).toHaveLength(1);
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
    const { input } = z.object({ input: opSpecs["htmlView.create"].input }).parse(decodeFrame(Buffer.from(await new Response(options?.body).arrayBuffer())).header);
    const result = await htmlViewCreate(f.ctx, input);
    return new Response(new Uint8Array(encodeFrame({ ok: true, output: result.output, meta: f.ctx.usage })));
  });
  const result = await htmlViewCreateTool.run(context, { ...createArgs, html });
  expect(result.output).toMatchObject({ shareUrl: "https://workspace.test/nodes/node?view=immersive", repositoryVisibility: visibility, privateSourceUnitIds: expected });
  expect(opSpecs["htmlView.create"].output.parse(result.output)).toEqual(result.output);
});
