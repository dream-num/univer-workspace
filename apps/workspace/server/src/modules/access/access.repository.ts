import type { WorkspaceDatabase } from "../../db/database.js";
import type {
  AccessRole,
  BlobAvailability,
  ResourceKind,
  SpaceType,
  UnitType,
} from "./access.types.js";

export interface ResolvedNodeRow {
  readonly id: string;
  readonly space_id: string;
  readonly parent_id: string | null;
  readonly name: string;
  readonly resource_id: string | null;
  readonly resource_kind: ResourceKind | null;
  readonly unit_type: UnitType | null;
  readonly blob_media_type: string | null;
  readonly blob_byte_size: number | null;
  readonly blob_availability: BlobAvailability | null;
  readonly has_children: 0 | 1;
  readonly updated_at: number;
  readonly space_type: SpaceType;
  readonly space_name: string;
  readonly owner_user_id: string;
  readonly public_read: 0 | 1;
  readonly member_role: Exclude<AccessRole, "owner"> | null;
  readonly grant_role: "editor" | "viewer" | null;
  readonly grant_navigation_root_id: string | null;
  readonly link_sharing_role: "editor" | "viewer" | null;
  readonly navigation_root_id: string | null;
}

interface SpaceAccessRow {
  readonly id: string;
  readonly type: SpaceType;
  readonly name: string;
  readonly owner_user_id: string;
  readonly public_read: 0 | 1;
  readonly member_role: Exclude<AccessRole, "owner"> | null;
}

export interface ResourceMappingRow {
  readonly resource_id: string;
  readonly node_id: string;
  readonly resource_kind: ResourceKind;
  readonly unit_id: string | null;
  readonly unit_type: UnitType | null;
  readonly object_key: string | null;
  readonly original_filename: string | null;
  readonly media_type: string | null;
  readonly byte_size: number | null;
  readonly sha256: string | null;
  readonly etag: string | null;
  readonly availability: BlobAvailability | null;
}

export class AccessRepository {
  constructor(private readonly _database: WorkspaceDatabase) {}

  findResourceByUnitId(unitId: string): ResourceMappingRow | null {
    return (
      (this._database.connection
        .prepare(
          `SELECT
             resource.id AS resource_id,
             resource.node_id,
             resource.kind AS resource_kind,
             univer.unit_id,
             univer.unit_type,
             NULL AS object_key,
             NULL AS original_filename,
             NULL AS media_type,
             NULL AS byte_size,
             NULL AS sha256,
             NULL AS etag,
             NULL AS availability
           FROM univer_resources AS univer
           JOIN resources AS resource ON resource.id = univer.resource_id
           WHERE univer.unit_id = ?`
        )
        .get(unitId) as ResourceMappingRow | undefined) ?? null
    );
  }

  findResource(resourceId: string): ResourceMappingRow | null {
    return (
      (this._database.connection
        .prepare(
          `SELECT
             resource.id AS resource_id,
             resource.node_id,
             resource.kind AS resource_kind,
             univer.unit_id,
             univer.unit_type,
             blob.object_key,
             blob.original_filename,
             blob.media_type,
             blob.byte_size,
             blob.sha256,
             blob.etag,
             blob.availability
           FROM resources AS resource
           LEFT JOIN univer_resources AS univer
             ON univer.resource_id = resource.id
           LEFT JOIN blob_resources AS blob
             ON blob.resource_id = resource.id
           WHERE resource.id = ?`
        )
        .get(resourceId) as ResourceMappingRow | undefined) ?? null
    );
  }

  resolveSpace(userId: string, spaceId: string): SpaceAccessRow | null {
    return (
      (this._database.connection
        .prepare(
          `SELECT
             spaces.id,
             spaces.type,
             spaces.name,
             spaces.owner_user_id,
             spaces.public_read,
             space_members.role AS member_role
           FROM spaces
           LEFT JOIN space_members
             ON space_members.space_id = spaces.id
            AND space_members.user_id = ?
           WHERE spaces.id = ?
             AND (
               spaces.owner_user_id = ?
               OR (spaces.type = 'team' AND space_members.user_id IS NOT NULL)
               OR spaces.public_read = 1
             )`
        )
        .get(userId, spaceId, userId) as SpaceAccessRow | undefined) ?? null
    );
  }

