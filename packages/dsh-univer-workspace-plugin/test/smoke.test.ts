import { describe, expect, it } from "vitest";
import * as host from "../src/index.js";
import {
  createDocument,
  createWorktreeLocalUnit,
  getWorktreeDetail,
  listSpaceDocuments,
  narrowNodePage,
  narrowSpaces,
  newIdempotencyKey,
  narrowNodes,
  narrowUnitResource,
} from "../src/provider/workspace-api.js";
import { spaceLinksDomainSpec } from "../src/provider/space-links.js";
import type { WorkspaceHttpClient } from "../src/provider/workspace-contract.js";
import { spaceDirectoryPath } from "../src/provider/workspace-contract.js";
import { renderSpaces } from "../src/tools/discovery.js";

/** A WorkspaceHttpClient stub answering queued `(path, init)` rounds. */
function stubClient(rounds: Array<(path: string) => Response>): WorkspaceHttpClient {
  let index = 0;
  return {
    origin: "https://workspace.test",
    sessionToken: "tok",
    async request(path: string): Promise<Response> {
      const round = rounds[Math.min(index, rounds.length - 1)];
      if (round === undefined) throw new Error("stub client ran out of rounds");
      index += 1;
      return await Promise.resolve(round(path));
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("dsh-univer-workspace-plugin", () => {
  it("exports a loadable cordis host plugin", () => {
    expect(host.name).toBe("dsh-univer-workspace-plugin");
    expect(typeof host.apply).toBe("function");
  });

  it("narrows a Workspace space list", () => {
    const spaces = narrowSpaces({
      spaces: [
        { id: "sp-1", type: "personal", name: "Personal", accessRole: "owner" },
        { id: "sp-2", type: "team", name: "Team", accessRole: "editor" },
      ],
    });
    expect(spaces).toHaveLength(2);
    expect(spaces[0]).toMatchObject({
      spaceId: "sp-1",
      type: "personal",
      name: "Personal",
      accessRole: "owner",
    });
    expect(spaces[1]).toMatchObject({ spaceId: "sp-2", type: "team", accessRole: "editor" });
  });

  it("rejects a malformed space list", () => {
    expect(() => narrowSpaces({})).toThrow(/no spaces array/);
  });

  it("renders the session-linked Space so the agent does not guess across Spaces", () => {
    const rendered = renderSpaces([
      {
        spaceId: "sp-personal",
        type: "personal",
        name: "Personal",
        accessRole: "owner",
        dshWorkspaceId: "ws-1",
        linked: false,
      },
      {
        spaceId: "sp-team",
        type: "team",
        name: "Team",
        accessRole: "editor",
        dshWorkspaceId: "ws-2",
        linked: true,
      },
    ]);
    expect(rendered).toEqual([
      {
        type: "text",
        text: "Personal (personal, sp-personal)\nTeam (team, sp-team, linked to this session)",
      },
    ]);
  });

  it("declares a versioned space-links domain", () => {
    expect(spaceLinksDomainSpec.name).toBe("univer_workspace_space_links");
    expect(spaceLinksDomainSpec.version).toBe(1);
  });

  it("derives stable per-user/per-Space paths without importing the harness app", () => {
    expect(spaceDirectoryPath("/workspace", "user-1", "space-1")).toBe(
      "/workspace/c6c289e49e9c05b2145860387b73bcb18df43fb09a1e4a4a9713c76c88bb541b/475e1f0c14a91b83eb7395c80cfd166d1b0e37b6541583803c5436c2e79ca75b",
    );
  });

  it("mints a valid Idempotency-Key", () => {
    const key = newIdempotencyKey();
    expect(key).toMatch(/^uwh-[a-z0-9]+-[A-Za-z0-9_-]+$/);
    expect(key.length).toBeGreaterThanOrEqual(16);
    expect(newIdempotencyKey()).not.toBe(key);
  });

  it("keeps a listed document usable without a list-level unitId", () => {
    const documents = narrowNodes(
      {
        nodes: [
          {
            id: "node-1",
            name: "Demo Sheet",
            resource: { id: "res-1", kind: "univer", unitType: "sheet", capabilities: {} },
            accessRole: "editor",
          },
        ],
      },
      "sp-1",
    );
    expect(documents).toHaveLength(1);
    const [first] = documents;
    if (first === undefined) throw new Error("expected one document");
    expect(first).toMatchObject({ nodeId: "node-1", resourceId: "res-1", unitType: "sheet" });
    expect(first.unitId).toBeNull();
  });

  it("walks every paged root and nested Node page", async () => {
    const requests: string[] = [];
    const client: WorkspaceHttpClient = {
      origin: "https://workspace.test",
      sessionToken: "tok",
      async request(path) {
        requests.push(path);
        if (path === "/api/spaces/sp-1/nodes?limit=100") {
          return jsonResponse(200, {
            nodes: [
              {
                id: "folder-a",
                spaceId: "sp-1",
                parentNodeId: null,
                name: "Folder A",
                resource: null,
                hasChildren: true,
              },
              {
                id: "root-doc",
                spaceId: "sp-1",
                parentNodeId: null,
                name: "Root",
                resource: { id: "res-root", kind: "univer", unitType: "sheet" },
                hasChildren: false,
              },
            ],
            nextCursor: "root-next",
          });
        }
        if (path === "/api/spaces/sp-1/nodes?limit=100&cursor=root-next") {
          return jsonResponse(200, {
            nodes: [
              {
                id: "folder-b",
                spaceId: "sp-1",
                parentNodeId: null,
                name: "Folder B",
                resource: null,
                hasChildren: true,
              },
            ],
            nextCursor: null,
          });
        }
        if (path === "/api/nodes/folder-a/children?limit=100") {
          return jsonResponse(200, {
            nodes: [
              {
                id: "nested-doc",
                spaceId: "sp-1",
                parentNodeId: "folder-a",
                name: "Nested",
                resource: { id: "res-nested", kind: "univer", unitType: "doc" },
                hasChildren: false,
              },
            ],
            nextCursor: "child-next",
          });
        }
        if (path === "/api/nodes/folder-a/children?limit=100&cursor=child-next") {
          return jsonResponse(200, {
            nodes: [
              {
                id: "nested-folder",
                spaceId: "sp-1",
                parentNodeId: "folder-a",
                name: "Nested Folder",
                resource: null,
                hasChildren: true,
              },
            ],
            nextCursor: null,
          });
        }
        if (path === "/api/nodes/folder-b/children?limit=100") {
          return jsonResponse(200, {
            nodes: [
              {
                id: "deep-doc",
                spaceId: "sp-1",
                parentNodeId: "folder-b",
                name: "Deep",
                resource: { id: "res-deep", kind: "univer", unitType: "slide" },
                hasChildren: false,
              },
            ],
            nextCursor: null,
          });
        }
        if (path === "/api/nodes/nested-folder/children?limit=100") {
          return jsonResponse(200, {
            nodes: [
              {
                id: "deep-nested-doc",
                spaceId: "sp-1",
                parentNodeId: "nested-folder",
                name: "Deep nested",
                resource: { id: "res-deep-nested", kind: "univer", unitType: "base" },
                hasChildren: false,
              },
            ],
            nextCursor: null,
          });
        }
        throw new Error(`unexpected request ${path}`);
      },
    };

    const documents = await listSpaceDocuments(client, "sp-1");
    expect(documents.map((document) => document.nodeId)).toEqual([
      "folder-a",
      "root-doc",
      "folder-b",
      "nested-doc",
      "nested-folder",
      "deep-doc",
      "deep-nested-doc",
    ]);
    expect(documents.find((document) => document.nodeId === "nested-doc")).toMatchObject({
      parentNodeId: "folder-a",
      resourceId: "res-nested",
      unitType: "doc",
    });
    expect(requests).toHaveLength(6);
  });

  it("supports hierarchy, query, resource-kind, and unit-type filters without dropping blobs", async () => {
    const client: WorkspaceHttpClient = {
      origin: "https://workspace.test",
      sessionToken: "tok",
      async request(path) {
        if (path === "/api/spaces/sp-1/nodes?limit=100") {
          return jsonResponse(200, {
            nodes: [
              {
                id: "folder",
                spaceId: "sp-1",
                parentNodeId: null,
                name: "Reports",
                resource: null,
                hasChildren: true,
              },
              {
                id: "blob",
                spaceId: "sp-1",
                parentNodeId: null,
                name: "Report.csv",
                resource: {
                  id: "blob-1",
                  kind: "blob",
                  mediaType: "text/csv",
                  byteSize: 12,
                  availability: "ready",
                  capabilities: {},
                },
                hasChildren: false,
              },
            ],
            nextCursor: null,
          });
        }
        if (path === "/api/nodes/folder/children?limit=100") {
          return jsonResponse(200, {
            nodes: [
              {
                id: "sheet",
                spaceId: "sp-1",
                parentNodeId: "folder",
                name: "Monthly",
                resource: { id: "res-1", kind: "univer", unitType: "sheet", capabilities: {} },
                hasChildren: false,
              },
            ],
            nextCursor: null,
          });
        }
        throw new Error(`unexpected request ${path}`);
      },
    };
    const all = await listSpaceDocuments(client, "sp-1");
    expect(all.map((document) => document.resourceKind)).toEqual([null, "blob", "univer"]);
    expect(all.find((document) => document.resourceKind === "blob")).toMatchObject({
      resourceId: "blob-1",
      mediaType: "text/csv",
      byteSize: 12,
    });
    const nestedSheets = await listSpaceDocuments(client, "sp-1", {
      parentNodeId: "folder",
      recursive: true,
      query: "month",
      unitType: "sheet",
    });
    expect(nestedSheets.map((document) => document.nodeId)).toEqual(["sheet"]);
    const blobs = await listSpaceDocuments(client, "sp-1", { resourceKind: "blob" });
    expect(blobs.map((document) => document.resourceId)).toEqual(["blob-1"]);
  });

  it("loads one requested tree branch without walking unrelated descendants", async () => {
    const requests: string[] = [];
    const client: WorkspaceHttpClient = {
      origin: "https://workspace.test",
      sessionToken: "tok",
      async request(path) {
        requests.push(path);
        if (path === "/api/nodes/folder/children?limit=100") {
          return jsonResponse(200, {
            nodes: [
              {
                id: "nested-doc",
                spaceId: "sp-1",
                parentNodeId: "folder",
                name: "Nested",
                resource: { id: "res-nested", kind: "univer", unitType: "doc" },
                hasChildren: false,
              },
            ],
            nextCursor: null,
          });
        }
        throw new Error(`unexpected request ${path}`);
      },
    };

    const documents = await listSpaceDocuments(client, "sp-1", {
      parentNodeId: "folder",
      recursive: false,
    });

    expect(documents.map((document) => document.nodeId)).toEqual(["nested-doc"]);
    expect(requests).toEqual(["/api/nodes/folder/children?limit=100"]);
  });

  it("rejects a malformed node cursor instead of looping", () => {
    expect(() => narrowNodePage({ nodes: [], nextCursor: 42 }, "sp-1")).toThrow(
      /invalid nextCursor/,
    );
  });

  it("creates a document and resolves the unitId through the open endpoint", async () => {
    const client = stubClient([
      (path) => {
        expect(path).toBe("/api/resources");
        return jsonResponse(201, {
          operation: { id: "op-1", state: "completed" },
          node: {
            id: "node-2",
            name: "New Sheet",
            resource: { id: "res-2", kind: "univer", unitType: "sheet", capabilities: {} },
            accessRole: "owner",
          },
        });
      },
      (path) => {
        expect(path).toBe("/api/resources/res-2/open");
        return jsonResponse(200, {
          resource: {
            id: "res-2",
            kind: "univer",
            nodeId: "node-2",
            spaceId: "sp-1",
            name: "New Sheet",
            unitId: "unit-2",
            unitType: "sheet",
            accessRole: "owner",
            editorMode: "edit",
          },
        });
      },
    ]);
    const created = await createDocument(client, {
      spaceId: "sp-1",
      parentNodeId: null,
      name: "New Sheet",
      unitType: "sheet",
    });
    expect(created).toEqual({ resourceId: "res-2", nodeId: "node-2", unitId: "unit-2" });
  });

  it("normalizes the unit-resource summary contract without requiring open-only fields", () => {
    const resolved = narrowUnitResource(
      {
        resource: {
          id: "res-4",
          kind: "univer",
          unitType: "sheet",
          capabilities: { editContent: true },
        },
        node: {
          id: "node-4",
          spaceId: "sp-1",
          name: "Resolved Sheet",
          resource: {
            id: "res-4",
            kind: "univer",
            unitType: "sheet",
            capabilities: { editContent: true },
          },
          accessRole: "editor",
        },
      },
      "unit-4",
    );
    expect(resolved).toEqual({
      nodeId: "node-4",
      resourceId: "res-4",
      unitId: "unit-4",
      unitType: "sheet",
      name: "Resolved Sheet",
      spaceId: "sp-1",
      accessRole: "editor",
      editorMode: "edit",
    });
  });

  it("rejects a unit-resource response whose Node and Resource identities disagree", () => {
    expect(() =>
      narrowUnitResource(
        {
          resource: { id: "res-4", kind: "univer", unitType: "sheet" },
          node: {
            id: "node-4",
            spaceId: "sp-1",
            name: "Wrong Sheet",
            resource: { id: "other-resource", kind: "univer", unitType: "sheet" },
          },
        },
        "unit-4",
      ),
    ).toThrow(/malformed descriptor/);
  });

  it("fetches a complete Worktree detail after a unit is attached", async () => {
    const client: WorkspaceHttpClient = {
      origin: "https://workspace.test",
      sessionToken: "tok",
      async request(path) {
        expect(path).toBe("/api/worktrees/wt-4");
        return jsonResponse(200, {
          worktree: {
            id: "wt-4",
            name: "Review",
            summary: null,
            kind: "user",
            teamSpace: null,
            visibility: "private",
            state: "draft",
            creator: { id: "u-1", username: "alice", displayName: "Alice", avatarUrl: null },
            unitCount: 1,
            processedAt: null,
            createdAt: "2026-08-28T00:00:00Z",
            updatedAt: "2026-08-28T00:00:01Z",
            capabilities: {
              review: true,
              editDraft: true,
              addUnit: true,
              changeVisibility: false,
              markReady: true,
              reopen: false,
              merge: false,
              discard: true,
            },
            units: [
              {
                unitId: "unit-4",
                resourceId: "res-4",
                nodeId: "node-4",
                source: "trunk",
                name: "Resolved Sheet",
                unitType: "sheet",
                target: null,
                draftHeadRevision: 0,
                change: "unchanged",
                mergeResult: "pending",
                activationState: "notApplicable",
              },
            ],
          },
        });
      },
    };
    const detail = await getWorktreeDetail(client, "wt-4");
    expect(detail.unitCount).toBe(1);
    expect(detail.units[0]).toMatchObject({ unitId: "unit-4", resourceId: "res-4" });
  });

  it("re-sends the same Idempotency-Key until a 202 create replays its result", async () => {
    const keys: string[] = [];
    const createAnswer = (state: "pending" | "completed"): Response =>
      jsonResponse(
        state === "pending" ? 202 : 200,
        state === "pending"
          ? { operation: { id: "op-1", state: "pending" } }
          : {
              operation: { id: "op-1", state: "completed" },
              node: {
                id: "node-3",
                name: "Retry Sheet",
                resource: { id: "res-3", kind: "univer", unitType: "sheet", capabilities: {} },
                accessRole: "owner",
              },
            },
      );
    const client: WorkspaceHttpClient = {
      origin: "https://workspace.test",
      sessionToken: "tok",
      async request(path, init) {
        if (path === "/api/resources") {
          const headers = (init?.headers ?? {}) as Record<string, string>;
          if (typeof headers["Idempotency-Key"] === "string") keys.push(headers["Idempotency-Key"]);
          return await Promise.resolve(createAnswer(keys.length === 1 ? "pending" : "completed"));
        }
        expect(path).toBe("/api/resources/res-3/open");
        return await Promise.resolve(
          jsonResponse(200, {
            resource: {
              id: "res-3",
              kind: "univer",
              nodeId: "node-3",
              spaceId: "sp-1",
              name: "Retry Sheet",
              unitId: "unit-3",
              unitType: "sheet",
              accessRole: "owner",
              editorMode: "edit",
            },
          }),
        );
      },
    };
    const created = await createDocument(client, {
      spaceId: "sp-1",
      parentNodeId: null,
      name: "Retry Sheet",
      unitType: "sheet",
    });
    expect(created).toEqual({ resourceId: "res-3", nodeId: "node-3", unitId: "unit-3" });
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("creates a Worktree-local Unit with the product contract", async () => {
    let requestInit: RequestInit | undefined;
    const client: WorkspaceHttpClient = {
      origin: "https://workspace.test",
      sessionToken: "tok",
      async request(path, init) {
        expect(path).toBe("/api/worktrees/wt-1/units");
        requestInit = init;
        return jsonResponse(201, {
          unit: {
            unitId: "unit-local",
            resourceId: "res-local",
            nodeId: "node-local",
            source: "worktree",
            name: "Draft Sheet",
            unitType: "sheet",
            target: { spaceId: "sp-1", parentNodeId: null },
            draftHeadRevision: 1,
            change: "added",
            mergeResult: "pending",
            activationState: "waitingForMerge",
          },
        });
      },
    };
    const unit = await createWorktreeLocalUnit(client, {
      worktreeId: "wt-1",
      name: "Draft Sheet",
      unitType: "sheet",
      targetSpaceId: "sp-1",
      targetParentNodeId: null,
    });
    expect(unit).toMatchObject({ unitId: "unit-local", source: "worktree", change: "added" });
    expect(requestInit?.method).toBe("POST");
    expect((requestInit?.headers as Record<string, string>)["Idempotency-Key"]).toMatch(/^uwh-/);
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      source: "worktree",
      name: "Draft Sheet",
      unitType: "sheet",
      targetSpaceId: "sp-1",
      targetParentNodeId: null,
    });
  });

  it("polls a pending Worktree Unit operation and resolves its final Unit", async () => {
    const requests: string[] = [];
    const client: WorkspaceHttpClient = {
      origin: "https://workspace.test",
      sessionToken: "tok",
      async request(path) {
        requests.push(path);
        if (path === "/api/worktrees/wt-2/units") {
          return new Response(
            JSON.stringify({
              operation: { id: "op-unit", state: "pending", result: null, error: null },
            }),
            { status: 202, headers: { "content-type": "application/json" } },
          );
        }
        if (path === "/api/operations/op-unit") {
          return new Response(
            JSON.stringify({
              id: "op-unit",
              state: "completed",
              result: { worktreeId: "wt-2", unitId: "unit-pending" },
              error: null,
            }),
            {
              status: 200,
              headers: { "content-type": "application/json", "retry-after": "0.001" },
            },
          );
        }
        if (path === "/api/worktrees/wt-2") {
          return jsonResponse(200, {
            worktree: {
              units: [
                {
                  unitId: "unit-pending",
                  resourceId: "res-pending",
                  nodeId: "node-pending",
                  source: "worktree",
                  name: "Pending Doc",
                  unitType: "doc",
                  target: { spaceId: "sp-1", parentNodeId: "folder-1" },
                  draftHeadRevision: 1,
                  change: "added",
                  mergeResult: "pending",
                  activationState: "waitingForMerge",
                },
              ],
            },
          });
        }
        throw new Error(`unexpected request ${path}`);
      },
    };
    const unit = await createWorktreeLocalUnit(client, {
      worktreeId: "wt-2",
      name: "Pending Doc",
      unitType: "doc",
      targetSpaceId: "sp-1",
      targetParentNodeId: "folder-1",
    });
    expect(unit).toMatchObject({ unitId: "unit-pending", unitType: "doc", source: "worktree" });
    expect(requests).toEqual([
      "/api/worktrees/wt-2/units",
      "/api/operations/op-unit",
      "/api/worktrees/wt-2",
    ]);
  });
});
