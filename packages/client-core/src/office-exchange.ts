import { extname } from "node:path";
import {
  ExchangeFormat,
  FormulaCalculationMode,
  exportToBuffer,
  exportToFile,
  importBuffer,
  importFile,
  type BufferImportOptions,
  type ExportOptions,
  type ImportOptions,
} from "@univerjs-pro/exchange-node";
import { UniverInstanceType } from "@univerjs/core";
import { measureCanonicalJson } from "./canonical-json.js";
import { WorkspaceApplicationError, workspaceError } from "./errors.js";
import { inspectSource, openSource, writeDownload, type SourceFile } from "./files.js";
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
type ImportOfficeBuffer = (
  input: Buffer,
  options: BufferImportOptions,
) => Promise<Readonly<Record<string, unknown>>>;
type ExportOfficeFile = (
  data: Readonly<Record<string, unknown>>,
  path: string,
  options: ExportOptions,
) => Promise<void>;
type ExportOfficeBuffer = (
  data: Readonly<Record<string, unknown>>,
  options: ExportOptions,
) => Promise<Buffer>;

const importOfficeFile = importFile as unknown as ImportOfficeFile;
const importOfficeBuffer = importBuffer as unknown as ImportOfficeBuffer;
const exportOfficeBuffer = exportToBuffer as unknown as ExportOfficeBuffer;
const exportOfficeFile = exportToFile as unknown as ExportOfficeFile;

export interface WorkspaceUnitExchangeDependencies {
  readonly runtime: Pick<WorkspaceContentRuntimeOperations, "exportUnitData">;
  readonly exportToBuffer?: ExportOfficeBuffer;
  readonly exportToFile?: ExportOfficeFile;
  readonly importBuffer?: ImportOfficeBuffer;
  readonly importFile?: ImportOfficeFile;
  readonly inspectSource?: typeof inspectSource;
  readonly openSource?: typeof openSource;
  readonly writeOutput?: typeof writeDownload;
  readonly createUnit: (input: {
    readonly idempotencyKey?: string;
    readonly initialData: Readonly<Record<string, unknown>>;
    readonly name: string;
    readonly parentNodeId?: string;
    readonly spaceId: string;
    readonly type: WorkspaceUnitType;
    readonly worktreeId: string;
  }, signal?: AbortSignal) => Promise<WorkspaceUnit>;
  readonly resolveRuntimeTarget: (input: {
    readonly unitId: string;
    readonly worktreeId: string;
  }, signal?: AbortSignal) => Promise<WorkspaceRuntimeTarget>;
}

export interface WorkspaceImportFileControls {
  readonly maxSourceBytes?: number;
  readonly maxUnitDataBytes?: number;
  readonly maxUnitDataDepth?: number;
  readonly signal?: AbortSignal;
}

export interface WorkspaceExportFileControls {
  readonly atomicOutput?: {
    readonly force: boolean;
    readonly maxOutputBytes: number;
  };
  readonly maxUnitDataBytes?: number;
  readonly maxUnitDataDepth?: number;
  readonly signal?: AbortSignal;
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

