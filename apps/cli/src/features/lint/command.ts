import { createUnitLayoutLintCommand } from "@univer-cli/unit-layout-lint-command";
import type { WorkspaceUnitLayoutLintFeature } from "@univerjs/univer-workspace-client-core";
import { Command } from "commander";

interface WorkspaceUnitLayoutLintCommandOptions {
  readonly worktree: string;
}

export function createWorkspaceUnitLayoutLintCommand(
  feature: Pick<WorkspaceUnitLayoutLintFeature, "lint" | "loadUnit">,
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
