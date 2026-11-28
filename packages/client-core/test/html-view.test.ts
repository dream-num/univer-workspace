import { LocaleType, type IWorkbookData } from "@univerjs/core";
import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { WorkspaceBlobFeature } from "../src/blob.js";
import { describeHtmlViewAccess } from "../src/html-view-page.js";
import { WorkspaceHttp } from "../src/http.js";
import { WorkspaceHtmlViewFeature, type WorkspaceHtmlViewOptions } from "../src/html-view.js";
import { WorkspaceContentSource } from "../src/runtime-source.js";

it.each([403, 404, 500].flatMap((status) => [false, true].map((worktree) => ({ status, worktree }))))(
  "reports trunk source HTTP $status with Worktree scope $worktree for validation and drafts", async ({ status, worktree }) => {
  const http = new WorkspaceHttp({
    origin: "https://workspace.test", role: "client", cookie: "workspace_session=test",
    fetcher: async (url, init) => {
      const request = new Request(url, init);
      expect(request.method).toBe("GET");
      if (new URL(request.url).pathname === "/api/worktrees/wt-1")
        return Response.json({ worktree: { id: "wt-1", name: "Sources", state: "draft", units: [] } });
      expect(new URL(request.url).pathname).toBe("/universer-api/snapshot/2/unit/unit/rev/0");
      return Response.json({ error: { code: "SOURCE_READ_FAILED", message: "Cannot read this unit." } }, { status });
    },
  });
  const content = new WorkspaceContentSource(http);
  const feature = new WorkspaceHtmlViewFeature({
    authenticatedHttp: async () => http, blobs: { uploadBytes: vi.fn() },
    configuredOrigin: async () => http.origin, runtime: { exportUnitData: vi.fn() },
    resolveTrunkRuntimeTarget: (input) => content.resolveTrunkRuntimeTarget(input),
  });
  const source = { name: "view.univer.html", bytes: Buffer.from('<output data-univer-cell-text="unit:budget:B2"></output>') };
  const expected = status === 500
    ? { code: "SOURCE_READ_FAILED", message: "Cannot read this unit.", detail: { status, path: "/universer-api/snapshot/2/unit/unit/rev/0" } }
    : {
        code: "workspace-html-view-source-unavailable",
        message: "The source Sheet may not exist, may not be readable by you, or may exist only in an unmerged pull request. Pass the source pull request to validate unmerged data.",
        detail: { unitId: "unit" },
      };
  const scope = worktree ? { sourceWorktreeId: "wt-1" } : {};
  await expect(feature.validate({ ...source, ...scope })).rejects.toMatchObject(expected);
  await expect(feature.draft({ kind: "create", source, ...scope, name: "View", spaceId: "space", idempotencyKey: "key" })).rejects.toMatchObject(expected);
});

it("snapshots source-neutral bytes before awaiting trunk validation", async () => {
  const html = '<output data-univer-cell-text="unit:budget:B2"></output>';
  const bytes = Buffer.from(html);
  const upload = vi.fn<Extract<WorkspaceHtmlViewOptions["blobs"], { upload: unknown }>["upload"]>(
    async (input) => {
      expect(await readFile(input.filePath, "utf8")).toBe(html);
      return { nodeId: "node", operationId: input.idempotencyKey };
    },
  );
  const feature = new WorkspaceHtmlViewFeature({
    authenticatedHttp: async () => sharingHttp(),
    blobs: { upload },
    configuredOrigin: async () => "https://workspace.test",
    resolveTrunkRuntimeTarget: async () => {
      bytes.fill(0);
      return {
        origin: "https://workspace.test",
        scope: { kind: "trunk" },
        unitId: "unit",
        unitType: "sheet",
        revision: 1,
      };
    },
    runtime: {
      exportUnitData: async () => ({
        id: "unit",
        name: "Budget",
        appVersion: "1",
        locale: LocaleType.EN_US,
        styles: {},
        sheetOrder: ["budget"],
        sheets: { budget: { rowCount: 10, columnCount: 3 } },
      }),
    },
  });
  expect(
    await feature.create({
      source: { bytes, name: "view.univer.html" },
      name: "Dashboard",
      spaceId: "space",
      idempotencyKey: "key",
    }),
  ).toEqual({
    nodeId: "node",
    operationId: "key",
    workspaceUrl: "https://workspace.test/nodes/node",
    shareUrl: "https://workspace.test/nodes/node?view=immersive",
    repositoryVisibility: "private",
    privateSourceUnitIds: ["unit"],
    access: "Only signed-in people with access can open shareUrl. To let anyone with the link view it without signing in, ask the user before making the repository public.",
  });
});

it("publishes a snapshot through uploadBytes without a file upload", async () => {
  const bytes = Buffer.from("<p>View</p>");
  const uploadBytes = vi.fn<
    Extract<WorkspaceHtmlViewOptions["blobs"], { uploadBytes: unknown }>["uploadBytes"]
  >(async (input) => {
    expect(Buffer.from(input.bytes).toString()).toBe("<p>View</p>");
    expect(input.fileName).toBe("view.univer.html");
    expect(input).not.toHaveProperty("filePath");
    return { nodeId: "node" };
  });
  const feature = new WorkspaceHtmlViewFeature({
    authenticatedHttp: async () => sharingHttp(),
    blobs: { uploadBytes },
    runtime: { exportUnitData: vi.fn() },
    resolveTrunkRuntimeTarget: vi.fn(),
    configuredOrigin: async () => {
      bytes.fill(0);
      return "https://workspace.test";
    },
  });
  await expect(
    feature.create({
      source: { bytes, name: "view.univer.html" },
      name: "View",
      spaceId: "space",
      idempotencyKey: "key",
    }),
  ).resolves.toMatchObject({ workspaceUrl: "https://workspace.test/nodes/node" });
  expect(uploadBytes).toHaveBeenCalledOnce();
});

