import { randomUUID } from "node:crypto";
import type { WorkspaceDatabase } from "../../db/database.js";
import { ApplicationError } from "../../middleware/errors.js";
import {
  enqueueObjectDeletion,
  insertReadyBlobResource,
  swapBlobContent,
} from "../blobs/blobs.repository.js";
import { draftBase, draftFiles, draftKeep, type BaseFile, type DraftRow } from "./drafts.types.js";
import { safeSkillPath } from "./scan.js";

export function draftConflict(message: string): ApplicationError {
  return new ApplicationError("CONFLICT", 409, message);
}
export interface CurrentFile extends BaseFile {
  nodeId: string;
  objectKey: string;
  byteSize: number;
  mediaType: string;
}
export interface SkillTarget {
  folderNodeId: string | null;
  files: CurrentFile[];
  nonEmpty: boolean;
}

export class SkillDraftsRepository {
  constructor(private readonly database: WorkspaceDatabase) {}
  find(id: string): DraftRow | undefined {
    return this.database.connection.prepare("SELECT * FROM skill_drafts WHERE id = ?").get(id) as
      | DraftRow
      | undefined;
  }
  findKey(userId: string, key: string): DraftRow | undefined {
    return this.database.connection
      .prepare("SELECT * FROM skill_drafts WHERE author_user_id = ? AND idempotency_key = ?")
      .get(userId, key) as DraftRow | undefined;
  }
  private folder(spaceId: string, parentId: string | null, name: string): string | null {
    const rows = this.database.connection
      .prepare(`SELECT n.id, r.id AS resource_id FROM nodes n
      LEFT JOIN resources r ON r.node_id = n.id
      WHERE n.space_id = ? AND n.parent_id IS ? AND n.name = ? AND n.trash_batch_id IS NULL`)
      .all(spaceId, parentId, name);
    if (rows.length > 1 || rows.some((row) => row.resource_id !== null))
      throw draftConflict("Ambiguous Skill destination or file/folder collision.");
    return rows.length === 0 ? null : String(rows[0]!.id);
  }
  target(spaceId: string, name: string): SkillTarget {
    let parentId: string | null = null;
    for (const segment of [".agents", "skills", name]) {
      parentId = this.folder(spaceId, parentId, segment);
      if (parentId === null) return { folderNodeId: null, files: [], nonEmpty: false };
    }
    const rows = this.database.connection
      .prepare(`WITH RECURSIVE tree(id, path) AS (
      SELECT id, name FROM nodes WHERE parent_id = ? AND trash_batch_id IS NULL
      UNION ALL SELECT n.id, tree.path || '/' || n.name FROM nodes n JOIN tree ON n.parent_id = tree.id WHERE n.trash_batch_id IS NULL
    ) SELECT tree.path, n.id AS node_id, r.id AS resource_id, b.etag, b.object_key, b.byte_size, b.media_type, b.availability
      FROM tree JOIN nodes n ON n.id = tree.id LEFT JOIN resources r ON r.node_id = n.id
      LEFT JOIN blob_resources b ON b.resource_id = r.id ORDER BY tree.path, n.id`)
      .all(parentId);
    const paths = new Set<string>();
    const files: CurrentFile[] = [];
    for (const row of rows) {
      const path = String(row.path);
      if (paths.has(path) || !safeSkillPath(path))
        throw draftConflict("Duplicate or invalid paths in the target Skill.");
      paths.add(path);
      if (row.resource_id === null) continue;
      if (row.etag === null || row.availability !== "ready")
        throw draftConflict("Skill files must be available Blob resources.");
      files.push({
        path,
        nodeId: String(row.node_id),
        resourceId: String(row.resource_id),
        etag: String(row.etag),
        objectKey: String(row.object_key),
        byteSize: Number(row.byte_size),
        mediaType: String(row.media_type),
      });
    }
    return { folderNodeId: parentId, files, nonEmpty: rows.length > 0 };
  }
  personalNameConflict(userId: string, spaceId: string, name: string): boolean {
    const space = this.database.connection
      .prepare("SELECT type FROM spaces WHERE id = ?")
      .get(spaceId);
    if (space?.type !== "team") return false;
    const personal = this.database.connection
      .prepare("SELECT id FROM spaces WHERE type = 'personal' AND owner_user_id = ?")
      .get(userId);
    if (!personal) return false;
    try {
      return this.target(String(personal.id), name).nonEmpty;
    } catch {
      return true;
    }
  }
  reserve(
    input: Pick<
      DraftRow,
      | "author_user_id"
      | "idempotency_key"
      | "intent_sha256"
      | "space_id"
      | "name"
      | "target_folder_node_id"
      | "files"
      | "base"
      | "keep"
      | "scan"
      | "review"
      | "unverified_review_count"
      | "source"
    >,
    now: number,
  ): { row: DraftRow; created: boolean } {
    return this.database.transaction((db) => {
      const existing = this.findKey(input.author_user_id, input.idempotency_key);
      if (existing) {
        if (existing.intent_sha256 !== input.intent_sha256)
          throw draftConflict("Idempotency-Key belongs to another draft intent.");
        return { row: existing, created: false };
      }
      const id = randomUUID();
      db.prepare(`INSERT INTO skill_drafts (id, author_user_id, idempotency_key, intent_sha256, space_id, name,
        target_folder_node_id, files, base, keep, scan, review, unverified_review_count, source, state, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'receiving', ?, ?, ?)`).run(
        id,
        input.author_user_id,
        input.idempotency_key,
        input.intent_sha256,
        input.space_id,
        input.name,
        input.target_folder_node_id,
        input.files,
        input.base,
        input.keep,
        input.scan,
        input.review,
        input.unverified_review_count,
        input.source,
        now + 3600000,
        now,
        now,
      );
      return { row: this.find(id)!, created: true };
    });
  }
  markPending(id: string, now: number): DraftRow {
    this.database.connection
      .prepare(`UPDATE skill_drafts SET state = 'pending', expires_at = ?, updated_at = ?
      WHERE id = ? AND state = 'receiving' AND expires_at > ?`)
      .run(now + 7 * 86400000, now, id, now);
    return this.find(id)!;
  }
  decide(
    id: string,
    userId: string,
    action: "publish" | "reject",
    now: number,
    authorize?: (row: DraftRow, target: SkillTarget) => void,
  ): DraftRow {
    return this.database.transaction((db) => {
      const row = this.find(id)!;
      if (row.state !== "pending" && row.state !== "receiving") return row;
      let state: DraftRow["state"];
      let folderId: string | null = null;
      if (row.expires_at <= now) state = "expired";
      else if (action === "reject") state = "rejected";
      else {
        if (row.state !== "pending") throw draftConflict("Draft content is still receiving.");
        const target = this.target(row.space_id, row.name);
        authorize?.(row, target);
        const base = draftBase(row);
        const changed =
          base === null
            ? target.nonEmpty
            : target.folderNodeId !== row.target_folder_node_id ||
              target.files.length !== base.length ||
              base.some(
                (file) =>
                  !target.files.some(
                    (current) =>
                      current.path === file.path &&
                      current.resourceId === file.resourceId &&
                      current.etag === file.etag,
                  ),
              );
        if (changed) state = "conflicted";
        else {
          const ensureFolder = (parentId: string | null, name: string): string => {
            const existing = this.folder(row.space_id, parentId, name);
            if (existing) return existing;
            const nodeId = randomUUID();
            db.prepare(
              `INSERT INTO nodes (id, space_id, parent_id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ).run(nodeId, row.space_id, parentId, name, userId, now, now);
            return nodeId;
          };
          folderId = ensureFolder(ensureFolder(ensureFolder(null, ".agents"), "skills"), row.name);
          const files = draftFiles(row);
          for (const file of files) {
            const existing = target.files.find((current) => current.path === file.path);
            if (existing) {
              if (
                swapBlobContent(db, {
                  resourceId: existing.resourceId,
                  expectedEtag: existing.etag,
                  objectKey: file.objectKey,
                  stored: file,
                  now,
                }) === "etag-mismatch"
              )
                throw draftConflict("Skill content changed.");
            } else {
              const segments = file.path.split("/");
              const name = segments.pop()!;
              let parentId = folderId;
              for (const segment of segments) parentId = ensureFolder(parentId, segment);
              if (this.folder(row.space_id, parentId, name))
                throw draftConflict("Skill file collides with an existing folder.");
              insertReadyBlobResource(db, {
                ...file,
                nodeId: randomUUID(),
                resourceId: randomUUID(),
                spaceId: row.space_id,
                parentNodeId: parentId,
                name,
                originalFilename: name,
                createdBy: userId,
                etag: file.sha256,
                now,
              });
            }
          }
          const keep = draftKeep(row);
          for (const removed of target.files.filter(
            (current) =>
              !files.some((file) => file.path === current.path) && !keep.includes(current.path),
          )) {
            const batchId = randomUUID();
            db.prepare(
              "INSERT INTO trash_batches (id, space_id, root_node_id, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
            ).run(batchId, row.space_id, removed.nodeId, userId, now);
            db.prepare("UPDATE nodes SET trash_batch_id = ?, updated_at = ? WHERE id = ?").run(
              batchId,
              now,
              removed.nodeId,
            );
          }
          state = "published";
        }
      }
      if (state !== "published")
        for (const file of draftFiles(row))
          enqueueObjectDeletion(db, file.objectKey, "blob_upload_abandoned", now);
      db.prepare(
        `UPDATE skill_drafts SET state = ?, result_folder_node_id = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?`,
      ).run(state, folderId, userId, now, now, id);
      return this.find(id)!;
    });
  }
  expireDue(now: number, limit: number, active: readonly string[] = []): number {
    const rows = this.database.connection
      .prepare(`SELECT id, author_user_id FROM skill_drafts WHERE state IN ('receiving', 'pending') AND expires_at <= ?
      AND id NOT IN (${active.map(() => "?").join(",") || "''"}) ORDER BY expires_at, id LIMIT ?`)
      .all(now, ...active, limit);
    for (const row of rows) this.decide(String(row.id), String(row.author_user_id), "reject", now);
    return rows.length;
  }
}
