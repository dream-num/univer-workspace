import { Buffer } from "node:buffer";
import { extname } from "node:path";
import {
  ExchangeFormat,
  FormulaCalculationMode,
  configureExchange,
  exportToBuffer,
  exportToFile,
  importBuffer,
  importFile,
  type BufferImportOptions,
  type ExportOptions,
  type IExchangeConfig,
  type ImportOptions,
} from "@univerjs-pro/exchange-node";
import { UniverInstanceType } from "@univerjs/core";
import { workspaceError } from "./errors.js";
import type { WorkspaceContentRuntimeOperations } from "./content-runtime.js";
import type { WorkspaceRuntimeTarget } from "./runtime-target.js";
import type { WorkspaceUnitType } from "./space-model.js";
import type { WorkspaceUnit } from "./worktree-model.js";
import type { WorkspaceContentSource } from "./runtime-source.js";
import { resolveWorkspaceExportImages } from "./export-images.js";

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

type ImportOfficeBuffer = (
  input: Buffer,
  options: BufferImportOptions,
) => Promise<Readonly<Record<string, unknown>>>;
type ExportOfficeBuffer = (
  data: Readonly<Record<string, unknown>>,
  options: ExportOptions,
) => Promise<Buffer>;

const importOfficeFile = importFile as unknown as ImportOfficeFile;
const exportOfficeFile = exportToFile as unknown as ExportOfficeFile;
const importOfficeBuffer = importBuffer as unknown as ImportOfficeBuffer;
const exportOfficeBuffer = exportToBuffer as unknown as ExportOfficeBuffer;

export interface WorkspaceUnitExchangeDependencies {
  /** Exchange verifies the license with its key; without both it runs on the free tier. */
  readonly license: string;
  readonly licenseKey: string;
  readonly configureExchange?: (config: IExchangeConfig) => Promise<void>;
  readonly resolveImageAsset: WorkspaceContentSource["resolveImageAsset"];
  readonly runtime: Pick<WorkspaceContentRuntimeOperations, "exportUnitData">;
  readonly exportToFile?: ExportOfficeFile;
  readonly importFile?: ImportOfficeFile;
  readonly exportToBuffer?: ExportOfficeBuffer;
  readonly importBuffer?: ImportOfficeBuffer;
  /**
   * "process" (default) configures the credentials once per process.
   * "per-operation" never touches the process configuration and passes the
   * credentials with each export, so one process can serve many licenses.
   */
  readonly licenseMode?: "process" | "per-operation";
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
  readonly type?: Exclude<WorkspaceUnitType, "board" | "pdf">;
  readonly worktreeId: string;
}

export interface WorkspaceImportFileResult {
  readonly committed: true;
  readonly name: string;
  readonly nodeId: string;
  readonly resourceId: string;
  readonly sourcePath: string;
  readonly type: Exclude<WorkspaceUnitType, "board" | "pdf">;
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
  readonly type: Exclude<WorkspaceUnitType, "board" | "pdf">;
  readonly unitId: string;
  readonly worktreeId: string;
}

export interface WorkspaceImportBufferInput extends Omit<WorkspaceImportFileInput, "sourcePath"> {
  readonly bytes: Uint8Array;
  /** Drives type inference and the default Unit name, like `sourcePath` for files. */
  readonly fileName: string;
}

export interface WorkspaceImportBufferResult extends Omit<WorkspaceImportFileResult, "sourcePath"> {
  readonly fileName: string;
}

export interface WorkspaceExportBufferInput {
  readonly format: "xlsx" | "docx" | "pptx";
  readonly unitId: string;
  readonly worktreeId: string;
}

export interface WorkspaceExportBufferResult {
  readonly bytes: Uint8Array;
  readonly format: "xlsx" | "docx" | "pptx";
  readonly type: Exclude<WorkspaceUnitType, "board" | "pdf">;
  readonly unitId: string;
  readonly worktreeId: string;
}

type ImportedUnitFields = Omit<WorkspaceImportFileResult, "sourcePath">;

export class WorkspaceUnitExchangeFeature {
  private configured: Promise<void> | undefined;

  public constructor(private readonly dependencies: WorkspaceUnitExchangeDependencies) {
    if (
      dependencies.licenseMode === "per-operation" &&
      (nonEmpty(dependencies.license) === undefined) !==
        (nonEmpty(dependencies.licenseKey) === undefined)
    ) {
      throw workspaceError(
        "workspace-exchange-license-incomplete",
        "Per-operation exchange needs both license and licenseKey, or neither for the free tier.",
      );
    }
  }

  public async importFile(input: WorkspaceImportFileInput): Promise<WorkspaceImportFileResult> {
    const imported = await this.importUnit(input, input.sourcePath, (options) =>
      (this.dependencies.importFile ?? importOfficeFile)(input.sourcePath, options),
    );
    return { ...imported, sourcePath: input.sourcePath };
  }