  public async importFile(
    input: WorkspaceImportFileInput,
    controls?: WorkspaceImportFileControls,
  ): Promise<WorkspaceImportFileResult> {
    controls?.signal?.throwIfAborted();
    validateImportControls(controls);
    const type = inferImportType(input.sourcePath, input.type);
    const unitType = toInstanceType(type);
    const options = importOptions(input.sourcePath, unitType);
    const imported = controls === undefined
      ? await (this.dependencies.importFile ?? importOfficeFile)(input.sourcePath, options)
      : await importControlled(this.dependencies, input.sourcePath, options, controls);
    controls?.signal?.throwIfAborted();
    if (controls !== undefined) validateOfficeUnitData(imported);
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
    if (controls !== undefined) {
      validateOfficeUnitData(initialData, controls.maxUnitDataBytes, controls.maxUnitDataDepth);
      controls.signal?.throwIfAborted();
    }
    const createInput = {
      initialData,
      name,
      spaceId: input.spaceId,
      type,
      worktreeId: input.worktreeId,
      ...(input.parentNodeId === undefined ? {} : { parentNodeId: input.parentNodeId }),
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    };
    const created = controls?.signal === undefined
      ? await this.dependencies.createUnit(createInput)
      : await this.dependencies.createUnit(createInput, controls.signal);
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

  public async exportFile(
    input: WorkspaceExportFileInput,
    controls?: WorkspaceExportFileControls,
  ): Promise<WorkspaceExportFileResult> {
    controls?.signal?.throwIfAborted();
    validateExportControls(controls);
    const targetInput = {
      unitId: input.unitId,
      worktreeId: input.worktreeId,
    };
    const target = controls?.signal === undefined
      ? await this.dependencies.resolveRuntimeTarget(targetInput)
      : await this.dependencies.resolveRuntimeTarget(targetInput, controls.signal);
    controls?.signal?.throwIfAborted();
    if (target.unitType === "board") {
      throw workspaceError(
        "workspace-unit-type-unsupported",
        "Workspace file exchange does not support Board Units.",
        { unitId: input.unitId },
      );
    }
    const format = inferExportFormat(input.outputPath);
    requireCompatibleExport(target.unitType, format);
    let result: unknown;
    try {
      result = await this.dependencies.runtime.exportUnitData({
        target,
        ...(controls?.maxUnitDataBytes === undefined
          ? {}
          : { maxValueBytes: controls.maxUnitDataBytes }),
        ...(controls?.maxUnitDataDepth === undefined
          ? {}
          : { maxValueDepth: controls.maxUnitDataDepth }),
        ...(controls?.signal === undefined ? {} : { signal: controls.signal }),
      });
    } catch (error) {
      throw projectRuntimeOfficeLimit(error) ?? error;
    }
    controls?.signal?.throwIfAborted();
    if (controls !== undefined) {
      validateOfficeUnitData(result, controls.maxUnitDataBytes, controls.maxUnitDataDepth);
    }
    if (!isRecord(result) || result["id"] !== target.unitId) {
      throw workspaceError(
        "workspace-exchange-unit-data-invalid",
        `Workspace runtime exported invalid UnitData for ${target.unitId}.`,
      );
    }
    if (controls?.atomicOutput === undefined) {
      await exportUnit(
        this.dependencies.exportToFile ?? exportOfficeFile,
        target.unitType,
        result,
        format,
        input.outputPath,
      );
    } else {
      const output = await exportUnitBuffer(
        this.dependencies.exportToBuffer ?? exportOfficeBuffer,
        target.unitType,
        result,
        format,
      );
      controls.signal?.throwIfAborted();
      if (output.byteLength > controls.atomicOutput.maxOutputBytes) {
        throw officeLimit("output-bytes", controls.atomicOutput.maxOutputBytes, output.byteLength);
      }
      await (this.dependencies.writeOutput ?? writeDownload)({
        content: singleChunk(output),
        expectedSize: output.byteLength,
        force: controls.atomicOutput.force,
        kind: "office",
        outputPath: input.outputPath,
        ...(controls.signal === undefined ? {} : { signal: controls.signal }),
      });
    }
    return {
      outputPath: input.outputPath,
      type: target.unitType,
      unitId: target.unitId,
      worktreeId: input.worktreeId,
    };
  }
}

async function importControlled(
  dependencies: WorkspaceUnitExchangeDependencies,
  sourcePath: string,
  options: ImportOptions,
  controls: WorkspaceImportFileControls,
): Promise<Readonly<Record<string, unknown>>> {
  const source = await (dependencies.inspectSource ?? inspectSource)(sourcePath, controls.signal);
  controls.signal?.throwIfAborted();
  if (controls.maxSourceBytes !== undefined && source.byteSize > controls.maxSourceBytes) {
    throw officeLimit(
      "source-bytes",
      controls.maxSourceBytes,
      Math.min(source.byteSize, controls.maxSourceBytes + 1),
    );
  }
  const bytes = await collectOfficeSource(
    (dependencies.openSource ?? openSource)(source, controls.signal),
    source,
    controls.maxSourceBytes,
    controls.signal,
  );
  controls.signal?.throwIfAborted();
  const imported = await (dependencies.importBuffer ?? importOfficeBuffer)(bytes, {
    ...options,
    fileName: source.originalFilename,
  } as BufferImportOptions);
  controls.signal?.throwIfAborted();
  return imported;
}

async function collectOfficeSource(
  content: AsyncIterable<Uint8Array>,
  source: SourceFile,
  maxBytes: number | undefined,
  signal: AbortSignal | undefined,
): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let byteSize = 0;
  const iterator = content[Symbol.asyncIterator]();
  try {
    while (true) {
      signal?.throwIfAborted();
      const item = await iterator.next();
      signal?.throwIfAborted();
      if (item.done) break;
      if (maxBytes !== undefined) {
        const remainingWithSentinel = maxBytes - byteSize + 1;
        if (item.value.byteLength >= remainingWithSentinel) {
          byteSize += remainingWithSentinel;
          throw officeLimit("source-bytes", maxBytes, byteSize);
        }
      }
      byteSize += item.value.byteLength;
      chunks.push(item.value);
    }
  } finally {
    await iterator.return?.().catch(() => undefined);
  }
  signal?.throwIfAborted();
  if (byteSize !== source.byteSize) {
    throw workspaceError(
      "workspace-blob-size-mismatch",
      "Office source byte stream does not match the inspected byte size.",
      { actualByteSize: byteSize, expectedByteSize: source.byteSize, path: source.path },
    );
  }
  return Buffer.concat(chunks, byteSize);
}

