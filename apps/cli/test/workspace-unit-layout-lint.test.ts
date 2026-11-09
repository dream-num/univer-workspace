import type { WorkspaceUnitLayoutLintFeature } from "@univerjs/univer-workspace-client-core";
import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceUnitLayoutLintCommand } from "../src/features/lint/command.js";

describe("Workspace Slide and Board layout lint command", () => {
  it.each([
    ["slide", ["--worktree", "wt-1"], { kind: "worktree", worktreeId: "wt-1" }],
    ["board", ["--worktree", "wt-1"], { kind: "worktree", worktreeId: "wt-1" }],
    ["slide", ["--trunk"], { kind: "trunk" }],
    ["board", ["--trunk"], { kind: "trunk" }],
  ] as const)("maps %s scope %j and preserves JSON output", async (unitType, scopeArgs, scope) => {
    const loadUnit = vi.fn<WorkspaceUnitLayoutLintFeature["loadUnit"]>(
      async () =>
        ({
          unitType,
          unitData: {
            id: "deck-1",
            slideOrder: ["cover"],
            slides: { cover: { id: "cover", elements: {} } },
          },
        }) as never,
    );
    const report = {
      kind: "unit-layout-lint",
      unitId: "deck-1",
      unitType,
      findings: [],
      ...(unitType === "board" ? { coverage: { complete: true }, status: "clean" } : {}),
    };
    const lint = vi.fn(async () => report as never);
    const feature: Pick<WorkspaceUnitLayoutLintFeature, "lint" | "loadUnit"> = {
      lint: () => ({ lint }),
      loadUnit,
    };
    const output: string[] = [];
    const command = createWorkspaceUnitLayoutLintCommand(feature);
    command.exitOverride().configureOutput({ writeOut: (text) => output.push(text) });
    const program = new Command("test").addCommand(command);

    await program.parseAsync(
      [
        "lint",
        ...scopeArgs,
        "--unit",
        "deck-1",
        "--json",
        ...(unitType === "board" ? ["--mode", "model"] : []),
      ],
      {
        from: "user",
      },
    );

    expect(loadUnit).toHaveBeenCalledWith({
      scope,
      unitId: "deck-1",
    });
    expect(lint).toHaveBeenCalledWith(
      expect.objectContaining({ unitType, ...(unitType === "board" ? { mode: "model" } : {}) }),
    );
    expect(JSON.parse(output.join(""))).toEqual(report);
  });

  it.each([
    { scopeArgs: [] },
    { scopeArgs: ["--worktree", " "] },
    { scopeArgs: ["--trunk", "--worktree", "wt-1"] },
  ])("rejects an invalid scope $scopeArgs before loading content", async ({ scopeArgs }) => {
    const loadUnit = vi.fn();
    const lint = vi.fn();
    const command = createWorkspaceUnitLayoutLintCommand({ lint: () => ({ lint }), loadUnit });
    command
      .exitOverride()
      .configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
    const program = new Command("test").addCommand(command);

    await expect(
      program.parseAsync(["lint", ...scopeArgs, "--unit", "board-1", "--json"], { from: "user" }),
    ).rejects.toMatchObject({ exitCode: 1 });

    expect(loadUnit).not.toHaveBeenCalled();
    expect(lint).not.toHaveBeenCalled();
  });

  it("returns incomplete Board evidence in one JSON error and exits 2", async () => {
    const report = {
      kind: "unit-layout-lint",
      unitId: "board-1",
      unitType: "board",
      findings: [],
      status: "incomplete",
      coverage: { complete: false, incomplete: [{ reason: "unresolved-route" }] },
    };
    const command = createWorkspaceUnitLayoutLintCommand({
      lint: () => ({ lint: async () => report as never }),
      loadUnit: async () => ({ unitType: "board", unitData: { id: "board-1" } }) as never,
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    command.exitOverride().configureOutput({
      writeOut: (text) => stdout.push(text),
      writeErr: (text) => stderr.push(text),
    });
    const program = new Command("test").addCommand(command);

    await expect(
      program.parseAsync(["lint", "--worktree", "wt-1", "--unit", "board-1", "--json"], {
        from: "user",
      }),
    ).rejects.toMatchObject({ exitCode: 2 });

    expect(stdout).toEqual([]);
    expect(JSON.parse(stderr.join(""))).toMatchObject({
      ok: false,
      error: { code: "UNIT_LAYOUT_LINT_BOARD_FAILED", details: { report } },
    });
  });

  it("requests read-only rendered label plans and retains them in the machine report", async () => {
    const labelPlan = { schemaVersion: 1, status: "ready", patches: [{ elementId: "edge-1" }] };
    const report = {
      kind: "unit-layout-lint",
      unitId: "board-1",
      unitType: "board",
      findings: [],
      status: "clean",
      coverage: { complete: true },
      analyses: [{ pageId: "page-1", labelPlan }],
    };
    const lint = vi.fn(async () => report as never);
    const command = createWorkspaceUnitLayoutLintCommand({
      lint: () => ({ lint }),
      loadUnit: async () => ({ unitType: "board", unitData: { id: "board-1" } }) as never,
    });
    const output: string[] = [];
    command.exitOverride().configureOutput({ writeOut: (text) => output.push(text) });
    await new Command("test")
      .addCommand(command)
      .parseAsync(
        [
          "lint",
          "--worktree",
          "wt-1",
          "--unit",
          "board-1",
          "--mode",
          "rendered",
          "--plan-labels",
          "--json",
        ],
        { from: "user" },
      );
    expect(lint).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "rendered", includeLabelPlan: true }),
    );
    expect(JSON.parse(output.join(""))).toEqual(report);
  });
});
