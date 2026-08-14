import { createUnitLayoutLintCommand } from "@univer-cli/unit-layout-lint-command";
import { Command } from "commander";
import type { WorkspaceUnitLayoutLintFeature } from "./unit-layout-lint.js";

interface WorkspaceUnitLayoutLintCommandOptions {
  readonly worktree: string;
}

export function createWorkspaceUnitLayoutLintCommand(
  feature: WorkspaceUnitLayoutLintFeature,
): Command {
  let command: Command;
  command = createUnitLayoutLintCommand({
    lint: feature.lint(),
    loadUnit: async ({ unitId }) => {
      const worktreeId = command.opts<WorkspaceUnitLayoutLintCommandOptions>().worktree.trim();
      return await feature.loadUnit({
        scope: { kind: "worktree", worktreeId },
        unitId,
      });
    },
  }).requiredOption("--worktree <worktree-id>", "Worktree containing the Slide Unit");
  return command;
}
