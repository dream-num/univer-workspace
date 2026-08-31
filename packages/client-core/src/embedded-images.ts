import { createHash } from "node:crypto";
import type { IMutation } from "@univerjs/protocol";
import { workspaceError } from "./errors.js";
import type { WorkspaceHttp } from "./http.js";
import type { WorkspaceRuntimeTarget } from "./runtime-target.js";
import {
  rewriteWorkspaceImageReferences,
  visitWorkspaceImageReferences,
} from "./image-references.js";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

type SupportedImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

interface EmbeddedImage {
  readonly bytes: Uint8Array;
  readonly digest: string;
  readonly extension: "png" | "jpg" | "gif" | "webp";
  readonly mediaType: SupportedImageMediaType;
  readonly source: string;
}

export interface WorkspaceEmbeddedImageUploader {
  upload(input: {
    readonly bytes: Uint8Array;
    readonly filename: string;
    readonly mediaType: SupportedImageMediaType;
    readonly signal?: AbortSignal;
    readonly unitId: string;
    readonly worktreeId: string;
  }): Promise<string>;
}

export function createWorkspaceEmbeddedImageUploader(
  http: WorkspaceHttp,
): WorkspaceEmbeddedImageUploader {
  return {
    async upload(input) {
      const query = new URLSearchParams({
        assign: input.unitId,
        size: String(input.bytes.byteLength),
        source: "3",
      });
      const form = new FormData();
      form.append(
        "file",
        new Blob([Uint8Array.from(input.bytes)], { type: input.mediaType }),
        input.filename,
      );
      const body = await http.json(
        `/universer-api/worktrees/${encodeURIComponent(input.worktreeId)}/stream/file/upload?${query.toString()}`,
        {
          formBody: form,
          method: "POST",
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        },
      );
      if (typeof body["FileId"] !== "string" || body["FileId"].length === 0) {
        throw workspaceError(
          "workspace-invalid-response",
          "Workspace embedded image upload response is missing FileId.",
        );
      }
      return body["FileId"];
    },
  };
}

export async function externalizeEmbeddedImages(input: {
  readonly mutations: readonly IMutation[];
  readonly onUploadConfirmed?: () => void;
  readonly signal?: AbortSignal;
  readonly target?: WorkspaceRuntimeTarget;
  readonly unitId: string;
  readonly uploader: WorkspaceEmbeddedImageUploader;
  readonly worktreeId: string;
}): Promise<readonly IMutation[]> {
  const imagesBySource = collectEmbeddedImages(input.mutations);
  if (imagesBySource.size === 0) return input.mutations;

  const uniqueImages = new Map<string, EmbeddedImage>();
  for (const image of imagesBySource.values()) uniqueImages.set(image.digest, image);

  const fileIdByDigest = new Map<string, string>();
  let confirmedUploadCount = 0;
  for (const image of uniqueImages.values()) {
    throwIfImageCancellation(input, confirmedUploadCount);
    try {
      const fileId = await input.uploader.upload({
        bytes: image.bytes,
        filename: `${image.digest}.${image.extension}`,
        mediaType: image.mediaType,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        unitId: input.unitId,
        worktreeId: input.worktreeId,
      });
      if (fileId.length > 0) {
        fileIdByDigest.set(image.digest, fileId);
        confirmedUploadCount += 1;
        input.onUploadConfirmed?.();
      }
    } catch (error) {
      if (input.signal?.aborted === true) {
        throw workspaceError(
          "workspace-result-unknown",
          "The embedded image upload may have completed, but its result could not be confirmed.",
          {
            effect: "embedded-image-upload",
            ...(input.target === undefined ? {} : { target: input.target }),
          },
        );
      }
      // Image hosting is an optimization. Preserve BASE64 when the File API cannot store it.
    }
    throwIfImageCancellation(input, confirmedUploadCount);
  }
  if (fileIdByDigest.size === 0) return input.mutations;

  const fileIdBySource = new Map<string, string>();
  for (const [source, image] of imagesBySource) {
    const fileId = fileIdByDigest.get(image.digest);
    if (fileId !== undefined) fileIdBySource.set(source, fileId);
  }
  return input.mutations.map((mutation) => rewriteMutation(mutation, fileIdBySource));
}

