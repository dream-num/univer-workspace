import { LocaleType } from "@univerjs/core";
import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { WorkspaceBlobFeature } from "../src/blob.js";
import { WorkspaceHttp } from "../src/http.js";
import { WorkspaceHtmlViewFeature, type WorkspaceHtmlViewOptions } from "../src/html-view.js";

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

it.each(["create", "replace"] as const)("saves a %s draft after validation while keeping Blob writes unused", async (kind) => {
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
  const result = await feature.draft({ ...intent, source: replacement.source, idempotencyKey: replacement.idempotencyKey });
  expect(result).toMatchObject({ id: "draft/1", kind, status: { state: "pending" },
    previewUrl: "https://workspace.test/drafts/draft%2F1", repositoryVisibility: "public", privateSourceUnitIds: ["unit"] });
  expect(requests).toEqual([{ method: "POST", idempotencyKey: replacement.idempotencyKey, body: {
    ...intent, ...(kind === "create" ? { name: "Page.univer.html" } : {}), html: Buffer.from(replacement.source.bytes).toString(),
  } }]);
  expect(uploadBytes).not.toHaveBeenCalled();
  expect(json.mock.calls.some(([path]) => /blob-upload-sessions|blob-resources.*content/.test(path))).toBe(false);
});
