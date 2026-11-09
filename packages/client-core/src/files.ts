import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, link, open, rename, stat, unlink, type FileHandle } from "node:fs/promises";
import { basename, dirname, posix, resolve } from "node:path";
import { WorkspaceApplicationError, workspaceError } from "./errors.js";

export interface SourceFile {
  /** Present for in-memory input; `path` then holds the caller's file name. */
  readonly bytes?: Uint8Array;
  readonly byteSize: number;
  readonly originalFilename: string;
  readonly path: string;
}

/** Relative POSIX paths ("img/a.png") to bytes. No absolute paths, no "..", no backslashes, no empty segments. */
export type WorkspaceSourceFiles = ReadonlyMap<string, Uint8Array>;

/** The one place a caller-supplied file set is checked; later steps trust the type. */
export function assertWorkspaceSourceFiles(files: WorkspaceSourceFiles): void {
  const folded = new Map<string, string>();
  for (const key of files.keys()) {
    if (
      key.length === 0 ||
      key.includes("\\") ||
      key.includes("\0") ||
      key.startsWith("/") ||
      key.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      throw workspaceError(
        "workspace-argument-invalid",
        `Source file path ${JSON.stringify(key)} must be a relative POSIX path without empty, "." or ".." segments.`,
      );
    }
    const fold = key.normalize("NFC").toLowerCase();
    const same = folded.get(fold);
    if (same !== undefined) throw sourceFileCollision(same, key);
    folded.set(fold, key);
  }
  // A key that is a directory prefix of another cannot be both a file and a directory on disk.
  for (const [fold, key] of folded) {
    const segments = fold.split("/");
    for (let length = 1; length < segments.length; length += 1) {
      const prefix = folded.get(segments.slice(0, length).join("/"));
      if (prefix !== undefined) throw sourceFileCollision(prefix, key);
    }
  }
}

function sourceFileCollision(first: string, second: string): WorkspaceApplicationError {
  return workspaceError(
    "workspace-argument-invalid",
    `Source file paths ${JSON.stringify(first)} and ${JSON.stringify(second)} collide on a case-insensitive or Unicode-normalizing filesystem, or one is a directory of the other.`,
  );
}

/** Look up a reference as the path variant would resolve it; a miss mimics a missing file. */
export function readWorkspaceSourceFile(
  files: WorkspaceSourceFiles,
  reference: string,
): Uint8Array {
  const key = posix.normalize(reference);
  const escapes = key.startsWith("/") || key === ".." || key.startsWith("../");
  const bytes = escapes ? undefined : files.get(key);
  if (bytes === undefined) {
    throw Object.assign(new Error(`ENOENT: no such file in the provided sources: ${reference}`), {
      code: "ENOENT",
    });
  }
  return bytes;
}

/** In-memory Blob input; the file name is trimmed and must be a plain basename. */
export interface WorkspaceBlobBytes {
  readonly bytes: Uint8Array;
  readonly fileName: string;
}

export interface DownloadTarget {
  readonly outputPath: string;
  discard(): Promise<void>;
  writeAndCommit(
    content: AsyncIterable<Uint8Array>,
    expectedSize?: number,
  ): Promise<{ readonly byteSize: number; readonly outputPath: string }>;
}

/** Copies the caller's bytes so later mutation cannot change what a retry sends. */
export function memorySource(input: WorkspaceBlobBytes): SourceFile {
  const fileName = input.fileName.trim();
  if (fileName === "" || fileName === "." || fileName === ".." || /[\\/\0]/.test(fileName)) {
    throw workspaceError(
      "workspace-argument-invalid",
      'In-memory Blob input needs a file name without path separators, not empty, "." or "..".',
    );
  }
  return {
    bytes: input.bytes.slice(),
    byteSize: input.bytes.byteLength,
    originalFilename: fileName,
    path: fileName,
  };
}

