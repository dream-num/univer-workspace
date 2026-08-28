/**
 * The `univer_edit` tool: read or write a Worktree Unit's data by executing
 * Univer Facade API code in the headless collaboration runtime.
 *
 * A read runs against a trunk or draft Unit; a write runs only in Worktree
 * scope and commits the resulting changeset to the draft, leaving merge to
 * the explicit `univer_worktree ready/merge` flow with user approval.
 * @module dsh-univer-workspace-plugin/tools/edit
 */

import { readFile } from "node:fs/promises";
import { defineTool, type JsonValue } from "@deepseek-ai/dsh-tools";
import type { Context } from "@deepseek-ai/cordis";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import type { WorkspaceRuntimeScope } from "../runtime/target.js";
import { resolveToolScope, type ToolSpaceScope } from "./tool-scope.ts";
import { existingSessionPath } from "./workspace-path.ts";
import { registerUniverTool } from "./presentation.ts";
import { UniverError } from "./errors.ts";

function text(value: string): ContentBlock[] {
  return [{ type: "text", text: value }];
}

const unitTypeEnum = { type: "string" as const, enum: ["sheet", "doc", "slide", "board", "base"] as const };

interface UnitExecutionArguments {
  readonly worktreeId?: string;
  readonly unitId: string;
  readonly unitType: "sheet" | "doc" | "slide" | "board" | "base";
  readonly revision?: number;
  readonly code: string;
}

/** Resolve the mutually-exclusive inline/file execution source. */
export async function resolveExecutionCode(
  exec: ToolRunContext,
  code: string | undefined,
  codeFile: string | undefined,
): Promise<string> {
  if ((code === undefined) === (codeFile === undefined)) {
    throw new UniverError("Provide exactly one of code or codeFile.", "INVALID_EXECUTION_SOURCE");
  }
  if (code !== undefined) return code;
  if (codeFile === undefined) {
    throw new UniverError("codeFile is required when code is omitted.", "INVALID_EXECUTION_SOURCE");
  }
  const source = await existingSessionPath(exec, codeFile);
  try {
    return await readFile(source.path, "utf8");
  } catch (error) {
    throw new UniverError("Cannot read the requested codeFile.", "CODE_FILE_READ_FAILED", { cause: error });
  }
}

async function executeUnit(
  ctx: Context,
  exec: ToolRunContext,
  args: UnitExecutionArguments,
  mode: "read" | "write",
): Promise<JsonValue> {
  const resolved = await resolveToolScope(ctx, exec);
  await assertUnitInScope(ctx, resolved, args.unitId, args.unitType, args.worktreeId);
  const runtimeScope: WorkspaceRuntimeScope =
    args.worktreeId === undefined ? { kind: "trunk" } : { kind: "worktree", worktreeId: args.worktreeId };
  if (mode === "read") {
    const value = await ctx.get("univerWorkspace")!.readUnit(resolved.userId, {
      scope: runtimeScope,
      unitId: args.unitId,
      unitType: args.unitType,
      ...(args.revision === undefined ? {} : { revision: args.revision }),
      code: args.code,
    });
    return { committed: false, value: value as unknown as JsonValue };
  }
  return await ctx.get("univerWorkspace")!.editUnit(resolved.userId, {
    scope: runtimeScope,
    unitId: args.unitId,
    unitType: args.unitType,
    ...(args.revision === undefined ? {} : { revision: args.revision }),
    code: args.code,
  }) as unknown as JsonValue;
}

/**
 * Bind a runtime Unit target to the authenticated Workspace User before
 * executing arbitrary Facade code. Workspace ACLs authorize the Unit; the
 * session-linked Space is only the default discovery context.
 */
export async function assertUnitInScope(
  ctx: Context,
  scope: ToolSpaceScope,
  unitId: string,
  unitType: UnitExecutionArguments["unitType"],
  worktreeId: string | undefined,
): Promise<void> {
  if (unitId.trim() === "") throw new UniverError("Univer tools require a non-empty unitId.", "INVALID_REQUEST");
  const service = ctx.get("univerWorkspace")!;
  if (worktreeId === undefined) {
    const document = await service.resolveUnitResource(scope.userId, unitId);
    if (document.unitType !== unitType) {
      throw new UniverError(`The Unit type is ${document.unitType}, not ${unitType}.`, "UNIT_TYPE_MISMATCH");
    }
    return;
  }
  if (worktreeId.trim() === "") throw new UniverError("Univer tools require a non-empty worktreeId.", "INVALID_REQUEST");
  const state = await service.getWorktreeFileState(scope.userId, worktreeId);
  const unit = state.worktrees
    .find((entry) => entry.worktreeId === worktreeId)
    ?.units.find((entry) => entry.unitId === unitId);
  if (unit === undefined) throw new UniverError("The Unit is not part of the requested Worktree.", "UNIT_NOT_FOUND");
  if (unit.unitType !== unitType) {
    throw new UniverError(`The Unit type is ${unit.unitType}, not ${unitType}.`, "UNIT_TYPE_MISMATCH");
  }
  if (unit.source === "worktree") {
    return;
  }
  // Trunk members retain their Resource identity, so resolve it as an extra
  // guard even though the Worktree endpoint has already checked user ACL.
  await service.resolveUnitResource(scope.userId, unitId);
}

