/**
 * Office exchange tools.
 *
 * The important semantic boundary is the same as dsh-univer-office:
 * `univer_import` converts an input file into UnitData and creates a new Unit
 * in an explicit draft Worktree; `univer_export` reads a synchronized Unit
 * (trunk or draft) and writes the converted bytes into the calling session
 * workspace. The Workspace product's trunk exchange endpoints are not used
 * here because they would bypass Worktree review/merge semantics.
 *
 * @module dsh-univer-workspace-plugin/tools/exchange
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { JsonValue, ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { Context } from "@deepseek-ai/cordis";
import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import {
  exportUnitData,
  inferExportFormat,
  importUnitData,
  type LocalExchangeUnitType,
} from "../provider/local-exchange.ts";
import { assertWorktreeAccessible, resolveTargetSpace, resolveToolScope, type ToolSpaceScope } from "./tool-scope.ts";
import { existingSessionPath, newSessionPath } from "./workspace-path.ts";
import { registerUniverTool } from "./presentation.ts";
import { UniverError } from "./errors.ts";

const unitTypeEnum = {
  type: "string" as const,
  enum: ["sheet", "doc", "slide", "base"] as const,
};

function text(value: string): ContentBlock[] {
  return [{ type: "text", text: value }];
}

interface ImportArguments {
  readonly source: string;
  /** Office-compatible logical target path; remote Units have no local file. */
  readonly file?: string;
  readonly worktreeId: string;
  readonly name: string;
  readonly spaceId?: string;
  readonly parentNodeId?: string;
  readonly unitType?: LocalExchangeUnitType;
  readonly idempotencyKey?: string;
  /** Deprecated alias retained for callers of the first Workspace prototype. */
  readonly type?: "auto" | LocalExchangeUnitType;
}

interface ExportArguments {
  /** Office-compatible logical source path; optional for a remote Unit. */
  readonly file?: string;
  readonly output?: string;
  readonly unitId?: string;
  /** Deprecated spelling retained for the first Workspace prototype. */
  readonly unitID?: string;
  readonly worktreeId?: string;
  readonly type?: LocalExchangeUnitType;
  readonly format?: "xlsx" | "csv" | "tsv" | "docx" | "pptx";
  readonly revision?: number;
}

