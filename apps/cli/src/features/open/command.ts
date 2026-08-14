import { Command } from "commander";
import { executeCommand, present, type JsonOption } from "../../command.js";
import { WorkspaceOpenFeature } from "./open.js";

export function createOpenCommand(feature: WorkspaceOpenFeature): Command {
  const command = new Command("open")
    .description("Print a review URL for one Worktree Unit")
    .requiredOption("--worktree <id>")
    .option("--unit <id>")
    .option("--viewer-url <url>")
    .option("--json")
    .action(
      async (
        options: JsonOption & {
          readonly unit?: string;
          readonly viewerUrl?: string;
          readonly worktree: string;
        },
      ) => {
        const result = await executeCommand(
          command,
          async () =>
            await feature.createUrl({
              worktreeId: options.worktree,
              ...(options.unit === undefined ? {} : { unitId: options.unit }),
              ...(options.viewerUrl === undefined ? {} : { viewerBaseUrl: options.viewerUrl }),
            }),
        );
        present(
          command,
          options,
          { data: result, success: true },
          [
            `Worktree: ${result.worktreeId}`,
            `Unit: ${result.unitId} (${result.type})`,
            `URL: ${result.openUrl}`,
          ].join("\n"),
        );
      },
    );
  return command;
}
