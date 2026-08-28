import { readFile } from "node:fs/promises";
import { Command } from "commander";
import type { WorkspaceContentExecutionFeature } from "@univerjs/univer-workspace-client-core";
import { executeCommand, present, type JsonOption } from "../../command.js";
import { workspaceError } from "../../errors.js";

interface ExecuteOptions extends JsonOption {
  readonly code?: string;
  readonly e?: string;
  readonly script?: string;
  readonly unit: string;
  readonly worktree: string;
}

export function createContentExecuteCommand(
  feature: WorkspaceContentExecutionFeature,
  options: { readonly readScript?: (path: string) => Promise<string> } = {},
): Command {
  const readScript = options.readScript ?? (async (path: string) => await readFile(path, "utf8"));
  const command = new Command("execute")
    .description(
      "Run Facade code against one Worktree Unit and submit captured Sheet, Doc, Slide, Base, or Board mutations",
    )
    .requiredOption("--worktree <id>", "target draft Worktree")
    .requiredOption("--unit <id>", "target Unit")
    .option("-e <js>", "inline Facade code")
    .option("--code <js>", "inline Facade code")
    .option("--script <path>", "read Facade code from a file")
    .option("--json", "write structured JSON")
    .action(async (commandOptions: ExecuteOptions) => {
      const result = await executeCommand(command, async () => {
        const code = await resolveCode(commandOptions, readScript);
        return await feature.execute({
          code,
          unitId: commandOptions.unit,
          worktreeId: commandOptions.worktree,
        });
      });
      const text = [
        JSON.stringify(result.value, null, 2),
        ...(result.committed
          ? [
              `committed revision ${String(result.revision)}${
                result.status === undefined ? "" : ` (${result.status})`
              }`,
            ]
          : []),
      ].join("\n");
      present(command, commandOptions, result, text);
    });
  return command;
}

async function resolveCode(
  options: Pick<ExecuteOptions, "code" | "e" | "script">,
  readScript: (path: string) => Promise<string>,
): Promise<string> {
  const sources = [options.e, options.code, options.script].filter(
    (value): value is string => value !== undefined,
  );
  if (sources.length !== 1) {
    throw workspaceError(
      "workspace-argument-invalid",
      "Exactly one of -e, --code, or --script is required.",
    );
  }
  return options.script === undefined ? sources[0]! : await readScript(options.script);
}
