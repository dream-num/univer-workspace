import { Unzip, UnzipInflate } from "fflate";
import type { WorkspaceSourceFiles } from "@univerjs/univer-workspace-client-core";
import { workspaceError } from "@univerjs/univer-workspace-client-core/product";

export const sourceZipPathLimits = { bytes: 1024, segments: 32 };

export interface SourceZipLimits {
  readonly entries: number;
  readonly fileBytes: number;
  readonly totalBytes: number;
}

/** Expand in bounded chunks so a false or absent ZIP size cannot bypass the byte caps. */
export function readSourceZip(bytes: Uint8Array, limits: SourceZipLimits): WorkspaceSourceFiles {
  const files = new Map<string, Uint8Array>();
  const paths = new Set<string>();
  const filePaths = new Set<string>();
  const directories = new Set<string>();
  let entries = 0;
  let completed = 0;
  let declared = 0;
  let actual = 0;
  let failure: Error | undefined;
  const invalid = (message: string) => workspaceError("workspace-argument-invalid", message);
  // Unzip accepts arbitrary data as an empty stream, so require a ZIP signature first.
  const signature =
    bytes.length < 22
      ? 0
      : new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  if (signature !== 0x04034b50 && signature !== 0x06054b50) throw invalid("Invalid ZIP archive.");
  const unzip = new Unzip((file) => {
    if (failure) return;
    entries += 1;
    if (entries > limits.entries) throw invalid("ZIP contains too many entries.");
    // Bound path work before inflation and Core's subsequent path validation.
    if (Buffer.byteLength(file.name, "utf8") > sourceZipPathLimits.bytes)
      throw invalid("ZIP entry name exceeds 1024 UTF-8 bytes.");
    const directory = file.name.endsWith("/");
    const path = directory ? file.name.slice(0, -1) : file.name;
    const parts = path.split("/");
    if (parts.length > sourceZipPathLimits.segments)
      throw invalid("ZIP entry name exceeds 32 path segments.");
    if (
      !path ||
      /[\\\0]/.test(path) ||
      parts.some((part) => !part || part === "." || part === "..")
    )
      throw invalid("ZIP paths must be relative POSIX paths without traversal.");
    const folded = path.normalize("NFC").toLowerCase();
    if (paths.has(folded)) throw invalid("ZIP paths collide.");
    paths.add(folded);
    if (filePaths.has(folded) || (!directory && directories.has(folded)))
      throw invalid("ZIP file and directory paths collide.");
    // Scan each separator once instead of rebuilding every prefix from path segments.
    for (let index = folded.indexOf("/"); index !== -1; index = folded.indexOf("/", index + 1)) {
      const prefix = folded.slice(0, index);
      if (filePaths.has(prefix)) throw invalid("ZIP file and directory paths collide.");
      directories.add(prefix);
    }
    if (directory) directories.add(folded);
    else filePaths.add(folded);
    if (file.originalSize !== undefined) {
      declared += file.originalSize;
      if (file.originalSize > limits.fileBytes || declared > limits.totalBytes)
        throw invalid("ZIP declared uncompressed size exceeds its limit.");
    }
    if (!directory) {
      files.set(path, new Uint8Array());
    }
    let size = 0;
    const chunks: Uint8Array[] = [];
    file.ondata = (error, chunk, final) => {
      if (failure) return;
      if (error) failure = invalid("ZIP entry could not be decompressed.");
      else {
        size += chunk.length;
        actual += chunk.length;
        if (size > limits.fileBytes || actual > limits.totalBytes || (directory && size !== 0))
          failure = invalid("ZIP actual uncompressed size exceeds its limit.");
        else {
          if (!directory) chunks.push(chunk);
          if (final) {
            if (file.originalSize !== undefined && size !== file.originalSize)
              failure = invalid("ZIP entry size differs from its declared size.");
            else {
              completed += 1;
              if (!directory) files.set(path, Buffer.concat(chunks, size));
            }
          }
        }
      }
      if (failure) file.terminate();
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    for (let offset = 0; offset < bytes.length; offset += 1024) {
      unzip.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
      if (failure) throw failure;
    }
    if (completed !== entries || (entries === 0 && signature !== 0x06054b50))
      throw invalid("ZIP is incomplete.");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "workspace-argument-invalid")
      throw error;
    throw invalid("Invalid ZIP archive.");
  }
  return files;
}
