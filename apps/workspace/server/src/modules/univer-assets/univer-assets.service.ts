import type { Readable } from "node:stream";
import { FileSource } from "@univerjs/protocol";
import { parseByteRange } from "../../integrations/blob/blob-http.js";
import type { BlobStore } from "../../integrations/blob/blob-store.js";
import { ApplicationError } from "../../middleware/errors.js";
import type { AccessResolver } from "../access/index.js";
import type { WorktreesModule } from "../worktrees/index.js";
import {
  UniverAssetsRepository,
  type UniverAssetRow,
} from "./univer-assets.repository.js";

export const MAX_UNIVER_ASSET_BYTES = 20 * 1024 * 1024;

export type UniverAssetScope =
  | { readonly kind: "trunk" }
  | { readonly kind: "worktree"; readonly worktreeId: string };

export interface UniverAssetsModule {
  upload(
    userId: string,
    scope: UniverAssetScope,
    input: {
      readonly size: unknown;
      readonly source: unknown;
      readonly assign: unknown;
      readonly filename: string;
      readonly declaredMediaType: string | null;
      readonly body: Readable;
    }
  ): Promise<{ readonly FileId: string }>;
  resolveContentUrl(
    userId: string,
    scope: UniverAssetScope,
    assetId: string
  ): Promise<string>;
  openContent(
    userId: string,
    scope: UniverAssetScope,
    assetId: string,
    rangeHeader: string | undefined
  ): Promise<{
    readonly asset: UniverAssetRow;
    readonly stream: Readable;
    readonly totalByteSize: number;
    readonly start: number;
    readonly end: number;
    readonly partial: boolean;
  }>;
}

export function createUniverAssetsModule(options: {
  readonly repository: UniverAssetsRepository;
  readonly access: AccessResolver;
  readonly worktrees: WorktreesModule;
  readonly store: BlobStore;
  readonly now?: () => number;
  readonly maxAssetBytes?: number;
}): UniverAssetsModule {
  const now = options.now ?? Date.now;
  const maxAssetBytes = options.maxAssetBytes ?? MAX_UNIVER_ASSET_BYTES;
  options.repository.recoverInterruptedUploads(now());

  return {
    async upload(userId, scope, input) {
      const intent = validUploadIntent(input, maxAssetBytes);
      await authorizeUnit(options, userId, scope, intent.unitId, true);
      const createdAt = now();
      const upload = options.repository.reserveUpload({
        actorUserId: userId,
        unitId: intent.unitId,
        worktreeId: scope.kind === "worktree" ? scope.worktreeId : null,
        originalFilename: intent.filename,
        declaredMediaType: intent.declaredMediaType,
        expectedSize: intent.size,
        createdAt,
        expiresAt: createdAt + 60 * 60 * 1000,
      });
      try {
        const stored = await options.store.put({
          objectKey: upload.object_key,
          body: input.body,
          expectedByteSize: intent.size,
          detectMediaType: false,
        });
        options.repository.markStored({
          uploadId: upload.id,
          receivedSize: stored.byteSize,
          sha256: stored.sha256,
          etag: stored.etag,
          updatedAt: now(),
        });
        const asset = options.repository.publishStored(upload.id);
        return { FileId: asset.id };
      } catch (error) {
        options.repository.abandonUpload(upload.id, now());
        if (error instanceof ApplicationError) throw error;
        throw invalidInput(
          error instanceof Error ? error.message : "Image upload failed.",
          "file"
        );
      }
    },

    async resolveContentUrl(userId, scope, assetId) {
      await requireAuthorizedAsset(options, userId, scope, assetId);
      const encodedAssetId = encodeURIComponent(assetId);
      if (scope.kind === "trunk") {
        return `/universer-api/file/${encodedAssetId}/content`;
      }
      return `/universer-api/worktrees/${encodeURIComponent(scope.worktreeId)}/file/${encodedAssetId}/content`;
    },

    async openContent(userId, scope, assetId, rangeHeader) {
      const asset = await requireAuthorizedAsset(
        options,
        userId,
        scope,
        assetId
      );
      const range = parseByteRange(rangeHeader, asset.byte_size);
      const opened = await options.store.open({
        objectKey: asset.object_key,
        ...(range ? { start: range.start, end: range.end } : {}),
      });
      return { asset, ...opened, partial: range !== null };
    },
  };
}

function validUploadIntent(
  input: {
    readonly size: unknown;
    readonly source: unknown;
    readonly assign: unknown;
    readonly filename: string;
    readonly declaredMediaType: string | null;
  },
  maxAssetBytes: number
): {
  readonly size: number;
  readonly unitId: string;
  readonly filename: string;
  readonly declaredMediaType: string | null;
} {
  if (String(input.source) !== String(FileSource.UnitEmbedded)) {
    throw invalidInput("source must be UnitEmbedded (3).", "source");
  }
  const size = Number(input.size);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw invalidInput("size must be a non-negative integer.", "size");
  }
  if (size > maxAssetBytes) {
    throw new ApplicationError(
      "PAYLOAD_TOO_LARGE",
      413,
      `Image exceeds the ${maxAssetBytes} byte limit.`,
      "size"
    );
  }
  if (
    typeof input.assign !== "string" ||
    !input.assign ||
    input.assign.length > 255
  ) {
    throw invalidInput("assign must be a valid Unit ID.", "assign");
  }
  if (!input.filename || input.filename.length > 1024) {
    throw invalidInput("The uploaded filename is invalid.", "file");
  }
  if (
    input.declaredMediaType !== null &&
    input.declaredMediaType.length > 255
  ) {
    throw invalidInput("The uploaded media type is invalid.", "file");
  }
  return {
    size,
    unitId: input.assign,
    filename: input.filename,
    declaredMediaType: input.declaredMediaType,
  };
}

async function requireAuthorizedAsset(
  options: {
    readonly repository: UniverAssetsRepository;
    readonly access: AccessResolver;
    readonly worktrees: WorktreesModule;
  },
  userId: string,
  scope: UniverAssetScope,
  assetId: string
): Promise<UniverAssetRow> {
  const asset = options.repository.findAsset(assetId);
  if (!asset) throw notFound();
  if (scope.kind === "trunk") {
    if (asset.worktree_id !== null) throw notFound();
  } else if (
    asset.worktree_id !== null &&
    asset.worktree_id !== scope.worktreeId
  ) {
    throw notFound();
  }
  await authorizeUnit(options, userId, scope, asset.unit_id, false);
  return asset;
}

async function authorizeUnit(
  options: {
    readonly access: AccessResolver;
    readonly worktrees: WorktreesModule;
  },
  userId: string,
  scope: UniverAssetScope,
  unitId: string,
  write: boolean
): Promise<void> {
  if (scope.kind === "worktree") {
    const allowed = await options.worktrees.authorizeProtocol({
      userId,
      worktreeId: scope.worktreeId,
      unitId,
      write,
    });
    if (!allowed) throw notFound();
    return;
  }
  const resource = options.access.resolveUnit(userId, unitId);
  if (!resource || resource.kind !== "univer") throw notFound();
  if (!resource.capabilities.openContent) throw notFound();
  if (write && !resource.capabilities.editContent) throw notFound();
}

function invalidInput(message: string, field?: string): ApplicationError {
  return new ApplicationError("INVALID_INPUT", 400, message, field);
}

function notFound(): ApplicationError {
  return new ApplicationError("NOT_FOUND", 404, "The resource was not found.");
}