function validateImportControls(controls: WorkspaceImportFileControls | undefined): void {
  if (controls === undefined) return;
  validatePositiveLimit(controls.maxSourceBytes, "source-bytes");
  validatePositiveLimit(controls.maxUnitDataBytes, "unit-data-bytes");
  if (
    controls.maxUnitDataDepth !== undefined
    && (!Number.isSafeInteger(controls.maxUnitDataDepth) || controls.maxUnitDataDepth < 0)
  ) {
    throw officeLimit("unit-data-depth", controls.maxUnitDataDepth);
  }
}

function validateExportControls(controls: WorkspaceExportFileControls | undefined): void {
  if (controls === undefined) return;
  validatePositiveLimit(controls.maxUnitDataBytes, "unit-data-bytes");
  if (
    controls.maxUnitDataDepth !== undefined
    && (!Number.isSafeInteger(controls.maxUnitDataDepth) || controls.maxUnitDataDepth < 0)
  ) {
    throw officeLimit("unit-data-depth", controls.maxUnitDataDepth);
  }
  if (controls.atomicOutput !== undefined) {
    validatePositiveLimit(controls.atomicOutput.maxOutputBytes, "output-bytes");
  }
}

function validatePositiveLimit(value: number | undefined, kind: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
    throw officeLimit(kind, value);
  }
}

function validateOfficeUnitData(
  value: unknown,
  maxBytes?: number,
  maxDepth?: number,
): void {
  let measurement;
  try {
    measurement = measureCanonicalJson(value);
  } catch {
    throw workspaceError(
      "workspace-exchange-unit-data-invalid",
      "Office conversion returned invalid UnitData.",
    );
  }
  if (maxDepth !== undefined && measurement.depth > maxDepth) {
    throw officeLimit("unit-data-depth", maxDepth, measurement.depth);
  }
  if (maxBytes !== undefined && measurement.bytes > maxBytes) {
    throw officeLimit("unit-data-bytes", maxBytes, measurement.bytes);
  }
}

function officeLimit(kind: string, limit: number, actual?: number): Error {
  return workspaceError(
    "workspace-office-limit-exceeded",
    "Office exchange exceeded a configured limit.",
    { kind, limit, ...(actual === undefined ? {} : { actual }) },
  );
}

function projectRuntimeOfficeLimit(error: unknown): Error | undefined {
  if (
    !(error instanceof WorkspaceApplicationError)
    || Object.getPrototypeOf(error) !== WorkspaceApplicationError.prototype
    || dataProperty(error, "code") !== "workspace-content-limit-exceeded"
  ) return undefined;
  const detail = dataProperty(error, "detail");
  if (!isRecord(detail) || !hasExactDataKeys(detail, ["actual", "kind", "limit"])) return undefined;
  const actual = dataProperty(detail, "actual");
  const kind = dataProperty(detail, "kind");
  const limit = dataProperty(detail, "limit");
  if (!Number.isSafeInteger(actual) || !Number.isSafeInteger(limit)) return undefined;
  if (kind === "export-unit-data-bytes") return officeLimit("unit-data-bytes", limit as number, actual as number);
  if (kind === "export-unit-data-depth") return officeLimit("unit-data-depth", limit as number, actual as number);
  return undefined;
}

function hasExactDataKeys(value: object, keys: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length && keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && descriptor.enumerable === true && "value" in descriptor;
  });
}

function dataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
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
  await exchange(data, outputPath, exportOptions(type, format));
}

async function exportUnitBuffer(
  exchange: ExportOfficeBuffer,
  type: Exclude<WorkspaceUnitType, "board">,
  data: Readonly<Record<string, unknown>>,
  format: ExchangeFormat,
): Promise<Buffer> {
  return await exchange(data, exportOptions(type, format));
}

async function* singleChunk(output: Buffer): AsyncIterable<Uint8Array> {
  yield output;
}

function exportOptions(
  type: Exclude<WorkspaceUnitType, "board">,
  format: ExchangeFormat,
): ExportOptions {
  const unitType = toInstanceType(type);
  return {
    format,
    type: unitType,
    ...(unitType === UniverInstanceType.UNIVER_SHEET
      ? { formulaCalculation: FormulaCalculationMode.FORCED }
      : {}),
  } as ExportOptions;
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
