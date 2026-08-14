import { randomUUID } from "node:crypto";
import type { WorkspaceDatabase } from "../../db/database.js";

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

interface UniverAssetUploadRow {
  readonly id: string;
  readonly asset_id: string;
  readonly unit_id: string;
  readonly worktree_id: string | null;
  readonly object_key: string;
  readonly actor_user_id: string;
  readonly original_filename: string;
  readonly declared_media_type: string | null;
  readonly expected_size: number;
  readonly received_size: number | null;
  readonly sha256: string | null;
  readonly etag: string | null;
  readonly state: "receiving" | "stored";
  readonly created_at: number;
  readonly updated_at: number;
  readonly expires_at: number;
}

export class UniverAssetsRepository {
  constructor(private readonly _database: WorkspaceDatabase) {}

  reserveUpload(input: {
    readonly actorUserId: string;
    readonly unitId: string;
    readonly worktreeId: string | null;
    readonly originalFilename: string;
    readonly declaredMediaType: string | null;
    readonly expectedSize: number;
    readonly createdAt: number;
    readonly expiresAt: number;
  }): UniverAssetUploadRow {
    const uploadId = randomUUID();
    const assetId = randomUUID();
    const objectKey = randomUUID();
    this._database.connection.prepare(
      `INSERT INTO univer_asset_uploads
        (
          id, asset_id, unit_id, worktree_id, object_key, actor_user_id,
          original_filename, declared_media_type, expected_size, state,
          created_at, updated_at, expires_at
        )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'receiving', ?, ?, ?)`
    ).run(
      uploadId,
      assetId,
      input.unitId,
      input.worktreeId,
      objectKey,
      input.actorUserId,
      input.originalFilename,
      input.declaredMediaType,
      input.expectedSize,
      input.createdAt,
      input.createdAt,
      input.expiresAt
    );
    return this._requireUpload(uploadId);
  }

  markStored(input: {
    readonly uploadId: string;
    readonly receivedSize: number;
    readonly sha256: string;
    readonly etag: string;
    readonly updatedAt: number;
  }): void {
    const result = this._database.connection.prepare(
      `UPDATE univer_asset_uploads
       SET state = 'stored', received_size = ?, sha256 = ?, etag = ?,
           updated_at = ?
       WHERE id = ? AND state = 'receiving'`
    ).run(
      input.receivedSize,
      input.sha256,
      input.etag,
      input.updatedAt,
      input.uploadId
    );
    if (result.changes !== 1) {
      throw new Error("Univer Asset Upload changed while bytes were stored.");
    }
  }

  publishStored(uploadId: string): UniverAssetRow {
    return this._database.transaction((database) => {
      const upload = this._requireUpload(uploadId);
      if (
        upload.state !== "stored" ||
        upload.received_size !== upload.expected_size ||
        !upload.sha256 ||
        !upload.etag
      ) {
        throw new Error("Univer Asset Upload is not ready to publish.");
      }
      database.prepare(
        `INSERT INTO univer_assets
          (
            id, unit_id, worktree_id, object_key, original_filename,
            media_type, byte_size, sha256, etag, created_by, created_at
          )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        upload.asset_id,
        upload.unit_id,
        upload.worktree_id,
        upload.object_key,
        upload.original_filename,
        upload.declared_media_type || "application/octet-stream",
        upload.received_size,
        upload.sha256,
        upload.etag,
        upload.actor_user_id,
        upload.created_at
      );
      database.prepare(
        "DELETE FROM univer_asset_uploads WHERE id = ?"
      ).run(upload.id);
      return this._requireAsset(upload.asset_id);
    });
  }

  abandonUpload(uploadId: string, abandonedAt: number): void {
    this._database.transaction((database) => {
      const upload = database.prepare(
        "SELECT * FROM univer_asset_uploads WHERE id = ?"
      ).get(uploadId) as UniverAssetUploadRow | undefined;
      if (!upload) return;
      enqueueDeletion(
        database,
        upload.object_key,
        "univer_asset_upload_abandoned",
        abandonedAt
      );
      database.prepare(
        "DELETE FROM univer_asset_uploads WHERE id = ?"
      ).run(uploadId);
    });
  }

  recoverInterruptedUploads(recoveredAt: number): {
    readonly published: number;
    readonly abandoned: number;
  } {
    const rows = this._database.connection.prepare(
      `SELECT * FROM univer_asset_uploads ORDER BY created_at, id`
    ).all() as unknown as UniverAssetUploadRow[];
    let published = 0;
    let abandoned = 0;
    for (const row of rows) {
      if (row.state === "stored") {
        this.publishStored(row.id);
        published += 1;
      } else {
        this.abandonUpload(row.id, recoveredAt);
        abandoned += 1;
      }
    }
    return { published, abandoned };
  }

  findAsset(assetId: string): UniverAssetRow | null {
    return (
      (this._database.connection.prepare(
        "SELECT * FROM univer_assets WHERE id = ?"
      ).get(assetId) as UniverAssetRow | undefined) ?? null
    );
  }

  publishWorktreeAssets(
    worktreeId: string,
    unitIds: readonly string[]
  ): number {
    if (unitIds.length === 0) return 0;
    return this._database.transaction((database) => {
      const publish = database.prepare(
        `UPDATE univer_assets
         SET worktree_id = NULL
         WHERE worktree_id = ? AND unit_id = ?`
      );
      let count = 0;
      for (const unitId of new Set(unitIds)) {
        count += Number(publish.run(worktreeId, unitId).changes);
      }
      return count;
    });
  }

  private _requireUpload(uploadId: string): UniverAssetUploadRow {
    const row = this._database.connection.prepare(
      "SELECT * FROM univer_asset_uploads WHERE id = ?"
    ).get(uploadId) as UniverAssetUploadRow | undefined;
    if (!row) throw new Error("Univer Asset Upload is missing.");
    return row;
  }

  private _requireAsset(assetId: string): UniverAssetRow {
    const row = this.findAsset(assetId);
    if (!row) throw new Error("Published Univer Asset is missing.");
    return row;
  }
}

type DeletionReason = "univer_asset_upload_abandoned";

function enqueueDeletion(
  database: WorkspaceDatabase["connection"],
  objectKey: string,
  reason: DeletionReason,
  createdAt: number
): void {
  database.prepare(
    `INSERT INTO object_deletion_jobs
      (id, object_key, reason, next_attempt_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (object_key) DO NOTHING`
  ).run(randomUUID(), objectKey, reason, createdAt, createdAt, createdAt);
}
