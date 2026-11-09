import { createUnitLayoutLintCommand } from "@univer-cli/unit-layout-lint-command";
import type {
  WorkspaceRuntimeScope,
  WorkspaceUnitLayoutLintFeature,
} from "@univerjs/univer-workspace-client-core";
import { Option, type Command } from "commander";
import { workspaceError } from "../../errors.js";

interface WorkspaceUnitLayoutLintCommandOptions {
  readonly trunk?: boolean;
  readonly worktree?: string;
}

export function createWorkspaceUnitLayoutLintCommand(
  feature: Pick<WorkspaceUnitLayoutLintFeature, "lint" | "loadUnit">,
): Command {
  let command: Command;
  command = createUnitLayoutLintCommand({
    lint: feature.lint(),
    loadUnit: async ({ unitId }) => {
      return await feature.loadUnit({
        scope: lintScope(command.opts<WorkspaceUnitLayoutLintCommandOptions>()),
        unitId,
      });
    },
  });
  command.addOption(
    new Option("--worktree <worktree-id>", "check the Unit from a Worktree").conflicts("trunk"),
  );
  command.addOption(new Option("--trunk", "check the Unit from trunk").conflicts("worktree"));
  return command;
}

function lintScope(options: WorkspaceUnitLayoutLintCommandOptions): WorkspaceRuntimeScope {
  if (options.trunk === true) return { kind: "trunk" };
  const worktreeId = options.worktree?.trim();
  if (worktreeId !== undefined && worktreeId !== "") {
    return { kind: "worktree", worktreeId };
  }
  throw workspaceError(
    "workspace-unit-layout-lint-scope-required",
    "Workspace layout lint requires --worktree <worktree-id> or --trunk.",
  );
}
