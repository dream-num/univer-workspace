import { extname } from "node:path";
import {
  ExchangeFormat,
  FormulaCalculationMode,
  exportToFile,
  importFile,
  type ExportOptions,
  type ImportOptions,
} from "@univerjs-pro/exchange-node";
import { UniverInstanceType } from "@univerjs/core";
import { workspaceError } from "./errors.js";
import type { WorkspaceContentRuntimeOperations } from "./content-runtime.js";
import type { WorkspaceRuntimeTarget } from "./runtime-target.js";
import type { WorkspaceUnitType } from "./space-model.js";
import type { WorkspaceUnit } from "./worktree-model.js";

type WorkspaceExchangeUnitType =
  | UniverInstanceType.UNIVER_SHEET
  | UniverInstanceType.UNIVER_BASE
  | UniverInstanceType.UNIVER_DOC
  | UniverInstanceType.UNIVER_SLIDE;
type ImportOfficeFile = (
  path: string,
  options: ImportOptions,
) => Promise<Readonly<Record<string, unknown>>>;
type ExportOfficeFile = (
  data: Readonly<Record<string, unknown>>,
  path: string,
  options: ExportOptions,
) => Promise<void>;

const importOfficeFile = importFile as unknown as ImportOfficeFile;
const exportOfficeFile = exportToFile as unknown as ExportOfficeFile;

export interface WorkspaceUnitExchangeDependencies {
  readonly runtime: Pick<WorkspaceContentRuntimeOperations, "exportUnitData">;
  readonly exportToFile?: ExportOfficeFile;
  readonly importFile?: ImportOfficeFile;
  readonly createUnit: (input: {
    readonly idempotencyKey?: string;
    readonly initialData: Readonly<Record<string, unknown>>;
    readonly name: string;
    readonly parentNodeId?: string;
    readonly spaceId: string;
    readonly type: WorkspaceUnitType;
    readonly worktreeId: string;
  }) => Promise<WorkspaceUnit>;
  readonly resolveRuntimeTarget: (input: {
    readonly unitId: string;
    readonly worktreeId: string;
  }) => Promise<WorkspaceRuntimeTarget>;
}

export interface WorkspaceImportFileInput {
  readonly idempotencyKey?: string;
  readonly name?: string;
  readonly parentNodeId?: string;
  readonly sourcePath: string;
  readonly spaceId: string;
  readonly type?: Exclude<WorkspaceUnitType, "board">;
  readonly worktreeId: string;
}

export interface WorkspaceImportFileResult {
  readonly committed: true;
  readonly name: string;
  readonly nodeId: string;
  readonly resourceId: string;
  readonly sourcePath: string;
  readonly type: Exclude<WorkspaceUnitType, "board">;
  readonly unitId: string;
  readonly worktreeId: string;
}

export interface WorkspaceExportFileInput {
  readonly outputPath: string;
  readonly unitId: string;
  readonly worktreeId: string;
}

export interface WorkspaceExportFileResult {
  readonly outputPath: string;
  readonly type: Exclude<WorkspaceUnitType, "board">;
  readonly unitId: string;
  readonly worktreeId: string;
}

export class WorkspaceUnitExchangeFeature {
  public constructor(private readonly dependencies: WorkspaceUnitExchangeDependencies) {}

  public async importFile(input: WorkspaceImportFileInput): Promise<WorkspaceImportFileResult> {
    const type = inferImportType(input.sourcePath, input.type);
    const unitType = toInstanceType(type);
    const imported = await (this.dependencies.importFile ?? importOfficeFile)(
      input.sourcePath,
      importOptions(input.sourcePath, unitType),
    );
    const explicitName = nonEmpty(input.name);
    const name =
      explicitName ??
      nonEmpty(imported["name"]) ??
      nonEmpty(imported["title"]) ??
      `Imported ${type}`;
    const initialData = {
      ...imported,
      ...(explicitName === undefined ? {} : { name: explicitName }),
    } as Readonly<Record<string, unknown>>;
    const created = await this.dependencies.createUnit({
      initialData,
      name,
      spaceId: input.spaceId,
      type,
      worktreeId: input.worktreeId,
      ...(input.parentNodeId === undefined ? {} : { parentNodeId: input.parentNodeId }),
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    });
    requireCreatedUnit(created, { ...input, name, type });
    return {
      committed: true,
      name,
      nodeId: created.nodeId,
      resourceId: created.resourceId,
      sourcePath: input.sourcePath,
      type,
      unitId: created.unitId,
      worktreeId: input.worktreeId,
    };
  }

