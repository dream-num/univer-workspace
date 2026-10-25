import { describe, expect, it, vi } from "vitest";
import {
  WorkspaceCompileMarkdownFeature,
  type WorkspaceMarkdownCompilation,
  type WorkspaceUnit,
} from "../src/index.js";

const compiled: WorkspaceMarkdownCompilation = {
  formatVersion: 1,
  targetUnitId: "doc-1",
  title: "Report",
  javascript: "return {};",
  diagnostics: [],
  sourceMap: [],
};
const unit = { unitId: "server-doc", worktreeId: "wt-1" } as WorkspaceUnit;
const runtimeMap = [
  {
    id: "intro",
    kind: "paragraph",
    source: { line: 1, column: 1, offset: 0, endOffset: 5 },
    paragraphIds: ["p-1"],
    objectIds: [],
  },
];

function setup(result = compiled) {
  const compile = vi.fn(async () => result);
  const materialize = vi.fn(async () => ({
    initialData: { id: "doc-1", rev: 1 },
    value: { sourceMap: runtimeMap },
  }));
  const create = vi.fn(async () => unit);
  const execute = vi.fn(async () => ({
    committed: true,
    revision: 4,
    value: { sourceMap: runtimeMap },
  }));
  return {
    compile,
    materialize,
    create,
    execute,
    feature: new WorkspaceCompileMarkdownFeature({
      compile,
      materializer: { materialize },
      units: { create },
      contentExecution: { execute },
    }),
  };
}

describe("Workspace Markdown generation", () => {
  it("compiles without creating remote state", async () => {
    const { feature, compile, create, materialize, execute } = setup();
    expect(await feature.execute({ file: "report.md" })).toEqual({ ...compiled, committed: false });
    expect(compile).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
    expect(materialize).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("creates a staged Doc and returns the actual native ID mapping", async () => {
    const { feature, create, materialize } = setup();
    const result = await feature.execute({
      file: "report.md",
      apply: { spaceId: "s", worktreeId: "wt-1", idempotencyKey: "request-1" },
    });
    expect(result).toMatchObject({ committed: true, unit, materializedSourceMap: runtimeMap });
    expect(materialize).toHaveBeenCalledWith({
      javascript: compiled.javascript,
      targetUnitId: compiled.targetUnitId,
    });
    expect(create).toHaveBeenCalledWith({
      type: "doc",
      name: "Report",
      spaceId: "s",
      worktreeId: "wt-1",
      idempotencyKey: "request-1",
      initialData: { id: "doc-1", rev: 1 },
    });
  });

  it("updates selected stable IDs without a revision precondition and retains returned metadata", async () => {
    const { feature, compile, execute, create } = setup();
    const result = await feature.execute({
      file: "update.md",
      update: {
        unitId: "doc-1",
        worktreeId: "wt-1",
        blockIds: ["intro"],
        sourceMap: runtimeMap,
      },
    });
    expect(compile).toHaveBeenCalledWith("update.md", {
      targetUnitId: "doc-1",
      update: { sourceMap: runtimeMap, blockIds: ["intro"] },
    });
    expect(execute).toHaveBeenCalledWith({
      unitId: "doc-1",
      worktreeId: "wt-1",
      code: compiled.javascript,
    });
    expect(result.materializedSourceMap).toEqual(runtimeMap);
    expect(result.execution?.revision).toBe(4);
    expect(create).not.toHaveBeenCalled();
  });

  it("prevents compiler errors from reaching either write path", async () => {
    const { feature, create, execute, materialize } = setup({
      ...compiled,
      diagnostics: [{ severity: "error", code: "bad", message: "bad source" }],
    });
    await expect(
      feature.execute({ file: "bad.md", apply: { spaceId: "s", worktreeId: "wt" } }),
    ).rejects.toMatchObject({ code: "workspace-markdown-diagnostics" });
    expect(create).not.toHaveBeenCalled();
    expect(materialize).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
