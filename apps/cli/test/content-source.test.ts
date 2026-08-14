import { describe, expect, it } from "vitest";
import { WorkspaceContentSource } from "../src/features/content/source.js";
import { WorkspaceHttp } from "../src/transport/http.js";

describe("Workspace content source scopes", () => {
  it("only resolves draft Worktrees as editable targets", async () => {
    const draft = contentSource(async () =>
      jsonResponse({
        worktree: {
          id: "wt-1",
          state: "draft",
          units: [{ draftHeadRevision: 7, unitId: "book-1", unitType: "sheet" }],
        },
      }),
    );
    await expect(
      draft.resolveEditableRuntimeTarget({ unitId: "book-1", worktreeId: "wt-1" }),
    ).resolves.toMatchObject({ revision: 7, unitId: "book-1", unitType: "sheet" });

    const ready = contentSource(async () =>
      jsonResponse({ worktree: { id: "wt-1", state: "ready", units: [] } }),
    );
    await expect(
      ready.resolveEditableRuntimeTarget({ unitId: "book-1", worktreeId: "wt-1" }),
    ).rejects.toMatchObject({ code: "workspace-worktree-not-editable" });
  });

  it("discovers a trunk Unit type and immutable head revision without a Worktree", async () => {
    const requests: string[] = [];
    const source = contentSource(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      requests.push(url.pathname);
      if (url.pathname.includes("/snapshot/2/")) return unitTypeMismatch();
      return jsonResponse({
        changesets: [],
        snapshot: {
          doc: { originalMeta: "" },
          rev: 4,
          type: 1,
          unitID: "doc-1",
        },
      });
    });

    await expect(source.resolveTrunkRuntimeTarget({ unitId: "doc-1" })).resolves.toEqual({
      origin: "https://workspace.test",
      revision: 4,
      scope: { kind: "trunk" },
      unitId: "doc-1",
      unitType: "doc",
    });
    expect(requests).toEqual([
      "/universer-api/snapshot/2/unit/doc-1/rev/0",
      "/universer-api/snapshot/1/unit/doc-1/rev/0",
    ]);
  });

  it("does not treat authentication, permission, not-found, or transport failures as type discovery", async () => {
    let requests = 0;
    const source = contentSource(async () => {
      requests += 1;
      return jsonResponse(
        { error: { code: "NOT_FOUND", message: "The Unit was not found." } },
        { status: 404 },
      );
    });
    await expect(source.resolveTrunkRuntimeTarget({ unitId: "missing" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(requests).toBe(1);
  });

  it("uses scope-specific Snapshot and block endpoints", async () => {
    const requests: string[] = [];
    const source = contentSource(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      requests.push(url.pathname);
      if (url.pathname.endsWith("/block/block-1")) {
        return jsonResponse({ block: { data: "YmxvY2s=", id: "block-1" } });
      }
      return jsonResponse({
        changesets: [],
        snapshot: {
          rev: 3,
          type: 2,
          unitID: "book-1",
          workbook: { originalMeta: "", sheets: {} },
        },
      });
    });
    const trunk = {
      origin: "https://workspace.test",
      revision: 3,
      scope: { kind: "trunk" as const },
      unitId: "book-1",
      unitType: "sheet" as const,
    };
    const worktree = {
      ...trunk,
      scope: { kind: "worktree" as const, worktreeId: "wt-1" },
    };

    await source.getUnit(trunk);
    await source.getSheetBlock(trunk, "block-1");
    await source.getUnit(worktree);
    await source.getSheetBlock(worktree, "block-1");
    expect(requests).toEqual([
      "/universer-api/snapshot/2/unit/book-1/rev/0",
      "/universer-api/snapshot/2/unit/book-1/block/block-1",
      "/universer-api/worktrees/wt-1/snapshot/2/unit/book-1/rev/0",
      "/universer-api/worktrees/wt-1/snapshot/2/unit/book-1/block/block-1",
    ]);
  });

  it("keeps mapped reference Units in the Worktree and falls back to trunk", async () => {
    const source = contentSource(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname === "/api/worktrees/wt-1") {
        return jsonResponse({
          worktree: {
            id: "wt-1",
            units: [{ draftHeadRevision: 8, unitId: "mapped-source", unitType: "sheet" }],
          },
        });
      }
      return jsonResponse({
        changesets: [],
        snapshot: {
          rev: 4,
          type: 2,
          unitID: "trunk-source",
          workbook: { originalMeta: "", sheets: {} },
        },
      });
    });
    const hostTarget = {
      origin: "https://workspace.test",
      revision: 7,
      scope: { kind: "worktree" as const, worktreeId: "wt-1" },
      unitId: "host",
      unitType: "board" as const,
    };

    await expect(
      source.resolveReferencedRuntimeTarget({ hostTarget, unitId: "mapped-source" }),
    ).resolves.toMatchObject({
      revision: 8,
      scope: { kind: "worktree", worktreeId: "wt-1" },
      unitId: "mapped-source",
      unitType: "sheet",
    });
    await expect(
      source.resolveReferencedRuntimeTarget({ hostTarget, unitId: "trunk-source" }),
    ).resolves.toMatchObject({
      revision: 4,
      scope: { kind: "trunk" },
      unitId: "trunk-source",
      unitType: "sheet",
    });
  });

  it("downloads a Worktree image asset through its signed content URL", async () => {
    const requests: string[] = [];
    const source = contentSource(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      requests.push(url.toString());
      if (url.pathname.endsWith("/sign-url")) {
        return jsonResponse({ error: { code: 1, message: "" }, url: "https://cdn.test/image" });
      }
      return new Response(Uint8Array.from([1, 2, 3]), {
        headers: { "content-length": "3", "content-type": "image/png" },
      });
    });

    await expect(
      source.resolveImageAsset({ assetId: "asset/1", worktreeId: "wt/1" }),
    ).resolves.toEqual({
      bytes: Uint8Array.from([1, 2, 3]),
      contentLength: 3,
      mediaType: "image/png",
    });
    expect(requests).toEqual([
      "https://workspace.test/universer-api/worktrees/wt%2F1/file/asset%2F1/sign-url",
      "https://cdn.test/image",
    ]);
  });
});

function contentSource(fetcher: typeof fetch): WorkspaceContentSource {
  return new WorkspaceContentSource(
    new WorkspaceHttp({
      cookie: "workspace_session=test",
      fetcher,
      origin: "https://workspace.test",
      role: "client",
    }),
  );
}

function unitTypeMismatch(): Response {
  return jsonResponse(
    { error: { code: 7, message: "Unit type does not match the stored unit" } },
    { status: 400 },
  );
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status: 200,
    ...init,
  });
}