const unitExecutionOutput = {
  schema: { type: "json" as const },
  render: (_args: unknown, value: unknown): ContentBlock[] => text(JSON.stringify(value ?? {})),
};

/** Register the edit tool. */
export function registerEditTool(ctx: Context): () => void {
  const disposeTool = registerUniverTool(ctx, defineTool({
    name: "univer_edit",
    description:
      "Execute Univer Facade API code against a Workspace Unit in the headless collaboration runtime. mode=read inspects a trunk or draft Unit; mode=write edits a Worktree draft Unit and commits the resulting changeset for later review/merge.",
    parameters: {
      mode: { type: "string", required: true, enum: ["read", "write"] },
      worktreeId: { type: "string" },
      unitId: { type: "string", required: true },
      unitType: { ...unitTypeEnum, required: true },
      revision: { type: "integer" },
      code: { type: "string", required: true },
    },
    output: {
      schema: { type: "json" },
      render: (_args, value: unknown) => {
        // The structured JSON is consumed by the turn projector and keeps
        // revision/commit metadata available after the session is replayed.
        return text(JSON.stringify(value ?? {}));
      },
    },
    async execute(args, exec) {
      return await executeUnit(ctx, exec, args, args.mode);
    },
    presentCall: (args) => ({
      card: "generic",
      title: `${args.mode === "write" ? "Edit" : "Read"} Univer Unit`,
      kind: args.mode === "write" ? "edit" : "read",
    }),
  }));

  const disposeInspect = registerUniverTool(ctx, defineTool({
    name: "univer_inspect",
    description:
      "Inspect structured content from a remote Workspace Unit. This mirrors dsh-univer-office's univer_inspect: omit range first to discover a workbook's worksheet names, then use an exact Sheet selector such as Sheet1!A1:D20 (case-sensitive). If a selector does not match, retry without range to get the valid names. It never executes caller-provided write code.",
    parameters: {
      worktreeId: { type: "string" as const },
      unitId: { type: "string" as const, required: true },
      unitType: { ...unitTypeEnum, required: true },
      revision: { type: "integer" as const },
      range: { type: "string" as const, description: "Optional case-sensitive Sheet range, e.g. Sheet1!A1:D20. Omit it first to discover worksheet names." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true, const: true },
          operation: { type: "string", required: true, const: "inspect" },
          unitId: { type: "string", required: true },
          unitType: { type: "string", required: true },
          result: { type: "json", required: true },
        },
      },
      render: (_args: unknown, value: unknown) => text(JSON.stringify(value ?? {})),
    },
    async execute(args, exec) {
      const resolved = await resolveToolScope(ctx, exec);
      await assertUnitInScope(ctx, resolved, args.unitId, args.unitType, args.worktreeId);
      const result = await ctx.get("univerWorkspace")!.inspectUnit(resolved.userId, {
        scope: args.worktreeId === undefined ? { kind: "trunk" } : { kind: "worktree", worktreeId: args.worktreeId },
        unitId: args.unitId,
        unitType: args.unitType,
        ...(args.revision === undefined ? {} : { revision: args.revision }),
        ...(args.range === undefined ? {} : { range: args.range }),
      });
      return {
        ok: true as const,
        operation: "inspect" as const,
        unitId: args.unitId,
        unitType: args.unitType,
        result: result as unknown as JsonValue,
      };
    },
    presentCall: (args) => ({
      card: "generic",
      title: args.range === undefined ? "Inspect Univer Unit" : `Inspect Univer range ${args.range}`,
      kind: "read",
    }),
  }));

  const disposeExecute = registerUniverTool(ctx, defineTool({
    name: "univer_execute",
    description:
      "Execute Facade API code against a remote Workspace Unit and commit the mutation to an explicit draft Worktree. Provide exactly one of code or codeFile; prefer a session-relative codeFile for multi-line programs. Use univer_worktree ready/merge to publish it.",
    parameters: {
      worktreeId: { type: "string" as const, required: true },
      unitId: { type: "string" as const, required: true },
      unitType: { ...unitTypeEnum, required: true },
      revision: { type: "integer" as const },
      code: { type: "string" as const },
      codeFile: { type: "string" as const },
    },
    output: unitExecutionOutput,
    async execute(args, exec) {
      const code = await resolveExecutionCode(exec, args.code, args.codeFile);
      return await executeUnit(ctx, exec, { ...args, code }, "write");
    },
    presentCall: () => ({ card: "generic", title: "Execute Univer Facade code", kind: "execute" }),
  }));

  return () => {
    disposeExecute();
    disposeInspect();
    disposeTool();
  };
}
