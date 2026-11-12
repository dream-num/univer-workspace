import { randomUUID } from "node:crypto";
import type { WorkspaceDatabase } from "../../db/database.js";
import type { StoredBlob } from "../../integrations/blob/blob-store.js";
import { ApplicationError } from "../../middleware/errors.js";
import {
  enqueueObjectDeletion,
  insertReadyBlobResource,
  swapBlobContent,
} from "../blobs/blobs.repository.js";
import type { DraftRow } from "./drafts.types.js";

export class HtmlViewDraftsRepository {
  constructor(private readonly database: WorkspaceDatabase) {}
  find(id: string): DraftRow | undefined {
    return this.database.connection
      .prepare("SELECT * FROM html_view_drafts WHERE id = ?")
      .get(id) as DraftRow | undefined;
  }
  findKey(userId: string, key: string): DraftRow | undefined {
    return this.database.connection
      .prepare("SELECT * FROM html_view_drafts WHERE author_user_id = ? AND idempotency_key = ?")
      .get(userId, key) as DraftRow | undefined;
  }
  currentEtag(resourceId: string): string | undefined {
    return this.database.connection
      .prepare("SELECT etag FROM blob_resources WHERE resource_id = ?")
      .get(resourceId)?.etag as string | undefined;
  }
  reserve(
    input: Pick<
      DraftRow,
      | "author_user_id"
      | "idempotency_key"
      | "kind"
      | "space_id"
      | "parent_node_id"
      | "name"
      | "target_resource_id"
      | "base_etag"
      | "sha256"
      | "byte_size"
    >,
    now: number,
  ): DraftRow {
    return this.database.transaction((db) => {
      db.prepare(`INSERT INTO html_view_drafts
        (id, author_user_id, idempotency_key, kind, space_id, parent_node_id, name, target_resource_id,
         base_etag, object_key, byte_size, sha256, state, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'receiving', ?, ?, ?)`).run(
        randomUUID(),
        input.author_user_id,
        input.idempotency_key,
        input.kind,
        input.space_id,
        input.parent_node_id,
        input.name,
        input.target_resource_id,
        input.base_etag,
        randomUUID(),
        input.byte_size,
        input.sha256,
        now + 3600000,
        now,
        now,
      );
      return this.findKey(input.author_user_id, input.idempotency_key)!;
    });
  }
  markPending(id: string, stored: StoredBlob, now: number): DraftRow {
    this.database.connection
      .prepare(`UPDATE html_view_drafts SET state = 'pending', media_type = ?, stored_etag = ?,
      expires_at = ?, updated_at = ? WHERE id = ? AND state = 'receiving' AND expires_at > ?`)
      .run(stored.mediaType, stored.etag, now + 7 * 86400000, now, id, now);
    return this.find(id)!;
  }
  decide(id: string, userId: string, action: "publish" | "reject", now: number): DraftRow {
    return this.database.transaction((db) => {
      const row = this.find(id)!;
      if (row.state !== "pending" && row.state !== "receiving") return row;
      let state: DraftRow["state"];
      let result: { nodeId: string; resourceId: string; etag: string } | null = null;
      if (row.expires_at <= now) state = "expired";
      else if (action === "reject") state = "rejected";
      else if (row.kind === "create") {
        result = { nodeId: randomUUID(), resourceId: randomUUID(), etag: row.stored_etag! };
        insertReadyBlobResource(db, {
          ...result,
          spaceId: row.space_id,
          parentNodeId: row.parent_node_id,
          name: row.name,
          originalFilename: row.name,
          createdBy: userId,
          objectKey: row.object_key,
          mediaType: row.media_type!,
          byteSize: row.byte_size,
          sha256: row.sha256,
          now,
        });
        state = "published";
      } else {
        const swapped = swapBlobContent(db, {
          resourceId: row.target_resource_id!,
          expectedEtag: row.base_etag!,
          objectKey: row.object_key,
          stored: { mediaType: row.media_type!, byteSize: row.byte_size, sha256: row.sha256 },
          now,
        });
        if (swapped === "etag-mismatch") state = "conflicted";
        else {
          const nodeId = db
            .prepare("SELECT node_id FROM resources WHERE id = ?")
            .get(row.target_resource_id!)!.node_id as string;
          result = { nodeId, resourceId: row.target_resource_id!, etag: swapped.etag };
          state = "published";
        }
      }
      if (state !== "published")
        enqueueObjectDeletion(db, row.object_key, "blob_upload_abandoned", now);
      db.prepare(`UPDATE html_view_drafts SET state = ?, result_node_id = ?, result_resource_id = ?, result_etag = ?,
        decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?`).run(
        state,
        result?.nodeId ?? null,
        result?.resourceId ?? null,
        result?.etag ?? null,
        userId,
        now,
        now,
        id,
      );
      return this.find(id)!;
    });
  }
  expireDue(now: number, limit: number, active: readonly string[] = []): number {
    const rows = this.database.connection
      .prepare(`SELECT id, author_user_id FROM html_view_drafts
      WHERE state IN ('receiving', 'pending') AND expires_at <= ?
      AND id NOT IN (${active.map(() => "?").join(",") || "''"}) ORDER BY expires_at, id LIMIT ?`)
      .all(now, ...active, limit);
    for (const row of rows) this.decide(String(row.id), String(row.author_user_id), "reject", now);
    return rows.length;
  }
}

export function draftConflict(message: string): ApplicationError {
  return new ApplicationError("CONFLICT", 409, message);
}