function sharingHttp(publicRead = false, privateUnits: readonly string[] = [], privateSpaceStatus = 200) {
  return new WorkspaceHttp({
    origin: "https://workspace.test",
    role: "client",
    cookie: "workspace_session=test",
    fetcher: async (url) => {
      const path = new URL(String(url)).pathname;
      if (path.startsWith("/api/spaces/")) {
        const id = path.split("/").at(-1);
        if (id === "private" && privateSpaceStatus !== 200) {
          return Response.json({ error: { code: "NOT_FOUND", message: "Space unavailable" } }, { status: privateSpaceStatus });
        }
        return Response.json({ id, name: "Team", publicRead: id === "private" ? false : publicRead });
      }
      const unitId = decodeURIComponent(path.split("/").at(-1) ?? "");
      return Response.json({ node: {
        id: "source-node", spaceId: privateUnits.includes(unitId) ? "private" : "space",
        parentNodeId: null, name: "Sheet", hasChildren: false, updatedAt: "now", accessRole: "owner",
        capabilities: { browseChildren: false, createChildren: false, rename: true, move: true, trash: true, share: true },
        resource: { id: "sheet-resource", kind: "univer", unitId, unitType: "sheet",
          capabilities: { downloadContent: true, editContent: true, openContent: true } },
      } });
    },
  });
}

it.each([
  { publicRead: true, privateUnits: [], visibility: "public", expected: [] },
  { publicRead: false, privateUnits: [], visibility: "private", expected: ["a", "public", "z"] },
  { publicRead: true, privateUnits: ["z"], visibility: "public", expected: ["z"] },
  { publicRead: true, privateUnits: ["z", "a"], visibility: "public", expected: ["a", "z"] },
])("reports share access for $visibility repositories with private sources $privateUnits", async ({ publicRead, privateUnits, visibility, expected }) => {
  const http = sharingHttp(publicRead, privateUnits);
  const json = vi.spyOn(http, "json");
  const feature = new WorkspaceHtmlViewFeature({
    authenticatedHttp: async () => http,
    configuredOrigin: async () => "https://workspace.test",
    blobs: { uploadBytes: async () => ({ nodeId: "node/1" }) },
    resolveTrunkRuntimeTarget: async ({ unitId }) => ({
      origin: "https://workspace.test", scope: { kind: "trunk" }, unitId, unitType: "sheet", revision: 1,
    }),
    runtime: { exportUnitData: async ({ target }) => ({
      id: target.unitId, name: "Budget", appVersion: "1", locale: LocaleType.EN_US,
      styles: {}, sheetOrder: ["budget"], sheets: { budget: { rowCount: 10, columnCount: 3 } },
    }) },
  });
  const html = ["z", "a", "public", "z"].map((id) => `<output data-univer-cell-text="${id}:budget:B2"></output>`).join("");
  await expect(feature.create({ source: { bytes: Buffer.from(html), name: "view.univer.html" }, name: "View", spaceId: "space", idempotencyKey: "key" })).resolves.toMatchObject({
    workspaceUrl: "https://workspace.test/nodes/node%2F1",
    shareUrl: "https://workspace.test/nodes/node%2F1?view=immersive",
    repositoryVisibility: visibility, privateSourceUnitIds: expected,
  });
  expect(json.mock.calls.filter(([path]) => path === "/api/spaces/space")).toHaveLength(1);
  expect(json.mock.calls.filter(([path]) => path === "/api/spaces/private")).toHaveLength(privateUnits.length ? 1 : 0);
});

it.each([404, 403, 500])("handles source Space HTTP %s without hiding other failures", async (status) => {
  const http = sharingHttp(true, ["unit"], status);
  const uploadBytes = vi.fn(async () => ({ nodeId: "node" }));
  const feature = new WorkspaceHtmlViewFeature({
    authenticatedHttp: async () => http,
    configuredOrigin: async () => http.origin,
    blobs: { uploadBytes },
    resolveTrunkRuntimeTarget: async ({ unitId }) => ({
      origin: http.origin, scope: { kind: "trunk" }, unitId, unitType: "sheet", revision: 1,
    }),
    runtime: { exportUnitData: async () => ({
      id: "unit", name: "Budget", appVersion: "1", locale: LocaleType.EN_US,
      styles: {}, sheetOrder: ["budget"], sheets: { budget: {} },
    }) },
  });
  const creation = feature.create({
    source: { bytes: Buffer.from('<output data-univer-cell-text="unit:budget:B2"></output>'), name: "view.univer.html" },
    name: "View", spaceId: "space", idempotencyKey: "key",
  });
  if (status === 404) {
    await expect(creation).resolves.toMatchObject({
      shareUrl: "https://workspace.test/nodes/node?view=immersive",
      repositoryVisibility: "public",
      privateSourceUnitIds: ["unit"],
    });
    expect(uploadBytes).toHaveBeenCalledOnce();
  } else {
    await expect(creation).rejects.toMatchObject({ detail: { status } });
    expect(uploadBytes).not.toHaveBeenCalled();
  }
});

