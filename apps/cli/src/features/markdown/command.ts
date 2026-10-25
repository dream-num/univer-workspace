import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  parseDocMarkdownSourceMap,
  type WorkspaceCompileMarkdownFeature,
  type WorkspaceCompileMarkdownInput,
} from "@univerjs/univer-workspace-client-core";
import { Command } from "commander";
import { executeCommand, present, type JsonOption } from "../../command.js";
import { workspaceError } from "../../errors.js";

interface MarkdownOptions extends JsonOption {
  readonly apply?: boolean;
  readonly worktree?: string;
  readonly space?: string;
  readonly parent?: string;
  readonly idempotencyKey?: string;
  readonly title?: string;
  readonly out?: string;
  readonly sourceMapOut?: string;
  readonly unit?: string;
  readonly sourceMap?: string;
  readonly blocks?: string;
}

export function createWorkspaceCompileMarkdownCommand(
  feature: Pick<WorkspaceCompileMarkdownFeature, "execute">,
): Command {
  const command = new Command("compile-markdown")
    .description("Compile Markdown into a native Modern Doc, or update explicit blocks in a draft")
    .argument("<file>", "Markdown source file")
    .option("--title <title>")
    .option("--apply", "create a staged Modern Doc or update the selected blocks")
    .option("--worktree <id>")
    .option("--space <id>")
    .option("--parent <node>")
    .option("--idempotency-key <key>")
    .option("--unit <id>", "existing Modern Doc to update")
    .option("--source-map <json>", "materialized source map from the last successful generation")
    .option("--blocks <ids>", "comma-separated explicit block IDs to replace")
    .option("--out <program.js>")
    .option("--source-map-out <json>", "write the source map for subsequent block updates")
    .option("--json")
    .action(async (file: string, options: MarkdownOptions) => {
      const result = await executeCommand(command, async () => {
        const input: WorkspaceCompileMarkdownInput = {
          file,
          ...(options.title === undefined ? {} : { title: options.title }),
        };
        if (options.apply !== true) {
          if (
            [
              options.worktree,
              options.space,
              options.parent,
              options.idempotencyKey,
              options.unit,
              options.sourceMap,
              options.blocks,
            ].some((value) => value !== undefined)
          )
            invalid("Target options require --apply.");
          if (options.out === undefined) invalid("Compile-only mode requires --out.");
          return await feature.execute(input);
        }
        if (options.worktree === undefined) invalid("--apply requires --worktree.");
        if (options.unit !== undefined) {
          const blockIds =
            options.blocks
              ?.split(",")
              .map((id) => id.trim())
              .filter(Boolean) ?? [];
          if (options.sourceMap === undefined || blockIds.length === 0)
            invalid("Block updates require --source-map and --blocks.");
          if (
            [options.space, options.parent, options.idempotencyKey].some(
              (value) => value !== undefined,
            )
          )
            invalid("Creation options cannot be used with --unit.");
          const sourceMap = parseDocMarkdownSourceMap(
            JSON.parse(await readFile(options.sourceMap!, "utf8")),
          );
          return await feature.execute({
            ...input,
            update: {
              unitId: options.unit,
              worktreeId: options.worktree!,
              sourceMap,
              blockIds,
            },
          });
        }
        if (options.space === undefined) invalid("Creating a Doc requires --space.");
        if ([options.sourceMap, options.blocks].some((value) => value !== undefined))
          invalid("Block update options require --unit.");
        return await feature.execute({
          ...input,
          apply: {
            spaceId: options.space!,
            worktreeId: options.worktree!,
            ...(options.parent === undefined ? {} : { parentNodeId: options.parent }),
            ...(options.idempotencyKey === undefined
              ? {}
              : { idempotencyKey: options.idempotencyKey }),
          },
        });
      });
      if (options.out !== undefined) await writeOutput(options.out, result.javascript);
      const sourceMap = result.materializedSourceMap ?? result.sourceMap;
      if (options.sourceMapOut !== undefined)
        await writeOutput(options.sourceMapOut, `${JSON.stringify(sourceMap, null, 2)}\n`);
      present(
        command,
        options,
        {
          committed: result.committed,
          targetUnitId: result.unit?.unitId ?? result.targetUnitId,
          diagnostics: result.diagnostics,
          sourceMap,
          ...(result.unit === undefined ? {} : { unit: result.unit }),
          ...(result.execution === undefined ? {} : { execution: result.execution }),
          ...(options.out === undefined ? {} : { out: options.out }),
        },
        result.committed
          ? `Applied Markdown to Modern Doc ${result.unit?.unitId ?? result.targetUnitId}`
          : `Compiled Markdown into ${options.out ?? result.targetUnitId}`,
      );
    });
  return command;
}

function invalid(message: string): never {
  throw workspaceError("workspace-argument-invalid", message);
}

async function writeOutput(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}
