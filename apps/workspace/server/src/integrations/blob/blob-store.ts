import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface StoredObject {
  readonly byteSize: number;
  readonly sha256: string;
  readonly etag: string;
}

export interface StoredBlob extends StoredObject {
  readonly mediaType: string;
}

interface BlobPutInput {
  readonly objectKey: string;
  readonly body: Readable;
  readonly expectedByteSize: number;
  readonly detectMediaType?: boolean;
}

export interface BlobStore {
  put(input: BlobPutInput & { readonly detectMediaType: false }): Promise<StoredObject>;
  put(input: BlobPutInput & { readonly detectMediaType?: true }): Promise<StoredBlob>;
  head(objectKey: string): Promise<{ readonly byteSize: number } | null>;
  open(input: {
    readonly objectKey: string;
    readonly start?: number;
    readonly end?: number;
  }): Promise<{
    readonly stream: Readable;
    readonly totalByteSize: number;
    readonly start: number;
    readonly end: number;
  }>;
  delete(objectKey: string): Promise<void>;
  /** Releases resources held by the store when its owner shuts down. */
  dispose?(): void | Promise<void>;
}

export function validObjectKey(objectKey: string): string {
  if (!/^[0-9a-f-]{36}$/.test(objectKey)) throw new Error("Invalid Blob object key.");
  return objectKey;
}

/** Both stores publish only after consuming and validating the complete input. */
export abstract class StreamingBlobStore {
  put(input: BlobPutInput & { readonly detectMediaType: false }): Promise<StoredObject>;
  put(input: BlobPutInput & { readonly detectMediaType?: true }): Promise<StoredBlob>;
  async put(input: BlobPutInput): Promise<StoredObject | StoredBlob> {
    const objectKey = validObjectKey(input.objectKey);
    const hash = createHash("sha256");
    const sample = input.detectMediaType === false ? null : Buffer.alloc(8192);
    let sampleBytes = 0;
    let byteSize = 0;

    async function* checkedChunks() {
      for await (const value of input.body) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        byteSize += chunk.length;
        if (byteSize > input.expectedByteSize) {
          throw new Error("Uploaded content exceeds its reserved byte size.");
        }
        hash.update(chunk);
        if (sample && sampleBytes < sample.length) {
          sampleBytes += chunk.copy(sample, sampleBytes);
        }
        yield chunk;
      }
      if (byteSize !== input.expectedByteSize) {
        throw new Error("Uploaded content length does not match its reservation.");
      }
    }

    const stream = Readable.from(checkedChunks(), { objectMode: false });
    try {
      await this.write(objectKey, stream, input.expectedByteSize);
    } finally {
      stream.destroy();
    }
    const sha256 = hash.digest("hex");
    const stored = { byteSize, sha256, etag: sha256 };
    return sample
      ? { ...stored, mediaType: detectMediaType(sample.subarray(0, sampleBytes), byteSize > sampleBytes) }
      : stored;
  }

  protected abstract write(objectKey: string, body: Readable, byteSize: number): Promise<void>;
}

export class LocalBlobStore extends StreamingBlobStore implements BlobStore {
  constructor(private readonly _directory: string) {
    super();
  }

  protected override async write(objectKey: string, body: Readable): Promise<void> {
    mkdirSync(this._directory, { recursive: true });
    const destination = join(this._directory, objectKey);
    const temporary = `${destination}.upload`;
    try {
      await pipeline(body, createWriteStream(temporary));
      renameSync(temporary, destination);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }

  async head(objectKey: string): Promise<{ readonly byteSize: number } | null> {
    try {
      return { byteSize: statSync(this._path(objectKey)).size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async open(input: {
    readonly objectKey: string;
    readonly start?: number;
    readonly end?: number;
  }): Promise<{
    readonly stream: Readable;
    readonly totalByteSize: number;
    readonly start: number;
    readonly end: number;
  }> {
    const filename = this._path(input.objectKey);
    const totalByteSize = statSync(filename).size;
    const start = input.start ?? 0;
    const end = input.end ?? Math.max(0, totalByteSize - 1);
    return {
      stream: createReadStream(filename, { start, end }),
      totalByteSize,
      start,
      end,
    };
  }

  async delete(objectKey: string): Promise<void> {
    const destination = this._path(objectKey);
    for (const filename of [destination, `${destination}.upload`]) {
      try {
        unlinkSync(filename);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }

  private _path(objectKey: string): string {
    return join(this._directory, validObjectKey(objectKey));
  }
}

function detectMediaType(sample: Buffer, truncated: boolean): string {
  if (sample.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    return "image/png";
  }
  if (sample.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))) {
    return "image/jpeg";
  }
  if (sample.subarray(0, 6).toString("ascii") === "GIF87a" ||
      sample.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif";
  if (sample.subarray(0, 2).toString("ascii") === "BM") return "image/bmp";
  if (sample.subarray(0, 4).toString("ascii") === "%PDF") {
    return "application/pdf";
  }
  if (sample.subarray(0, 2).toString("ascii") === "PK") {
    return "application/zip";
  }
  if (
    sample.subarray(0, 4).toString("ascii") === "RIFF" &&
    sample.subarray(8, 12).toString("ascii") === "WEBP"
  ) return "image/webp";
  if (sample.subarray(4, 8).toString("ascii") === "ftyp") return "video/mp4";
  if (sample.subarray(0, 3).toString("ascii") === "ID3") return "audio/mpeg";
  if (sample.subarray(0, 4).equals(Buffer.from("1a45dfa3", "hex"))) {
    return "video/webm";
  }
  if (sample.byteLength === 0) return "application/octet-stream";
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(sample, { stream: truncated });
    if (![...text].some((character) => character < " " && !"\n\r\t".includes(character))) {
      return "text/plain; charset=utf-8";
    }
  } catch {}
  return "application/octet-stream";
}