it("does not publish when source metadata cannot confirm the requested Unit", async () => {
  const http = sharingHttp();
  const json = vi.spyOn(http, "json");
  const wrong = await http.json("/api/unit-resources/other");
  const uploadBytes = vi.fn();
  const feature = new WorkspaceHtmlViewFeature({
    authenticatedHttp: async () => http, blobs: { uploadBytes },
    configuredOrigin: async () => http.origin,
    resolveTrunkRuntimeTarget: async ({ unitId }) => ({ origin: http.origin, scope: { kind: "trunk" }, unitId, unitType: "sheet", revision: 1 }),
    runtime: { exportUnitData: async () => ({
      id: "unit", name: "Budget", appVersion: "1", locale: LocaleType.EN_US,
      styles: {}, sheetOrder: ["budget"], sheets: { budget: {} },
    }) },
  });
  json.mockImplementation(async (path) => path.startsWith("/api/spaces/") ? { id: "space", name: "Team" } : wrong);
  await expect(feature.create({ source: { bytes: Buffer.from('<output data-univer-cell-text="unit:budget:B2"></output>'), name: "view.univer.html" }, name: "View", spaceId: "space", idempotencyKey: "key" })).rejects.toMatchObject({ code: "workspace-result-mismatch" });
  expect(uploadBytes).not.toHaveBeenCalled();
});

function revisionFeature(options: { name?: string; page?: Uint8Array; etag?: string; conflict?: boolean; publicRead?: boolean } = {}) {
  const page = options.page ?? Buffer.from('<output data-univer-cell-text="unit:budget:B2"></output>');
  const resource = {
    id: "resource", kind: "blob", availability: "ready", byteSize: page.length,
    mediaType: "text/html", capabilities: { downloadContent: true, editContent: true, openContent: true },
  };
  const node = {
    id: "node", spaceId: "space", parentNodeId: null, name: options.name ?? "Page.univer.html",
    hasChildren: false, updatedAt: "now", accessRole: "owner", resource,
    capabilities: { browseChildren: false, createChildren: false, rename: true, move: true, trash: true, share: true },
  };
  const recorded = new Map<string, { operationId: string; resourceId: string; etag: string }>();
  const writes: string[] = [];
  const sharing = sharingHttp(options.publicRead ?? true, ["unit"]);
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const request = new Request(url, init);
    const path = new URL(request.url).pathname;
    if (path === "/api/resources/resource") return Response.json({ node, resource });
    if (path.endsWith("/download")) {
      expect(request.headers.get("accept-encoding")).toBe("identity");
      return new Response(new Uint8Array(page), { headers: {
        "content-type": "text/html", "content-length": String(page.length), etag: options.etag ?? '"v1"',
      } });
    }
    if (path.endsWith("/content")) {
      const key = request.headers.get("idempotency-key") ?? "";
      expect(request.headers.get("if-match")).toBe('"v1"');
      if (options.conflict) return Response.json({ error: { code: "PRECONDITION_FAILED", message: "Changed" } }, { status: 412 });
      if (!recorded.has(key)) {
        writes.push(await request.text());
        recorded.set(key, { operationId: key, resourceId: "resource", etag: '"v2"' });
      }
      return Response.json(recorded.get(key));
    }
    return Response.json(await sharing.json(path));
  });
  const http = new WorkspaceHttp({ origin: "https://workspace.test", role: "client", cookie: "session=test", fetcher });
  const blobs = new WorkspaceBlobFeature(async () => http);
  const feature = new WorkspaceHtmlViewFeature({
    authenticatedHttp: async () => http,
    blobs: {
      uploadBytes: async () => ({ nodeId: "node" }),
      get: (id) => blobs.get(id),
      replaceBytes: (input) => blobs.replaceBytes(input),
    },
    configuredOrigin: async () => http.origin,
    resolveTrunkRuntimeTarget: async ({ unitId }) => ({ origin: http.origin, unitId, unitType: "sheet", revision: 1, scope: { kind: "trunk" } }),
    runtime: { exportUnitData: async () => ({
      id: "unit", name: "Budget", appVersion: "1", locale: LocaleType.EN_US,
      styles: {}, sheetOrder: ["budget"], sheets: { budget: { rowCount: 10, columnCount: 3 } },
    }) },
  });
  return { feature, fetcher, writes };
}

it("reads the exact UTF-8 page including BOM with its strong ETag and identity", async () => {
  const html = '\ufeff<p title="界">😀</p>\r\n';
  const { feature } = revisionFeature({ page: Buffer.from(html) });
  await expect(feature.read("resource", 1000)).resolves.toEqual({
    resourceId: "resource", nodeId: "node", spaceId: "space", name: "Page.univer.html", html, etag: '"v1"',
  });
});

