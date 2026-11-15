import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { Readable } from "node:stream";
import { StreamingBlobStore, validObjectKey, type BlobStore } from "./blob-store.js";

export interface S3BlobStoreOptions {
  readonly bucket: string;
  readonly region?: string;
  readonly endpoint?: string;
  readonly forcePathStyle?: boolean;
  readonly prefix?: string;
}

export class S3BlobStore extends StreamingBlobStore implements BlobStore {
  private readonly _client: S3Client;
  private readonly _bucket: string;
  private readonly _prefix: string;
  private readonly _uploads = new Set<string>();

  constructor({ bucket, prefix, ...clientOptions }: S3BlobStoreOptions) {
    super();
    this._bucket = bucket;
    this._prefix = prefix ? `${prefix}/` : "";
    this._client = new S3Client(clientOptions);
  }

  protected override async write(
    objectKey: string,
    body: Readable,
    byteSize: number,
  ): Promise<void> {
    if (this._uploads.has(objectKey))
      throw new Error("An upload for this S3 object is in progress.");
    this._uploads.add(objectKey);
    try {
      await new Upload({
        client: this._client,
        params: { ...this._location(objectKey), Body: body, ContentLength: byteSize },
      }).done();
    } finally {
      this._uploads.delete(objectKey);
    }
  }

  async head(objectKey: string): Promise<{ readonly byteSize: number } | null> {
    try {
      const response = await this._client.send(new HeadObjectCommand(this._location(objectKey)));
      if (response.ContentLength === undefined)
        throw new Error("S3 HEAD response has no Content-Length.");
      return { byteSize: response.ContentLength };
    } catch (error) {
      if (error instanceof NotFound) return null;
      throw error;
    }
  }

  async open(input: {
    readonly objectKey: string;
    readonly start?: number;
    readonly end?: number;
  }) {
    const ranged = input.start !== undefined || input.end !== undefined;
    const response = await this._client.send(
      new GetObjectCommand({
        ...this._location(input.objectKey),
        ...(ranged ? { Range: `bytes=${input.start ?? 0}-${input.end ?? ""}` } : {}),
      }),
    );
    const stream = response.Body;
    if (!(stream instanceof Readable)) throw new Error("S3 GET response has no readable body.");

    const length = response.ContentLength;
    if (!ranged && length !== undefined) {
      return { stream, totalByteSize: length, start: 0, end: Math.max(0, length - 1) };
    }
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.ContentRange ?? "");
    if (ranged && range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      const totalByteSize = Number(range[3]);
      const expectedEnd = Math.min(input.end ?? totalByteSize - 1, totalByteSize - 1);
      if (start === (input.start ?? 0) && end === expectedEnd && length === end - start + 1) {
        return { stream, totalByteSize, start, end };
      }
    }
    stream.destroy();
    throw new Error("S3 GET response has missing or inconsistent length or range headers.");
  }

  async delete(objectKey: string): Promise<void> {
    // A cancelled session can reach the deletion queue before its final PUT completes.
    // Let maintenance retry so a later upload completion cannot recreate the deleted object.
    if (this._uploads.has(objectKey))
      throw new Error("An upload for this S3 object is in progress.");
    await this._client.send(new DeleteObjectCommand(this._location(objectKey)));
  }

  dispose(): void {
    this._client.destroy();
  }

  private _location(objectKey: string) {
    return { Bucket: this._bucket, Key: this._prefix + validObjectKey(objectKey) };
  }
}
