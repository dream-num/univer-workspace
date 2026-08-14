import { describe, expect, it, vi } from "vitest";
import { WorkspaceContentExecutionFeature } from "../src/features/content/execution.js";
import type { WorkspaceRuntimeTarget } from "../src/runtime/target.js";

const target: WorkspaceRuntimeTarget = {
  origin: "https://workspace.test",
  revision: 7,
  scope: { kind: "worktree", worktreeId: "wt-1" },
  unitId: "book-1",
  unitType: "sheet",
};

describe("Workspace content execution adapter", () => {
  it("prepares production bindings after resolving the selected target", async () => {
    const request = vi.fn(async () => ({ committed: false, value: "book-1" }));
    const resolveEditableRuntimeTarget = vi.fn(async () => target);
    const feature = new WorkspaceContentExecutionFeature(
      { resolveEditableRuntimeTarget },
      { request },
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
    expect(request).toHaveBeenCalledWith("runtime.execute-and-commit", {
      code: [
        "const api = univerAPI;",
        'const workbook = api.getWorkbook("book-1");',
        'if (!workbook) throw new Error("Cannot find workbook book-1");',
        "return workbook.getId();",
      ].join("\n"),
      target: {
        origin: "https://workspace.test",
        revision: 7,
        scope: { kind: "worktree", worktreeId: "wt-1" },
        unitId: "book-1",
        unitType: "sheet",
      },
    });
  });

  it("rejects a reserved binding before making the daemon request", async () => {
    const request = vi.fn(async () => ({ committed: false, value: null }));
    const feature = new WorkspaceContentExecutionFeature(
      { resolveEditableRuntimeTarget: async () => target },
      { request },
    );

    await expect(
      feature.execute({
        code: "const workbook = 1;",
        unitId: "book-1",
        worktreeId: "wt-1",
      }),
    ).rejects.toMatchObject({ code: "CONTENT_EXECUTION_RESERVED_BINDING" });
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects a non-Slide Unit through the SVG-specific execution seam", async () => {
    const request = vi.fn(async () => ({ committed: false, value: null }));
    const feature = new WorkspaceContentExecutionFeature(
      { resolveEditableRuntimeTarget: async () => target },
      { request },
    );

    await expect(
      feature.executeSlide({
        code: "return presentation.getId();",
        unitId: "book-1",
        worktreeId: "wt-1",
      }),
    ).rejects.toMatchObject({ code: "WORKSPACE_CONTENT_UNIT_TYPE_UNSUPPORTED" });
    expect(request).not.toHaveBeenCalled();
  });
});
