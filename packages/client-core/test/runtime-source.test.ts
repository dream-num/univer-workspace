import { describe, expect, it } from "vitest";
import {
  WorkspaceContentSource,
  WorkspaceHttp,
  type WorkspaceUnitType,
  type WorkspaceWorktreeState,
} from "../src/index.js";

describe("Workspace runtime source resolution", () => {
  it("downloads a Worktree image Asset through its signed content URL", async () => {
    const requests: string[] = [];
    const source = contentSource(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      requests.push(url.toString());
      if (url.pathname.endsWith("/sign-url")) {
        return Response.json({ error: { code: 1, message: "" }, url: "https://cdn.test/image" });
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

  it("resolves a strictly parsed Worktree Unit target", async () => {
    const source = contentSource(async () => Response.json({ worktree: rawWorktree() }));
    await expect(source.resolveRuntimeTarget({ unitId: "book-1", worktreeId: "wt-1" })).resolves.toEqual({
      origin: "https://workspace.test",
      revision: 7,
      scope: { kind: "worktree", worktreeId: "wt-1" },
      unitId: "book-1",
      unitType: "sheet",
    });
  });

  it("rejects missing membership and non-Draft editability before Snapshot access", async () => {
    const requests: string[] = [];
    const missing = contentSource(async (input) => {
      requests.push(new URL(input instanceof Request ? input.url : input.toString()).pathname);
      return Response.json({ worktree: rawWorktree("draft", []) });
    });
    await expect(
      missing.resolveRuntimeTarget({ unitId: "missing", worktreeId: "wt-1" }),
    ).rejects.toMatchObject({ code: "WORKSPACE_UNIT_NOT_FOUND" });
    const ready = contentSource(async (input) => {
      requests.push(new URL(input instanceof Request ? input.url : input.toString()).pathname);
      return Response.json({ worktree: rawWorktree("ready") });
    });
    await expect(
      ready.resolveEditableRuntimeTarget({ unitId: "book-1", worktreeId: "wt-1" }),
    ).rejects.toMatchObject({
      code: "workspace-worktree-not-editable",
      detail: { state: "ready", worktreeId: "wt-1" },
    });
    expect(requests).toEqual(["/api/worktrees/wt-1", "/api/worktrees/wt-1"]);
  });

  it("probes wire types in Sheet, Doc, Slide, Base, Board order and stops on success", async () => {
    const requests: string[] = [];
    const source = contentSource(async (input) => {
      const path = new URL(input instanceof Request ? input.url : input.toString()).pathname;
      requests.push(path);
      const type = Number(path.split("/")[3]);
      return type === 6
        ? Response.json({ changesets: [], snapshot: snapshot("board", "unit/1", 9) })
        : unitTypeMismatch();
    });
    await expect(source.resolveTrunkRuntimeTarget({ unitId: "unit/1" })).resolves.toMatchObject({
      revision: 9,
      unitType: "board",
    });
    expect(requests).toEqual([2, 1, 3, 5, 6].map((type) => `/universer-api/snapshot/${type}/unit/unit%2F1/rev/0`));
  });

  it.each([
    [{ code: 7, message: "different" }, 400],
    [{ code: "OTHER", message: "Unit type does not match the stored unit" }, 400],
    [{ code: "NOT_FOUND", message: "The Unit was not found." }, 404],
  ])("does not probe after a non-mismatch failure %#", async (error, status) => {
    let requests = 0;
    const source = contentSource(async () => {
      requests += 1;
      return Response.json({ error }, { status });
    });
    await expect(source.resolveTrunkRuntimeTarget({ unitId: "missing" })).rejects.toMatchObject({
      code: String(error.code),
      message: error.message,
    });
    expect(requests).toBe(1);
  });

  it("returns the bounded unsupported-type error after five exact mismatches", async () => {
    let requests = 0;
    const source = contentSource(async () => {
      requests += 1;
      return unitTypeMismatch();
    });
    await expect(source.resolveTrunkRuntimeTarget({ unitId: "unknown" })).rejects.toMatchObject({
      code: "workspace-unit-type-unsupported",
      detail: {
        supportedUnitTypes: ["sheet", "doc", "slide", "base", "board"],
        unitId: "unknown",
      },
    });
    expect(requests).toBe(5);
  });

  it("uses exact scope-aware Unit and block endpoints and enforces the selected head", async () => {
    const requests: string[] = [];
    const source = contentSource(async (input) => {
      const path = new URL(input instanceof Request ? input.url : input.toString()).pathname;
      requests.push(path);
      if (path.endsWith("/block/block%2F1")) {
        return Response.json({ block: { data: "YmxvY2s=", id: "block/1" } });
      }
      return Response.json({
        changesets: [{ baseRev: 3, mutations: [], revision: 4, type: 2, unitID: "book/1" }],
        snapshot: snapshot("sheet", "book/1", 3),
      });
    });
    const target = {
      origin: "https://workspace.test",
      revision: 4,
      scope: { kind: "worktree" as const, worktreeId: "wt/1" },
      unitId: "book/1",
      unitType: "sheet" as const,
    };
    await expect(source.getUnit(target)).resolves.toMatchObject({ snapshot: { rev: 3 } });
    await expect(source.getSheetBlock(target, "block/1")).resolves.toMatchObject({
      data: Uint8Array.from([98, 108, 111, 99, 107]),
      id: "block/1",
    });
    await expect(source.getUnit({ ...target, revision: 5 })).rejects.toMatchObject({
      code: "WORKSPACE_RESPONSE_INVALID",
    });
    expect(requests).toEqual([
      "/universer-api/worktrees/wt%2F1/snapshot/2/unit/book%2F1/rev/0",
      "/universer-api/worktrees/wt%2F1/snapshot/2/unit/book%2F1/block/block%2F1",
      "/universer-api/worktrees/wt%2F1/snapshot/2/unit/book%2F1/rev/0",
    ]);
  });

  it.each(["sheet", "doc", "slide", "base", "board"] as const)(
    "strictly decodes %s metadata base64",
    async (unitType) => {
      const valid = contentSource(async () =>
        Response.json({ changesets: [], snapshot: snapshot(unitType, "unit-1", 1) }),
      );
      await expect(
        valid.getUnit({
          origin: "https://workspace.test",
          revision: 1,
          scope: { kind: "trunk" },
          unitId: "unit-1",
          unitType,
        }),
      ).resolves.toBeDefined();

      const invalidValue = snapshot(unitType, "unit-1", 1);
      const field = unitType === "sheet" || unitType === "base" ? "workbook" : unitType;
      (invalidValue[field] as Record<string, unknown>)["originalMeta"] = "bad!";
      const invalid = contentSource(async () =>
        Response.json({ changesets: [], snapshot: invalidValue }),
      );
      await expect(
        invalid.getUnit({
          origin: "https://workspace.test",
          revision: 1,
          scope: { kind: "trunk" },
          unitId: "unit-1",
          unitType,
        }),
      ).rejects.toMatchObject({ code: "WORKSPACE_RESPONSE_INVALID" });
    },
  );

  it("rejects invalid Sheet metadata, changeset identity, and serialized block base64", async () => {
    const target = {
      origin: "https://workspace.test",
      revision: 1,
      scope: { kind: "trunk" as const },
      unitId: "book-1",
      unitType: "sheet" as const,
    };
    const invalidSheet = snapshot("sheet", "book-1", 1);
    ((invalidSheet["workbook"] as Record<string, unknown>)["sheets"] as Record<string, unknown>)[
      "sheet-1"
    ] = { originalMeta: "YQ" };
    await expect(
      contentSource(async () => Response.json({ changesets: [], snapshot: invalidSheet })).getUnit(
        target,
      ),
    ).rejects.toMatchObject({ code: "WORKSPACE_RESPONSE_INVALID" });
    await expect(
      contentSource(async () =>
        Response.json({
          changesets: [{ baseRev: 0, mutations: [], revision: 1, type: 2, unitID: "other" }],
          snapshot: snapshot("sheet", "book-1", 0),
        }),
      ).getUnit(target),
    ).rejects.toMatchObject({ code: "WORKSPACE_RESPONSE_INVALID" });
    await expect(
      contentSource(async () => Response.json({ block: { data: "YQ===", id: "block-1" } })).getSheetBlock(
        target,
        "block-1",
      ),
    ).rejects.toMatchObject({ code: "WORKSPACE_RESPONSE_INVALID" });
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

function rawWorktree(
  state: WorkspaceWorktreeState = "draft",
  units: readonly Record<string, unknown>[] = [rawUnit()],
): Record<string, unknown> {
  return { id: "wt-1", name: "Draft", state, teamSpace: null, units };
}

function rawUnit(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    activationState: "notApplicable",
    change: "unchanged",
    draftHeadRevision: 7,
    mergeResult: "pending",
    name: "Sheet",
    nodeId: "node-1",
    resourceId: "resource-1",
    source: "trunk",
    target: null,
    unitId: "book-1",
    unitType: "sheet",
    ...overrides,
  };
}

function snapshot(type: WorkspaceUnitType, unitId: string, revision: number): Record<string, unknown> {
  const wire = { base: 5, board: 6, doc: 1, sheet: 2, slide: 3 }[type];
  if (type === "sheet" || type === "base") {
    return { rev: revision, type: wire, unitID: unitId, workbook: { originalMeta: "YQ==", sheets: {} } };
  }
  return {
    [type]: { originalMeta: "YQ==" },
    rev: revision,
    type: wire,
    unitID: unitId,
  };
}

function unitTypeMismatch(): Response {
  return Response.json(
    { error: { code: 7, message: "Unit type does not match the stored unit" } },
    { status: 400 },
  );
}
