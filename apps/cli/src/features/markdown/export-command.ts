import { readFile } from "node:fs/promises";
import {
  parseDocMarkdownSourceMap,
  writeWorkspaceMarkdownExport,
  type WorkspaceExportMarkdownFeature,
} from "@univerjs/univer-workspace-client-core";
import { Command } from "commander";
import { executeCommand, present, type JsonOption } from "../../command.js";
import { workspaceError } from "../../errors.js";

interface ExportMarkdownOptions extends JsonOption {
  readonly unit: string;
  readonly worktree: string;
  readonly sourceMap: string;
  readonly blocks: string;
  readonly out: string;
  readonly sourceMapOut?: string;
}

export function createWorkspaceExportMarkdownCommand(
  feature: Pick<WorkspaceExportMarkdownFeature, "execute">,
): Command {
  const command = new Command("export-markdown")
    .description(
      "Read selected current native Doc blocks as editable Markdown with resource sidecars",
    )
    .requiredOption("--worktree <id>", "read from this Worktree")
    .requiredOption("--unit <id>", "native Modern Doc to read")
    .requiredOption(
      "--source-map <json>",
      "materialized source map from generation or the previous export",
    )
    .requiredOption("--blocks <ids>", "comma-separated explicit block IDs to export")
    .requiredOption("--out <file.md>", "write Markdown and resource sidecars beside this file")
    .option(
      "--source-map-out <json>",
      "write the refreshed block map with same-read revision metadata",
    )
    .option("--json")
    .action(async (options: ExportMarkdownOptions) => {
      const result = await executeCommand(command, async () => {
        const blockIds = options.blocks
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean);
        if (
          !options.unit.trim() ||
          !options.worktree.trim() ||
          blockIds.length === 0 ||
          new Set(blockIds).size !== blockIds.length
        ) {
          throw workspaceError(
            "workspace-argument-invalid",
            "Export requires a Unit, Worktree and distinct non-empty block IDs.",
          );
        }
        const sourceMap = parseDocMarkdownSourceMap(
          JSON.parse(await readFile(options.sourceMap, "utf8")),
        );
        const exported = await feature.execute({
          unitId: options.unit,
          worktreeId: options.worktree,
          sourceMap,
          blockIds,
        });
        await writeWorkspaceMarkdownExport(exported, options.out, options.sourceMapOut);
        return exported;
      });
      present(
        command,
        options,
        {
          ...result,
          assets: result.assets.map(({ data: _data, ...asset }) => asset),
          out: options.out,
          ...(options.sourceMapOut === undefined ? {} : { sourceMapOut: options.sourceMapOut }),
        },
        `Exported current native Doc ${result.unitId} at revision ${String(result.revision)} to ${options.out}`,
      );
    });
  return command;
}
