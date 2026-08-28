import { UniverInstanceType } from "@univerjs/core";
import { describe, expect, it, vi } from "vitest";
import {
  createWorkspaceReferencedUnitProviderRegistration,
  createWorkspaceReferenceLoadContext,
  loadWorkspaceReferenceHostContext,
  readWorkspaceReferenceScope,
  selectWorkspaceReferenceScope,
  WorkspaceHttp,
  WORKSPACE_REFERENCED_UNIT_PROVIDER_ID,
  type WorkspaceRuntimeTarget,
  type WorkspaceSnapshotLoader,
} from "../src/index.js";

describe("Workspace reference host, context, and provider", () => {
  it("uses a zero-request trunk host and strictly loads mapped Worktree host membership", async () => {
    let requests = 0;
    const http = workspaceHttp(async () => {
      requests += 1;
      return Response.json({
        worktree: rawWorktree([
          rawUnit("host", 7),
          rawUnit("mapped-2", 4),
          rawUnit("mapped-1", 3),
        ]),
      });
    });
    await expect(
      loadWorkspaceReferenceHostContext(http, target({ kind: "trunk" })),
    ).resolves.toEqual({ mappedUnitIds: [], scope: { kind: "trunk" } });
    expect(requests).toBe(0);
    await expect(
      loadWorkspaceReferenceHostContext(http, target({ kind: "worktree", worktreeId: "wt-1" })),
    ).resolves.toEqual({
      mappedUnitIds: ["host", "mapped-2", "mapped-1"],
      scope: { kind: "worktree", worktreeId: "wt-1" },
    });
    expect(requests).toBe(1);
  });

  it("rejects missing and stale Worktree hosts", async () => {
    const missing = workspaceHttp(async () => Response.json({ worktree: rawWorktree([rawUnit("other", 7)]) }));
    await expect(
      loadWorkspaceReferenceHostContext(missing, target({ kind: "worktree", worktreeId: "wt-1" })),
    ).rejects.toMatchObject({ code: "workspace-unit-not-found" });
    const stale = workspaceHttp(async () => Response.json({ worktree: rawWorktree([rawUnit("host", 8)]) }));
    await expect(
      loadWorkspaceReferenceHostContext(stale, target({ kind: "worktree", worktreeId: "wt-1" })),
    ).rejects.toMatchObject({ code: "workspace-runtime-target-stale" });
  });

  it("selects mapped Worktree scope and trunk fallback", () => {
    const host = {
      mappedUnitIds: ["mapped"],
      scope: { kind: "worktree" as const, worktreeId: "wt-1" },
    };
    expect(selectWorkspaceReferenceScope(host, "mapped")).toEqual({
      kind: "worktree",
      unitId: "mapped",
      worktreeId: "wt-1",
    });
    expect(selectWorkspaceReferenceScope(host, "unmapped")).toEqual({ kind: "trunk", unitId: "unmapped" });
    expect(selectWorkspaceReferenceScope({ mappedUnitIds: ["mapped"], scope: { kind: "trunk" } }, "mapped")).toEqual({
      kind: "trunk",
      unitId: "mapped",
    });
    expect(() => selectWorkspaceReferenceScope(host, " ")).toThrowError(
      expect.objectContaining({ code: "workspace-reference-invalid-context" }),
    );
  });

  it("round trips exact v1 load contexts and rejects malformed or wrong-Unit metadata", () => {
    const trunk = createWorkspaceReferenceLoadContext({ kind: "trunk", unitId: "unit-1" });
    const worktree = createWorkspaceReferenceLoadContext({ kind: "worktree", unitId: "unit-1", worktreeId: "wt-1" });
    expect(trunk).toEqual({
      metadata: {
        "univer.workspace.reference-source-scope.v1": JSON.stringify({ version: 1, kind: "trunk", unitId: "unit-1" }),
      },
    });
    expect(readWorkspaceReferenceScope({}, "unit-1")).toBeUndefined();
    expect(readWorkspaceReferenceScope(trunk, "unit-1")).toEqual({ kind: "trunk", unitId: "unit-1" });
    expect(readWorkspaceReferenceScope(worktree, "unit-1")).toEqual({ kind: "worktree", unitId: "unit-1", worktreeId: "wt-1" });
    for (const encoded of [
      "not-json",
      "[]",
      JSON.stringify({ version: 2, kind: "trunk", unitId: "unit-1" }),
      JSON.stringify({ version: 1, kind: "other", unitId: "unit-1" }),
      JSON.stringify({ version: 1, kind: "trunk", unitId: "" }),
      JSON.stringify({ version: 1, kind: "worktree", unitId: "unit-1", worktreeId: "" }),
      JSON.stringify({ version: 1, kind: "trunk", unitId: "unit-1", extra: true }),
    ]) {
      expect(() => readWorkspaceReferenceScope({ metadata: { "univer.workspace.reference-source-scope.v1": encoded } })).toThrowError(
        expect.objectContaining({ code: "workspace-reference-invalid-load-context" }),
      );
    }
    expect(() => readWorkspaceReferenceScope(trunk, "other")).toThrowError(
      expect.objectContaining({ code: "workspace-reference-invalid-load-context" }),
    );
  });

  it.each([
    ["loadSheet", UniverInstanceType.UNIVER_SHEET, "sheet"],
    ["loadDoc", UniverInstanceType.UNIVER_DOC, "doc"],
    ["loadSlide", UniverInstanceType.UNIVER_SLIDE, "slide"],
    ["loadBase", UniverInstanceType.UNIVER_BASE, "base"],
    ["loadBoard", UniverInstanceType.UNIVER_BOARD, "board"],
  ] as const)("loads each supported Unit through %s with revision 0 and selected context", async (method, unitType, resourceType) => {
    const createOptions = { makeCurrent: false };
    const calls: unknown[][] = [];
    const loader = loaderFor(unitType, (args) => calls.push(args));
    const resolveSnapshotService = vi.fn(() => loader as never);
    const registration = createWorkspaceReferencedUnitProviderRegistration({
      hostContext: {
        mappedUnitIds: ["source-1"],
        scope: { kind: "worktree", worktreeId: "wt-1" },
      },
      resolveSnapshotService,
    });
    expect(registration).toMatchObject({
      match: { fileKinds: ["self"], unitTypes: ["sheet", "doc", "slide", "base", "board"] },
      priority: 100,
      registrationId: WORKSPACE_REFERENCED_UNIT_PROVIDER_ID,
    });
    await expect(
      registration.provider.ensureUnit({
        createOptions,
        ref: { file: { kind: "self" }, unit: { selector: "source-1", type: resourceType } },
        unitType,
      }),
    ).resolves.toEqual({ unitId: "source-1", unitType });
    expect(resolveSnapshotService).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    const [unitId, revision, context, options] = calls[0]!;
    expect([method, unitId, revision]).toEqual([method, "source-1", 0]);
    expect(readWorkspaceReferenceScope(context as never, "source-1")).toEqual({
      kind: "worktree",
      unitId: "source-1",
      worktreeId: "wt-1",
    });
    expect(options).toEqual({ createOptions });
  });

  it.each([
    ["aborted", { aborted: true, file: { kind: "self" }, selector: "source", type: "sheet", unitType: UniverInstanceType.UNIVER_SHEET }],
    ["unsupported-file-kind", { file: { kind: "relative", path: "file" }, selector: "source", type: "sheet", unitType: UniverInstanceType.UNIVER_SHEET }],
    ["unit-type-mismatch", { file: { kind: "self" }, selector: "source", type: "doc", unitType: UniverInstanceType.UNIVER_SHEET }],
    ["unsupported-unit-type", { file: { kind: "self" }, selector: "source", type: "unknown", unitType: 999 as UniverInstanceType }],
  ] as const)("rejects %s before resolving or loading", async (code, input) => {
    const resolveSnapshotService = vi.fn();
    const registration = createWorkspaceReferencedUnitProviderRegistration({
      hostContext: { mappedUnitIds: [], scope: { kind: "trunk" } },
      resolveSnapshotService,
    });
    await expect(
      registration.provider.ensureUnit({
        createOptions: {},
        ref: { file: input.file, unit: { selector: input.selector, type: input.type } } as never,
        ...("aborted" in input && input.aborted === true
          ? { signal: AbortSignal.abort() }
          : {}),
        unitType: input.unitType,
      }),
    ).rejects.toMatchObject({ code: `workspace-reference-${code}` });
    expect(resolveSnapshotService).not.toHaveBeenCalled();
  });

  it("rejects a loaded Unit with a different identity or type", async () => {
    for (const loaded of [
      { getUnitId: () => "other", type: UniverInstanceType.UNIVER_SHEET },
      { getUnitId: () => "source", type: UniverInstanceType.UNIVER_DOC },
    ]) {
      const registration = createWorkspaceReferencedUnitProviderRegistration({
        hostContext: { mappedUnitIds: [], scope: { kind: "trunk" } },
        resolveSnapshotService: () => ({ loadSheet: async () => loaded }) as never,
      });
      await expect(
        registration.provider.ensureUnit({
          createOptions: {},
          ref: { file: { kind: "self" }, unit: { selector: "source", type: "sheet" } },
          unitType: UniverInstanceType.UNIVER_SHEET,
        }),
      ).rejects.toMatchObject({ code: "workspace-reference-loaded-identity-mismatch" });
    }
  });

  it("allows an in-flight shared load to complete after abort", async () => {
    const controller = new AbortController();
    const registration = createWorkspaceReferencedUnitProviderRegistration({
      hostContext: { mappedUnitIds: [], scope: { kind: "trunk" } },
      resolveSnapshotService: () => ({
        loadSheet: async () => {
          controller.abort();
          return { getUnitId: () => "source", type: UniverInstanceType.UNIVER_SHEET };
        },
      }) as never,
    });
    await expect(
      registration.provider.ensureUnit({
        createOptions: {},
        ref: { file: { kind: "self" }, unit: { selector: "source", type: "sheet" } },
        signal: controller.signal,
        unitType: UniverInstanceType.UNIVER_SHEET,
      }),
    ).resolves.toEqual({ unitId: "source", unitType: UniverInstanceType.UNIVER_SHEET });
  });
});

