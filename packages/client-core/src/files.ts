import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, link, open, rename, stat, unlink, type FileHandle } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { WorkspaceApplicationError, workspaceError } from "./errors.js";

export interface SourceFile {
  readonly byteSize: number;
  readonly originalFilename: string;
  readonly path: string;
}

export interface DownloadTarget {
  readonly outputPath: string;
  discard(): Promise<void>;
  writeAndCommit(
    content: AsyncIterable<Uint8Array>,
    expectedSize?: number,
  ): Promise<{ readonly byteSize: number; readonly outputPath: string }>;
}

type AtomicOutputKind = "asset" | "blob" | "office";

export async function inspectSource(path: string, signal?: AbortSignal): Promise<SourceFile> {
  signal?.throwIfAborted();
  const resolvedPath = resolve(path);
  let metadata;
  try {
    metadata = await stat(resolvedPath);
    signal?.throwIfAborted();
  } catch (error) {
    signal?.throwIfAborted();
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

export async function* openSource(
  source: SourceFile,
  signal?: AbortSignal,
): AsyncIterable<Uint8Array> {
  let byteSize = 0;
  try {
    signal?.throwIfAborted();
    for await (const chunk of createReadStream(source.path, signal === undefined ? {} : { signal })) {
      signal?.throwIfAborted();
      const bytes =
        chunk instanceof Uint8Array ? chunk : Uint8Array.from(chunk as ArrayLike<number>);
      byteSize += bytes.byteLength;
      if (byteSize > source.byteSize)
        throw sizeMismatch("blob", source.byteSize, byteSize, source.path);
      yield bytes;
    }
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof WorkspaceApplicationError) throw error;
    throw fileError("workspace-blob-source-unavailable", "Blob source could not be read.", {
      cause: errorMessage(error),
      path: source.path,
    });
  }
  signal?.throwIfAborted();
  if (byteSize !== source.byteSize)
    throw sizeMismatch("blob", source.byteSize, byteSize, source.path);
}

export async function writeDownload(input: {
  readonly content: AsyncIterable<Uint8Array>;
  readonly expectedSize?: number;
  readonly force?: boolean;
  readonly kind: AtomicOutputKind;
  readonly outputPath: string;
  readonly signal?: AbortSignal;
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
  readonly kind: AtomicOutputKind;
  readonly outputPath: string;
  readonly signal?: AbortSignal;
}): Promise<DownloadTarget> {
  input.signal?.throwIfAborted();
  const outputPath = resolve(input.outputPath);
  if (input.force !== true && (await pathExists(outputPath, input.kind, input.signal))) {
    throw outputExists(input.kind, outputPath);
  }
  input.signal?.throwIfAborted();
  const temporaryPath = resolve(
    dirname(outputPath),
    `.${basename(outputPath)}.${String(process.pid)}.${randomUUID()}.tmp`,
  );
  let handle: FileHandle | undefined;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    input.signal?.throwIfAborted();
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    input.signal?.throwIfAborted();
    throw fileError(
      `workspace-${input.kind}-output-unavailable`,
      input.kind === "office"
        ? "Office output directory is unavailable."
        : `${title(input.kind)} download output directory is unavailable.`,
      { cause: errorMessage(error), outputPath },
    );
  }
  return new NodeDownloadTarget({
    force: input.force === true,
    handle: handle!,
    kind: input.kind,
    outputPath,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
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
      readonly kind: AtomicOutputKind;
      readonly outputPath: string;
      readonly signal?: AbortSignal;
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
        this.options.kind === "office"
          ? "Office output target is no longer writable."
          : `${title(this.options.kind)} download target is no longer writable.`,
        { outputPath: this.outputPath },
      );
    }
    let byteSize = 0;
    try {
      this.options.signal?.throwIfAborted();
      for await (const chunk of content) {
        this.options.signal?.throwIfAborted();
        byteSize += chunk.byteLength;
        if (expectedSize !== undefined && byteSize > expectedSize) {
          throw sizeMismatch(this.options.kind, expectedSize, byteSize, this.outputPath);
        }
        await writeAll(handle, chunk, this.options.signal);
      }
      this.options.signal?.throwIfAborted();
      if (expectedSize !== undefined && byteSize !== expectedSize) {
        throw sizeMismatch(this.options.kind, expectedSize, byteSize, this.outputPath);
      }
      await handle.sync();
      this.options.signal?.throwIfAborted();
      await handle.close();
      this.handle = undefined;
      this.options.signal?.throwIfAborted();
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
      this.options.signal?.throwIfAborted();
      if (error instanceof WorkspaceApplicationError) throw error;
      throw fileError(
        this.options.kind === "office"
          ? "workspace-office-output-write-failed"
          : `workspace-${this.options.kind}-download-write-failed`,
        this.options.kind === "office"
          ? "Office output could not be written safely."
          : `${title(this.options.kind)} download could not be written safely.`,
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

export async function* responseContent(
  response: Response,
  signal?: AbortSignal,
): AsyncIterable<Uint8Array> {
  if (response.body === null) {
    throw workspaceError(
      "workspace-invalid-response",
      "Workspace download response is missing content.",
    );
  }
  const reader = response.body.getReader();
  let completed = false;
  try {
    while (true) {
      signal?.throwIfAborted();
      const item = await readWithSignal(reader, signal);
      signal?.throwIfAborted();
      if (item.done) {
        completed = true;
        return;
      }
      yield item.value;
    }
  } finally {
    if (!completed) await reader.cancel(signal?.reason).catch(() => undefined);
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

async function writeAll(
  handle: FileHandle,
  chunk: Uint8Array,
  signal?: AbortSignal,
): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    signal?.throwIfAborted();
    const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset);
    signal?.throwIfAborted();
    if (bytesWritten === 0) throw new Error("zero-byte filesystem write");
    offset += bytesWritten;
  }
}

async function pathExists(
  path: string,
  kind: AtomicOutputKind,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    signal?.throwIfAborted();
    await access(path);
    signal?.throwIfAborted();
    return true;
  } catch (error) {
    signal?.throwIfAborted();
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw fileError(
      `workspace-${kind}-output-unavailable`,
      kind === "office"
        ? "Office output is unavailable."
        : `${title(kind)} download output is unavailable.`,
      { cause: errorMessage(error), outputPath: path },
    );
  }
}

async function readWithSignal(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal === undefined) return await reader.read();
  signal.throwIfAborted();
  let rejectAborted!: (reason?: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAborted = reject;
  });
  const onAbort = () => rejectAborted(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([reader.read(), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function sizeMismatch(
  kind: AtomicOutputKind,
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

function outputExists(kind: AtomicOutputKind, outputPath: string): WorkspaceApplicationError {
  return fileError(
    `workspace-${kind}-output-exists`,
    kind === "office"
      ? "Office output already exists. Pass force to replace it."
      : `${title(kind)} download output already exists. Pass --force to replace it.`,
    { outputPath },
  );
}

function fileError(code: string, message: string, detail: unknown): WorkspaceApplicationError {
  return new WorkspaceApplicationError(code, message, detail);
}

function title(kind: AtomicOutputKind): "Asset" | "Blob" | "Office" {
  if (kind === "asset") return "Asset";
  if (kind === "blob") return "Blob";
  return "Office";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
