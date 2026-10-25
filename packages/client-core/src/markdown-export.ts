import type {
  CompileDocMarkdownReadOptions,
  DocMarkdownReadResult,
} from "@univer-cli/doc-markdown-facade";
import { writeDocMarkdownExport } from "@univer-cli/doc-markdown-facade/node";

export type WorkspaceMarkdownReadOptions = CompileDocMarkdownReadOptions;

export interface WorkspaceMarkdownExportResult extends DocMarkdownReadResult {
  readonly revision: number;
}

/** Write a Markdown artifact and bounded resource sidecars beside the source file. */
export async function writeWorkspaceMarkdownExport(
  result: WorkspaceMarkdownExportResult,
  file: string,
  sourceMapFile?: string,
): Promise<void> {
  await writeDocMarkdownExport(result, {
    markdownPath: file,
    ...(sourceMapFile === undefined ? {} : { sourceMapPath: sourceMapFile }),
  });
}
