// Types the rest of the program may use without importing Univer packages (lens imports only this file).
import type { ICellData, IWorkbookData, IWorksheetData } from "@univerjs/core";

/** Univer workbook snapshot, exactly as the exchange binding or `workbook.save()` produces it. */
export type Snapshot = IWorkbookData;
export type SnapshotSheet = Partial<IWorksheetData>;
export type SnapshotCell = ICellData;

/** Formats uxl can read. Detected from content, never from the extension. */
export type FileFormat = "xlsx" | "xlsm" | "xls" | "csv" | "tsv";
/** Formats uxl can write. xls and xlsm are read-only (no writer; VBA cannot be preserved). */
export type ExportFormat = "xlsx" | "csv" | "tsv";
