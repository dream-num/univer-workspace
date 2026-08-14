import { writeFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceAuth } from "../src/features/auth/session.js";
import { WorkspaceAssetFeature } from "../src/features/asset/download.js";
import { WorkspaceBlobFeature } from "../src/features/blob/transfer.js";
import { WorkspaceOpenFeature } from "../src/features/open/open.js";
import { parseDetachedNode } from "../src/features/space/model.js";
import { WorkspaceSpaceFeature } from "../src/features/space/space.js";
import { WorkspaceUnitFeature } from "../src/features/unit/membership.js";
import { WorkspaceWorktreeFeature } from "../src/features/worktree/management.js";
import type { WorkspaceWorktree } from "../src/features/worktree/model.js";
import { parseUnit } from "../src/features/worktree/model.js";
import { WorkspaceHttp } from "../src/transport/http.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (path) => await rm(path, { force: true, recursive: true })),
  );
});

describe("Workspace application feature parity", () => {
  it("rejects broadened capability records and legacy Unit identities", () => {
    const withExtraCapability = node({ resource: blobResource() });
    const capabilities = withExtraCapability["capabilities"] as Record<string, unknown>;
    capabilities["deleteForever"] = true;
    expect(() => parseDetachedNode(withExtraCapability)).toThrowError(
      expect.objectContaining({ code: "workspace-invalid-response" }),
    );

    const legacy = unit("wt-1") as unknown as Record<string, unknown>;
    legacy["unitType"] = "sheet";
    legacy["fileId"] = "legacy-file-id";
    expect(() => parseUnit(legacy, "wt-1")).toThrowError(
      expect.objectContaining({ code: "workspace-invalid-response" }),
    );
  });

  it("retries Worktree creation with one stable public identity", async () => {
    const keys: string[] = [];
    let attempts = 0;
    const feature = new WorkspaceWorktreeFeature(
      authFor(async (_input, init) => {
        attempts += 1;
        keys.push(new Headers(init?.headers).get("idempotency-key") ?? "");
        if (attempts < 3) throw new Error("connection reset");
        return jsonResponse(worktree("wt-created"));
      }),
    );

    await expect(
      feature.create({ idempotencyKey: "stable-key", name: "Draft", scope: { kind: "user" } }),
    ).resolves.toMatchObject({ id: "wt-created", name: "Draft", state: "draft" });
    expect(keys).toEqual(["stable-key", "stable-key", "stable-key"]);
  });

  it("lists, gets, and updates Worktrees through the production response shapes", async () => {
    const requests: string[] = [];
    const feature = new WorkspaceWorktreeFeature(
      authFor(async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        requests.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
        if (url.pathname === "/api/worktrees" && init?.method === "GET") {
          return jsonResponse({ items: [worktree("wt-1")] });
        }
        if (init?.method === "PATCH") {
          return jsonResponse({ worktree: { ...worktree("wt-1"), name: "Renamed" } });
        }
        return jsonResponse({ worktree: worktree("wt-1") });
      }),
    );

    await expect(
      feature.list({ scope: "space", spaceId: "space-1", view: "processed" }),
    ).resolves.toHaveLength(1);
    await expect(feature.get("wt-1")).resolves.toMatchObject({ id: "wt-1" });
    await expect(feature.update("wt-1", { name: "Renamed" })).resolves.toMatchObject({
      name: "Renamed",
    });
    expect(requests).toEqual([
      "GET /api/worktrees?scope=processed&kind=team&teamSpaceId=space-1",
      "GET /api/worktrees/wt-1",
      "PATCH /api/worktrees/wt-1",
    ]);
  });

  it.each([
    ["ready", "draft", "ready"],
    ["reopen", "ready", "draft"],
    ["merge", "ready", "merged"],
    ["discard", "draft", "discarded"],
  ] as const)(
    "executes Worktree %s with its exact state contract",
    async (action, initial, expected) => {
      let getCount = 0;
      const feature = new WorkspaceWorktreeFeature(
        authFor(async (_input, init) => {
          if (init?.method === "POST") {
            return jsonResponse({ worktree: worktree("wt-1", expected) });
          }
          getCount += 1;
          return jsonResponse({ worktree: worktree("wt-1", initial) });
        }),
      );
      await expect(feature.transition("wt-1", action)).resolves.toMatchObject({ state: expected });
      expect(getCount).toBe(1);
    },
  );

  it("confirms an unknown Worktree lifecycle result by reading current state", async () => {
    let gets = 0;
    const feature = new WorkspaceWorktreeFeature(
      authFor(async (_input, init) => {
        if (init?.method === "POST") throw new Error("response interrupted");
        gets += 1;
        return jsonResponse({ worktree: worktree("wt-1", gets === 1 ? "ready" : "merged") });
      }),
    );

    await expect(feature.transition("wt-1", "merge")).resolves.toMatchObject({
      id: "wt-1",
      state: "merged",
    });
    expect(gets).toBe(2);
  });

  it("keeps Unit creation identity stable and validates the created target", async () => {
    const keys: string[] = [];
    const requestBodies: unknown[] = [];
    let attempts = 0;
    const feature = new WorkspaceUnitFeature(
      authFor(async (_input, init) => {
        attempts += 1;
        keys.push(new Headers(init?.headers).get("idempotency-key") ?? "");
        requestBodies.push(JSON.parse(String(init?.body)) as unknown);
        if (attempts === 1) throw new Error("socket closed");
        const created = unit("wt-1", {
          name: "Planning",
          source: "worktree",
          target: { parentNodeId: "folder-1", spaceId: "space-1" },
        });
        return jsonResponse({
          unit: { ...created, unitType: created.type },
        });
      }),
    );

    await expect(
      feature.create({
        idempotencyKey: "unit-key",
        initialData: { id: "unit-1", sheets: {} },
        name: "Planning",
        parentNodeId: "folder-1",
        spaceId: "space-1",
        type: "sheet",
        worktreeId: "wt-1",
      }),
    ).resolves.toMatchObject({ source: "worktree", worktreeId: "wt-1" });
    expect(keys).toEqual(["unit-key", "unit-key"]);
    expect(requestBodies).toEqual([
      expect.objectContaining({ initialData: { id: "unit-1", sheets: {} } }),
      expect.objectContaining({ initialData: { id: "unit-1", sheets: {} } }),
    ]);
  });

  it("lists Units and retries add with the same stable Resource identity", async () => {
    const keys: string[] = [];
    let addAttempts = 0;
    const feature = new WorkspaceUnitFeature(
      authFor(async (_input, init) => {
        if (init?.method === "POST") {
          addAttempts += 1;
          keys.push(new Headers(init.headers).get("idempotency-key") ?? "");
          if (addAttempts === 1) throw new Error("unknown add result");
          const added = unit("wt-1");
          return jsonResponse({ unit: { ...added, unitType: added.type } });
        }
        const listed = unit("wt-1");
        return jsonResponse({
          worktree: { ...worktree("wt-1"), units: [{ ...listed, unitType: listed.type }] },
        });
      }),
    );

    await expect(feature.list("wt-1")).resolves.toHaveLength(1);
    await expect(feature.add("wt-1", "resource-1")).resolves.toMatchObject({
      resourceId: "resource-1",
      source: "trunk",
      target: null,
      worktreeId: "wt-1",
    });
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("lists, browses, and finds Space Nodes with stable pagination metadata", async () => {
    const feature = new WorkspaceSpaceFeature(
      authFor(async (input) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        if (url.pathname === "/api/spaces") {
          return jsonResponse({ spaces: [{ id: "space-1", name: "Personal", type: "personal" }] });
        }
        return jsonResponse(
          nodePage({
            nodes: [
              node({ id: "node-1", name: "Quarterly Plan" }),
              node({ id: "node-2", name: "Archive", resource: blobResource() }),
            ],
          }),
        );
      }),
    );

    await expect(feature.list()).resolves.toEqual([
      { id: "space-1", name: "Personal", type: "personal" },
    ]);
    await expect(
      feature.browse({ resourceKind: "blob", spaceId: "space-1" }),
    ).resolves.toHaveLength(1);
    await expect(
      feature.find({ query: "quarterly plan", spaceId: "space-1" }),
    ).resolves.toMatchObject([{ name: "Quarterly Plan", nodeId: "node-1" }]);
  });

  it("rejects a repeated Space pagination cursor", async () => {
    const feature = new WorkspaceSpaceFeature(
      authFor(async () => jsonResponse(nodePage({ nextCursor: "repeat", nodes: [] }))),
    );
    await expect(feature.browse({ spaceId: "space-1" })).rejects.toMatchObject({
      code: "workspace-invalid-response",
    });
  });

  it("rejects cyclic Space traversal and reports uncertain Node creation", async () => {
    const cyclic = new WorkspaceSpaceFeature(
      authFor(async () =>
        jsonResponse(
          nodePage({
            nodes: [node({ hasChildren: true, id: "parent", parentNodeId: null })],
          }),
        ),
      ),
    );
    await expect(cyclic.browse({ recursive: true, spaceId: "space-1" })).rejects.toMatchObject({
      code: "workspace-invalid-response",
    });

    const uncertain = new WorkspaceSpaceFeature(
      authFor(async () => Promise.reject(new Error("lost"))),
    );
    await expect(
      uncertain.createNode({ name: "Folder", parentNodeId: "parent", spaceId: "space-1" }),
    ).rejects.toMatchObject({
      code: "workspace-result-unknown",
      detail: { name: "Folder", parentNodeId: "parent", spaceId: "space-1" },
    });
  });

  it("renames and moves organizational and Resource Nodes with exact PATCH intents", async () => {
    const requests: Array<{ readonly body: unknown; readonly path: string }> = [];
    const feature = new WorkspaceSpaceFeature(
      authFor(async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        const body = JSON.parse(String(init?.body)) as {
          readonly name?: string;
          readonly parentNodeId?: string | null;
        };
        requests.push({ body, path: url.pathname });
        return jsonResponse(
          node({
            id: "resource-node",
            name: body.name ?? "Report",
            parentNodeId: Object.hasOwn(body, "parentNodeId")
              ? (body.parentNodeId ?? null)
              : "old-parent",
            resource: blobResource(),
          }),
        );
      }),
    );

    await expect(
      feature.renameNode({ name: "  Quarterly Report  ", nodeId: "resource-node" }),
    ).resolves.toMatchObject({ name: "Quarterly Report", nodeId: "resource-node" });
    await expect(
      feature.moveNode({ nodeId: "resource-node", parentNodeId: "archive" }),
    ).resolves.toMatchObject({ nodeId: "resource-node", parentNodeId: "archive" });
    await expect(
      feature.moveNode({ nodeId: "resource-node", parentNodeId: null }),
    ).resolves.toMatchObject({ nodeId: "resource-node", parentNodeId: null });

    expect(requests).toEqual([
      { body: { name: "Quarterly Report" }, path: "/api/nodes/resource-node" },
      { body: { parentNodeId: "archive" }, path: "/api/nodes/resource-node" },
      { body: { parentNodeId: null }, path: "/api/nodes/resource-node" },
    ]);
  });

  it("confirms an unknown Node update by reading current metadata", async () => {
    let patchCount = 0;
    let getCount = 0;
    const feature = new WorkspaceSpaceFeature(
      authFor(async (_input, init) => {
        if (init?.method === "PATCH") {
          patchCount += 1;
          throw new Error("response interrupted");
        }
        getCount += 1;
        return jsonResponse(
          nodeResponse(node({ id: "node-1", name: "Moved", parentNodeId: "parent-2" }), [
            { id: "parent-2", name: "Destination" },
            { id: "node-1", name: "Moved" },
          ]),
        );
      }),
    );

    const moved = await feature.moveNode({ nodeId: "node-1", parentNodeId: "parent-2" });
    expect(moved).toMatchObject({ nodeId: "node-1", parentNodeId: "parent-2" });
    expect(moved).not.toHaveProperty("path");
    expect({ getCount, patchCount }).toEqual({ getCount: 1, patchCount: 1 });
  });

  it("rejects invalid rename input and mismatched update responses", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      jsonResponse(node({ id: "different-node", name: "Renamed" })),
    );
    const feature = new WorkspaceSpaceFeature(authFor(fetcher));

    await expect(feature.renameNode({ name: "   ", nodeId: "node-1" })).rejects.toMatchObject({
      code: "workspace-argument-invalid",
    });
    await expect(feature.renameNode({ name: "Renamed", nodeId: "node-1" })).rejects.toMatchObject({
      code: "workspace-result-mismatch",
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("returns a recursive Trash Batch and never retries an unknown trash result", async () => {
    let calls = 0;
    const feature = new WorkspaceSpaceFeature(
      authFor(async (input, init) => {
        calls += 1;
        const url = new URL(input instanceof Request ? input.url : input.toString());
        expect({ method: init?.method, path: url.pathname }).toEqual({
          method: "POST",
          path: "/api/nodes/node-1/trash",
        });
        return jsonResponse(trashBatch("node-1"), { status: 201 });
      }),
    );
    await expect(feature.trashNode("node-1")).resolves.toMatchObject({
      nodeCount: 3,
      root: { nodeId: "node-1" },
      trashBatchId: "trash-1",
    });
    expect(calls).toBe(1);

    let unknownCalls = 0;
    const uncertain = new WorkspaceSpaceFeature(
      authFor(async () => {
        unknownCalls += 1;
        throw new Error("connection reset");
      }),
    );
    await expect(uncertain.trashNode("node-1")).rejects.toMatchObject({
      code: "workspace-result-unknown",
      detail: { nodeId: "node-1" },
    });
    expect(unknownCalls).toBe(1);
  });

  it("recovers Blob PUT and completion without replaying a confirmed write", async () => {
    const directory = await temporaryDirectory();
    const sourcePath = join(directory, "payload.bin");
    await writeFile(sourcePath, "abc");
    let putCount = 0;
    let statusCount = 0;
    let completeCount = 0;
    const feature = new WorkspaceBlobFeature(
      authFor(async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        if (url.pathname === "/api/blob-upload-sessions" && init?.method === "POST") {
          return jsonResponse(uploadEnvelope("waitingForUpload", { uploadTarget: true }));
        }
        if (url.pathname.endsWith("/content") && init?.method === "PUT") {
          putCount += 1;
          throw new Error("upload response lost");
        }
        if (url.pathname.endsWith("/complete") && init?.method === "POST") {
          completeCount += 1;
          throw new Error("completion response lost");
        }
        if (url.pathname === "/api/blob-upload-sessions/upload-1") {
          statusCount += 1;
          return jsonResponse(uploadEnvelope(statusCount === 1 ? "uploaded" : "completed"));
        }
        if (url.pathname === "/api/resources/resource-1") {
          const owningNode = node({
            id: "node-1",
            name: "payload.bin",
            resource: blobResource(),
          });
          return jsonResponse({ node: owningNode, resource: owningNode.resource });
        }
        throw new Error(`unexpected request ${init?.method ?? "GET"} ${url.pathname}`);
      }),
    );

    await expect(
      feature.upload({ filePath: sourcePath, idempotencyKey: "blob-key", spaceId: "space-1" }),
    ).resolves.toMatchObject({
      idempotencyKey: "blob-key",
      nodeId: "node-1",
      operationId: "operation-1",
      resourceId: "resource-1",
      uploadId: "upload-1",
    });
    expect({ completeCount, putCount, statusCount }).toEqual({
      completeCount: 1,
      putCount: 1,
      statusCount: 2,
    });
  });

  it("rejects a published Blob that differs from its reserved intent", async () => {
    const directory = await temporaryDirectory();
    const sourcePath = join(directory, "payload.bin");
    await writeFile(sourcePath, "abc");
    const feature = new WorkspaceBlobFeature(
      authFor(async (input) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        if (url.pathname === "/api/blob-upload-sessions") {
          return jsonResponse(uploadEnvelope("completed"));
        }
        const wrongNode = node({ id: "node-1", name: "different.bin", resource: blobResource() });
        return jsonResponse({ node: wrongNode, resource: wrongNode.resource });
      }),
    );

    await expect(
      feature.upload({ filePath: sourcePath, spaceId: "space-1" }),
    ).rejects.toMatchObject({
      code: "workspace-result-mismatch",
    });
  });

  it("downloads Blob bytes only when HTTP metadata matches Resource metadata", async () => {
    const directory = await temporaryDirectory();
    const outputPath = join(directory, "blob.bin");
    const feature = new WorkspaceBlobFeature(
      authFor(async (input) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        if (url.pathname === "/api/resources/resource-1") {
          const owningNode = node({ id: "node-1", name: "payload.bin", resource: blobResource() });
          return jsonResponse({ node: owningNode, resource: owningNode.resource });
        }
        return new Response("abc", {
          headers: {
            "content-length": "3",
            "content-type": "application/octet-stream",
            etag: "v1",
          },
        });
      }),
    );

    await expect(feature.download({ outputPath, resourceId: "resource-1" })).resolves.toMatchObject(
      {
        byteSize: 3,
        etag: "v1",
        mediaType: "application/octet-stream",
        nodeId: "node-1",
        outputPath,
        resourceId: "resource-1",
      },
    );
    expect(await readFile(outputPath, "utf8")).toBe("abc");

    const missingMetadata = new WorkspaceBlobFeature(
      authFor(async (input) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        if (url.pathname.startsWith("/api/resources/")) {
          const owningNode = node({ resource: blobResource() });
          return jsonResponse({ node: owningNode, resource: owningNode.resource });
        }
        return new Response(new Uint8Array([97, 98, 99]));
      }),
    );
    await expect(
      missingMetadata.download({
        outputPath: join(directory, "invalid.bin"),
        resourceId: "resource-1",
      }),
    ).rejects.toMatchObject({ code: "workspace-invalid-response" });
  });

  it("validates Asset sign envelopes and downloads the exact signed response", async () => {
    const directory = await temporaryDirectory();
    const outputPath = join(directory, "asset.bin");
    let contentCookie: string | null = "not-called";
    const feature = new WorkspaceAssetFeature(
      authFor(async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        if (url.pathname.endsWith("/sign-url")) {
          return jsonResponse({ error: { code: 1, message: "" }, url: "https://cdn.test/file-1" });
        }
        contentCookie = new Headers(init?.headers).get("cookie");
        return new Response("asset", {
          headers: {
            "content-length": "5",
            "content-type": "application/octet-stream",
            etag: "asset-v1",
          },
        });
      }),
    );

    await expect(
      feature.download({ assetId: "file-1", outputPath, worktreeId: "wt-1" }),
    ).resolves.toMatchObject({
      assetId: "file-1",
      byteLength: 5,
      etag: "asset-v1",
      outputPath,
      worktreeId: "wt-1",
    });
    expect(await readFile(outputPath, "utf8")).toBe("asset");
    expect(contentCookie).toBeNull();

    const invalid = new WorkspaceAssetFeature(
      authFor(async () => jsonResponse({ error: { code: true, message: "invalid" } })),
    );
    await expect(
      invalid.download({
        assetId: "file-1",
        outputPath: join(directory, "bad.bin"),
        worktreeId: "wt-1",
      }),
    ).rejects.toMatchObject({ code: "workspace-invalid-response" });
  });

  it("does not call the Asset sign endpoint when a non-force output already exists", async () => {
    const directory = await temporaryDirectory();
    const outputPath = join(directory, "existing.bin");
    await writeFile(outputPath, "keep");
    let requests = 0;
    const feature = new WorkspaceAssetFeature(
      authFor(async () => {
        requests += 1;
        return jsonResponse({});
      }),
    );
    await expect(
      feature.download({ assetId: "file-1", outputPath, worktreeId: "wt-1" }),
    ).rejects.toMatchObject({ code: "workspace-asset-output-exists" });
    expect(requests).toBe(0);
    expect(await readFile(outputPath, "utf8")).toBe("keep");
  });

  it("rejects Open results containing a Unit from another Worktree", async () => {
    const reader = {
      get: async (): Promise<WorkspaceWorktree> => ({
        id: "wt-1",
        name: "Draft",
        state: "draft",
        units: [unit("wt-other")],
      }),
    } as unknown as WorkspaceWorktreeFeature;
    const feature = new WorkspaceOpenFeature(
      { configuredOrigin: async () => "https://workspace.test" } as unknown as WorkspaceAuth,
      reader,
    );
    await expect(feature.createUrl({ worktreeId: "wt-1" })).rejects.toMatchObject({
      code: "workspace-result-mismatch",
    });
  });

  it("rejects an invalid Open viewer URL before reading the Worktree", async () => {
    let reads = 0;
    const feature = new WorkspaceOpenFeature(
      { configuredOrigin: async () => "https://workspace.test" } as unknown as WorkspaceAuth,
      {
        get: async () => {
          reads += 1;
          return worktree("wt-1") as unknown as WorkspaceWorktree;
        },
      } as unknown as WorkspaceWorktreeFeature,
    );
    await expect(
      feature.createUrl({ viewerBaseUrl: "file:///tmp/viewer", worktreeId: "wt-1" }),
    ).rejects.toMatchObject({ code: "workspace-viewer-url-invalid" });
    expect(reads).toBe(0);
  });

  it("requires an explicit Unit when Open receives a multi-Unit Worktree", async () => {
    const feature = new WorkspaceOpenFeature(
      { configuredOrigin: async () => "https://workspace.test" } as unknown as WorkspaceAuth,
      {
        get: async (): Promise<WorkspaceWorktree> => ({
          id: "wt-1",
          name: "Draft",
          state: "draft",
          units: [unit("wt-1"), { ...unit("wt-1"), unitId: "unit-2" }],
        }),
      } as unknown as WorkspaceWorktreeFeature,
    );
    await expect(feature.createUrl({ worktreeId: "wt-1" })).rejects.toMatchObject({
      code: "workspace-open-unit-required",
      detail: { unitCount: 2, worktreeId: "wt-1" },
    });
  });
});