export async function inspectSource(path: string): Promise<SourceFile> {
  const resolvedPath = resolve(path);
  let metadata;
  try {
    metadata = await stat(resolvedPath);
  } catch (error) {
    throw fileError("workspace-blob-source-unavailable", "Blob source file is unavailable.", {
      cause: errorMessage(error),
      path: resolvedPath,
    });
  }
  if (!metadata.isFile()) {
    throw fileError("workspace-blob-source-invalid", "Blob source must be a regular file.", {
      path: resolvedPath,
    });
  }
  return {
    byteSize: metadata.size,
    originalFilename: basename(resolvedPath),
    path: resolvedPath,
  };
}

export async function* openSource(source: SourceFile): AsyncIterable<Uint8Array> {
  if (source.bytes !== undefined) {
    if (source.bytes.byteLength > 0) yield source.bytes;
    return;
  }
  let byteSize = 0;
  try {
    for await (const chunk of createReadStream(source.path)) {
      const bytes =
        chunk instanceof Uint8Array ? chunk : Uint8Array.from(chunk as ArrayLike<number>);
      byteSize += bytes.byteLength;
      if (byteSize > source.byteSize)
        throw sizeMismatch("blob", source.byteSize, byteSize, source.path);
      yield bytes;
    }
  } catch (error) {
    if (error instanceof WorkspaceApplicationError) throw error;
    throw fileError("workspace-blob-source-unavailable", "Blob source could not be read.", {
      cause: errorMessage(error),
      path: source.path,
    });
  }
  if (byteSize !== source.byteSize)
    throw sizeMismatch("blob", source.byteSize, byteSize, source.path);
}

export async function writeDownload(input: {
  readonly content: AsyncIterable<Uint8Array>;
  readonly expectedSize?: number;
  readonly force?: boolean;
  readonly kind: "asset" | "blob";
  readonly outputPath: string;
}): Promise<{ readonly byteSize: number; readonly outputPath: string }> {
  const target = await prepareDownload(input);
  try {
    return await target.writeAndCommit(input.content, input.expectedSize);
  } finally {
    await target.discard();
  }
}

export async function prepareDownload(input: {
  readonly force?: boolean;
  readonly kind: "asset" | "blob";
  readonly outputPath: string;
}): Promise<DownloadTarget> {
  const outputPath = resolve(input.outputPath);
  if (input.force !== true && (await pathExists(outputPath, input.kind))) {
    throw outputExists(input.kind, outputPath);
  }
  const temporaryPath = resolve(
    dirname(outputPath),
    `.${basename(outputPath)}.${String(process.pid)}.${randomUUID()}.tmp`,
  );
  let handle: FileHandle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
  } catch (error) {
    throw fileError(
      `workspace-${input.kind}-output-unavailable`,
      `${title(input.kind)} download output directory is unavailable.`,
      { cause: errorMessage(error), outputPath },
    );
  }
  return new NodeDownloadTarget({
    force: input.force === true,
    handle,
    kind: input.kind,
    outputPath,
    temporaryPath,
  });
}

class NodeDownloadTarget implements DownloadTarget {
  public readonly outputPath: string;
  private handle: FileHandle | undefined;
  private committed = false;

  public constructor(
    private readonly options: {
      readonly force: boolean;
      readonly handle: FileHandle;
      readonly kind: "asset" | "blob";
      readonly outputPath: string;
      readonly temporaryPath: string;
    },
  ) {
    this.outputPath = options.outputPath;
    this.handle = options.handle;
  }

