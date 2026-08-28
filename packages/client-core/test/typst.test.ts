import type { CompileDocTypstBundleResult } from "@univer-cli/doc-typst-facade";
import { describe, expect, it, vi } from "vitest";
import {
  WorkspaceApplicationError,
  WorkspaceCompileTypstFeature,
  WorkspaceResultUnknownError,
  type WorkspaceCompileTypstDependencies,
  type WorkspaceUnit,
} from "../src/index.js";

const compiled: CompileDocTypstBundleResult = {
  diagnostics: [],
  javascript: "return Promise.resolve();",
  previews: [],
  targetUnitId: "typst-doc",
  title: "Compiled paper",
};
type CreateInput = Parameters<WorkspaceCompileTypstDependencies["units"]["create"]>[0];

describe("Workspace Typst compilation", () => {
  it.each([
    [undefined, {}],
    ["relative/previews", { previewDir: "relative/previews" }],
    ["path with spaces/previews", { previewDir: "path with spaces/previews" }],
    ["/absolute/previews", { previewDir: "/absolute/previews" }],
  ] as const)("compiles once with exact preview input %s and no Workspace side effects", async (previewDir, options) => {
    const diagnostic = { reason: "notice", severity: "info" as const, sourcePath: "page.typ" };
    const preview = { pageId: "page-1", path: "preview.svg", sourcePath: "page.typ" };
    const result = {
      ...compiled,
      diagnostics: [diagnostic],
      extra: { nested: true },
      previews: [preview],
    } as CompileDocTypstBundleResult & { readonly extra: { readonly nested: boolean } };
    const compile = vi.fn(async () => result);
    const materialize = vi.fn();
    const create = vi.fn();
    const feature = createFeature({ compile, materializer: { materialize }, units: { create } });

    const operation = feature.execute({
      bundlePath: " exact/bundle path ",
      ...(previewDir === undefined ? {} : { previewDir }),
    });
    await expect(operation).resolves.toEqual({ ...result, committed: false });
    expect(compile).toHaveBeenCalledOnce();
    expect(compile).toHaveBeenCalledWith(" exact/bundle path ", options);
    expect((await operation).diagnostics).toBe(result.diagnostics);
    expect((await operation).previews).toBe(result.previews);
    expect(materialize).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("returns compile-only errors and all compiler artifacts without side effects", async () => {
    const diagnostics = [
      { reason: "unsupported", severity: "error" as const, sourcePath: "page.typ" },
      { reason: "approximate", severity: "warning" as const, sourcePath: "page.typ" },
    ];
    const result = { ...compiled, diagnostics };
    const materialize = vi.fn();
    const create = vi.fn();
    const feature = createFeature({
      compile: vi.fn(async () => result),
      materializer: { materialize },
      units: { create },
    });

    await expect(feature.execute({ bundlePath: "paper" })).resolves.toEqual({
      ...result,
      committed: false,
    });
    expect(materialize).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("propagates compiler rejection without retry or side effects", async () => {
    const failure = new Error("compile failed");
    const compile = vi.fn(async () => {
      throw failure;
    });
    const materialize = vi.fn();
    const create = vi.fn();
    const feature = createFeature({ compile, materializer: { materialize }, units: { create } });

    await expect(feature.execute({ bundlePath: "paper" })).rejects.toBe(failure);
    expect(compile).toHaveBeenCalledOnce();
    expect(materialize).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("blocks apply on errors with exact error-only detail", async () => {
    const error1 = { reason: "first", severity: "error" as const, sourcePath: "one.typ" };
    const warning = { reason: "warn", severity: "warning" as const, sourcePath: "one.typ" };
    const error2 = { reason: "second", severity: "error" as const, sourcePath: "two.typ" };
    const compile = vi.fn(async () => ({ ...compiled, diagnostics: [warning, error1, error2] }));
    const materialize = vi.fn();
    const create = vi.fn();
    const feature = createFeature({ compile, materializer: { materialize }, units: { create } });

    const failure = await feature
      .execute({
        apply: { spaceId: "space-1", worktreeId: "wt-1" },
        bundlePath: "paper",
      })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(WorkspaceApplicationError);
    expect(failure).toMatchObject({
      code: "workspace-typst-diagnostics",
      detail: { diagnostics: [error1, error2] },
      message: "Typst compilation contains 2 error diagnostic(s); no Unit was created.",
    });
    expect(compile).toHaveBeenCalledOnce();
    expect(materialize).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("allows warnings and uses the same compiled program exactly once", async () => {
    const warning = { reason: "approximate", severity: "warning" as const, sourcePath: "page.typ" };
    const result = { ...compiled, diagnostics: [warning] };
    const compile = vi.fn(async () => result);
    const materialized = {
      initialData: { id: "typst-doc", name: "Runtime paper", rev: 1 },
      name: "Runtime paper",
    };
    const materialize = vi.fn(async () => materialized);
    const create = vi.fn(async () => unit());
    const feature = createFeature({ compile, materializer: { materialize }, units: { create } });

    await expect(
      feature.execute({
        apply: { spaceId: "space-1", worktreeId: "wt-1" },
        bundlePath: "paper",
      }),
    ).resolves.toEqual({ ...result, committed: true, unit: unit() });
    expect(compile).toHaveBeenCalledOnce();
    expect(materialize).toHaveBeenCalledOnce();
    expect(materialize).toHaveBeenCalledWith({
      javascript: result.javascript,
      targetUnitId: result.targetUnitId,
    });
    expect(create).toHaveBeenCalledOnce();
  });
});

describe("Workspace Typst apply", () => {
  it("creates one staged Doc with exact materialized data and caller identity", async () => {
    const compile = vi.fn(async () => compiled);
    const initialData = { body: { dataStream: "content" }, id: "typst-doc", rev: 1 };
    const materialize = vi.fn(async () => ({ initialData, name: "  Materialized name  " }));
    const serverUnit = unit();
    const create = vi.fn(async (_input: CreateInput) => serverUnit);
    const feature = createFeature({ compile, materializer: { materialize }, units: { create } });

    await expect(
      feature.execute({
        apply: {
          idempotencyKey: " request-1 ",
          parentNodeId: " parent-1 ",
          spaceId: " space-1 ",
          worktreeId: " worktree-1 ",
        },
        bundlePath: " bundle ",
      }),
    ).resolves.toEqual({ ...compiled, committed: true, unit: serverUnit });
    expect(compile).toHaveBeenCalledOnce();
    expect(materialize).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith({
      idempotencyKey: " request-1 ",
      initialData,
      name: "  Materialized name  ",
      parentNodeId: " parent-1 ",
      spaceId: " space-1 ",
      type: "doc",
      worktreeId: " worktree-1 ",
    });
    expect(create.mock.calls[0]![0].initialData).toBe(initialData);
    expect(serverUnit.unitId).not.toBe(compiled.targetUnitId);
  });

  it("uses compiled title and omits optional create fields when materialized name is absent", async () => {
    const create = vi.fn(async (_input: CreateInput) => unit());
    const feature = createFeature({
      materializer: { materialize: async () => ({ initialData: { id: "typst-doc" } }) },
      units: { create },
    });
    await feature.execute({
      apply: { spaceId: "space-1", worktreeId: "wt-1" },
      bundlePath: "paper",
    });
    expect(create).toHaveBeenCalledWith({
      initialData: { id: "typst-doc" },
      name: compiled.title,
      spaceId: "space-1",
      type: "doc",
      worktreeId: "wt-1",
    });
    expect(create.mock.calls[0]![0]).not.toHaveProperty("idempotencyKey");
    expect(create.mock.calls[0]![0]).not.toHaveProperty("parentNodeId");
  });

  it.each([
    [
      "result mismatch",
      new WorkspaceApplicationError("workspace-result-mismatch", "different Unit"),
    ],
    ["result unknown", new WorkspaceResultUnknownError("response lost")],
    ["ordinary failure", new Error("network failed")],
  ])("propagates %s without replay", async (_, failure) => {
    const compile = vi.fn(async () => compiled);
    const materialize = vi.fn(async () => ({ initialData: { id: "typst-doc" } }));
    const create = vi.fn(async () => {
      throw failure;
    });
    const feature = createFeature({ compile, materializer: { materialize }, units: { create } });

    await expect(
      feature.execute({
        apply: { idempotencyKey: "stable", spaceId: "space-1", worktreeId: "wt-1" },
        bundlePath: "paper",
      }),
    ).rejects.toBe(failure);
    expect(compile).toHaveBeenCalledOnce();
    expect(materialize).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
  });

  it("does not create or replay when materialization fails", async () => {
    const failure = new Error("materialization failed");
    const compile = vi.fn(async () => compiled);
    const materialize = vi.fn(async () => {
      throw failure;
    });
    const create = vi.fn();
    const feature = createFeature({ compile, materializer: { materialize }, units: { create } });

    await expect(
      feature.execute({
        apply: { spaceId: "space-1", worktreeId: "wt-1" },
        bundlePath: "paper",
      }),
    ).rejects.toBe(failure);
    expect(compile).toHaveBeenCalledOnce();
    expect(materialize).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
  });
});

function createFeature(
  overrides: Partial<WorkspaceCompileTypstDependencies> = {},
): WorkspaceCompileTypstFeature {
  return new WorkspaceCompileTypstFeature({
    compile: async () => compiled,
    materializer: { materialize: async () => ({ initialData: { id: "typst-doc" } }) },
    units: { create: async () => unit() },
    ...overrides,
  });
}

function unit(): WorkspaceUnit {
  return {
    activationState: "notApplicable",
    change: "added",
    draftHeadRevision: 1,
    mergeResult: "pending",
    name: "Runtime paper",
    nodeId: "node-1",
    resourceId: "resource-1",
    source: "worktree",
    target: { parentNodeId: null, spaceId: "space-1" },
    type: "doc",
    unitId: "server-unit-1",
    worktreeId: "wt-1",
  };
}
