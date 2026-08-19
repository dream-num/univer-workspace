import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  builtinTextMeasurer,
  compileSvgToFacade,
  wrapSlideScript,
  type SvgTextMeasurer,
} from "@univer-cli/svg-facade";
import {
  createUniverRenderRuntime,
  type UniverRenderRuntimeOptions,
  type UniverTextMeasureRuntime,
} from "@univer-cli/univer-render-runtime";
import { Command, InvalidArgumentError } from "commander";
import { executeCommand } from "../../command.js";
import { resolveUniverLicense } from "../../config.js";
import type {
  WorkspaceContentExecuteInput,
  WorkspaceContentExecuteResult,
} from "../content/execution.js";
import { createWorkspaceSvgTextMeasurer } from "./text-measurer.js";

const ESTIMATE_LINT =
  "text boxes were sized by estimation (--estimate-text-size), not by real font metrics: text can sit off-position, especially centred or right-aligned lines; recompile without the flag (with a browser) before you ship";

export interface WorkspaceCompileSvgCommandOptions {
  readonly renderPageRoot: string;
  readonly createRuntime?: (
    options: UniverRenderRuntimeOptions,
  ) => Promise<UniverTextMeasureRuntime>;
  readonly env: NodeJS.ProcessEnv;
  readonly executeSlide: (
    input: WorkspaceContentExecuteInput,
  ) => Promise<WorkspaceContentExecuteResult>;
}

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

export function createWorkspaceCompileSvgCommand(
  dependencies: WorkspaceCompileSvgCommandOptions,
): Command {
  const createRuntime = dependencies.createRuntime ?? createUniverRenderRuntime;
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
        let runtimePromise: Promise<UniverTextMeasureRuntime> | undefined;
        const textMeasurer: SvgTextMeasurer =
          options.estimateTextSize === true
            ? builtinTextMeasurer
            : {
                source: "univer-render-runtime",
                measureLine: async (input) => {
                  runtimePromise ??= createRuntime({
                    renderPageRoot: dependencies.renderPageRoot,
                    env: dependencies.env,
                    license: resolveUniverLicense(dependencies.env),
                  });
                  return await createWorkspaceSvgTextMeasurer(await runtimePromise).measureLine(
                    input,
                  );
                },
              };
        try {
          const compiled = await compileSvgToFacade(readFileSync(file, "utf8"), {
            assetResolver: (href) => ({ bytes: readFileSync(resolve(dirname(file), href)) }),
            textMeasurer,
          });
          const lints =
            options.estimateTextSize === true ? [...compiled.lints, ESTIMATE_LINT] : compiled.lints;
          const mode = options.add === true ? "add" : "replace";
          const code =
            options.page === undefined
              ? compiled.code
              : wrapSlideScript(compiled.code, {
                  page: options.page,
                  mode,
                  ...compiled.viewport,
                });
          if (options.out !== undefined) writeFileSync(options.out, `${code}\n`, "utf8");
          const applied =
            options.apply === true
              ? await dependencies.executeSlide({
                  code,
                  unitId: options.unit as string,
                  worktreeId: options.worktree as string,
                })
              : undefined;
          return {
            code,
            lints,
            mode,
            page: options.page,
            textMeasure: compiled.textMeasure,
            viewport: compiled.viewport,
            warnings: compiled.warnings,
            ...(options.out === undefined ? {} : { out: options.out }),
            ...(applied === undefined ? {} : { applied }),
          };
        } finally {
          const runtime = await runtimePromise?.catch(() => undefined);
          await runtime?.close();
        }
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