  public async writeAndCommit(
    content: AsyncIterable<Uint8Array>,
    expectedSize?: number,
  ): Promise<{ readonly byteSize: number; readonly outputPath: string }> {
    const handle = this.handle;
    if (handle === undefined) {
      throw fileError(
        `workspace-${this.options.kind}-output-invalid-state`,
        `${title(this.options.kind)} download target is no longer writable.`,
        { outputPath: this.outputPath },
      );
    }
    let byteSize = 0;
    try {
      for await (const chunk of content) {
        byteSize += chunk.byteLength;
        if (expectedSize !== undefined && byteSize > expectedSize) {
          throw sizeMismatch(this.options.kind, expectedSize, byteSize, this.outputPath);
        }
        await writeAll(handle, chunk);
      }
      if (expectedSize !== undefined && byteSize !== expectedSize) {
        throw sizeMismatch(this.options.kind, expectedSize, byteSize, this.outputPath);
      }
      await handle.sync();
      await handle.close();
      this.handle = undefined;
      if (this.options.force) {
        await rename(this.options.temporaryPath, this.outputPath);
      } else {
        try {
          await link(this.options.temporaryPath, this.outputPath);
        } catch (error) {
          if (isNodeError(error) && error.code === "EEXIST") {
            throw outputExists(this.options.kind, this.outputPath);
          }
          throw error;
        }
        await unlink(this.options.temporaryPath);
      }
      this.committed = true;
      return { byteSize, outputPath: this.outputPath };
    } catch (error) {
      await this.discard();
      if (error instanceof WorkspaceApplicationError) throw error;
      throw fileError(
        `workspace-${this.options.kind}-download-write-failed`,
        `${title(this.options.kind)} download could not be written safely.`,
        { cause: errorMessage(error), outputPath: this.outputPath },
      );
    }
  }

  public async discard(): Promise<void> {
    if (this.committed) return;
    const handle = this.handle;
    this.handle = undefined;
    await handle?.close().catch(() => undefined);
    await unlink(this.options.temporaryPath).catch(() => undefined);
  }
}

export async function* responseContent(response: Response): AsyncIterable<Uint8Array> {
  if (response.body === null) {
    throw workspaceError(
      "workspace-invalid-response",
      "Workspace download response is missing content.",
    );
  }
  const reader = response.body.getReader();
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) return;
      yield item.value;
    }
  } finally {
    reader.releaseLock();
  }
}

export function contentLength(
  response: Response,
  subject: "Asset" | "Blob" = "Blob",
): number | undefined {
  const value = response.headers.get("content-length");
  if (value === null) return undefined;
  if (value.trim() === "") {
    throw workspaceError(
      "workspace-invalid-response",
      `Workspace ${subject} response contains an invalid Content-Length.`,
    );
  }
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw workspaceError(
      "workspace-invalid-response",
      `Workspace ${subject} response contains an invalid Content-Length.`,
    );
  }
  return size;
}

async function writeAll(handle: FileHandle, chunk: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset);
    if (bytesWritten === 0) throw new Error("zero-byte filesystem write");
    offset += bytesWritten;
  }
}

async function pathExists(path: string, kind: "asset" | "blob"): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw fileError(
      `workspace-${kind}-output-unavailable`,
      `${title(kind)} download output is unavailable.`,
      { cause: errorMessage(error), outputPath: path },
    );
  }
}

function sizeMismatch(
  kind: "asset" | "blob",
  expectedByteSize: number,
  actualByteSize: number,
  path: string,
): WorkspaceApplicationError {
  return fileError(
    `workspace-${kind}-size-mismatch`,
    `${title(kind)} byte stream does not match the expected byte size.`,
    { actualByteSize, expectedByteSize, path },
  );
}

function outputExists(kind: "asset" | "blob", outputPath: string): WorkspaceApplicationError {
  return fileError(
    `workspace-${kind}-output-exists`,
    `${title(kind)} download output already exists. Pass --force to replace it.`,
    { outputPath },
  );
}

function fileError(code: string, message: string, detail: unknown): WorkspaceApplicationError {
  return new WorkspaceApplicationError(code, message, detail);
}

function title(kind: "asset" | "blob"): "Asset" | "Blob" {
  return kind === "asset" ? "Asset" : "Blob";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
