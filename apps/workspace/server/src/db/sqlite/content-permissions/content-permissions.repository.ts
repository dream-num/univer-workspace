import type { SqliteDatabase } from "../connection.js";
import { spaceOwnerIdsSql, type SqliteAccessRepository } from "../access/access.repository.js";
import type { UnitType } from "../../../modules/access/index.js";
import {
  canManageContentPermission,
  type ContentCollaborator,
  type ContentPermissionObject,
  type ContentPermissionUpdate,
  type ContentPermissionsRepository,
  type ContentPermissionWriteResult,
} from "../../../modules/content-permissions/content-permissions.repository.js";

export class SqliteContentPermissionsRepository implements ContentPermissionsRepository {
  constructor(private readonly database: SqliteDatabase, private readonly access: SqliteAccessRepository) {}

  async get(unitId: string, objectId: string): Promise<ContentPermissionObject | null> {
    const row = this.database.connection
      .prepare("SELECT * FROM content_permission_objects WHERE unit_id = ? AND id = ?")
      .get(unitId, objectId) as
      | {
          id: string;
          unit_id: string;
          object_type: number;
          creator_user_id: string;
          name: string;
          strategies_json: string;
          read_scope: number;
          edit_scope: number;
        }
      | undefined;
    if (!row) return null;
    const collaborators = this.database.connection
      .prepare(
        "SELECT user_id AS userId, role FROM content_permission_collaborators WHERE object_id = ? ORDER BY user_id",
      )
      .all(objectId) as unknown as ContentCollaborator[];
    return {
      id: row.id,
      unitId: row.unit_id,
      objectType: row.object_type,
      creatorUserId: row.creator_user_id,
      name: row.name,
      strategies: JSON.parse(row.strategies_json) as ContentPermissionObject["strategies"],
      readScope: row.read_scope,
      editScope: row.edit_scope,
      collaborators,
    };
  }

  async create(object: ContentPermissionObject, unitType: UnitType): Promise<ContentPermissionWriteResult> {
    return this.database.transaction((db) => {
      const resource = this.access.readUnitContentAccess(object.creatorUserId, object.unitId);
      if (!resource?.capabilities.editContent || resource.unitType !== unitType) return "denied";
      if (!this.canAddCollaborators(object.unitId, object.collaborators)) return "invalid-collaborator";
      const now = Date.now();
      db.prepare(`INSERT INTO content_permission_objects
        (id, unit_id, object_type, creator_user_id, name, strategies_json, read_scope, edit_scope, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        object.id,
        object.unitId,
        object.objectType,
        object.creatorUserId,
        object.name,
        JSON.stringify(object.strategies),
        object.readScope,
        object.editScope,
        now,
        now,
      );
      this.writeCollaborators(object.id, object.collaborators);
      return "saved";
    });
  }

  async update(
    userId: string,
    unitId: string,
    objectId: string,
    patch: ContentPermissionUpdate,
  ): Promise<ContentPermissionWriteResult> {
    return this.database.transaction((db) => {
      const object = db.prepare("SELECT creator_user_id FROM content_permission_objects WHERE unit_id = ? AND id = ?")
        .get(unitId, objectId) as { creator_user_id: string } | undefined;
      if (!object) return "denied";
      const resource = this.access.readUnitContentAccess(userId, unitId);
      if (!canManageContentPermission(userId, object.creator_user_id, resource)) return "denied";
      if (patch.collaborators !== null && !this.canAddCollaborators(unitId, patch.collaborators))
        return "invalid-collaborator";
      db.prepare(`UPDATE content_permission_objects
        SET name = COALESCE(?, name), strategies_json = COALESCE(?, strategies_json),
            read_scope = COALESCE(?, read_scope), edit_scope = COALESCE(?, edit_scope), updated_at = ?
        WHERE id = ? AND unit_id = ?`).run(
        patch.name,
        patch.strategies === null ? null : JSON.stringify(patch.strategies),
        patch.scope?.read ?? null,
        patch.scope?.edit ?? null,
        Date.now(),
        objectId,
        unitId,
      );
      if (patch.collaborators !== null) {
        db.prepare("DELETE FROM content_permission_collaborators WHERE object_id = ?").run(objectId);
        this.writeCollaborators(objectId, patch.collaborators);
      }
      return "saved";
    });
  }

  /** Finite explicit membership only; public/link readers are never enumerated. */
  async candidateUserIds(unitId: string): Promise<string[]> {
    const rows = this.database.connection
      .prepare(`
      WITH RECURSIVE ancestors(id, parent_id, space_id) AS (
        SELECT n.id, n.parent_id, n.space_id FROM nodes n
        JOIN resources r ON r.node_id = n.id JOIN univer_resources u ON u.resource_id = r.id
        WHERE u.unit_id = ?
        UNION ALL
        SELECT n.id, n.parent_id, n.space_id FROM nodes n JOIN ancestors a ON a.parent_id = n.id
      )
      ${spaceOwnerIdsSql("SELECT owner_user_id AS id FROM spaces WHERE id IN (SELECT space_id FROM ancestors)")}
      UNION SELECT user_id AS id FROM space_members WHERE space_id IN (SELECT space_id FROM ancestors)
      UNION SELECT user_id AS id FROM node_grants WHERE node_id IN (SELECT id FROM ancestors)
      ORDER BY id
    `)
      .all(unitId) as { id: string }[];
    return rows.map((row) => row.id);
  }

  private canAddCollaborators(unitId: string, collaborators: readonly ContentCollaborator[]): boolean {
    const user = this.database.connection.prepare("SELECT 1 FROM users WHERE id = ?");
    return collaborators.every(({ userId }) =>
      user.get(userId) && this.access.readUnitContentAccess(userId, unitId)?.capabilities.openContent
    );
  }

  private writeCollaborators(objectId: string, collaborators: readonly ContentCollaborator[]): void {
    const insert = this.database.connection.prepare(
      "INSERT INTO content_permission_collaborators (object_id, user_id, role) VALUES (?, ?, ?)",
    );
    for (const user of collaborators) insert.run(objectId, user.userId, user.role);
  }
}
