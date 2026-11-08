import { expect, it, vi } from "vitest";
import { WorkspaceContentSource } from "@univerjs/univer-workspace-client-core";
import { WorkspaceHttp, workspaceError } from "@univerjs/univer-workspace-client-core/product";
import { htmlViewCreate, htmlViewValidate } from "../src/executor/ops/html-view.js";
import type { OpContext } from "../src/executor/context.js";
import { htmlViewMaxBytes, opSpecs } from "../src/shared/executor-protocol.js";
import { translateError } from "../src/shared/errors.js";
import { zeroCost } from "../src/shared/usage.js";
import { htmlViewCreateTool } from "../src/gateway/tools/files/html-view-create.js";
import { htmlViewValidateTool } from "../src/gateway/tools/files/html-view-validate.js";

const html = '<output data-univer-cell-text="unit:budget:B2"></output>';
const key = "html-retry-key-123";
function setup() {
  let completed = false;
  const resource = {
    id: "resource",
    kind: "blob",
    availability: "ready",
    byteSize: Buffer.byteLength(html),
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
    if (request.method === "POST") {
      expect(request.headers.get("idempotency-key")).toBe(key);
      return Response.json(envelope());
    }
    if (request.method === "PUT") {
      expect(await request.text()).toBe(html);
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
