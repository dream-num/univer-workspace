import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compileDocTypstBundle,
  type CompileDocTypstBundleResult,
} from "@univer-cli/doc-typst-facade";
import { WorkspaceCompileTypstFeature } from "../src/features/typst/compile.js";
import { HeadlessWorkspaceTypstMaterializer } from "../src/features/typst/materialize.js";
import type { WorkspaceUnit } from "../src/features/worktree/model.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (directory) => await rm(directory, { force: true, recursive: true })),
  );
});

const compiled: CompileDocTypstBundleResult = {
  diagnostics: [],
  javascript: "return Promise.resolve();",
  previews: [],
  targetUnitId: "typst-doc",
  title: "Compiled paper",
};

const unit: WorkspaceUnit = {
  activationState: "notApplicable",
  change: "added",
  draftHeadRevision: 1,
  mergeResult: "pending",
  name: "Runtime paper",
  nodeId: "node-1",
  resourceId: "resource-1",
  source: "worktree",
  target: { parentNodeId: "parent-1", spaceId: "space-1" },
  type: "doc",
  unitId: "unit-1",
  worktreeId: "worktree-1",
};

describe("WorkspaceCompileTypstFeature", () => {
  it("materializes compiler output through the standard headless Doc Facade", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workspace-typst-materialize-"));
    temporaryDirectories.push(directory);
    await mkdir(join(directory, "pages"));
    await writeFile(join(directory, "pages", "one.typ"), "= Hello\n\nWorld", "utf8");
    await writeFile(
      join(directory, "typst.json"),
      JSON.stringify({
        pages: ["pages/one.typ"],
        schemaVersion: 1,
        targetUnitId: "materialized-doc",
        title: "Materialized paper",
      }),
      "utf8",
    );

    const output = await compileDocTypstBundle(directory);
    const first = await new HeadlessWorkspaceTypstMaterializer().materialize(output);
    const second = await new HeadlessWorkspaceTypstMaterializer().materialize(output);

    expect(first.initialData).toMatchObject({ id: "materialized-doc", rev: 1 });
    expect(first.initialData).toEqual(second.initialData);
  });

  it("compiles once, materializes complete UnitData, and creates one staged Doc", async () => {
    const compile = vi.fn(async () => compiled);
    const materialize = vi.fn(async () => ({
      initialData: { id: "typst-doc", name: "Runtime paper", rev: 1 },
      name: "Runtime paper",
    }));
    const create = vi.fn(async () => unit);
    const feature = new WorkspaceCompileTypstFeature({
      compile,
      materializer: { materialize },
      units: { create },
    });

    await expect(
      feature.execute({
        bundlePath: "paper",
        previewDir: "previews",
        apply: {
          idempotencyKey: "request-1",
          parentNodeId: "parent-1",
          spaceId: "space-1",
          worktreeId: "worktree-1",
        },
      }),
    ).resolves.toEqual({ ...compiled, committed: true, unit });
    expect(compile).toHaveBeenCalledOnce();
    expect(compile).toHaveBeenCalledWith("paper", { previewDir: "previews" });
    expect(materialize).toHaveBeenCalledWith({
      javascript: compiled.javascript,
      targetUnitId: "typst-doc",
    });
    expect(create).toHaveBeenCalledWith({
      idempotencyKey: "request-1",
      initialData: { id: "typst-doc", name: "Runtime paper", rev: 1 },
      name: "Runtime paper",
      parentNodeId: "parent-1",
      spaceId: "space-1",
      type: "doc",
      worktreeId: "worktree-1",
    });
  });

  it("does not materialize or create a Unit when compilation reports an error", async () => {
    const materialize = vi.fn();
    const create = vi.fn();
    const feature = new WorkspaceCompileTypstFeature({
      compile: async () => ({
        ...compiled,
        diagnostics: [{ reason: "unsupported", severity: "error", sourcePath: "page.typ" }],
      }),
      materializer: { materialize },
      units: { create },
    });

    await expect(
      feature.execute({
        bundlePath: "paper",
        apply: { spaceId: "space-1", worktreeId: "worktree-1" },
      }),
    ).rejects.toMatchObject({ code: "workspace-typst-diagnostics" });
    expect(materialize).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("keeps compile-only mode free of Workspace side effects", async () => {
    const materialize = vi.fn();
    const create = vi.fn();
    const feature = new WorkspaceCompileTypstFeature({
      compile: async () => compiled,
      materializer: { materialize },
      units: { create },
    });

    await expect(feature.execute({ bundlePath: "paper" })).resolves.toEqual({
      ...compiled,
      committed: false,
    });
    expect(materialize).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