  resolveNode(userId: string, nodeId: string): ResolvedNodeRow | null {
    return (
      (this._database.connection
        .prepare(
          `WITH RECURSIVE ancestry(id, parent_id, depth) AS (
             SELECT id, parent_id, 0
             FROM nodes
             WHERE id = ? AND trash_batch_id IS NULL
             UNION ALL
             SELECT parent.id, parent.parent_id, ancestry.depth + 1
             FROM nodes AS parent
             JOIN ancestry ON ancestry.parent_id = parent.id
             WHERE parent.trash_batch_id IS NULL
           )
           SELECT
             node.id,
             node.space_id,
             node.parent_id,
             node.name,
             resource.id AS resource_id,
             resource.kind AS resource_kind,
             univer.unit_type,
             blob.media_type AS blob_media_type,
             blob.byte_size AS blob_byte_size,
             blob.availability AS blob_availability,
             EXISTS (
               SELECT 1 FROM nodes AS child
               WHERE child.parent_id = node.id
                 AND child.trash_batch_id IS NULL
             ) AS has_children,
             node.updated_at,
             space.type AS space_type,
             space.name AS space_name,
             space.owner_user_id,
             space.public_read,
             member.role AS member_role,
             (
               SELECT grant_node.role
               FROM ancestry
               JOIN node_grants AS grant_node
                 ON grant_node.node_id = ancestry.id
                AND grant_node.user_id = ?
               ORDER BY
                 CASE grant_node.role WHEN 'editor' THEN 0 ELSE 1 END,
                 ancestry.depth DESC
               LIMIT 1
             ) AS grant_role,
             (
               SELECT ancestry.id
               FROM ancestry
               JOIN node_grants AS navigation_grant
                 ON navigation_grant.node_id = ancestry.id
                AND navigation_grant.user_id = ?
               ORDER BY ancestry.depth DESC
               LIMIT 1
             ) AS grant_navigation_root_id,
             (
               SELECT link_sharing.role
               FROM ancestry
               JOIN node_link_sharing AS link_sharing
                 ON link_sharing.node_id = ancestry.id
                AND link_sharing.enabled = 1
               ORDER BY
                 CASE link_sharing.role WHEN 'editor' THEN 0 ELSE 1 END,
                 ancestry.depth DESC
               LIMIT 1
             ) AS link_sharing_role,
             (
               SELECT visible_root.id
               FROM (
                 SELECT ancestry.id, ancestry.depth
                 FROM ancestry
                 JOIN node_grants AS navigation_grant
                   ON navigation_grant.node_id = ancestry.id
                  AND navigation_grant.user_id = ?
                 UNION ALL
                 SELECT ancestry.id, ancestry.depth
                 FROM ancestry
                 JOIN node_link_sharing AS link_sharing
                   ON link_sharing.node_id = ancestry.id
                  AND link_sharing.enabled = 1
               ) AS visible_root
               ORDER BY visible_root.depth DESC
               LIMIT 1
             ) AS navigation_root_id
           FROM nodes AS node
           JOIN spaces AS space ON space.id = node.space_id
           LEFT JOIN resources AS resource ON resource.node_id = node.id
           LEFT JOIN univer_resources AS univer
             ON univer.resource_id = resource.id
           LEFT JOIN blob_resources AS blob
             ON blob.resource_id = resource.id
           LEFT JOIN space_members AS member
             ON member.space_id = space.id
            AND member.user_id = ?
           WHERE node.id = ?
             AND node.trash_batch_id IS NULL
             AND (
               space.owner_user_id = ?
               OR (space.type = 'team' AND member.user_id IS NOT NULL)
               OR space.public_read = 1
               OR (
                 space.type = 'personal'
                 AND (
                   EXISTS (
                     SELECT 1
                     FROM ancestry
                     JOIN node_grants AS visible_grant
                       ON visible_grant.node_id = ancestry.id
                      AND visible_grant.user_id = ?
                   )
                   OR EXISTS (
                     SELECT 1
                     FROM ancestry
                     JOIN node_link_sharing AS visible_link_sharing
                       ON visible_link_sharing.node_id = ancestry.id
                      AND visible_link_sharing.enabled = 1
                   )
                 )
               )
             )`
        )
        .get(
          nodeId,
          userId,
          userId,
          userId,
          userId,
          nodeId,
          userId,
          userId
        ) as ResolvedNodeRow | undefined) ?? null
    );
  }
}
