/**
 * DSH-facing presentation and error boundary shared by Workspace tools.
 *
 * The canonical value returned by a tool remains structured JSON.  Only the
 * final model-facing content is converted to text, and stable `UniverError`
 * codes are retained in that projection for recovery instructions.
 *
 * @module dsh-univer-workspace-plugin/tools/presentation
 */

import type { Context } from "@deepseek-ai/cordis";
import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import type {
  ToolDefinition,
  ToolFailure,
  ToolExecution,
  ToolExecutionResult,
} from "@deepseek-ai/dsh-tools";
import { asUniverError, safeToolFailureMessage } from "./errors.ts";

/** Render one JSON value without leaking an Error object or stack. */
export function text(value: unknown): ContentBlock[] {
  return [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value ?? {}) }];
}

/** Stable title convention used by operation cards. */
export function operationTitle(operation: string, identity: string): string {
  return `Univer ${operation}: ${identity}`;
}

/**
 * Add the Office-compatible final-content projection to one definition.
 * `finalizeContent` is deliberately total: a malformed prior result must not
 * create a second error while the registry is materializing the first one.
 */
export function withUniverErrorContent(definition: ToolDefinition): ToolDefinition {
  const previous = definition.finalizeContent;
  return {
    ...definition,
    finalizeContent(
      exec: Readonly<ToolExecution>,
      result: Readonly<ToolExecutionResult>,
    ): ContentBlock[] | undefined {
      if (result.isError) {
        const code = result.error.info?.code ?? "WORKSPACE_OPERATION_FAILED";
        return [
          {
            type: "text",
            text: `Error [${code}]: ${safeToolFailureMessage(result.error.message, code)}`,
          },
        ];
      }
      try {
        return previous?.(exec, result);
      } catch {
        // A third-party finalizer is presentation-only.  If it fails, retain
        // the registry's already-normalized content rather than masking it.
        return undefined;
      }
    },
  };
}

/**
 * Harden a tool body at the DSH boundary.  Provider errors retain their
 * HarnessError identity; arbitrary failures become a stable `UniverError`.
 */
export function hardenUniverTool(
  definition: ToolDefinition,
  fallbackCode = "WORKSPACE_OPERATION_FAILED",
): ToolDefinition {
  const execute = definition.execute;
  return withUniverErrorContent({
    ...definition,
    async execute(args, exec) {
      try {
        return await execute(args, exec);
      } catch (error) {
        throw asUniverError(error, fallbackCode);
      }
    },
  });
}

/** Register one hardened definition and return its native disposer. */
export function registerUniverTool(
  ctx: Context,
  definition: ToolDefinition,
  fallbackCode?: string,
): () => void {
  return ctx.tools.register(hardenUniverTool(definition, fallbackCode));
}

/** Narrow helper for output renderers that must always return content blocks. */
export function renderJson(_args: unknown, value: unknown): ContentBlock[] {
  return text(value);
}

/**
 * Convert a DSH failure to a safe text block when a caller needs to project a
 * result outside the registry.  This intentionally accepts only the public
 * `ToolFailure` shape; causes and stacks never cross this boundary.
 */
export function renderToolFailure(error: ToolFailure): ContentBlock[] {
  const info = error.info;
  const code = info?.code ?? "WORKSPACE_OPERATION_FAILED";
  return [
    {
      type: "text",
      text: `Error [${code}]: ${safeToolFailureMessage(error.message, code)}`,
    },
  ];
}
