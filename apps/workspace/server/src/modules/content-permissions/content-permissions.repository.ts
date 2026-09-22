import type { WorkspaceDatabase } from "../../db/database.js";

export interface ContentCollaborator {
  readonly userId: string;
  readonly role: number;
}

/** Protocol enum values are opaque storage values; the integration validates them. */
export interface ContentPermissionObject {
  readonly id: string;
  readonly unitId: string;
  readonly objectType: number;
  readonly creatorUserId: string;
  readonly name: string;
  readonly strategies: readonly { readonly action: number; readonly role: number }[];
  readonly editScope: number;
  readonly collaborators: readonly ContentCollaborator[];
}

export class ContentPermissionsRepository {
  constructor(private readonly database: WorkspaceDatabase) {}

  get(unitId: string, objectId: string): ContentPermissionObject | null {
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
      editScope: row.edit_scope,
      collaborators,
    };
  }

  create(object: ContentPermissionObject): void {
    this.database.transaction((db) => {
      const now = Date.now();
      db.prepare(`INSERT INTO content_permission_objects
        (id, unit_id, object_type, creator_user_id, name, strategies_json, edit_scope, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        object.id,
        object.unitId,
        object.objectType,
        object.creatorUserId,
        object.name,
        JSON.stringify(object.strategies),
        object.editScope,
        now,
        now,
      );
      this.writeCollaborators(object);
    });
  }

  update(object: ContentPermissionObject): void {
    this.database.transaction((db) => {
      db.prepare(`UPDATE content_permission_objects SET name = ?, strategies_json = ?, edit_scope = ?, updated_at = ?
        WHERE id = ? AND unit_id = ?`).run(
        object.name,
        JSON.stringify(object.strategies),
        object.editScope,
        Date.now(),
        object.id,
        object.unitId,
      );
      db.prepare("DELETE FROM content_permission_collaborators WHERE object_id = ?").run(object.id);
      this.writeCollaborators(object);
    });
  }

  /** Finite explicit membership only; public/link readers are never enumerated. */
  candidateUserIds(unitId: string): string[] {
    const rows = this.database.connection
      .prepare(`
      WITH RECURSIVE ancestors(id, parent_id, space_id) AS (
        SELECT n.id, n.parent_id, n.space_id FROM nodes n
        JOIN resources r ON r.node_id = n.id JOIN univer_resources u ON u.resource_id = r.id
        WHERE u.unit_id = ?
        UNION ALL
        SELECT n.id, n.parent_id, n.space_id FROM nodes n JOIN ancestors a ON a.parent_id = n.id
      )
      SELECT owner_user_id AS id FROM spaces WHERE id IN (SELECT space_id FROM ancestors)
      UNION SELECT user_id AS id FROM space_members WHERE space_id IN (SELECT space_id FROM ancestors)
      UNION SELECT user_id AS id FROM node_grants WHERE node_id IN (SELECT id FROM ancestors)
      ORDER BY id
    `)
      .all(unitId) as { id: string }[];
    return rows.map((row) => row.id);
  }

  private writeCollaborators(object: ContentPermissionObject): void {
    const insert = this.database.connection.prepare(
      "INSERT INTO content_permission_collaborators (object_id, user_id, role) VALUES (?, ?, ?)",
    );
    for (const user of object.collaborators) insert.run(object.id, user.userId, user.role);
  }
}
