import { Command } from "commander";
import { WorkspaceApplicationError } from "./errors.js";

export interface JsonOption {
  readonly json?: boolean;
}

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
      const hint =
        error.code === "workspace-authentication-required"
          ? "\nHint: run univer-workspace-cli login"
          : "";
      command.error(`${error.code}: ${error.message}${detail}${hint}`, {
        code: "workspace.command.failed",
        exitCode: 1,
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

function isCodedError(error: unknown): error is Error & { readonly code: string } {
  return error instanceof Error && typeof (error as { readonly code?: unknown }).code === "string";
}
