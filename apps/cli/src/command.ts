import { readFile } from "node:fs/promises";
import { Command, InvalidArgumentError, Option } from "commander";
import { WorkspaceApplicationError, workspaceError } from "./errors.js";

export interface JsonOption {
  readonly json?: boolean;
}

/** `--json [fields]`: true for the whole object, or raw/validated field names. */
export interface JsonFieldsOption {
  readonly json?: true | string | readonly string[];
}

/** Parse and validate fields before Commander enters a command that can change remote data. */
export function jsonFieldsOption(available: readonly string[]): Option {
  return new Option("--json [fields]", "write JSON, optionally only these comma-separated fields")
    .argParser((value: string) => {
      const names = fieldNames(value);
      const unknown = names.filter((name) => !available.includes(name));
      if (names.length === 0 || unknown.length > 0) {
        throw new InvalidArgumentError(
          "workspace-argument-invalid: " +
            (names.length === 0
              ? "--json fields must not be empty."
              : `Unknown --json field: ${unknown.join(", ")}. Available fields: ${available.join(", ")}.`),
        );
      }
      return names;
    });
}

/** Exit status 4 tells an agent that signing in, not retrying, is the next step. */
export const EXIT_AUTHENTICATION_REQUIRED = 4;

export async function executeCommand<Result>(
  command: Command,
  operation: () => Promise<Result>,
): Promise<Result> {
  try {
    return await operation();
  } catch (error) {
    if (isCodedError(error)) {
      const detail =
        error instanceof WorkspaceApplicationError && error.detail !== undefined
          ? `\n${JSON.stringify(error.detail, null, 2)}`
          : "";
      const authenticationRequired = error.code === "workspace-authentication-required";
      const hint = authenticationRequired ? "\nHint: run uvw auth login" : "";
      command.error(`${error.code}: ${error.message}${detail}${hint}`, {
        code: "workspace.command.failed",
        exitCode: authenticationRequired ? EXIT_AUTHENTICATION_REQUIRED : 1,
      });
    }
    throw error;
  }
}

export function present(
  command: Command,
  options: JsonOption,
  value: unknown,
  text?: string,
): void {
  command
    .configureOutput()
    .writeOut?.(
      `${options.json === true || text === undefined ? JSON.stringify(value, null, 2) : text}\n`,
    );
}

/**
 * Writes the text rendering, or with `--json [fields]` the bare value (an object or an array of
 * objects, never a `{ issue }` wrapper), narrowed to the requested top-level fields.
 */
export function emit(
  command: Command,
  options: JsonFieldsOption,
  value: unknown,
  text: string,
): void {
  const out =
    options.json === undefined
      ? text
      : JSON.stringify(options.json === true ? value : pickFields(value, options.json), null, 2);
  command.configureOutput().writeOut?.(`${out}\n`);
}

function pickFields(value: unknown, fields: string | readonly string[]): unknown {
  const names = typeof fields === "string" ? fieldNames(fields) : fields;
  if (names.length === 0) {
    throw workspaceError("workspace-argument-invalid", "--json fields must not be empty.");
  }
  const pick = (item: unknown) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return item;
    const record = item as Record<string, unknown>;
    // Parsed field arrays already passed the command's contract, including optional fields.
    const unknown = typeof fields === "string" ? names.filter((name) => !(name in record)) : [];
    if (unknown.length > 0) {
      throw workspaceError(
        "workspace-argument-invalid",
        `Unknown --json field: ${unknown.join(", ")}. Available fields: ${Object.keys(record).join(", ")}.`,
      );
    }
    return Object.fromEntries(names.map((name) => [name, record[name]]));
  };
  return Array.isArray(value) ? value.map(pick) : pick(value);
}

function fieldNames(fields: string): string[] {
  return fields.split(",").map((name) => name.trim()).filter((name) => name !== "");
}

/** Left-aligned columns separated by two spaces; trailing blanks are trimmed. */
export function table(rows: readonly (readonly string[])[]): string {
  const widths = rows.reduce<number[]>((all, row) => {
    row.forEach((cell, index) => (all[index] = Math.max(all[index] ?? 0, cell.length)));
    return all;
  }, []);
  return rows
    .map((row) => row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ").trimEnd())
    .join("\n");
}

export function oneOf<const Value extends string>(
  value: string,
  allowed: readonly Value[],
  option: string,
): Value {
  if ((allowed as readonly string[]).includes(value)) return value as Value;
  throw Object.assign(new Error(`${option} must be one of: ${allowed.join(", ")}`), {
    code: "workspace-argument-invalid",
  });
}

export function collect(value: string, previous: readonly string[] = []): string[] {
  return [...previous, value];
}

/** `-L, --limit`: a positive integer, defaulting to 30 like gh. */
export function limitOf(value: string | undefined): number {
  if (value === undefined) return 30;
  if (!/^[1-9]\d{0,5}$/.test(value)) {
    throw workspaceError("workspace-argument-invalid", `--limit must be a positive integer, got "${value}".`);
  }
  return Number(value);
}

/** `-` reads stdin so agents can pass multi-line Markdown without shell escaping. */
export async function readText(
  inline: string | undefined,
  file: string | undefined,
  names: string,
): Promise<string | undefined> {
  if (inline !== undefined && file !== undefined) {
    throw workspaceError("workspace-argument-invalid", `Use either ${names}, not both.`);
  }
  if (file === undefined) return inline;
  if (file !== "-") return await readFile(file, "utf8");
  let text = "";
  for await (const chunk of process.stdin) {
    text += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
  }
  return text;
}

function isCodedError(error: unknown): error is Error & { readonly code: string } {
  return error instanceof Error && typeof (error as { readonly code?: unknown }).code === "string";
}
