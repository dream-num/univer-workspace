import { describe, expect, it, vi } from "vitest";
import {
  parseDetachedNode,
  parseNodePage,
  parseTrashBatch,
  WorkspaceHttp,
  WorkspaceSpaceFeature,
  type AuthenticatedWorkspaceHttp,
} from "../src/index.js";

describe("Workspace Space and Node workflows", () => {
  it("gets the current authenticated HTTP instance for each operation", async () => {
    let calls = 0;
    const authenticatedHttp: AuthenticatedWorkspaceHttp = async () => {
      calls += 1;
      return http(async () =>
        jsonResponse({ spaces: [{ id: `space-${String(calls)}`, name: "Personal" }] }),
      );
    };
    const feature = new WorkspaceSpaceFeature(authenticatedHttp);

    await expect(feature.list()).resolves.toEqual([{ id: "space-1", name: "Personal" }]);
    await expect(feature.list()).resolves.toEqual([{ id: "space-2", name: "Personal" }]);
    expect(calls).toBe(2);
  });

  it("lists, browses multiple pages, filters and finds Nodes in stable order", async () => {
    const requests: string[] = [];
    const feature = featureFor(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      requests.push(`${url.pathname}${url.search}`);
      if (url.pathname === "/api/spaces") {
        return jsonResponse({ spaces: [{ id: "space-1", name: "Personal", type: "personal" }] });
      }
      if (url.search === "") {
        return jsonResponse(
          nodePage({
            nextCursor: "next page",
            nodes: [node({ id: "node-1", name: "Quarterly Plan" })],
          }),
        );
      }
      return jsonResponse(
        nodePage({
          nodes: [
            node({ id: "node-2", name: "Archive", resource: blobResource() }),
            node({ id: "node-3", name: "Budget", resource: univerResource("sheet") }),
          ],
        }),
      );
    });

    await expect(feature.list()).resolves.toEqual([
      { id: "space-1", name: "Personal", type: "personal" },
    ]);
    await expect(feature.browse({ spaceId: "space-1" })).resolves.toMatchObject([
      { nodeId: "node-1", path: "/Quarterly Plan", resource: null },
      { nodeId: "node-2", path: "/Archive", resource: { kind: "blob" } },
      {
        nodeId: "node-3",
        path: "/Budget",
        resource: { kind: "univer", unitId: "unit-2", unitType: "sheet" },
      },
    ]);
    await expect(feature.browse({ resourceKind: "blob", spaceId: "space-1" })).resolves.toMatchObject([
      { nodeId: "node-2" },
    ]);
    await expect(feature.browse({ resourceKind: "none", spaceId: "space-1" })).resolves.toMatchObject([
      { nodeId: "node-1" },
    ]);
    await expect(
      feature.browse({ resourceKind: "univer", spaceId: "space-1", unitType: "sheet" }),
    ).resolves.toMatchObject([{ nodeId: "node-3" }]);
    await expect(feature.find({ query: " quarterly ", spaceId: "space-1" })).resolves.toMatchObject([
      { nodeId: "node-1" },
    ]);
    expect(requests).toContain("/api/spaces/space-1/nodes?cursor=next%20page");
  });

  it("rejects changed pagination metadata and repeated cursors without looping", async () => {
    let repeatedCalls = 0;
    const repeated = featureFor(async () => {
      repeatedCalls += 1;
      return jsonResponse(nodePage({ nextCursor: "repeat", nodes: [] }));
    });
    await expect(repeated.browse({ spaceId: "space-1" })).rejects.toMatchObject({
      code: "workspace-invalid-response",
    });
    expect(repeatedCalls).toBe(2);

    let metadataCalls = 0;
    const changed = featureFor(async () => {
      metadataCalls += 1;
      return jsonResponse(
        nodePage({
          nextCursor: metadataCalls === 1 ? "next" : null,
          nodes: [],
          spaceName: metadataCalls === 1 ? "Personal" : "Changed",
        }),
      );
    });
    await expect(changed.browse({ spaceId: "space-1" })).rejects.toMatchObject({
      code: "workspace-invalid-response",
    });
    expect(metadataCalls).toBe(2);
  });

  it("rejects repeated Nodes during recursive traversal without looping", async () => {
    let calls = 0;
    const feature = featureFor(async () => {
      calls += 1;
      return jsonResponse(
        calls === 1
          ? nodePage({ nodes: [node({ hasChildren: true, id: "parent" })] })
          : nodePage({
              breadcrumbs: [{ id: "parent", name: "Parent" }],
              nodes: [node({ id: "parent", parentNodeId: "parent" })],
              parentNode: node({ hasChildren: true, id: "parent", name: "Parent" }),
            }),
      );
    });

    await expect(feature.browse({ recursive: true, spaceId: "space-1" })).rejects.toMatchObject({
      code: "workspace-invalid-response",
    });
    expect(calls).toBe(2);
  });

  it("creates a trimmed organizational Node once and validates its target", async () => {
    const requests: Array<{ body: unknown; method: string | undefined; path: string }> = [];
    const feature = featureFor(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      requests.push({ body: JSON.parse(String(init?.body)), method: init?.method, path: url.pathname });
      return jsonResponse(node({ id: "created", name: "Folder", parentNodeId: "parent" }), {
        status: 201,
      });
    });

    await expect(
      feature.createNode({ name: "  Folder  ", parentNodeId: "parent", spaceId: "space-1" }),
    ).resolves.toMatchObject({ name: "Folder", nodeId: "created", parentNodeId: "parent" });
    expect(requests).toEqual([
      {
        body: { name: "Folder", parentNodeId: "parent", spaceId: "space-1" },
        method: "POST",
        path: "/api/nodes",
      },
    ]);
  });

  it("does not retry create when the remote result is unknown", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Promise.reject(new Error("lost")));
    const feature = featureFor(fetcher);

    await expect(
      feature.createNode({ name: "Folder", parentNodeId: "parent", spaceId: "space-1" }),
    ).rejects.toMatchObject({
      code: "workspace-result-unknown",
      detail: { name: "Folder", parentNodeId: "parent", spaceId: "space-1" },
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    {
      expected: { name: "Renamed" },
      input: { name: "Renamed", nodeId: "node-1" } as const,
      kind: "rename" as const,
      patch: { name: "Renamed" },
      target: node({ id: "node-1", name: "Renamed" }),
    },
    {
      expected: { parentNodeId: "parent-2" },
      input: { nodeId: "node-1", parentNodeId: "parent-2" } as const,
      kind: "move" as const,
      patch: { parentNodeId: "parent-2" },
      target: node({ id: "node-1", name: "Moved", parentNodeId: "parent-2" }),
    },
    {
      expected: { parentNodeId: null },
      input: { nodeId: "node-1", parentNodeId: null } as const,
      kind: "move" as const,
      patch: { parentNodeId: null },
      target: node({ id: "node-1", name: "Moved", parentNodeId: null }),
    },
  ])("confirms unknown $kind with one GET and no PATCH replay", async (fixture) => {
    const requests: Array<{ body?: unknown; method: string; path: string }> = [];
    const feature = featureFor(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const method = init?.method ?? "GET";
      requests.push({
        method,
        path: url.pathname,
        ...(init?.body === undefined ? {} : { body: JSON.parse(String(init.body)) }),
      });
      if (method === "PATCH") throw new Error("response interrupted");
      return jsonResponse(
        nodeResponse(fixture.target, [
          ...(fixture.target["parentNodeId"] === null
            ? []
            : [{ id: String(fixture.target["parentNodeId"]), name: "Parent" }]),
          { id: "node-1", name: String(fixture.target["name"]) },
        ]),
      );
    });

    const result =
      fixture.kind === "rename"
        ? await feature.renameNode(fixture.input)
        : await feature.moveNode(fixture.input);
    expect(result).toMatchObject(fixture.expected);
    expect(result).not.toHaveProperty("path");
    expect(requests).toEqual([
      { body: fixture.patch, method: "PATCH", path: "/api/nodes/node-1" },
      { method: "GET", path: "/api/nodes/node-1" },
    ]);
  });

  it("returns result-unknown when read-back cannot confirm an update", async () => {
    let calls = 0;
    const feature = featureFor(async (_input, init) => {
      calls += 1;
      if (init?.method === "PATCH") throw new Error("lost");
      return jsonResponse(
        nodeResponse(node({ id: "node-1", name: "Old" }), [{ id: "node-1", name: "Old" }]),
      );
    });

    await expect(feature.renameNode({ name: "New", nodeId: "node-1" })).rejects.toMatchObject({
      code: "workspace-result-unknown",
      detail: { nodeId: "node-1", requested: { name: "New" } },
    });
    expect(calls).toBe(2);
  });

  it("validates Node names and update response identity", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(node({ id: "different" })));
    const feature = featureFor(fetcher);

    await expect(feature.renameNode({ name: "   ", nodeId: "node-1" })).rejects.toMatchObject({
      code: "workspace-argument-invalid",
    });
    await expect(feature.renameNode({ name: "x".repeat(256), nodeId: "node-1" })).rejects.toMatchObject({
      code: "workspace-argument-invalid",
    });
    await expect(feature.renameNode({ name: "Renamed", nodeId: "node-1" })).rejects.toMatchObject({
      code: "workspace-result-mismatch",
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("returns a strict Trash Batch once and does not retry unknown trash", async () => {
    const requests: string[] = [];
    const feature = featureFor(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      requests.push(`${init?.method ?? "GET"} ${url.pathname}`);
      return jsonResponse(trashBatch("node-1"), { status: 201 });
    });
    await expect(feature.trashNode("node-1")).resolves.toMatchObject({
      nodeCount: 3,
      root: { nodeId: "node-1" },
      trashBatchId: "trash-1",
    });
    expect(requests).toEqual(["POST /api/nodes/node-1/trash"]);

    const fetcher = vi.fn<typeof fetch>(async () => Promise.reject(new Error("lost")));
    await expect(featureFor(fetcher).trashNode("node-1")).rejects.toMatchObject({
      code: "workspace-result-unknown",
      detail: { nodeId: "node-1" },
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe("Workspace Space and Node strict parsers", () => {
  it("rejects broadened capabilities and unsupported Resources", () => {
    const broadened = node({ resource: blobResource() });
    (broadened["capabilities"] as Record<string, unknown>)["deleteForever"] = true;
    expect(() => parseDetachedNode(broadened)).toThrowError(
      expect.objectContaining({ code: "workspace-invalid-response" }),
    );

    expect(() => parseDetachedNode(node({ resource: { id: "resource-1", kind: "legacy" } }))).toThrowError(
      expect.objectContaining({ code: "workspace-invalid-response" }),
    );
    expect(() =>
      parseDetachedNode(node({ resource: { ...univerResource("doc"), unitId: "" } })),
    ).toThrowError(expect.objectContaining({ code: "workspace-invalid-response" }));
  });

  it("accepts legacy Univer Resource summaries without a Unit identity", () => {
    const resource = univerResource("doc");
    delete resource["unitId"];
    expect(parseDetachedNode(node({ resource })).resource).toMatchObject({
      kind: "univer",
      resourceId: "resource-2",
      unitType: "doc",
    });
    expect(parseDetachedNode(node({ resource })).resource).not.toHaveProperty("unitId");
  });

  it("rejects mismatched Space, parent, pagination and Trash identities", () => {
    expect(() => parseNodePage(nodePage({ nodes: [], spaceId: "other" }), "space-1", undefined)).toThrowError(
      expect.objectContaining({ code: "workspace-invalid-response" }),
    );
    expect(() =>
      parseNodePage({ ...nodePage({ nodes: [] }), nextCursor: 1 }, "space-1", undefined),
    ).toThrowError(expect.objectContaining({ code: "workspace-invalid-response" }));
    expect(() => parseTrashBatch(trashBatch("node-1"), "other-node")).toThrowError(
      expect.objectContaining({ code: "workspace-invalid-response" }),
    );
  });
});

function featureFor(fetcher: typeof fetch): WorkspaceSpaceFeature {
  return new WorkspaceSpaceFeature(async () => http(fetcher));
}

function http(fetcher: typeof fetch): WorkspaceHttp {
  return new WorkspaceHttp({
    cookie: "workspace_session=test",
    fetcher,
    origin: "https://workspace.test",
    role: "client",
  });
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
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

function univerResource(unitType: string): Record<string, unknown> {
  return {
    capabilities: { downloadContent: false, editContent: true, openContent: true },
    id: "resource-2",
    kind: "univer",
    unitId: "unit-2",
    unitType,
  };
}

function nodePage(input: {
  readonly breadcrumbs?: readonly { readonly id: string; readonly name: string }[];
  readonly nextCursor?: string | null;
  readonly nodes: readonly Record<string, unknown>[];
  readonly parentNode?: Record<string, unknown> | null;
  readonly spaceId?: string;
  readonly spaceName?: string;
}): Record<string, unknown> {
  return {
    breadcrumbs: input.breadcrumbs ?? [],
    navigationRootNodeId: null,
    nextCursor: input.nextCursor ?? null,
    nodes: input.nodes,
    parentNode: input.parentNode ?? null,
    space: {
      id: input.spaceId ?? "space-1",
      name: input.spaceName ?? "Personal",
      type: "personal",
    },
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
