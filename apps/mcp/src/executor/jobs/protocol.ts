import type { BufferImportOptions, ExportOptions } from "@univerjs-pro/exchange-node";

import type { WorkspaceSourceFiles } from "@univerjs/univer-workspace-client-core";

export type ConversionJob =
  | { kind: "typst.compile"; bundle: WorkspaceSourceFiles }
  | {
      kind: "markdown.materialize";
      javascript: string;
      targetUnitId: string;
      format?: "Markdown" | "Typst";
    }
  | { kind: "import"; bytes: Uint8Array; options: BufferImportOptions }
  | { kind: "export"; data: Readonly<Record<string, unknown>>; options: ExportOptions };
export interface JobCredentials {
  readonly license: string;
  readonly licenseKey: string;
}

export type JobRequest =
  | Extract<ConversionJob, { kind: "import" }>
  | (Extract<ConversionJob, { kind: "export" | "markdown.materialize" | "typst.compile" }> &
      JobCredentials);
