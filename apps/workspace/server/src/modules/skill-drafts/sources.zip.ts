import { crc32 } from "node:zlib";
import { Unzip, UnzipInflate } from "fflate";
import { ApplicationError } from "../../middleware/errors.js";
import { safeSkillPath, type ScanFile } from "./scan.js";

export const ARCHIVE_LIMITS = {
  entries: 1000,
  fileBytes: 20 * 1024 * 1024,
  totalBytes: 100 * 1024 * 1024,
  ratio: 100,
};
const invalid = () =>
  new ApplicationError(
    "INVALID_INPUT",
    400,
    "Invalid zip, unsafe path, symlink or unsupported zip feature.",
  );
const tooLarge = () =>
  new ApplicationError(
    "PAYLOAD_TOO_LARGE",
    413,
    "Zip exceeds its entry, per-file, total size or compression ratio limit.",
  );

export function extractSkillZip(input: Uint8Array): ScanFile[] {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (bytes.length > ARCHIVE_LIMITS.totalBytes) throw tooLarge();
  try {
    let end = bytes.length - 22;
    for (; end >= Math.max(0, bytes.length - 65557); end--) {
      if (
        bytes.readUInt32LE(end) === 0x06054b50 &&
        end + 22 + bytes.readUInt16LE(end + 20) === bytes.length
      )
        break;
    }
    if (end < Math.max(0, bytes.length - 65557)) throw invalid();
    const count = bytes.readUInt16LE(end + 10);
    if (count > ARCHIVE_LIMITS.entries) throw tooLarge();
    if (
      bytes.readUInt16LE(end + 4) ||
      bytes.readUInt16LE(end + 6) ||
      bytes.readUInt16LE(end + 8) !== count
    )
      throw invalid();
    let at = bytes.readUInt32LE(end + 16);
    if (at + bytes.readUInt32LE(end + 12) !== end) throw invalid();
    const entries = new Map<string, { size: number; directory: boolean; crc: number }>();
    let declaredTotal = 0;
    let localEnd = 0;
    for (let i = 0; i < count; i++) {
      if (bytes.readUInt32LE(at) !== 0x02014b50) throw invalid();
      const compressed = bytes.readUInt32LE(at + 20);
      const size = bytes.readUInt32LE(at + 24);
      const nameLength = bytes.readUInt16LE(at + 28);
      const name = new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(at + 46, at + 46 + nameLength),
      );
      const directory = name.endsWith("/");
      const path = directory ? name.slice(0, -1) : name;
      const mode = bytes.readUInt32LE(at + 38) >>> 16;
      if (
        !safeSkillPath(path) ||
        entries.has(name) ||
        (mode & 0xf000) === 0xa000 ||
        bytes.readUInt16LE(at + 8) & 1 ||
        ![0, 8].includes(bytes.readUInt16LE(at + 10))
      )
        throw invalid();
      if (directory && size !== 0) throw invalid();
      declaredTotal += size;
      if (
        size > ARCHIVE_LIMITS.fileBytes ||
        declaredTotal > ARCHIVE_LIMITS.totalBytes ||
        size > Math.max(1, compressed) * ARCHIVE_LIMITS.ratio
      )
        throw tooLarge();
      const offset = bytes.readUInt32LE(at + 42);
      if (
        offset !== localEnd ||
        bytes.readUInt32LE(offset) !== 0x04034b50 ||
        bytes.readUInt16LE(offset + 6) !== bytes.readUInt16LE(at + 8) ||
        bytes.readUInt16LE(offset + 8) !== bytes.readUInt16LE(at + 10)
      )
        throw invalid();
      if (
        !(bytes.readUInt16LE(offset + 6) & 8) &&
        (bytes.readUInt32LE(offset + 14) !== bytes.readUInt32LE(at + 16) ||
          bytes.readUInt32LE(offset + 18) !== compressed ||
          bytes.readUInt32LE(offset + 22) !== size)
      )
        throw invalid();
      const localNameLength = bytes.readUInt16LE(offset + 26);
      const localName = bytes.subarray(offset + 30, offset + 30 + localNameLength);
      if (!localName.equals(bytes.subarray(at + 46, at + 46 + nameLength))) throw invalid();
      localEnd = offset + 30 + localNameLength + bytes.readUInt16LE(offset + 28) + compressed;
      if (bytes.readUInt16LE(offset + 6) & 8)
        localEnd += bytes.readUInt32LE(localEnd) === 0x08074b50 ? 16 : 12;
      if (localEnd > bytes.readUInt32LE(end + 16)) throw invalid();
      entries.set(name, { size, directory, crc: bytes.readUInt32LE(at + 16) });
      at += 46 + nameLength + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
    }
    if (at !== end || localEnd !== bytes.readUInt32LE(end + 16)) throw invalid();
    const files: ScanFile[] = [];
    const seen = new Set<string>();
    let total = 0;
    const unzip = new Unzip((file) => {
      const entry = entries.get(file.name);
      if (!entry || seen.has(file.name)) throw invalid();
      seen.add(file.name);
      const chunks: Uint8Array[] = [];
      let size = 0;
      let checksum = 0;
      file.ondata = (error, data, final) => {
        if (error) throw invalid();
        size += data.byteLength;
        total += data.byteLength;
        if (
          size > entry.size ||
          size > ARCHIVE_LIMITS.fileBytes ||
          total > ARCHIVE_LIMITS.totalBytes
        ) {
          file.terminate();
          throw tooLarge();
        }
        checksum = crc32(data, checksum);
        chunks.push(data);
        if (final) {
          if (size !== entry.size || checksum !== entry.crc) throw invalid();
          if (!entry.directory) files.push({ path: file.name, bytes: Buffer.concat(chunks) });
        }
      };
      file.start();
    });
    unzip.register(UnzipInflate);
    for (let offset = 0; offset < bytes.length; offset += 1024)
      unzip.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
    if (seen.size !== entries.size || total !== declaredTotal) throw invalid();
    return files;
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw invalid();
  }
}
