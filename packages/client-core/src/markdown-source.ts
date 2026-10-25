import { dirname, resolve } from "node:path";
import {
  compileDocMarkdown,
  compileDocMarkdownFile,
  compileDocMarkdownUpdate,
  compileDocMarkdownUpdateFile,
} from "@univer-cli/doc-markdown-facade";

export {
  writeWorkspaceMarkdownExport,
  type WorkspaceMarkdownExportResult,
} from "./markdown-export.js";
export { readWorkspaceMarkdownImage } from "./markdown-assets.js";

export type WorkspaceMarkdownCompilation = Awaited<ReturnType<typeof compileDocMarkdown>>;
export type WorkspaceMarkdownUpdate = Pick<
  Parameters<typeof compileDocMarkdownUpdate>[1],
  "sourceMap" | "blockIds"
>;
export type WorkspaceMarkdownOptions = Parameters<typeof compileDocMarkdown>[1] & {
  readonly update?: WorkspaceMarkdownUpdate;
};

/** Resolve every source resource inside the caller-authorized source workspace. */
export async function compileWorkspaceMarkdownFile(
  file: string,
  options: Omit<WorkspaceMarkdownOptions, "assetResolver">,
  sourceWorkspace: string = dirname(resolve(file)),
): Promise<WorkspaceMarkdownCompilation> {
  if (options.update !== undefined) {
    return await compileDocMarkdownUpdateFile(file, {
      ...options,
      ...options.update,
      assetRoot: sourceWorkspace,
    });
  }
  return await compileDocMarkdownFile(file, { ...options, assetRoot: sourceWorkspace });
}
