import { writeFileSync } from "node:fs";
import { Command, InvalidArgumentError } from "commander";
import type {
  WorkspaceCompileSvgFeature,
  WorkspaceContentExecuteResult,
} from "@univerjs/univer-workspace-client-core";
import { executeCommand } from "../../command.js";

interface CommandOptions {
  readonly add?: boolean;
  readonly apply?: boolean;
  readonly estimateTextSize?: boolean;
  readonly json?: boolean;
  readonly out?: string;
  readonly page?: number;
  readonly unit?: string;
  readonly worktree?: string;
}

interface CommandResult extends Awaited<ReturnType<WorkspaceCompileSvgFeature["compile"]>> {
  readonly applied?: WorkspaceContentExecuteResult;
  readonly out?: string;
}

export function createWorkspaceCompileSvgCommand(
  feature: Pick<WorkspaceCompileSvgFeature, "apply" | "compile">,
): Command {
  const command = new Command("compile-svg")
    .description("Compile SVG into Slide Facade code and optionally apply one page")
    .argument("<file.svg>", "SVG source file")
    .option("--json", "write structured JSON")
    .option("--estimate-text-size", "use deterministic text-size estimation")
    .option("--page <number>", "1-based target Slide page", positiveInteger)
    .option("--add", "overlay onto the target page instead of clearing it first")
    .option("--out <path>", "write generated code to a file")
    .option("--apply", "execute and commit the generated page program")
    .option("--worktree <id>", "target draft Worktree for --apply")
    .option("--unit <id>", "target Slide Unit for --apply")
    .action(async (file: string, options: CommandOptions) => {
      validateOptions(command, options);
      const result = await executeCommand(command, async () => {
        const compiled = await feature.compile({
          file,
          ...(options.add === undefined ? {} : { add: options.add }),
          ...(options.estimateTextSize === undefined
            ? {}
            : { estimateTextSize: options.estimateTextSize }),
          ...(options.page === undefined ? {} : { page: options.page }),
        });
        if (options.out !== undefined) writeFileSync(options.out, `${compiled.code}\n`, "utf8");
        const value =
          options.apply === true
            ? await feature.apply({
                compiled,
                unitId: options.unit as string,
                worktreeId: options.worktree as string,
              })
            : compiled;
        return {
          code: value.code,
          lints: value.lints,
          mode: value.mode,
          page: value.page,
          textMeasure: value.textMeasure,
          viewport: value.viewport,
          warnings: value.warnings,
          ...(options.out === undefined ? {} : { out: options.out }),
          ...("applied" in value ? { applied: value.applied } : {}),
        } as CommandResult;
      });

      if (options.json === true) {
        command.configureOutput().writeOut?.(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      writeDiagnostics(command, result.warnings, result.lints);
      if (options.out !== undefined) {
        command.configureOutput().writeOut?.(`generated code: ${options.out}\n`);
      }
      if (result.applied !== undefined) {
        command
          .configureOutput()
          .writeOut?.(
            `applied page ${String(result.page)} (${result.mode})${
              result.applied.committed
                ? `; committed revision ${String(result.applied.revision)}`
                : "; no mutation committed"
            }\n`,
          );
      } else if (options.out === undefined) {
        command.configureOutput().writeOut?.(`${result.code}\n`);
      }
    });
  return command;
}

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError(`Expected an integer >= 1; received "${value}".`);
  }
  return parsed;
}

function validateOptions(command: Command, options: CommandOptions): void {
  if (options.page === undefined && (options.add === true || options.out !== undefined)) {
    command.error("--add and --out require --page <number>.", {
      code: "workspace-argument-invalid",
      exitCode: 1,
    });
  }
  if (options.apply === true) {
    if (
      options.page === undefined ||
      options.worktree === undefined ||
      options.unit === undefined
    ) {
      command.error("--apply requires --page <number>, --worktree <id>, and --unit <id>.", {
        code: "workspace-argument-invalid",
        exitCode: 1,
      });
    }
  } else if (options.worktree !== undefined || options.unit !== undefined) {
    command.error("--worktree and --unit are only valid with --apply.", {
      code: "workspace-argument-invalid",
      exitCode: 1,
    });
  }
}

function writeDiagnostics(
  command: Command,
  warnings: readonly string[],
  lints: readonly string[],
): void {
  const output = command.configureOutput();
  for (const warning of warnings) output.writeErr?.(`warning: ${warning}\n`);
  for (const lint of lints) output.writeErr?.(`lint: ${lint}\n`);
}