  public async exportFile(input: WorkspaceExportFileInput): Promise<WorkspaceExportFileResult> {
    const target = await this.dependencies.resolveRuntimeTarget({
      unitId: input.unitId,
      worktreeId: input.worktreeId,
    });
    if (target.unitType === "board") {
      throw workspaceError(
        "workspace-unit-type-unsupported",
        "Workspace file exchange does not support Board Units.",
        { unitId: input.unitId },
      );
    }
    const format = inferExportFormat(input.outputPath);
    requireCompatibleExport(target.unitType, format);
    const result: unknown = await this.dependencies.runtime.exportUnitData({ target });
    if (!isRecord(result) || result["id"] !== target.unitId) {
      throw workspaceError(
        "workspace-exchange-unit-data-invalid",
        `Workspace runtime exported invalid UnitData for ${target.unitId}.`,
      );
    }
    await exportUnit(
      this.dependencies.exportToFile ?? exportOfficeFile,
      target.unitType,
      result,
      format,
      input.outputPath,
    );
    return {
      outputPath: input.outputPath,
      type: target.unitType,
      unitId: target.unitId,
      worktreeId: input.worktreeId,
    };
  }
}

function inferImportType(
  sourcePath: string,
  explicit?: Exclude<WorkspaceUnitType, "board">,
): Exclude<WorkspaceUnitType, "board"> {
  const extension = extname(sourcePath).toLowerCase();
  if (extension === ".xls" || extension === ".xlsx") {
    if (explicit === undefined || explicit === "sheet" || explicit === "base") {
      return explicit ?? "sheet";
    }
  } else if (extension === ".doc" || extension === ".docx") {
    if (explicit === undefined || explicit === "doc") return "doc";
  } else if ([".ppt", ".pptx", ".pptm", ".ppsx", ".ppsm", ".potx"].includes(extension)) {
    if (explicit === undefined || explicit === "slide") return "slide";
  }
  throw workspaceError(
    "workspace-exchange-import-format-unsupported",
    `Cannot import ${sourcePath} as ${explicit ?? "an inferred Unit type"}.`,
  );
}

function inferExportFormat(outputPath: string): ExchangeFormat {
  switch (extname(outputPath).toLowerCase()) {
    case ".xlsx":
      return ExchangeFormat.XLSX;
    case ".docx":
      return ExchangeFormat.DOCX;
    case ".pptx":
      return ExchangeFormat.PPTX;
    default:
      throw workspaceError(
        "workspace-exchange-export-format-unsupported",
        "Export output must end in .xlsx, .docx, or .pptx.",
      );
  }
}

function requireCompatibleExport(
  type: Exclude<WorkspaceUnitType, "board">,
  format: ExchangeFormat,
): void {
  const compatible =
    ((type === "sheet" || type === "base") && format === ExchangeFormat.XLSX) ||
    (type === "doc" && format === ExchangeFormat.DOCX) ||
    (type === "slide" && format === ExchangeFormat.PPTX);
  if (!compatible) {
    throw workspaceError(
      "workspace-exchange-export-format-mismatch",
      `Cannot export a ${type} Unit as ${format}.`,
    );
  }
}

function toInstanceType(type: Exclude<WorkspaceUnitType, "board">): WorkspaceExchangeUnitType {
  switch (type) {
    case "sheet":
      return UniverInstanceType.UNIVER_SHEET;
    case "base":
      return UniverInstanceType.UNIVER_BASE;
    case "doc":
      return UniverInstanceType.UNIVER_DOC;
    case "slide":
      return UniverInstanceType.UNIVER_SLIDE;
  }
}

async function exportUnit(
  exchange: ExportOfficeFile,
  type: Exclude<WorkspaceUnitType, "board">,
  data: Readonly<Record<string, unknown>>,
  format: ExchangeFormat,
  outputPath: string,
): Promise<void> {
  const unitType = toInstanceType(type);
  await exchange(data, outputPath, {
    format,
    type: unitType,
    ...(unitType === UniverInstanceType.UNIVER_SHEET
      ? { formulaCalculation: FormulaCalculationMode.FORCED }
      : {}),
  } as ExportOptions);
}

function importOptions(sourcePath: string, type: WorkspaceExchangeUnitType): ImportOptions {
  const extension = extname(sourcePath).toLowerCase();
  const format = [".pptm", ".ppsx", ".ppsm", ".potx"].includes(extension)
    ? ExchangeFormat.PPTX
    : undefined;
  return {
    type,
    ...(format === undefined ? {} : { format }),
    ...(type === UniverInstanceType.UNIVER_SHEET && extension === ".xlsx"
      ? { formulaCalculation: FormulaCalculationMode.FORCED }
      : {}),
  } as ImportOptions;
}

function requireCreatedUnit(
  unit: WorkspaceUnit,
  input: WorkspaceImportFileInput & {
    readonly name: string;
    readonly type: Exclude<WorkspaceUnitType, "board">;
  },
): void {
  if (
    unit.worktreeId !== input.worktreeId ||
    unit.source !== "worktree" ||
    unit.type !== input.type ||
    unit.name !== input.name ||
    unit.target?.spaceId !== input.spaceId ||
    unit.target.parentNodeId !== (input.parentNodeId ?? null)
  ) {
    throw workspaceError(
      "workspace-result-mismatch",
      "Workspace import response does not match the requested Unit.",
    );
  }
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
