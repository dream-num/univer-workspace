import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { WorkspaceCompileTypstFeature } from "@univerjs/univer-workspace-client-core";
import { Command } from "commander";
import { executeCommand, present, type JsonOption } from "../../command.js";
import { workspaceError } from "../../errors.js";

interface CompileTypstOptions extends JsonOption {
  readonly apply?: boolean;
  readonly diagnosticsOut?: string;
  readonly idempotencyKey?: string;
  readonly out?: string;
  readonly parent?: string;
  readonly previewDir?: string;
  readonly space?: string;
  readonly worktree?: string;
}

export function createWorkspaceCompileTypstCommand(
  feature: Pick<WorkspaceCompileTypstFeature, "execute">,
): Command {
  const command = new Command("compile-typst")
    .description("Compile a Typst bundle and optionally create one staged Workspace Doc")
    .argument("<bundle>", "bundle directory or typst.json path")
    .option("--apply", "create the compiled Doc as a staged Worktree Unit")
    .option("--worktree <id>")
    .option("--space <id>")
    .option("--parent <node>")
    .option("--idempotency-key <key>")
    .option("--out <program.js>")
    .option("--diagnostics-out <json>")
    .option("--preview-dir <directory>")
    .option("--json")
    .action(async (bundle: string, options: CompileTypstOptions) => {
      const result = await executeCommand(command, async () => {
        validateOptions(options);
        return await feature.execute({
          bundlePath: bundle,
          ...(options.previewDir === undefined ? {} : { previewDir: options.previewDir }),
          ...(options.apply !== true
            ? {}
            : {
                apply: {
                  spaceId: options.space as string,
                  worktreeId: options.worktree as string,
                  ...(options.parent === undefined ? {} : { parentNodeId: options.parent }),
                  ...(options.idempotencyKey === undefined
                    ? {}
                    : { idempotencyKey: options.idempotencyKey }),
                },
              }),
        });
      });
      if (options.out !== undefined) await writeOutput(options.out, result.javascript);
      if (options.diagnosticsOut !== undefined) {
        await writeOutput(
          options.diagnosticsOut,
          `${JSON.stringify({ schemaVersion: 1, diagnostics: result.diagnostics }, null, 2)}\n`,
        );
      }
      const value = {
        committed: result.committed,
        compiledTargetUnitId: result.targetUnitId,
        diagnostics: result.diagnostics,
        previews: result.previews,
        ...(options.out === undefined ? {} : { out: options.out }),
        ...(result.unit === undefined ? {} : { unit: result.unit }),
      };
      present(
        command,
        options,
        value,
        result.unit === undefined
          ? `Compiled ${result.targetUnitId}; wrote ${options.out as string}`
          : `Created staged Doc ${result.unit.unitId} from ${result.targetUnitId} in ${result.unit.worktreeId}`,
      );
    });
  return command;
}

function validateOptions(options: CompileTypstOptions): void {
  if (options.apply === true) {
    if (options.worktree === undefined || options.space === undefined) {
      throw workspaceError(
        "workspace-argument-invalid",
        "--apply requires --worktree and --space.",
      );
    }
    return;
  }
  if (
    options.worktree !== undefined ||
    options.space !== undefined ||
    options.parent !== undefined ||
    options.idempotencyKey !== undefined
  ) {
    throw workspaceError("workspace-argument-invalid", "Workspace target options require --apply.");
  }
  if (options.out === undefined) {
    throw workspaceError("workspace-argument-invalid", "Compile-only mode requires --out.");
  }
}

async function writeOutput(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}