function throwIfImageCancellation(
  input: {
    readonly signal?: AbortSignal;
    readonly target?: WorkspaceRuntimeTarget;
  },
  confirmedUploadCount: number,
): void {
  if (input.signal?.aborted !== true) return;
  if (confirmedUploadCount > 0 && input.target !== undefined) {
    throw workspaceError(
      "workspace-content-partial-side-effect",
      "Embedded image uploads were confirmed before content execution was cancelled.",
      {
        confirmedUploadCount,
        contentCommitted: false,
        effect: "embedded-image-upload",
        target: input.target,
      },
    );
  }
  input.signal.throwIfAborted();
}

function collectEmbeddedImages(
  mutations: readonly IMutation[],
): ReadonlyMap<string, EmbeddedImage> {
  const images = new Map<string, EmbeddedImage>();
  for (const mutation of mutations) {
    const data = parseMutationData(mutation.data);
    visitWorkspaceImageReferences(data, "BASE64", (reference) => {
      if (isPreservedSvgBase64DataUri(reference.source) || images.has(reference.source)) return;
      const image = tryParseEmbeddedImage(reference.source);
      if (image !== undefined) images.set(reference.source, image);
    });
  }
  return images;
}

function rewriteMutation(
  mutation: IMutation,
  fileIdBySource: ReadonlyMap<string, string>,
): IMutation {
  const data = parseMutationData(mutation.data);
  if (data === undefined) return mutation;
  const rewritten = rewriteWorkspaceImageReferences(data, "BASE64", "UUID", fileIdBySource);
  if (rewritten === data) return mutation;
  return {
    ...mutation,
    data: JSON.stringify(rewritten),
  };
}

function parseMutationData(value: string): unknown | undefined {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function tryParseEmbeddedImage(source: string): EmbeddedImage | undefined {
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]*={0,2})$/u.exec(source);
  if (match === null) return undefined;
  const mediaType = match[1] as SupportedImageMediaType | undefined;
  const encoded = match[2];
  if (mediaType === undefined || encoded === undefined) return undefined;
  if (encoded.length === 0 || encoded.length % 4 !== 0 || !isCanonicalBase64(encoded)) {
    return undefined;
  }
  const bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
  if (bytes.byteLength > MAX_IMAGE_BYTES || !matchesImageSignature(mediaType, bytes)) {
    return undefined;
  }
  return {
    bytes,
    digest: createHash("sha256").update(bytes).digest("hex"),
    extension: imageExtension(mediaType),
    mediaType,
    source,
  };
}

function isCanonicalBase64(value: string): boolean {
  const decoded = Buffer.from(value, "base64");
  return decoded.toString("base64") === value;
}

function matchesImageSignature(mediaType: SupportedImageMediaType, bytes: Uint8Array): boolean {
  if (mediaType === "image/png") {
    return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  }
  if (mediaType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mediaType === "image/webp") {
    return (
      Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
      Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
    );
  }
  const header = Buffer.from(bytes.subarray(0, 6)).toString("ascii");
  return header === "GIF87a" || header === "GIF89a";
}

function imageExtension(mediaType: SupportedImageMediaType): "png" | "jpg" | "gif" | "webp" {
  if (mediaType === "image/png") return "png";
  if (mediaType === "image/jpeg") return "jpg";
  if (mediaType === "image/webp") return "webp";
  return "gif";
}

function isPreservedSvgBase64DataUri(value: string): boolean {
  const separator = value.indexOf(",");
  if (separator < 0) return false;
  const metadata = value.slice("data:".length, separator).split(";");
  return (
    metadata[0]?.toLowerCase() === "image/svg+xml" &&
    metadata.slice(1).some((part) => part.toLowerCase() === "base64")
  );
}
