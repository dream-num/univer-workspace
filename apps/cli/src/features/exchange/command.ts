import { Command } from "commander";
import type { WorkspaceUnitExchangeFeature } from "@univerjs/univer-workspace-client-core";
import { executeCommand, oneOf, present, type JsonOption } from "../../command.js";

export function createWorkspaceUnitExchangeCommands(
  feature: Pick<WorkspaceUnitExchangeFeature, "exportFile" | "importFile">,
): readonly Command[] {
  const importCommand = new Command("import")
    .description("Import an Office file as a Worktree-local Unit")
    .requiredOption("--file <source>")
    .requiredOption("--worktree <id>")
    .requiredOption("--space <id>")
    .option("--type <type>")
    .option("--name <name>")
    .option("--parent <node>")
    .option("--idempotency-key <key>")
    .option("--json")
    .action(
      async (
        options: JsonOption & {
          readonly file: string;
          readonly idempotencyKey?: string;
          readonly name?: string;
          readonly parent?: string;
          readonly space: string;
          readonly type?: string;
          readonly worktree: string;
        },
      ) => {
        const result = await executeCommand(
          importCommand,
          async () =>
            await feature.importFile({
              sourcePath: options.file,
              spaceId: options.space,
              worktreeId: options.worktree,
              ...(options.type === undefined
                ? {}
                : { type: oneOf(options.type, ["sheet", "base", "doc", "slide"], "--type") }),
              ...(options.name === undefined ? {} : { name: options.name }),
              ...(options.parent === undefined ? {} : { parentNodeId: options.parent }),
              ...(options.idempotencyKey === undefined
                ? {}
                : { idempotencyKey: options.idempotencyKey }),
            }),
        );
        present(
          importCommand,
          options,
          result,
          `imported ${result.type} ${result.unitId} as Resource ${result.resourceId} on Node ${result.nodeId} in ${result.worktreeId}`,
        );
      },
    );

  const exportCommand = new Command("export")
    .description("Export a Workspace Worktree Unit head")
    .argument("<output>")
    .requiredOption("--worktree <id>")
    .requiredOption("--unit <id>")
    .option("--json")
    .action(
      async (
        outputPath: string,
        options: JsonOption & { readonly unit: string; readonly worktree: string },
      ) => {
        const result = await executeCommand(
          exportCommand,
          async () =>
            await feature.exportFile({
              outputPath,
              unitId: options.unit,
              worktreeId: options.worktree,
            }),
        );
        present(
          exportCommand,
          options,
          result,
          `exported ${result.type} ${result.unitId} to ${result.outputPath}`,
        );
      },
    );

  return [importCommand, exportCommand];
}