function authFor(fetcher: typeof fetch): WorkspaceAuth {
  const http = new WorkspaceHttp({
    cookie: "workspace_session=test",
    fetcher,
    origin: "https://workspace.test",
    role: "client",
  });
  return {
    authenticatedHttp: async () => http,
    configuredOrigin: async () => http.origin,
  } as unknown as WorkspaceAuth;
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function worktree(
  id: string,
  state: WorkspaceWorktree["state"] = "draft",
): Record<string, unknown> {
  return { id, name: "Draft", state, units: [] };
}

function unit(
  worktreeId: string,
  overrides: {
    readonly name?: string;
    readonly source?: "trunk" | "worktree";
    readonly target?: { readonly parentNodeId: string | null; readonly spaceId: string } | null;
  } = {},
): WorkspaceWorktree["units"][number] {
  const source = overrides.source ?? "trunk";
  return {
    activationState: "notApplicable",
    change: "unchanged",
    draftHeadRevision: 0,
    mergeResult: "pending",
    name: overrides.name ?? "Sheet",
    nodeId: "node-1",
    resourceId: "resource-1",
    source,
    target:
      overrides.target ?? (source === "trunk" ? null : { parentNodeId: null, spaceId: "space-1" }),
    type: "sheet",
    unitId: "unit-1",
    worktreeId,
  };
}

function node(
  overrides: {
    readonly hasChildren?: boolean;
    readonly id?: string;
    readonly name?: string;
    readonly parentNodeId?: string | null;
    readonly resource?: Record<string, unknown> | null;
  } = {},
): Record<string, unknown> {
  return {
    accessRole: "owner",
    capabilities: {
      browseChildren: true,
      createChildren: true,
      move: true,
      rename: true,
      share: true,
      trash: true,
    },
    hasChildren: overrides.hasChildren ?? false,
    id: overrides.id ?? "node-1",
    name: overrides.name ?? "Folder",
    parentNodeId: overrides.parentNodeId ?? null,
    resource: overrides.resource ?? null,
    spaceId: "space-1",
    updatedAt: "2026-08-05T00:00:00.000Z",
  };
}

function blobResource(): Record<string, unknown> {
  return {
    availability: "ready",
    byteSize: 3,
    capabilities: { downloadContent: true, editContent: false, openContent: false },
    id: "resource-1",
    kind: "blob",
    mediaType: "application/octet-stream",
  };
}

function nodePage(input: {
  readonly nextCursor?: string | null;
  readonly nodes: readonly Record<string, unknown>[];
}): Record<string, unknown> {
  return {
    breadcrumbs: [],
    navigationRootNodeId: null,
    nextCursor: input.nextCursor ?? null,
    nodes: input.nodes,
    parentNode: null,
    space: { id: "space-1", name: "Personal", type: "personal" },
  };
}

function nodeResponse(
  target: Record<string, unknown>,
  breadcrumbs: readonly { readonly id: string; readonly name: string }[],
): Record<string, unknown> {
  return {
    breadcrumbs,
    navigationRootNodeId: null,
    node: target,
    space: { id: "space-1", name: "Personal", type: "personal" },
  };
}

function trashBatch(nodeId: string): Record<string, unknown> {
  return {
    capabilities: { removePermanently: true, restore: true },
    id: "trash-1",
    nodeCount: 3,
    originalLocation: {
      breadcrumbs: [
        { id: "parent-1", name: "Projects" },
        { id: nodeId, name: "Archive" },
      ],
    },
    removeBlockedBy: null,
    restoreBlockedBy: null,
    root: { id: nodeId, name: "Archive", resource: null },
    spaceId: "space-1",
    trashedAt: "2026-08-09T00:00:00.000Z",
    trashedBy: {
      avatarUrl: null,
      displayName: "Alice",
      id: "user-1",
      username: "alice",
    },
  };
}

function uploadEnvelope(
  state: "waitingForUpload" | "uploaded" | "completed",
  options: { readonly uploadTarget?: boolean } = {},
): Record<string, unknown> {
  return {
    operation: {
      createdAt: "2026-08-05T00:00:00.000Z",
      error: null,
      id: "operation-1",
      kind: "createBlobResource",
      result: state === "completed" ? { resourceId: "resource-1" } : null,
      state: state === "completed" ? "completed" : "pending",
      updatedAt: "2026-08-05T00:00:00.000Z",
    },
    upload: {
      byteSize: 3,
      createdAt: "2026-08-05T00:00:00.000Z",
      detectedMediaType: state === "completed" ? "application/octet-stream" : null,
      expiresAt: "2026-08-06T00:00:00.000Z",
      id: "upload-1",
      name: "payload.bin",
      nodeId: "node-1",
      operationId: "operation-1",
      originalFilename: "payload.bin",
      receivedSize: state === "waitingForUpload" ? null : 3,
      resourceId: "resource-1",
      sha256: null,
      state,
      updatedAt: "2026-08-05T00:00:00.000Z",
    },
    uploadTarget:
      options.uploadTarget === true
        ? { contentUrl: "/api/blob-upload-sessions/upload-1/content", method: "PUT" }
        : null,
  };
}

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "workspace-app-features-"));
  temporaryDirectories.push(path);
  return path;
}