/** Register local Office conversion tools. */
export function registerExchangeTools(ctx: Context): () => void {
  const disposeImport = registerUniverTool(ctx, defineTool({
    name: "univer_import",
    description:
      "Import an xls/xlsx/csv/tsv/doc/docx/ppt/pptx file as a new Unit inside an explicit draft Worktree. The conversion runs locally with the pinned Univer exchange SDK; it never publishes directly to trunk.",
    parameters: {
      source: { type: "string", required: true, description: "Path to the Office source file relative to the session workspace." },
      file: { type: "string", description: "Optional Office-compatible logical target path; remote Units are identified by the returned unitId/resourceId." },
      worktreeId: { type: "string", required: true, description: "Writable draft Worktree id." },
      name: { type: "string", required: true, description: "Non-empty name for the imported Unit." },
      spaceId: { type: "string", description: "Optional target Space; omit to use the linked Space, or provide a Space accessible to the authenticated User." },
      parentNodeId: { type: "string", description: "Optional target folder Node id." },
      unitType: { ...unitTypeEnum, description: "Optional explicit type; otherwise infer it from the source extension." },
      type: { type: "string", enum: ["auto", "sheet", "doc", "slide", "base"], description: "Deprecated alias for unitType." },
      idempotencyKey: { type: "string", description: "Optional stable key for retry-safe Worktree Unit creation." },
    },
    output: {
      schema: { type: "json" },
      render: (_args: unknown, value: unknown) => text(JSON.stringify(value ?? {})),
    },
    async execute(args: ImportArguments, exec: ToolRunContext): Promise<JsonValue> {
      const resolved = await resolveToolScope(ctx, exec);
      const worktreeId = nonEmpty(args.worktreeId, "univer_import requires a non-empty worktreeId");
      const name = nonEmpty(args.name, "univer_import requires a non-empty Unit name");
      const idempotencyKey = args.idempotencyKey?.trim();
      if (args.idempotencyKey !== undefined && idempotencyKey === "") {
        throw new UniverError("univer_import idempotencyKey must be non-empty.", "INVALID_REQUEST");
      }
      await assertWorktreeAccessible(ctx, resolved, worktreeId);
      const targetSpaceId = resolveTargetSpace(resolved, args.spaceId);
      const source = await existingSessionPath(exec, args.source);
      const explicitType = explicitImportType(args.unitType, args.type);
      const imported = await importUnitData(
        new Uint8Array(await readFile(source.path)),
        basename(source.path),
        explicitType,
      );
      const unit = await ctx.get("univerWorkspace")!.createWorktreeLocalUnit(resolved.userId, {
        worktreeId,
        name,
        unitType: imported.unitType,
        targetSpaceId,
        targetParentNodeId: args.parentNodeId ?? null,
        initialData: imported.data,
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      });
      return {
        ok: true,
        operation: "import",
        status: "done",
        sourcePath: args.source,
        worktreeId,
        unitId: unit.unitId,
        resourceId: unit.resourceId,
        nodeId: unit.nodeId,
        unitType: unit.unitType,
        name: unit.name,
        source: unit.source,
        unit: unit as unknown as JsonValue,
      };
    },
    presentCall: (args: ImportArguments) => ({
      card: "generic",
      title: `import ${args.source}`,
      kind: "execute",
    }),
  }));

  const disposeExport = registerUniverTool(ctx, defineTool({
    name: "univer_export",
    description:
      "Export one explicit Workspace Unit (trunk or Worktree draft) to .xlsx, .csv, .tsv, .docx, or .pptx in the session workspace. The Unit type and scope are checked before conversion.",
    parameters: {
      file: { type: "string", description: "Optional Office-compatible logical source path; not required for a remote Unit." },
      output: { type: "string", description: "Destination path relative to the session workspace (preferred Office-compatible spelling)." },
      unitId: { type: "string", description: "Explicit Unit id from univer_open/univer_status." },
      unitID: { type: "string", description: "Deprecated alias for unitId." },
      worktreeId: { type: "string", description: "Optional Worktree scope; omit to export the linked Space's trunk Unit." },
      type: { ...unitTypeEnum, description: "Optional type assertion; the server-resolved Unit type is authoritative." },
      format: { type: "string", enum: ["xlsx", "csv", "tsv", "docx", "pptx"], description: "Optional format assertion; normally inferred from output extension." },
      revision: { type: "integer", description: "Optional expected revision; reject export if the Unit has advanced." },
    },
    output: {
      schema: { type: "json" },
      render: (_args: unknown, value: unknown) => text(JSON.stringify(value ?? {})),
    },
    async execute(args: ExportArguments, exec: ToolRunContext): Promise<JsonValue> {
      const resolved = await resolveToolScope(ctx, exec);
      const unitId = nonEmpty(args.unitId ?? args.unitID, "univer_export requires unitId");
      const outputArg = nonEmpty(args.output ?? (args.output === undefined ? args.file : undefined), "univer_export requires output");
      const worktreeId = args.worktreeId === undefined ? undefined : nonEmpty(args.worktreeId, "univer_export worktreeId must be non-empty");
      const target = await resolveUnitTarget(ctx, resolved, unitId, worktreeId);
      if (args.type !== undefined && args.type !== target.unitType) {
        throw new UniverError(`The Unit type is ${target.unitType}, not ${args.type}.`, "UNIT_TYPE_MISMATCH");
      }
      const output = await newSessionPath(exec, outputArg);
      const inferredFormat = inferExportFormat(output.path);
      if (args.format !== undefined && args.format !== inferredFormat) {
        throw new UniverError(
          `univer_export format ${args.format} does not match output extension ${inferredFormat}.`,
          "EXPORT_FORMAT_MISMATCH",
        );
      }
      const data = await ctx.get("univerWorkspace")!.exportUnitData(resolved.userId, {
        scope: worktreeId === undefined ? { kind: "trunk" } : { kind: "worktree", worktreeId },
        unitId,
        unitType: target.unitType,
        ...(args.revision === undefined ? {} : { revision: args.revision }),
      });
      const bytes = await exportUnitData(
        data as unknown as Readonly<Record<string, unknown>>,
        target.unitType,
        output.path,
      );
      await mkdir(dirname(output.path), { recursive: true });
      await writeFile(output.path, bytes);
      return {
        ok: true,
        operation: "export",
        status: "done",
        file: outputArg,
        output: outputArg,
        unitId,
        unitID: unitId,
        unitType: target.unitType,
        format: inferredFormat,
        ...(worktreeId === undefined ? {} : { worktreeId }),
      };
    },
    presentCall: (args: ExportArguments) => ({
      card: "generic",
      title: `export ${args.output ?? args.file ?? "Unit"}`,
      kind: "execute",
      ...(args.output === undefined ? {} : { locations: [{ path: args.output }] }),
    }),
  }));

  return () => {
    disposeExport();
    disposeImport();
  };
}

function nonEmpty(value: string | undefined, message: string): string {
  if (value === undefined || value.trim() === "") throw new UniverError(message, "INVALID_REQUEST");
  return value.trim();
}

function explicitImportType(
  unitType: LocalExchangeUnitType | undefined,
  legacy: ImportArguments["type"],
): LocalExchangeUnitType | undefined {
  const legacyType = legacy === undefined || legacy === "auto" ? undefined : legacy;
  if (unitType !== undefined && legacyType !== undefined && unitType !== legacyType) {
    throw new UniverError(`unitType ${unitType} conflicts with type ${legacyType}.`, "INVALID_REQUEST");
  }
  return unitType ?? legacyType;
}

async function resolveUnitTarget(
  ctx: Context,
  scope: ToolSpaceScope,
  unitId: string,
  worktreeId: string | undefined,
): Promise<{ readonly unitType: LocalExchangeUnitType }> {
  const service = ctx.get("univerWorkspace")!;
  if (worktreeId === undefined) {
    const document = await service.resolveUnitResource(scope.userId, unitId);
    if (document.unitType === "board") {
      throw new UniverError("Board Units do not have an Office exchange format.", "EXCHANGE_FORMAT_UNSUPPORTED");
    }
    return { unitType: document.unitType };
  }
  await assertWorktreeAccessible(ctx, scope, worktreeId);
  const state = await service.getWorktreeFileState(scope.userId, worktreeId);
  const worktree = state.worktrees.find((entry) => entry.worktreeId === worktreeId);
  const unit = worktree?.units.find((entry) => entry.unitId === unitId);
  if (unit === undefined) throw new UniverError("The Unit is not part of the requested Worktree.", "UNIT_NOT_FOUND");
  if (unit.unitType === "board") {
    throw new UniverError("Board Units do not have an Office exchange format.", "EXCHANGE_FORMAT_UNSUPPORTED");
  }
  if (unit.source === "trunk") {
    await service.resolveUnitResource(scope.userId, unitId);
  }
  return { unitType: unit.unitType as LocalExchangeUnitType };
}
