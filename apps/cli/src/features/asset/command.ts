import { Command } from "commander";
import { executeCommand, present, type JsonOption } from "../../command.js";
import { WorkspaceAssetFeature } from "./download.js";

export function createAssetCommand(feature: WorkspaceAssetFeature): Command {
  const root = new Command("asset").description("Download Unit-referenced Workspace Assets");
  const download = new Command("download")
    .argument("<output>")
    .requiredOption("--id <file-id>")
    .requiredOption("--worktree <id>")
    .option("--force")
    .option("--json")
    .action(
      async (
        outputPath: string,
        options: JsonOption & {
          readonly force?: boolean;
          readonly id: string;
          readonly worktree: string;
        },
      ) => {
        const value = {
          download: await executeCommand(
            download,
            async () =>
              await feature.download({
                assetId: options.id,
                outputPath,
                worktreeId: options.worktree,
                ...(options.force === true ? { force: true } : {}),
              }),
          ),
        };
        present(download, options, value);
      },
    );
  return root.addCommand(download);
}
