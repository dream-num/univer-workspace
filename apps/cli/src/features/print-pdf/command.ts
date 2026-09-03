import type {
  WorkspacePrintPdfApplication,
  WorkspaceRuntimeScope,
} from "@univerjs/univer-workspace-client-core";
import { Command, Option } from "commander";
import { executeCommand, present, type JsonOption } from "../../command.js";
import { workspaceError } from "../../errors.js";

interface WorkspacePrintPdfCommandOptions extends JsonOption {
  readonly trunk?: boolean;
  readonly unit: string;
  readonly worktree?: string;
}

/** Compose remote Workspace scope selection around Unit PDF printing. */
export function createWorkspacePrintPdfCommand(
  application: WorkspacePrintPdfApplication,
): Command {
  const command = new Command("print-pdf")
    .description("Print a Workspace Unit to PDF")
    .argument("<output.pdf>", "output PDF file")
    .requiredOption("--unit <unit-id>", "Unit to print")
    .addOption(
      new Option("--worktree <worktree-id>", "print the Unit from a Worktree").conflicts(
        "trunk",
      ),
    )
    .addOption(new Option("--trunk", "print the Unit from trunk").conflicts("worktree"))
    .option("--json", "write a structured output summary as JSON")
    .action(async (destination: string, options: WorkspacePrintPdfCommandOptions) => {
      const result = await executeCommand(
        command,
        async () =>
          await application.print({
            destination,
            scope: printScope(options),
            unitId: options.unit,
          }),
      );
      present(command, options, result, result.location);
    });
  return command;
}

function printScope(options: WorkspacePrintPdfCommandOptions): WorkspaceRuntimeScope {
  if (options.trunk === true) return { kind: "trunk" };
  const worktreeId = options.worktree?.trim();
  if (worktreeId !== undefined && worktreeId !== "") {
    return { kind: "worktree", worktreeId };
  }
  throw workspaceError(
    "workspace-print-pdf-scope-required",
    "Workspace PDF printing requires --worktree <worktree-id> or --trunk.",
  );
}
