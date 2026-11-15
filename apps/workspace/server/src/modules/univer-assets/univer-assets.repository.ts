export interface UniverAssetRow {
  readonly id: string;
  readonly unit_id: string;
  readonly worktree_id: string | null;
  readonly object_key: string;
  readonly original_filename: string;
  readonly media_type: string;
  readonly byte_size: number;
  readonly sha256: string;
  readonly etag: string;
  readonly created_by: string;
  readonly created_at: number;
}

export interface UniverAssetsRepository {
  reserveUpload(input: {
    readonly actorUserId: string;
    readonly unitId: string;
    readonly worktreeId: string | null;
    readonly originalFilename: string;
    readonly declaredMediaType: string | null;
    readonly expectedSize: number;
    readonly createdAt: number;
    readonly expiresAt: number;
    /** An Asset ID the caller already wrote into the Unit (an Office import's references). */
    readonly assetId?: string;
  }): Promise<{ readonly id: string; readonly objectKey: string }>;
  markStored(input: {
    readonly uploadId: string;
    readonly receivedSize: number;
    readonly sha256: string;
    readonly etag: string;
    readonly updatedAt: number;
  }): Promise<void>;
  publishStored(uploadId: string): Promise<UniverAssetRow>;
  abandonUpload(uploadId: string, abandonedAt: number): Promise<void>;
  recoverInterruptedUploads(recoveredAt: number): Promise<{
    readonly published: number;
    readonly abandoned: number;
  }>;
  findAsset(assetId: string): Promise<UniverAssetRow | null>;
  publishWorktreeAssets(
    worktreeId: string,
    unitIds: readonly string[]
  ): Promise<number>;
}
