/**
 * Local Office <-> Univer UnitData conversion.
 *
 * `dsh-univer-office` performs conversion before it touches a Worktree.  The
 * Workspace plugin follows the same rule: the exchange SDK runs in the
 * harness process, while the resulting plain UnitData is sent through the
 * product's Worktree-local Unit contract.  No product trunk exchange task is
 * involved, so an import can be reviewed, discarded, or merged like any
 * other agent change.
 *
 * @module dsh-univer-workspace-plugin/provider/local-exchange
 */

import { Buffer } from "node:buffer";
import { extname } from "node:path";
import {
  ExchangeFormat,
  FormulaCalculationMode,
  exportToBuffer,
  importBuffer,
  type ExportOptions,
  type ImportOptions,
} from "@univerjs-pro/exchange-node";
import { UniverInstanceType } from "@univerjs/core";

export type LocalExchangeUnitType = "sheet" | "doc" | "slide" | "base";
export type LocalExchangeFormat = "xlsx" | "csv" | "tsv" | "docx" | "pptx";

/** Keep the product's 1 MiB JSON route limit from becoming a vague 413. */
export const MAX_INITIAL_DATA_BYTES = 900 * 1024;

export class LocalExchangeError extends Error {
  constructor(
    message: string,
    readonly code:
      | "UNSUPPORTED_IMPORT_FORMAT"
      | "UNSUPPORTED_EXPORT_FORMAT"
      | "EXPORT_TYPE_MISMATCH"
      | "INVALID_UNIT_DATA"
      | "INITIAL_DATA_TOO_LARGE",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LocalExchangeError";
  }
}

/** Infer the Unit type from an Office filename, checking an explicit type. */
export function inferImportUnitType(
  fileName: string,
  explicit?: LocalExchangeUnitType,
): LocalExchangeUnitType {
  const extension = extname(fileName).toLowerCase();
  const inferred: LocalExchangeUnitType | undefined =
    extension === ".xls" || extension === ".xlsx" || extension === ".csv" || extension === ".tsv"
      ? "sheet"
      : extension === ".doc" || extension === ".docx"
        ? "doc"
        : extension === ".ppt" || extension === ".pptx"
          ? "slide"
          : undefined;
  if (
    inferred === undefined ||
    (explicit !== undefined &&
      explicit !== inferred &&
      !(inferred === "sheet" && explicit === "base"))
  ) {
    throw new LocalExchangeError(
      `Cannot import ${fileName} as ${explicit ?? "an inferred Unit type"}.`,
      "UNSUPPORTED_IMPORT_FORMAT",
    );
  }
  return explicit ?? inferred;
}

/** Infer a supported export format from an output filename. */
export function inferExportFormat(outputPath: string): LocalExchangeFormat {
  const extension = extname(outputPath).toLowerCase();
  if (
    extension === ".xlsx" ||
    extension === ".csv" ||
    extension === ".tsv" ||
    extension === ".docx" ||
    extension === ".pptx"
  ) {
    return extension.slice(1) as LocalExchangeFormat;
  }
  throw new LocalExchangeError(
    `Export output must end in .xlsx, .csv, .tsv, .docx, or .pptx (received ${outputPath}).`,
    "UNSUPPORTED_EXPORT_FORMAT",
  );
}

/** Ensure the output format is supported by the selected Unit type. */
export function assertCompatibleExport(
  unitType: LocalExchangeUnitType,
  format: LocalExchangeFormat,
): void {
  const compatible =
    ((unitType === "sheet" || unitType === "base") &&
      (format === "xlsx" || format === "csv" || format === "tsv")) ||
    (unitType === "doc" && format === "docx") ||
    (unitType === "slide" && format === "pptx");
  if (!compatible) {
    throw new LocalExchangeError(
      `Cannot export a ${unitType} Unit as ${format}.`,
      "EXPORT_TYPE_MISMATCH",
    );
  }
}

/** Convert an Office byte buffer to JSON-safe UnitData for a Worktree create. */
export async function importUnitData(
  bytes: Uint8Array,
  fileName: string,
  explicitType?: LocalExchangeUnitType,
): Promise<{
  readonly unitType: LocalExchangeUnitType;
  readonly data: Readonly<Record<string, unknown>>;
}> {
  const unitType = inferImportUnitType(fileName, explicitType);
  const format = importFormat(fileName);
  const options = importOptions(unitType, format, fileName);
  let data: unknown;
  try {
    // The SDK exposes one overload per Unit type; this function has already
    // narrowed the runtime pair, so the union-to-overload cast is deliberate.
    data = await importBuffer(Buffer.from(bytes), options as never);
  } catch (error) {
    throw new LocalExchangeError(
      `Could not import ${fileName}: ${error instanceof Error ? error.message : String(error)}`,
      "INVALID_UNIT_DATA",
      { cause: error },
    );
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new LocalExchangeError("Exchange SDK returned invalid UnitData.", "INVALID_UNIT_DATA");
  }
  const json = toJsonObject(data as Record<string, unknown>);
  const size = Buffer.byteLength(JSON.stringify(json), "utf8");
  if (size > MAX_INITIAL_DATA_BYTES) {
    throw new LocalExchangeError(
      `Imported UnitData is ${String(size)} bytes; the Worktree create contract accepts at most ${String(MAX_INITIAL_DATA_BYTES)} bytes.`,
      "INITIAL_DATA_TOO_LARGE",
    );
  }
  return { unitType, data: json };
}

