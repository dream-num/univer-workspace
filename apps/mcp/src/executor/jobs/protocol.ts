import type { BufferImportOptions, ExportOptions } from "@univerjs-pro/exchange-node";

export type ConversionJob =
  | { kind: "markdown.materialize"; javascript: string; targetUnitId: string }
  | { kind: "import"; bytes: Uint8Array; options: BufferImportOptions }
  | { kind: "export"; data: Readonly<Record<string, unknown>>; options: ExportOptions };
export interface JobCredentials {
  readonly license: string;
  readonly licenseKey: string;
}

export type JobRequest =
  | Extract<ConversionJob, { kind: "import" }>
  | (Extract<ConversionJob, { kind: "export" | "markdown.materialize" }> & JobCredentials);
