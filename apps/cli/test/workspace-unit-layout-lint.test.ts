import type { WorkspaceUnitLayoutLintFeature } from "@univerjs/univer-workspace-client-core";
import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceUnitLayoutLintCommand } from "../src/features/lint/command.js";

describe("Workspace Slide layout lint command", () => {
  it("maps the explicit Worktree scope and preserves JSON output", async () => {
    const loadUnit = vi.fn<WorkspaceUnitLayoutLintFeature["loadUnit"]>(async () => ({
      unitType: "slide" as const,
      unitData: {
        id: "deck-1",
        slideOrder: ["cover"],
        slides: { cover: { id: "cover", elements: {} } },
      },
    }) as never);
    const lint = vi.fn(async () => ({
      kind: "unit-layout-lint" as const,
      unitId: "deck-1",
      unitType: "slide" as const,
      findings: [],
    }) as never);
    const feature: Pick<WorkspaceUnitLayoutLintFeature, "lint" | "loadUnit"> = {
      lint: () => ({ lint }),
      loadUnit,
    };
    const output: string[] = [];
    const command = createWorkspaceUnitLayoutLintCommand(feature);
    command.exitOverride().configureOutput({ writeOut: (text) => output.push(text) });
    const program = new Command("test").addCommand(command);

    await program.parseAsync(["lint", "--worktree", "wt-1", "--unit", "deck-1", "--json"], {
      from: "user",
    });

    expect(loadUnit).toHaveBeenCalledWith({
      scope: { kind: "worktree", worktreeId: "wt-1" },
      unitId: "deck-1",
    });
    expect(JSON.parse(output.join(""))).toEqual({
      kind: "unit-layout-lint",
      unitId: "deck-1",
      unitType: "slide",
      findings: [],
    });
  });
});
