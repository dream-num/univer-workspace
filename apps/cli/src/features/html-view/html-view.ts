import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { isHtmlViewFilename } from "@univerjs-labs/html-view";
import {
  WorkspaceHtmlViewFeature as CoreHtmlViewFeature,
  normalizeHtmlViewDestination,
  type WorkspaceHtmlViewOptions,
  type WorkspaceHtmlViewDestination,
} from "@univerjs/univer-workspace-client-core";
import {
  isWorkspaceResultUnknown,
  WorkspaceApplicationError,
  workspaceError,
} from "../../errors.js";

export class WorkspaceHtmlViewFeature {
  private readonly core: CoreHtmlViewFeature;

  public constructor(options: WorkspaceHtmlViewOptions) {
    this.core = new CoreHtmlViewFeature(options);
  }

  public async validate(inputPath: string) {
    const source = await readSource(inputPath);
    return await withSourcePath(source.filePath, () => this.core.validate(source));
  }

  public async create(input: WorkspaceHtmlViewDestination & { readonly filePath: string }) {
    normalizeHtmlViewDestination(input);
    const source = await readSource(input.filePath);
    return await withSourcePath(source.filePath, () => this.core.create({ ...input, source }));
  }
}

async function readSource(inputPath: string) {
  if (!isHtmlViewFilename(inputPath)) {
    throw workspaceError("workspace-argument-invalid", "Source must be a .univer.html file.");
  }
  const filePath = resolve(inputPath);
  try {
    if (!(await stat(filePath)).isFile()) throw new Error("Source must be a regular file.");
    return { bytes: await readFile(filePath), name: basename(filePath), filePath };
  } catch (error) {
    throw workspaceError(
      "workspace-html-view-source-unavailable",
      "HTML View source could not be read.",
      { filePath, cause: error instanceof Error ? error.message : String(error) },
    );
  }
}

async function withSourcePath<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof WorkspaceApplicationError && isRecord(error.detail)) {
      const { detail, code, message } = error;
      if (isWorkspaceResultUnknown(error)) {
        const request = error.detail["request"];
        throw workspaceError(error.code, error.message, {
          ...error.detail,
          sourcePath: filePath,
          ...(isRecord(request) ? { request: { ...request, sourcePath: filePath } } : {}),
        });
      }
      if ("filePath" in detail) throw workspaceError(code, message, { ...detail, filePath });
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
