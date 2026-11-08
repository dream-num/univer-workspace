import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import {
  compileDocMarkdown,
  compileDocMarkdownFile,
  compileDocMarkdownUpdate,
  compileDocMarkdownUpdateFile,
} from "@univer-cli/doc-markdown-facade";
import { extname } from "node:path";
import {
  assertWorkspaceSourceFiles,
  readWorkspaceSourceFile,
  type WorkspaceSourceFiles,
} from "./files.js";

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

/**
 * The server compares initialData on idempotent retries and the Doc id is part of that data, so a
 * retried creation must compile to the same id.
 */
export function workspaceMarkdownTargetUnitId(idempotencyKey?: string): string {
  const identity =
    idempotencyKey === undefined
      ? randomUUID()
      : createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32);
  return `markdown-${identity}`;
}

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

const IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** In-memory twin of {@link compileWorkspaceMarkdownFile}: the assets map is the source workspace. */
export async function compileWorkspaceMarkdownSource(
  markdown: string,
  options: Omit<WorkspaceMarkdownOptions, "assetResolver">,
  assets: WorkspaceSourceFiles = new Map(),
): Promise<WorkspaceMarkdownCompilation> {
  assertWorkspaceSourceFiles(assets);
  const assetResolver: NonNullable<WorkspaceMarkdownOptions["assetResolver"]> = async (reference) => {
    const mimeType = IMAGE_MIME_TYPES[extname(reference).toLowerCase()];
    return {
      data: readWorkspaceSourceFile(assets, reference),
      ...(mimeType === undefined ? {} : { mimeType }),
    };
  };
  if (options.update !== undefined) {
    return await compileDocMarkdownUpdate(markdown, { ...options, ...options.update, assetResolver });
  }
  return await compileDocMarkdown(markdown, { ...options, assetResolver });
}
