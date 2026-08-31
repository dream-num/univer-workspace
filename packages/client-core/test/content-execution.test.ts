import { describe, expect, it, vi } from "vitest";
import {
  WorkspaceContentExecutionFeature,
  type WorkspaceContentRuntimeOperations,
  type WorkspaceRuntimeTarget,
} from "../src/index.js";

const target: WorkspaceRuntimeTarget = {
  origin: "https://workspace.test",
  revision: 7,
  scope: { kind: "worktree", worktreeId: "wt-1" },
  unitId: "book-1",
  unitType: "sheet",
};

describe("Workspace content execution workflow", () => {
  it("prepares production bindings after resolving the selected target", async () => {
    const executeAndCommit = vi.fn(async () => ({ committed: false as const, value: "book-1" }));
    const resolveEditableRuntimeTarget = vi.fn(async () => target);
    const feature = new WorkspaceContentExecutionFeature(
      { resolveEditableRuntimeTarget },
      runtimeWith(executeAndCommit),
    );

    await expect(
      feature.execute({
        code: "return workbook.getId();",
        unitId: "book-1",
        worktreeId: "wt-1",
      }),
    ).resolves.toEqual({ committed: false, value: "book-1" });

    expect(resolveEditableRuntimeTarget).toHaveBeenCalledWith({
      unitId: "book-1",
      worktreeId: "wt-1",
    });
    expect(executeAndCommit).toHaveBeenCalledWith({
      code: [
        "const api = univerAPI;",
        'const workbook = api.getWorkbook("book-1");',
        'if (!workbook) throw new Error("Cannot find workbook book-1");',
        "return workbook.getId();",
      ].join("\n"),
      target,
    });
  });

  it("injects the selected Base facade with the current SDK prelude", async () => {
    const baseTarget: WorkspaceRuntimeTarget = {
      ...target,
      unitId: "base-1",
      unitType: "base",
    };
    const executeAndCommit = vi.fn(async () => ({ committed: false as const, value: "base-1" }));
    const feature = new WorkspaceContentExecutionFeature(
      { resolveEditableRuntimeTarget: async () => baseTarget },
      runtimeWith(executeAndCommit),
    );

    await expect(
      feature.execute({
        code: "return base.getId();",
        unitId: "base-1",
        worktreeId: "wt-1",
      }),
    ).resolves.toEqual({ committed: false, value: "base-1" });

    expect(executeAndCommit).toHaveBeenCalledWith({
      code: [
        "const api = univerAPI;",
        'const base = api.getBase("base-1");',
        'if (!base) throw new Error("Cannot find base base-1");',
        "return base.getId();",
      ].join("\n"),
      target: baseTarget,
    });
  });

  it("rejects a reserved binding before invoking the runtime", async () => {
    const executeAndCommit = vi.fn();
    const feature = new WorkspaceContentExecutionFeature(
      { resolveEditableRuntimeTarget: async () => target },
      runtimeWith(executeAndCommit),
    );

    await expect(
      feature.execute({
        code: "const workbook = 1;",
        unitId: "book-1",
        worktreeId: "wt-1",
      }),
    ).rejects.toMatchObject({ code: "CONTENT_EXECUTION_RESERVED_BINDING" });
    expect(executeAndCommit).not.toHaveBeenCalled();
  });

  it("rejects redeclaring the injected Base facade before invoking the runtime", async () => {
    const baseTarget: WorkspaceRuntimeTarget = {
      ...target,
      unitId: "base-1",
      unitType: "base",
    };
    const executeAndCommit = vi.fn();
    const feature = new WorkspaceContentExecutionFeature(
      { resolveEditableRuntimeTarget: async () => baseTarget },
      runtimeWith(executeAndCommit),
    );

    await expect(
      feature.execute({
        code: 'const base = api.getBase("base-1");',
        unitId: "base-1",
        worktreeId: "wt-1",
      }),
    ).rejects.toMatchObject({
      code: "CONTENT_EXECUTION_RESERVED_BINDING",
      details: { binding: "base", unitType: "base" },
    });
    expect(executeAndCommit).not.toHaveBeenCalled();
  });

  it("rejects a non-Slide Unit before invoking the runtime", async () => {
    const executeAndCommit = vi.fn();
    const feature = new WorkspaceContentExecutionFeature(
      { resolveEditableRuntimeTarget: async () => target },
      runtimeWith(executeAndCommit),
    );

    await expect(
      feature.executeSlide({
        code: "return presentation.getId();",
        unitId: "book-1",
        worktreeId: "wt-1",
      }),
    ).rejects.toMatchObject({ code: "WORKSPACE_CONTENT_UNIT_TYPE_UNSUPPORTED" });
    expect(executeAndCommit).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    {},
    { committed: "yes", value: null },
    { committed: false },
    { committed: true, revision: 0, status: "committed", value: null },
    { committed: true, revision: 8, status: "", value: null },
  ])("rejects malformed runtime result %#", async (result) => {
    const feature = new WorkspaceContentExecutionFeature(
      { resolveEditableRuntimeTarget: async () => target },
      runtimeWith(vi.fn(async () => result) as never),
    );

    await expect(
      feature.execute({ code: "return null", unitId: "book-1", worktreeId: "wt-1" }),
    ).rejects.toMatchObject({ code: "WORKSPACE_RUNTIME_RESULT_INVALID" });
  });
});

function runtimeWith(
  executeAndCommit: WorkspaceContentRuntimeOperations["executeAndCommit"],
): WorkspaceContentRuntimeOperations {
  return {
    executeAndCommit,
    executeRead: vi.fn(),
    exportUnitData: vi.fn(),
  };
}
