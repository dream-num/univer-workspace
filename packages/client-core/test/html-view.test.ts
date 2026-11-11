import { LocaleType } from "@univerjs/core";
import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
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