  public async importBuffer(input: WorkspaceImportBufferInput): Promise<WorkspaceImportBufferResult> {
    const imported = await this.importUnit(input, input.fileName, (options) =>
      (this.dependencies.importBuffer ?? importOfficeBuffer)(
        Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength),
        { ...options, fileName: input.fileName } as BufferImportOptions,
      ),
    );
    return { ...imported, fileName: input.fileName };
  }

  public async exportFile(input: WorkspaceExportFileInput): Promise<WorkspaceExportFileResult> {
    const prepared = await this.prepareExport(input, () => inferExportFormat(input.outputPath));
    await (this.dependencies.exportToFile ?? exportOfficeFile)(
      prepared.data,
      input.outputPath,
      this.exportOptions(prepared.type, prepared.format),
    );
    return {
      outputPath: input.outputPath,
      type: prepared.type,
      unitId: prepared.unitId,
      worktreeId: input.worktreeId,
    };
  }

  public async exportBuffer(input: WorkspaceExportBufferInput): Promise<WorkspaceExportBufferResult> {
    const prepared = await this.prepareExport(input, () => bufferExportFormat(input.format));
    const output = await (this.dependencies.exportToBuffer ?? exportOfficeBuffer)(
      prepared.data,
      this.exportOptions(prepared.type, prepared.format),
    );
    return {
      bytes: new Uint8Array(output),
      format: input.format,
      type: prepared.type,
      unitId: prepared.unitId,
      worktreeId: input.worktreeId,
    };
  }

  private async importUnit(
    input: Omit<WorkspaceImportFileInput, "sourcePath">,
    fileName: string,
    convert: (options: ImportOptions) => Promise<Readonly<Record<string, unknown>>>,
  ): Promise<ImportedUnitFields> {
    const type = inferImportType(fileName, input.type);
    const unitType = toInstanceType(type);
    await this.configureExchange();
    const imported = await convert(importOptions(fileName, unitType));
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
      type,
      unitId: created.unitId,
      worktreeId: input.worktreeId,
    };
  }

  private async prepareExport(
    input: { readonly unitId: string; readonly worktreeId: string },
    formatOf: () => ExchangeFormat,
  ): Promise<{
    readonly data: Readonly<Record<string, unknown>>;
    readonly format: ExchangeFormat;
    readonly type: Exclude<WorkspaceUnitType, "board" | "pdf">;
    readonly unitId: string;
  }> {
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
    const type = target.unitType;
    const format = formatOf();
    requireCompatibleExport(type, format);
    await this.configureExchange();
    const result: unknown = await this.dependencies.runtime.exportUnitData({ target });
    if (!isRecord(result) || result["id"] !== target.unitId) {
      throw workspaceError(
        "workspace-exchange-unit-data-invalid",
        `Workspace runtime exported invalid UnitData for ${target.unitId}.`,
      );
    }
    return {
      data: await resolveWorkspaceExportImages(
        result,
        input.worktreeId,
        this.dependencies.resolveImageAsset,
      ),
      format,
      type,
      unitId: target.unitId,
    };
  }

  private exportOptions(
    type: Exclude<WorkspaceUnitType, "board" | "pdf">,
    format: ExchangeFormat,
  ): ExportOptions {
    const unitType = toInstanceType(type);
    const license = nonEmpty(this.dependencies.license)?.trim();
    const licenseKey = nonEmpty(this.dependencies.licenseKey)?.trim();
    return {
      format,
      type: unitType,
      ...(unitType === UniverInstanceType.UNIVER_SHEET
        ? { formulaCalculation: FormulaCalculationMode.FORCED }
        : {}),
      ...(this.dependencies.licenseMode === "per-operation" &&
      license !== undefined &&
      licenseKey !== undefined
        ? { license, licenseKey }
        : {}),
    } as ExportOptions;
  }

  // Exchange credentials belong to the JS context, so set them once before the
  // first conversion; a rejected configuration is retried by the next call.
  private async configureExchange(): Promise<void> {
    if (this.dependencies.licenseMode === "per-operation") return;
    this.configured ??= (this.dependencies.configureExchange ?? configureExchange)({
      license: this.dependencies.license,
      licenseKey: this.dependencies.licenseKey,
    }).catch((error: unknown) => {
      this.configured = undefined;
      throw error;
    });
    await this.configured;
  }
}

function inferImportType(
  sourcePath: string,
  explicit?: Exclude<WorkspaceUnitType, "board" | "pdf">,
): Exclude<WorkspaceUnitType, "board" | "pdf"> {
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
  type: Exclude<WorkspaceUnitType, "board" | "pdf">,
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

function toInstanceType(type: Exclude<WorkspaceUnitType, "board" | "pdf">): WorkspaceExchangeUnitType {
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

function bufferExportFormat(format: WorkspaceExportBufferInput["format"]): ExchangeFormat {
  switch (format) {
    case "xlsx":
      return ExchangeFormat.XLSX;
    case "docx":
      return ExchangeFormat.DOCX;
    case "pptx":
      return ExchangeFormat.PPTX;
    default:
      throw workspaceError(
        "workspace-exchange-export-format-unsupported",
        "Export format must be xlsx, docx, or pptx.",
      );
  }
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
  input: Omit<WorkspaceImportFileInput, "sourcePath"> & {
    readonly name: string;
    readonly type: Exclude<WorkspaceUnitType, "board" | "pdf">;
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