it("rejects a non-page before downloading", async () => {
  const { feature, fetcher } = revisionFeature({ name: "Page.html" });
  await expect(feature.read("resource", 1000)).rejects.toMatchObject({ code: "workspace-resource-kind-mismatch" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([Buffer.from("x".repeat(1001)), Buffer.from('"'.repeat(600))])("refuses oversized inline pages without truncation %#", async (page) => {
  await expect(revisionFeature({ page }).feature.read("resource", 1000)).rejects.toMatchObject({ code: "workspace-result-too-large" });
});

it("rejects invalid UTF-8 and weak ETags", async () => {
  await expect(revisionFeature({ page: new Uint8Array([0xc3, 0x28]) }).feature.read("resource", 1000)).rejects.toMatchObject({ code: "workspace-html-view-invalid" });
  await expect(revisionFeature({ etag: 'W/"v1"' }).feature.read("resource", 1000)).rejects.toMatchObject({ code: "workspace-invalid-response" });
});

const replacement = {
  resourceId: "resource", etag: '"v1"', idempotencyKey: "html-replace-key-123",
  source: { name: "view.univer.html", bytes: Buffer.from('<output data-univer-cell-text="unit:budget:B2"></output>') },
};

it.each([true, false])("replaces conditionally and idempotently with the creation access summary (public %s)", async (publicRead) => {
  const { feature, writes } = revisionFeature({ publicRead });
  const created = await feature.create({ source: replacement.source, name: "Page", spaceId: "space", idempotencyKey: "create-key" });
  const first = await feature.replace(replacement);
  expect(first.repositoryVisibility).toBe(created.repositoryVisibility);
  expect(first.privateSourceUnitIds).toEqual(created.privateSourceUnitIds);
  expect(await feature.replace(replacement)).toEqual(first);
  expect(first).toEqual({
    resourceId: "resource", nodeId: "node", operationId: replacement.idempotencyKey, etag: '"v2"',
    workspaceUrl: "https://workspace.test/nodes/node", shareUrl: "https://workspace.test/nodes/node?view=immersive",
    repositoryVisibility: publicRead ? "public" : "private", privateSourceUnitIds: ["unit"],
    access: publicRead
      ? "Anyone with the link can open shareUrl, but its private source Sheets (unit) require signing in with access."
      : "Only signed-in people with access can open shareUrl. To let anyone with the link view it without signing in, ask the user before making the repository public.",
  });
  expect(writes).toEqual([Buffer.from(replacement.source.bytes).toString()]);
});

it("validates replacement bindings and destination kind before any write", async () => {
  const { feature, writes } = revisionFeature();
  await expect(feature.replace({ ...replacement, source: { ...replacement.source, bytes: Buffer.from('<div data-univer-cell-text="unit:missing:B2"></div>') } })).rejects.toMatchObject({ code: "workspace-html-view-source-invalid" });
  expect(writes).toEqual([]);
  const nonPage = revisionFeature({ name: "plain.txt" });
  await expect(nonPage.feature.replace(replacement)).rejects.toMatchObject({ code: "workspace-resource-kind-mismatch" });
  expect(nonPage.writes).toEqual([]);
});

it("preserves a stale ETag failure for the caller to reconcile", async () => {
  await expect(revisionFeature({ conflict: true }).feature.replace(replacement)).rejects.toMatchObject({ code: "PRECONDITION_FAILED", detail: { status: 412 } });
});

it.each([
  { kind: "create", count: 1 }, { kind: "create", count: 61 },
  { kind: "replace", count: 1 }, { kind: "replace", count: 61 },
] as const)("saves a $kind draft with $count binding samples while keeping Blob writes unused", async ({ kind, count }) => {
  const http = sharingHttp(true, ["unit"]);
  const original = http.json.bind(http);
  const requests: unknown[] = [];
  const onWrite = vi.fn();
  const json = vi.spyOn(http, "json").mockImplementation(async (path, options) => {
    if (path === "/api/resources/resource") return { node: {
      id: "node", spaceId: "space", parentNodeId: null, name: "Page.univer.html", hasChildren: false, updatedAt: "now", accessRole: "owner",
      capabilities: { browseChildren: false, createChildren: false, rename: true, move: true, trash: true, share: true },
      resource: { id: "resource", kind: "blob", availability: "ready", byteSize: 10, mediaType: "text/html",
        capabilities: { downloadContent: true, editContent: true, openContent: true } },
    }, resource: { id: "resource", kind: "blob", availability: "ready", byteSize: 10, mediaType: "text/html",
      capabilities: { downloadContent: true, editContent: true, openContent: true } } };
    if (path === "/api/html-view-drafts") {
      expect(onWrite).toHaveBeenCalledOnce();
      requests.push(options);
      return { draft: { id: "draft/1", kind, state: "pending", spaceId: "space", name: "Page.univer.html",
        targetResourceId: kind === "replace" ? "resource" : null, published: null, expiresAt: "later" } };
    }
    expect(onWrite).not.toHaveBeenCalled();
    return original(path, options);
  });
  const uploadBytes = vi.fn();
  const feature = new WorkspaceHtmlViewFeature({
    authenticatedHttp: async () => http, blobs: { uploadBytes }, configuredOrigin: async () => http.origin, onWrite,
    resolveTrunkRuntimeTarget: async ({ unitId }) => ({ origin: http.origin, unitId, unitType: "sheet", revision: 1, scope: { kind: "trunk" } }),
    runtime: { exportUnitData: async () => ({ id: "unit", name: "Budget", appVersion: "1", locale: LocaleType.EN_US,
      styles: {}, sheetOrder: ["budget"], sheets: { budget: { rowCount: 10, columnCount: 3 } } }) },
  });
  const intent = kind === "create" ? { kind, name: "Page", spaceId: "space", parentNodeId: "folder" }
    : { kind, resourceId: "resource", etag: '"v1"' };
  const source = { ...replacement.source, bytes: Buffer.from(Buffer.from(replacement.source.bytes).toString().repeat(count)) };
  const validation = await feature.validate(source);
  const result = await feature.draft({ ...intent, source, idempotencyKey: replacement.idempotencyKey });
  expect(result.bindings).toEqual(validation.bindings);
  expect(result.bindingCount).toBe(count);
  expect(result.bindings).toHaveLength(Math.min(count, 60));
  if (count > 60) expect(result.truncated).toBe(true);
  else expect(result).not.toHaveProperty("truncated");
  expect(result).toMatchObject({ id: "draft/1", kind, status: { state: "pending" },
    previewUrl: "https://workspace.test/drafts/draft%2F1", repositoryVisibility: "public", privateSourceUnitIds: ["unit"] });
  expect(requests).toEqual([{ method: "POST", idempotencyKey: replacement.idempotencyKey, body: {
    ...intent, ...(kind === "create" ? { name: "Page.univer.html" } : {}), html: source.bytes.toString(),
  } }]);
  expect(uploadBytes).not.toHaveBeenCalled();
  expect(json.mock.calls.some(([path]) => /blob-upload-sessions|blob-resources.*content/.test(path))).toBe(false);
});

function samplingFeature(workbook: IWorkbookData) {
  const exportUnitData = vi.fn<WorkspaceHtmlViewOptions["runtime"]["exportUnitData"]>(async ({ target }) => ({ ...workbook, id: target.unitId }));
  const feature = new WorkspaceHtmlViewFeature({
    authenticatedHttp: vi.fn(), blobs: { uploadBytes: vi.fn() }, configuredOrigin: vi.fn(),
    resolveTrunkRuntimeTarget: async ({ unitId }) => ({
      origin: "https://workspace.test", scope: { kind: "trunk" }, unitId, unitType: "sheet", revision: 1,
    }),
    runtime: { exportUnitData },
  });
  return { feature, exportUnitData };
}

const sampleWorkbook: IWorkbookData = {
  id: "unit", name: "Budget", appVersion: "1", locale: LocaleType.EN_US,
  styles: { date: { n: { pattern: "yyyy-mm" } }, general: { n: { pattern: "General" } } },
  sheetOrder: ["budget"],
  sheets: { budget: {
    name: "Budget", rowCount: 100, columnCount: 30,
    cellData: {
      6: { 1: { v: 46357, s: "date" }, 2: { v: 42, f: "=SUM(A1:A6)", s: "general" } },
      7: { 0: { v: "Header" }, 1: { v: "x".repeat(81) }, 8: { v: "ninth column" } },
      8: { 1: { v: 0, s: { n: { pattern: "0.00" } } }, 2: { v: false } },
      9: { 0: { v: "" }, 1: { s: "date" } },
      10: { 8: { v: "outside head" } },
      11: { 9: { v: "outside range" } },
      12: { 0: { v: null } },
      13: { 0: { si: "shared", v: 7 } },
    },
  }, unnamed: { rowCount: 100, columnCount: 30 } },
};

it("samples cells, formulas, empty values and ranges in document order from each existing export", async () => {
  const { feature, exportUnitData } = samplingFeature(sampleWorkbook);
  const result = await feature.validate({ name: "view.univer.html", bytes: Buffer.from(`
    <output data-univer-cell-text="unit:budget:B7"></output>
    <input data-univer-cell-model="other:budget:C7">
    <div data-univer-cell-subscribe="unit:unnamed:AA2"></div>
    <div data-univer-range-subscribe="other:budget:A8:I14"></div>
  `) });
  expect(result).toEqual({
    valid: true, unitIds: ["unit", "other"], bindingCount: 4,
    bindings: [
      { kind: "text", unitId: "unit", sheet: "Budget", ref: "B7", cell: { value: 46357, format: "yyyy-mm" } },
      { kind: "model", unitId: "other", sheet: "Budget", ref: "C7", cell: { value: 42, formula: true } },
      { kind: "cell", unitId: "unit", sheet: "unnamed", ref: "AA2", cell: { value: null } },
      { kind: "range", unitId: "other", sheet: "Budget", ref: "A8:I14", range: {
        rows: 7, columns: 9, filledRows: 4,
        head: [
          [{ value: "Header" }, { value: "x".repeat(80) + "…" }, ...Array.from({ length: 6 }, () => ({ value: null }))],
          [{ value: null }, { value: 0, format: "0.00" }, { value: false }, ...Array.from({ length: 5 }, () => ({ value: null }))],
          [{ value: null }, { value: null, format: "yyyy-mm" }, ...Array.from({ length: 6 }, () => ({ value: null }))],
        ],
      } },
    ],
  });
  expect(exportUnitData).toHaveBeenCalledTimes(2);
});

it("keeps short strings, omits empty formats, and marks shared formulas", async () => {
  const { feature } = samplingFeature({ ...sampleWorkbook, sheets: { budget: {
    rowCount: 100, columnCount: 30,
    cellData: { 0: {
      0: { v: "x".repeat(80), s: { n: { pattern: "" } } },
      1: { v: null, si: "shared" },
      2: { p: { id: "rich", documentStyle: {}, body: { dataStream: "Rich text\r\n" } } },
      3: { v: "😀".repeat(80) },
      4: { v: "😀".repeat(81) },
    } },
  } } });
  const result = await feature.validate({ name: "view.univer.html", bytes: Buffer.from(
    '<div data-univer-range-subscribe="unit:budget:A1:E1"></div>',
  ) });
  expect(result.bindings).toEqual([
    { kind: "range", unitId: "unit", sheet: "budget", ref: "A1:E1", range: {
      rows: 1, columns: 5, filledRows: 1,
      head: [[{ value: "x".repeat(80) }, { value: null, formula: true }, { value: "Rich text" }, { value: "😀".repeat(80) }, { value: "😀".repeat(80) + "…" }]],
    } },
  ]);
});

it.each([0, 60, 61])("caps samples at 60 without losing the binding count (%s)", async (count) => {
  const { feature } = samplingFeature(sampleWorkbook);
  const result = await feature.validate({ name: "view.univer.html", bytes: Buffer.from(
    Array.from({ length: count }, (_, row) => `<output data-univer-cell-text="unit:budget:A${row + 1}"></output>`).join(""),
  ) });
  expect(result.bindingCount).toBe(count);
  expect(result.bindings).toHaveLength(Math.min(count, 60));
  if (count > 60) expect(result).toHaveProperty("truncated", true);
  else expect(result).not.toHaveProperty("truncated");
  if (count) expect(result.bindings.at(-1)?.ref).toBe(`A${Math.min(count, 60)}`);
});

it("still validates bindings beyond the sample cap", async () => {
  const { feature } = samplingFeature(sampleWorkbook);
  await expect(feature.validate({ name: "view.univer.html", bytes: Buffer.from(
    '<output data-univer-cell-text="unit:budget:A1"></output>'.repeat(60) +
    '<output data-univer-cell-text="unit:missing:A1"></output>',
  ) })).rejects.toMatchObject({ code: "workspace-html-view-source-invalid" });
});

it.each((["draft", "ready", "merged", "discarded"] as const).flatMap((state) => (["create", "revise"] as const).map((kind) => ({ state, kind }))))("resolves HTML sources for a $state pull request ($kind)", async ({ state, kind }) => {
  const http = sharingHttp(true);
  const original = http.json.bind(http);
  const posts: unknown[] = [];
  const mapped = { unitId: "unit", resourceId: "resource", nodeId: "node", name: "New Sheet",
    unitType: "sheet", source: "worktree", target: { spaceId: "private", parentNodeId: null },
    draftHeadRevision: 7, change: "added", mergeResult: "pending", activationState: "waitingForMerge" };
  const json = vi.spyOn(http, "json").mockImplementation(async (path, options) => {
    if (path === "/api/worktrees/wt-1") return { worktree: { id: "wt-1", name: "Sources", state, units: [mapped] } };
    if (path === "/api/html-view-drafts/old") return { draft: { id: "old", kind: "create", state: "pending", spaceId: "space", name: "Page.univer.html",
      targetResourceId: null, sourceWorktreeId: "wt-1", published: null, expiresAt: "later" } };
    if (path === "/api/html-view-drafts") {
      posts.push(options?.body);
      return { draft: { id: "draft", kind: "create", state: "pending", spaceId: "space", name: "Page.univer.html",
        targetResourceId: null, sourceWorktreeId: state === "merged" && kind === "create" ? null : "wt-1",
        publishWhen: state === "merged" ? "publish" : "merge", published: null, expiresAt: "later" } };
    }
    if (path.includes("/snapshot/")) return { snapshot: { unitID: "other", type: 2, rev: 3,
      workbook: { originalMeta: "", sheets: {} } }, changesets: [] };
    return original(path, options);
  });
  const trunk = vi.fn<WorkspaceHtmlViewOptions["resolveTrunkRuntimeTarget"]>(async ({ unitId }) => ({
    origin: http.origin, unitId, unitType: "sheet", revision: 3, scope: { kind: "trunk" },
  }));
  const exportUnitData = vi.fn<WorkspaceHtmlViewOptions["runtime"]["exportUnitData"]>(async ({ target }) => ({
    id: target.unitId, name: "Budget", appVersion: "1", locale: LocaleType.EN_US, styles: {}, sheetOrder: ["budget"],
    sheets: { budget: { rowCount: 10, columnCount: 3, cellData: { 1: { 1: { v: target.scope.kind === "worktree" ? 42 : 5 } } } } },
  }));
  const feature = new WorkspaceHtmlViewFeature({ authenticatedHttp: async () => http, blobs: { uploadBytes: vi.fn() },
    configuredOrigin: async () => http.origin, resolveTrunkRuntimeTarget: trunk, runtime: { exportUnitData } });
  const source = { name: "page.univer.html", bytes: Buffer.from(
    '<output data-univer-cell-text="unit:budget:B2"></output><output data-univer-cell-text="other:budget:B2"></output>'),
    sourceWorktreeId: "wt-1" };
  const draft = kind === "revise" ? { kind, draftId: "old", source, idempotencyKey: "key" }
    : { kind, source, sourceWorktreeId: "wt-1", name: "Page", spaceId: "space", idempotencyKey: "key" };
  if (state === "discarded") {
    await expect(feature.validate(source)).rejects.toMatchObject({ code: "workspace-worktree-discarded" });
    await expect(feature.draft(draft)).rejects.toMatchObject({ code: "workspace-worktree-discarded" });
    expect(exportUnitData).not.toHaveBeenCalled();
    expect(posts).toEqual([]);
    return;
  }
  const validation = await feature.validate(source);
  expect(validation.bindings).toMatchObject([
    { unitId: "unit", cell: { value: state === "merged" ? 5 : 42 } },
    { unitId: "other", cell: { value: 5 } },
  ]);
  expect(exportUnitData.mock.calls.map(([{ target }]) => target.scope)).toEqual([
    state === "merged" ? { kind: "trunk" } : { kind: "worktree", worktreeId: "wt-1" }, { kind: "trunk" },
  ]);
  const result = await feature.draft(draft);
  expect(result.sourceWorktreeId).toBe(state === "merged" && kind === "create" ? null : "wt-1");
  expect(result.publishWhen).toBe(state === "merged" ? "publish" : "merge");
  expect(posts).toEqual([{ ...(kind === "revise" ? { kind, draftId: "old" } : { kind, name: "Page.univer.html", spaceId: "space" }), html: source.bytes.toString(),
    ...(state === "merged" && kind === "create" ? {} : { sourceWorktreeId: "wt-1" }) }]);
  expect(result.privateSourceUnitIds).toEqual(state === "merged" ? [] : ["unit"]);
  if (state !== "merged") expect(json.mock.calls.some(([path]) => path === "/api/unit-resources/unit")).toBe(false);
});

it("describes HTML View access across caller, visibility, private source, and space type combinations", () => {
  const unclaimed = { id: "a1", name: "agent", kind: "agent", claimed: false } as const;
  const claimed = { id: "a1", name: "agent", kind: "agent", claimed: true } as const;
  const person = { id: "u1", name: "alice" };

  expect(describeHtmlViewAccess({
    caller: unclaimed,
    handoffUrl: "https://workspace.test/claim/abc?to=%2Fnodes%2Fn1%3Fview%3Dimmersive",
    repositoryVisibility: "private",
    spaceType: "personal",
  })).toBe(
    "Only this temporary agent can open shareUrl directly. Give the user handoffUrl instead so they can open the page live without signing in and claim this agent.",
  );
  expect(describeHtmlViewAccess({ caller: unclaimed, repositoryVisibility: "public" })).toBe(
    "Only this temporary agent can open shareUrl directly. Do not give shareUrl to the user alone; run claim (uvw claim in the CLI) with this node to get a handoff link so they can open the page live without signing in.",
  );
  for (const caller of [undefined, person, claimed]) {
    expect(describeHtmlViewAccess({ caller, repositoryVisibility: "public", privateSourceUnitIds: [] })).toBe(
      "Anyone with the link can open shareUrl and view its live data without signing in (read-only for visitors).",
    );
    expect(describeHtmlViewAccess({ caller, repositoryVisibility: "public", privateSourceUnitIds: ["u1", "u2"] })).toBe(
      "Anyone with the link can open shareUrl, but its private source Sheets (u1, u2) require signing in with access.",
    );
    expect(describeHtmlViewAccess({ caller, repositoryVisibility: "private", spaceType: "personal" })).toBe(
      "Only signed-in people with access can open shareUrl. To let anyone with the link view it without signing in, ask the user before turning on Link Sharing.",
    );
    expect(describeHtmlViewAccess({ caller, repositoryVisibility: "private", spaceType: "team" })).toBe(
      "Only signed-in people with access can open shareUrl. To let anyone with the link view it without signing in, ask the user before making the repository public.",
    );
    expect(describeHtmlViewAccess({ caller })).toBe(
      "Only signed-in people with access can open shareUrl unless the repository is public or Link Sharing is enabled.",
    );
  }
});

it.each([
  { publicRead: true, spaceType: "team" as const, privateUnits: [] as string[], expectedAccess: "Anyone with the link can open shareUrl and view its live data without signing in (read-only for visitors)." },
  { publicRead: true, spaceType: "team" as const, privateUnits: ["unit"], expectedAccess: "Anyone with the link can open shareUrl, but its private source Sheets (unit) require signing in with access." },
  { publicRead: false, spaceType: "personal" as const, privateUnits: [] as string[], expectedAccess: "Only signed-in people with access can open shareUrl. To let anyone with the link view it without signing in, ask the user before turning on Link Sharing." },
  { publicRead: false, spaceType: "team" as const, privateUnits: [] as string[], expectedAccess: "Only signed-in people with access can open shareUrl. To let anyone with the link view it without signing in, ask the user before making the repository public." },
])("returns access guidance for $spaceType repository (public $publicRead, private $privateUnits)", async ({ publicRead, spaceType, privateUnits, expectedAccess }) => {
  const http = new WorkspaceHttp({
    origin: "https://workspace.test",
    role: "client",
    cookie: "workspace_session=test",
    fetcher: async (url) => {
      const path = new URL(String(url)).pathname;
      if (path.startsWith("/api/spaces/")) {
        const id = path.split("/").at(-1);
        return Response.json({ id, name: "Space", type: spaceType, publicRead: id === "private" ? false : publicRead });
      }
      if (path.startsWith("/api/unit-resources/")) {
        const unitId = decodeURIComponent(path.split("/").at(-1) ?? "");
        return Response.json({ node: {
          id: "source-node", spaceId: privateUnits.includes(unitId) ? "private" : "space",
          parentNodeId: null, name: "Sheet", hasChildren: false, updatedAt: "now", accessRole: "owner",
          capabilities: { browseChildren: false, createChildren: false, rename: true, move: true, trash: true, share: true },
          resource: { id: "sheet-resource", kind: "univer", unitId, unitType: "sheet",
            capabilities: { downloadContent: true, editContent: true, openContent: true } },
        } });
      }
      throw new Error(`Unexpected path: ${path}`);
    },
  });
  const json = vi.spyOn(http, "json");
  const feature = new WorkspaceHtmlViewFeature({
    authenticatedHttp: async () => http,
    configuredOrigin: async () => http.origin,
    blobs: { uploadBytes: async () => ({ nodeId: "node" }) },
    resolveTrunkRuntimeTarget: async ({ unitId }) => ({
      origin: http.origin, scope: { kind: "trunk" }, unitId, unitType: "sheet", revision: 1,
    }),
    runtime: { exportUnitData: async () => ({
      id: "unit", name: "Budget", appVersion: "1", locale: LocaleType.EN_US,
      styles: {}, sheetOrder: ["budget"], sheets: { budget: { rowCount: 10, columnCount: 3 } },
    }) },
  });
  const created = await feature.create({
    source: { bytes: Buffer.from('<output data-univer-cell-text="unit:budget:B2"></output>'), name: "view.univer.html" },
    name: "View",
    spaceId: "space",
    idempotencyKey: "key",
  });
  expect(created.access).toBe(expectedAccess);
  expect(created).not.toHaveProperty("handoffUrl");
  expect(created).not.toHaveProperty("handoffExpiresAt");
  expect(json.mock.calls.some(([path]) => path === "/api/session" || path === "/api/agents/claim-codes")).toBe(false);
});

it("adds handoffUrl and unclaimed-agent guidance on create and replace, and guidance only on draft", async () => {
  const base = revisionFeature({ publicRead: false });
  const requests: string[] = [];
  const unclaimed = { id: "a1", name: "agent-1", kind: "agent", claimed: false } as const;
  const claimed = { id: "a1", name: "agent-1", kind: "agent", claimed: true } as const;
  const sharing = sharingHttp(false, ["unit"]);
  const http = new WorkspaceHttp({
    origin: "https://workspace.test",
    role: "client",
    cookie: "workspace_session=test",
    fetcher: async (url, init) => {
      const request = new Request(url, init);
      const path = new URL(request.url).pathname;
      requests.push(`${request.method} ${path}`);
      if (path === "/api/agents/claim-codes" && request.method === "POST") {
        return Response.json({ claimUrl: "/claim/code-123", expiresIn: 600 });
      }
      if (path === "/api/resources/resource") {
        return Response.json({
          node: {
            id: "node/1", spaceId: "space", parentNodeId: null, name: "Page.univer.html",
            hasChildren: false, updatedAt: "now", accessRole: "owner",
            capabilities: { browseChildren: false, createChildren: false, rename: true, move: true, trash: true, share: true },
            resource: { id: "resource", kind: "blob", availability: "ready", byteSize: 10, mediaType: "text/html",
              capabilities: { downloadContent: true, editContent: true, openContent: true } },
          },
          resource: { id: "resource", kind: "blob", availability: "ready", byteSize: 10, mediaType: "text/html",
            capabilities: { downloadContent: true, editContent: true, openContent: true } },
        });
      }
      if (path === "/api/html-view-drafts") {
        return Response.json({ draft: { id: "draft-1", kind: "create", state: "pending", spaceId: "space",
          name: "Page.univer.html", targetResourceId: null, published: null, expiresAt: "later" } });
      }
      return Response.json(await sharing.json(path));
    },
  });
  const blobs = new WorkspaceBlobFeature(async () => http);
  let caller: typeof unclaimed | typeof claimed = unclaimed;
  const feature = new WorkspaceHtmlViewFeature({
    authenticatedHttp: async () => http,
    configuredOrigin: async () => http.origin,
    caller: async () => caller,
    blobs: {
      uploadBytes: async () => ({ nodeId: "node/1" }),
      get: (id) => blobs.get(id),
      replaceBytes: async () => ({ resourceId: "resource", operationId: "op-1", etag: '"v2"' }),
    },
    resolveTrunkRuntimeTarget: async ({ unitId }) => ({
      origin: http.origin, scope: { kind: "trunk" }, unitId, unitType: "sheet", revision: 1,
    }),
    runtime: { exportUnitData: async () => ({
      id: "unit", name: "Budget", appVersion: "1", locale: LocaleType.EN_US,
      styles: {}, sheetOrder: ["budget"], sheets: { budget: { rowCount: 10, columnCount: 3 } },
    }) },
  });

  const created = await feature.create({
    source: replacement.source, name: "Page", spaceId: "space", idempotencyKey: "k1",
  });
  expect(created.handoffUrl).toBe("https://workspace.test/claim/code-123?to=%2Fnodes%2Fnode%252F1%3Fview%3Dimmersive");
  expect(typeof created.handoffExpiresAt).toBe("string");
  expect(created.access).toBe(
    "Only this temporary agent can open shareUrl directly. Give the user handoffUrl instead so they can open the page live without signing in and claim this agent.",
  );

  const replaced = await feature.replace(replacement);
  expect(replaced.handoffUrl).toBe("https://workspace.test/claim/code-123?to=%2Fnodes%2Fnode%252F1%3Fview%3Dimmersive");
  expect(typeof replaced.handoffExpiresAt).toBe("string");
  expect(replaced.access).toBe(
    "Only this temporary agent can open shareUrl directly. Give the user handoffUrl instead so they can open the page live without signing in and claim this agent.",
  );

  const drafted = await feature.draft({
    kind: "create", source: replacement.source, name: "Page", spaceId: "space", idempotencyKey: "k2",
  });
  expect(drafted).not.toHaveProperty("handoffUrl");
  expect(drafted).not.toHaveProperty("handoffExpiresAt");
  expect(drafted.access).toBe(
    "Only this temporary agent can open shareUrl directly. Do not give shareUrl to the user alone; run claim (uvw claim in the CLI) with this node to get a handoff link so they can open the page live without signing in.",
  );
  expect(requests.filter((entry) => entry === "POST /api/agents/claim-codes")).toHaveLength(2);

  caller = claimed;
  const claimedCreated = await feature.create({
    source: replacement.source, name: "Page", spaceId: "space", idempotencyKey: "k3",
  });
  expect(claimedCreated).not.toHaveProperty("handoffUrl");
  expect(claimedCreated.access).toBe(
    "Only signed-in people with access can open shareUrl. To let anyone with the link view it without signing in, ask the user before making the repository public.",
  );
  expect(requests.filter((entry) => entry === "POST /api/agents/claim-codes")).toHaveLength(2);
  expect(base.writes).toEqual([]);
});
