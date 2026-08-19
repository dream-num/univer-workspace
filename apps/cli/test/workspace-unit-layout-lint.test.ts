import type {
  UniverSlideLayoutCapture,
  UniverSlideLayoutRuntime,
} from "@univer-cli/univer-render-runtime";
import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceUnitLayoutLintCommand } from "../src/features/lint/command.js";
import { WorkspaceUnitLayoutLintFeature } from "../src/features/lint/unit-layout-lint.js";
import { UNIVER_LICENSE } from "../src/license.js";

describe("Workspace Slide layout lint", () => {
  it("maps the explicit Worktree target and closes the browser runtime", async () => {
    const source = {
      loadUnit: vi.fn(async () => ({
        unitType: "slide",
        unitData: {
          id: "deck-1",
          slideOrder: ["cover"],
          slides: { cover: { id: "cover", elements: {} } },
        },
      })),
    };
    const runtime = slideRuntime({
      pages: [
        {
          page: 1,
          pageId: "cover",
          pageWidth: 960,
          pageHeight: 540,
          elements: [],
        },
      ],
    });
    const createRuntime = vi.fn(async () => runtime);
    const command = createWorkspaceUnitLayoutLintCommand(
      new WorkspaceUnitLayoutLintFeature({
        renderPageRoot: "/render-runtime",
        createRuntime,
        env: {},
        source,
      }),
    );
    const output: string[] = [];
    command.exitOverride().configureOutput({ writeOut: (text) => output.push(text) });
    const program = new Command("test").addCommand(command);

    await program.parseAsync(["lint", "--worktree", "wt-1", "--unit", "deck-1", "--json"], {
      from: "user",
    });

    expect(source.loadUnit).toHaveBeenCalledWith({
      scope: { kind: "worktree", worktreeId: "wt-1" },
      unitId: "deck-1",
    });
    expect(JSON.parse(output.join(""))).toMatchObject({
      kind: "unit-layout-lint",
      unitId: "deck-1",
      unitType: "slide",
      findings: [],
    });
    expect(createRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        renderPageRoot: "/render-runtime",
        license: UNIVER_LICENSE,
      }),
    );
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it("rejects a non-Slide target before creating a browser runtime", async () => {
    const createRuntime = vi.fn(async () => slideRuntime({ pages: [] }));
    const feature = new WorkspaceUnitLayoutLintFeature({
      renderPageRoot: "/render-runtime",
      createRuntime,
      env: {},
      source: { loadUnit: async () => ({ unitType: "doc", unitData: { id: "doc-1" } }) },
    });

    await expect(
      feature.loadUnit({ scope: { kind: "worktree", worktreeId: "wt-1" }, unitId: "doc-1" }),
    ).rejects.toMatchObject({ code: "workspace-unit-layout-lint-unit-type-unsupported" });
    expect(createRuntime).not.toHaveBeenCalled();
  });
});

function slideRuntime(
  capture: UniverSlideLayoutCapture,
): UniverSlideLayoutRuntime & { close(): Promise<void> } {
  return {
    captureSlideLayout: vi.fn(async () => capture),
    close: vi.fn(async () => undefined),
  };
}