/** Convert runtime UnitData to an Office byte buffer. */
export async function exportUnitData(
  data: Readonly<Record<string, unknown>>,
  unitType: LocalExchangeUnitType,
  outputPath: string,
): Promise<Uint8Array> {
  const format = inferExportFormat(outputPath);
  assertCompatibleExport(unitType, format);
  const json = toJsonObject(data);
  const options = exportOptions(unitType, format, json);
  try {
    // As above, `unitType` and `format` are checked together immediately
    // before this call, while the SDK models the valid pairs as overloads.
    const output = await exportToBuffer(json as never, options as never);
    return new Uint8Array(output);
  } catch (error) {
    throw new LocalExchangeError(
      `Could not export ${unitType} Unit to ${outputPath}: ${error instanceof Error ? error.message : String(error)}`,
      "INVALID_UNIT_DATA",
      { cause: error },
    );
  }
}

function importFormat(fileName: string): ExchangeFormat {
  switch (extname(fileName).toLowerCase()) {
    case ".xls":
      return ExchangeFormat.XLS;
    case ".xlsx":
      return ExchangeFormat.XLSX;
    case ".csv":
      return ExchangeFormat.CSV;
    case ".tsv":
      return ExchangeFormat.TSV;
    case ".doc":
      return ExchangeFormat.DOC;
    case ".docx":
      return ExchangeFormat.DOCX;
    case ".ppt":
      return ExchangeFormat.PPT;
    case ".pptx":
      return ExchangeFormat.PPTX;
    default:
      throw new LocalExchangeError(
        `Cannot infer import format from ${fileName}.`,
        "UNSUPPORTED_IMPORT_FORMAT",
      );
  }
}

function instanceType(unitType: LocalExchangeUnitType): UniverInstanceType {
  switch (unitType) {
    case "sheet":
      return UniverInstanceType.UNIVER_SHEET;
    case "doc":
      return UniverInstanceType.UNIVER_DOC;
    case "slide":
      return UniverInstanceType.UNIVER_SLIDE;
    case "base":
      return UniverInstanceType.UNIVER_BASE;
  }
}

function importOptions(
  unitType: LocalExchangeUnitType,
  format: ExchangeFormat,
  fileName: string,
): ImportOptions & { readonly fileName: string } {
  const base = { type: instanceType(unitType), format, fileName };
  if (format === ExchangeFormat.XLSX && unitType === "sheet") {
    return { ...base, formulaCalculation: FormulaCalculationMode.FORCED } as ImportOptions & {
      readonly fileName: string;
    };
  }
  // CSV/TSV accept an optional parser config. Supplying an empty object keeps
  // the option shape stable across the beta.2 SDK overloads.
  if (format === ExchangeFormat.CSV || format === ExchangeFormat.TSV) {
    return { ...base, csv: {} } as ImportOptions & { readonly fileName: string };
  }
  return base as ImportOptions & { readonly fileName: string };
}

function exportOptions(
  unitType: LocalExchangeUnitType,
  format: LocalExchangeFormat,
  data: Readonly<Record<string, unknown>>,
): ExportOptions {
  const type = instanceType(unitType);
  const exchangeFormat = format as ExchangeFormat;
  if (format === "csv" || format === "tsv") {
    const sheet = firstSheet(data);
    if (sheet === undefined) {
      throw new LocalExchangeError(
        "CSV/TSV export requires at least one worksheet.",
        "INVALID_UNIT_DATA",
      );
    }
    return {
      type,
      format: exchangeFormat,
      csv: { worksheetId: sheet.id },
    } as ExportOptions;
  }
  return {
    type,
    format: exchangeFormat,
    ...(unitType === "sheet" ? { formulaCalculation: FormulaCalculationMode.FORCED } : {}),
  } as ExportOptions;
}

function firstSheet(data: Readonly<Record<string, unknown>>): { readonly id: string } | undefined {
  const order = data.sheetOrder;
  const sheets = data.sheets;
  if (
    !Array.isArray(order) ||
    sheets === null ||
    typeof sheets !== "object" ||
    Array.isArray(sheets)
  )
    return undefined;
  const id = order.find((entry): entry is string => typeof entry === "string");
  return id === undefined ? undefined : { id };
}

/** Round-trip through JSON so the product request cannot contain exotic values. */
function toJsonObject(value: Record<string, unknown>): Readonly<Record<string, unknown>> {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("value is not JSON serializable");
    const decoded = JSON.parse(encoded) as unknown;
    if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded)) {
      throw new Error("value is not a JSON object");
    }
    return decoded as Readonly<Record<string, unknown>>;
  } catch (error) {
    throw new LocalExchangeError(
      `UnitData is not JSON serializable: ${error instanceof Error ? error.message : String(error)}`,
      "INVALID_UNIT_DATA",
      { cause: error },
    );
  }
}
