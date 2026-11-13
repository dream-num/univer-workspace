import type {
  SheetLensRequest,
  SheetLensResult,
  WorkspaceRuntimeScope,
} from "@univerjs/univer-workspace-client-core";
import { Command, InvalidArgumentError, Option } from "commander";
import { collect, executeCommand, oneOf, present, type JsonOption } from "../../command.js";
import { workspaceError } from "../../errors.js";

export interface SheetLensInput {
  readonly unitId: string;
  readonly scope: WorkspaceRuntimeScope;
  readonly request: SheetLensRequest;
}

interface LensOptions extends JsonOption {
  unit: string;
  trunk?: boolean;
  worktree?: string;
  at?: string;
  from?: string;
  depth?: 0 | 1 | 2;
  budget?: number;
  values?: boolean;
  formulas?: boolean;
  styles?: boolean;
  max?: number;
  in?: "values" | "formulas";
  case?: boolean;
  sheet?: string[];
}

export function createSheetLensCommands(application: {
  run(input: SheetLensInput): Promise<SheetLensResult>;
}): Command[] {
  const outline = baseCommand("outline", "Outline")
    .option("--at <ref>", "zoom in on an outline ref")
    .option("--from <ref>", "continue at an outline ref")
    .option("--depth <0|1|2>", "outline depth", (text) => {
      const value = Number(text);
      if (value === 0 || value === 1 || value === 2) return value;
      throw new InvalidArgumentError("workspace-argument-invalid: depth must be 0, 1 or 2");
    })
    .option("--budget <chars>", "text character budget", positiveInteger)
    .action(async (options: LensOptions) => {
      await run(outline, options, {
        op: "outline",
        ...(options.at === undefined ? {} : { at: options.at }),
        ...(options.from === undefined ? {} : { from: options.from }),
        ...(options.depth === undefined ? {} : { depth: options.depth }),
        ...(options.budget === undefined ? {} : { budget: options.budget }),
      });
    });
  const read = baseCommand("read", "Read")
    .argument("<range>", "cell range, optionally preceded by Sheet!")
    .addOption(new Option("--values", "read displayed values").conflicts("formulas"))
    .addOption(new Option("--formulas", "read formulas").conflicts("values"))
    .option("--styles", "include cell styles")
    .option("--max <cells>", "maximum cells per page", positiveInteger)
    .action(async (range: string, options: LensOptions) => {
      await run(read, options, {
        op: "read",
        range,
        content: options.styles
          ? options.formulas
            ? "formula+style"
            : "style"
          : options.formulas
            ? "formula"
            : options.values
              ? "display"
              : "both",
        ...(options.max === undefined ? {} : { max: options.max }),
      });
    });
  const find = baseCommand("find", "Find in")
    .argument("<terms...>", "terms to locate")
    .option("--in <content>", "search values or formulas", (value) =>
      oneOf(value, ["values", "formulas"], "--in"),
    )
    .option("--case", "match case")
    .option("--sheet <name>", "search this sheet (repeatable)", collect)
    .option("--from <cell>", "continue at this cell")
    .option("--max <hits>", "maximum hits per page", positiveInteger)
    .action(async (terms: string[], options: LensOptions) => {
      await run(find, options, {
        op: "find",
        terms,
        in: options.in ?? "values",
        caseSensitive: options.case === true,
        ...(options.sheet === undefined ? {} : { sheets: options.sheet }),
        ...(options.from === undefined ? {} : { from: options.from }),
        ...(options.max === undefined ? {} : { max: options.max }),
      });
    });
  return [outline, read, find];

  async function run(command: Command, options: LensOptions, request: SheetLensRequest) {
    const { scope, result } = await executeCommand(command, async () => {
      const scope = scopeOf(options);
      return { scope, result: await application.run({ unitId: options.unit, scope, request }) };
    });
    const next = result.next ? continuation(command, options, request, result.next) : undefined;
    const scopeText = scope.kind === "trunk" ? "trunk" : `worktree ${scope.worktreeId}`;
    const lines = [
      `unit ${options.unit} [${scopeText}, rev=${result.revision}]`,
      result.text.replace(/\n+$/, ""),
    ];
    lines.push(...result.warnings.map((warning) => `note: ${warning.message}`));
    if (result.next && next) {
      const label =
        result.next.op === "outline"
          ? result.next.unit
          : result.next.op === "read"
            ? "rows"
            : "hits";
      lines.push(`… ${result.next.remaining} more ${label}: ${next}`);
    }
    present(
      command,
      options,
      {
        unitId: options.unit,
        scope,
        revision: result.revision,
        text: result.text,
        json: result.json,
        ...(next === undefined ? {} : { next }),
        warnings: result.warnings,
      },
      lines.join("\n"),
    );
  }
}

function baseCommand(name: string, verb: string): Command {
  return new Command(name)
    .description(`${verb} a Sheet Unit (Sheet only; use inspect for Doc, Slide, Base and Board)`)
    .requiredOption("--unit <id>", "Sheet Unit to read")
    .addOption(new Option("--trunk", "read from trunk").conflicts("worktree"))
    .addOption(new Option("--worktree <id>", "read from a Worktree").conflicts("trunk"))
    .option("--json", "write structured JSON");
}

function scopeOf(options: LensOptions): WorkspaceRuntimeScope {
  if (options.trunk) return { kind: "trunk" };
  if (options.worktree?.trim()) return { kind: "worktree", worktreeId: options.worktree.trim() };
  throw workspaceError("workspace-argument-invalid", "Use --trunk or --worktree <id>.");
}

function positiveInteger(text: string): number {
  const value = Number(text);
  if (Number.isSafeInteger(value) && value > 0) return value;
  throw new InvalidArgumentError("workspace-argument-invalid: expected a positive integer");
}

function continuation(
  command: Command,
  options: LensOptions,
  request: SheetLensRequest,
  next: NonNullable<SheetLensResult["next"]>,
): string {
  const values: Record<string, unknown> = { ...options };
  if (next.op === "outline") {
    values["at"] = next.at;
    values["from"] = next.from;
  } else if (next.op === "find") values["from"] = next.from;
  const args = ["uvw", command.name()];
  for (const option of command.options) {
    const value = values[option.attributeName()];
    if (value === undefined || value === false || !option.long) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      args.push(option.long);
      if (item !== true) args.push(String(item));
    }
  }
  if (next.op === "read") args.push("--", next.range);
  else if (request.op === "find") args.push("--", ...request.terms);
  return args.map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  return /^[a-zA-Z0-9_./:!=+,-]+$/.test(value) ? value : `'${value.replaceAll("'", `'"'"'`)}'`;
}
