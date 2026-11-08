import type { BufferImportOptions, ExportOptions } from "@univerjs-pro/exchange-node";

export type ConversionJob =
  | { kind: "import"; bytes: Uint8Array; options: BufferImportOptions }
  | { kind: "export"; data: Readonly<Record<string, unknown>>; options: ExportOptions };
export interface JobCredentials {
  readonly license: string;
  readonly licenseKey: string;
}