function loaderFor(
  type: UniverInstanceType,
  record: (args: unknown[]) => void,
): WorkspaceSnapshotLoader {
  const loaded = { getUnitId: () => "source-1", type };
  const load = async (...args: unknown[]) => {
    record(args);
    return loaded;
  };
  return {
    loadBase: load,
    loadBoard: load,
    loadDoc: load,
    loadSheet: load,
    loadSlide: load,
  };
}

function target(scope: WorkspaceRuntimeTarget["scope"]): WorkspaceRuntimeTarget {
  return { origin: "https://workspace.test", revision: 7, scope, unitId: "host", unitType: "sheet" };
}

function workspaceHttp(fetcher: typeof fetch): WorkspaceHttp {
  return new WorkspaceHttp({ cookie: "workspace_session=test", fetcher, origin: "https://workspace.test", role: "worker" });
}

function rawWorktree(units: readonly Record<string, unknown>[]): Record<string, unknown> {
  return { id: "wt-1", name: "Draft", state: "draft", teamSpace: null, units };
}

function rawUnit(unitId: string, draftHeadRevision: number): Record<string, unknown> {
  return {
    activationState: "notApplicable",
    change: "unchanged",
    draftHeadRevision,
    mergeResult: "pending",
    name: unitId,
    nodeId: `node-${unitId}`,
    resourceId: `resource-${unitId}`,
    source: "trunk",
    target: null,
    unitId,
    unitType: "sheet",
  };
}
