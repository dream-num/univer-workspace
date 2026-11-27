import { AGENT_MERGE_WINDOW_MS, assertCeiling, requesterCategory, resolveStoredContentAccess, resolveStoredNodeAccess, resolveStoredResourceAccess, resolveStoredSpaceAccess } from "../../../modules/access/index.js";
import type { PoolClient } from "pg";
import type { PostgresDatabase, PostgresStatement } from "../connection.js";
import { previewedSql } from "../../preview-sql.js";
import type {
  ResolvedNodeRow,
  StoredSpaceAccess,
  ResourceMappingRow,
  NodeAuthorizationRow,
  OwnedResourceRow,
  AccessRepository,
} from "../../../modules/access/access.repository.js";

/** The human who claimed an agent owns the agent's Spaces too, but a claimed agent gains nothing of its human's. */
export function ownsSpaceSql(ownerUserId: string, userId = "$userId"): string {
  return `(${ownerUserId} = ${userId} OR EXISTS (
    SELECT 1 FROM agents WHERE agents.user_id = ${ownerUserId} AND agents.owner_user_id = ${userId}
  ))`;
}

export function spaceOwnerIdsSql(ownerIdsSql: string): string {
  return `${ownerIdsSql}
    UNION SELECT owner_user_id FROM agents WHERE owner_user_id IS NOT NULL AND user_id IN (${ownerIdsSql})`;
}

/**
 * Who may open a proposal, a Team Worktree, in a Team Space: its owners, its members while it is not
 * suspended, and the signed-in readers of a public one that its `proposals` setting admits.
 */
export function proposesSql(space: string, userId = "$userId"): string {
  return `(${space}.type = 'team' AND (${ownsSpaceSql(`${space}.owner_user_id`, userId)} OR (
    NOT ${ownerSuspendedSql(`${space}.owner_user_id`)} AND (
      EXISTS (SELECT 1 FROM space_members AS proposer WHERE proposer.space_id = ${space}.id AND proposer.user_id = ${userId})
      OR (${space}.public_read AND ${space}.proposals <> 'members' AND EXISTS (
        SELECT 1 FROM users AS proposer WHERE proposer.id = ${userId} AND (
          ${space}.proposals = 'anyone' OR proposer.kind = 'human'
          OR EXISTS (SELECT 1 FROM agents AS claimed WHERE claimed.user_id = proposer.id AND claimed.owner_user_id IS NOT NULL))))))))`;
}

export const spaceAccessColumns = `
  spaces.id, spaces.type, spaces.name, spaces.owner_user_id AS "ownerUserId",
  ${ownsSpaceSql("spaces.owner_user_id")} AS "owned",
  spaces.public_read AS "publicRead", ${previewedSql("spaces.owner_user_id")} AS "previewed", space_members.role AS "memberRole",
  ${proposesSql("spaces")} AS "proposes", spaces.landing`;

export const spaceMemberJoin = `
  LEFT JOIN space_members
    ON space_members.space_id = spaces.id AND space_members.user_id = $userId`;

/**
 * An agent that is banned or past its expiry is suspended: its Space gives a role to nobody but
 * its owners. Suspension is derived on every read and never stored, so lifting it needs no repair.
 */
export function ownerSuspendedSql(ownerUserId: string): string {
  return `EXISTS (
    SELECT 1 FROM agents
    WHERE agents.user_id = ${ownerUserId}
      AND (agents.banned_at IS NOT NULL OR agents.expires_at <= EXTRACT(EPOCH FROM statement_timestamp()) * 1000)
  )`;
}

export const visibleSpaceSql = `(
  ${ownsSpaceSql("spaces.owner_user_id")}
  OR (
    NOT ${ownerSuspendedSql("spaces.owner_user_id")}
    AND (
      (spaces.type = 'team' AND space_members.user_id IS NOT NULL)
      OR spaces.public_read
      OR ${previewedSql("spaces.owner_user_id")}
    )
  )
)`;

const requesterColumns = `
  (SELECT kind FROM users WHERE id = $userId) AS requester_kind,
  (SELECT (owner_user_id IS NOT NULL)::integer FROM agents WHERE user_id = $userId) AS requester_claimed`;

async function readRequester(database: PostgresDatabase, userId: string) {
  return await database.prepare(`SELECT ${requesterColumns}`).get({ userId }) as
    Pick<NodeAuthorizationRow, "requester_kind" | "requester_claimed">;
}

/**
 * Files the User's Spaces hold or are about to hold: Nodes with a Resource outside Trash,
 * new-file intents of open pull requests, and creations still in flight. A file that
 * `operationId` already accounts for is left out, so replaying an operation adds nothing.
 */
async function countOwnedFiles(database: PostgresDatabase, userId: string, operationId: string | null): Promise<number> {
  const row = await database
    .prepare(
      `SELECT
         (SELECT COUNT(*)
          FROM resources
          JOIN nodes ON nodes.id = resources.node_id
          JOIN spaces ON spaces.id = nodes.space_id
          WHERE spaces.owner_user_id = $userId
            AND nodes.trash_batch_id IS NULL)
         + (SELECT COUNT(*)
            FROM worktree_node_intents AS intent
            JOIN spaces ON spaces.id = intent.target_space_id
            WHERE spaces.owner_user_id = $userId
              AND intent.activated_at IS NULL
              AND intent.discarded_at IS NULL)
         + (SELECT COUNT(*)
            FROM operations
            WHERE actor_user_id = $userId
              AND state = 'pending'
              AND kind IN ('create_resource', 'create_blob_resource', 'create_worktree_unit', 'copy_node'))
         - (EXISTS (
             SELECT 1 FROM operations
             WHERE id = $operationId AND actor_user_id = $userId AND state <> 'failed'
           ))::integer AS files`,
    )
    .get({ userId, operationId }) as { readonly files: number };
  return row.files;
}

/** Read the principal and inventory on the same connection and transaction as the write. */
export async function assertFileQuota(
  database: PostgresDatabase,
  userId: string,
  adding: number,
  operationId: string | null = null,
): Promise<void> {
  const principal = requesterCategory(await readRequester(database, userId));
  if (principal === "agent_unclaimed") {
    assertCeiling(principal, "createFiles", { held: await countOwnedFiles(database, userId, operationId), adding });
  }
}

/** Read the principal and its Team Spaces in the transaction that creates the next one. */
export async function assertTeamSpaceQuota(client: PoolClient, userId: string): Promise<void> {
  const { rows: [row] } = await client.query<Pick<NodeAuthorizationRow, "requester_kind" | "requester_claimed"> & { readonly held: number }>(`
    SELECT (SELECT kind FROM users WHERE id = $1) AS requester_kind,
           (SELECT (owner_user_id IS NOT NULL)::integer FROM agents WHERE user_id = $1) AS requester_claimed,
           (SELECT COUNT(*)::integer FROM spaces WHERE type = 'team' AND owner_user_id = $1) AS held`, [userId]);
  assertCeiling(requesterCategory(row!), "createTeamSpace", { held: row!.held });
}

/** Read the principal and its forks in the transaction that creates the next one. */
export async function assertForkQuota(client: PoolClient, userId: string): Promise<void> {
  const { rows: [row] } = await client.query<Pick<NodeAuthorizationRow, "requester_kind" | "requester_claimed"> & { readonly held: number }>(`
    SELECT (SELECT kind FROM users WHERE id = $1) AS requester_kind,
           (SELECT (owner_user_id IS NOT NULL)::integer FROM agents WHERE user_id = $1) AS requester_claimed,
           (SELECT COUNT(*)::integer FROM forks WHERE owner_user_id = $1) AS held`, [userId]);
  assertCeiling(requesterCategory(row!), "createFork", { held: row!.held });
}

/** Counted in the transaction that opens the next proposal, so concurrent opens cannot pass the cap. Members are not capped. */
export async function assertProposalQuota(database: PostgresDatabase, userId: string, spaceId: string): Promise<void> {
  const row = await database.prepare(`SELECT ${requesterColumns},
    (SELECT COUNT(*)::integer FROM worktrees JOIN spaces ON spaces.id = worktrees.team_space_id
      WHERE worktrees.team_space_id = $spaceId AND worktrees.creator_user_id = $userId AND worktrees.processed_at IS NULL
        AND NOT ${ownsSpaceSql("spaces.owner_user_id")}
        AND NOT EXISTS (SELECT 1 FROM space_members WHERE space_id = $spaceId AND user_id = $userId)) AS open`).get({ userId, spaceId }) as
    Pick<NodeAuthorizationRow, "requester_kind" | "requester_claimed"> & { readonly open: number };
  assertCeiling(requesterCategory(row), "openProposal", { open: row.open });
}

/**
 * Worktrees the User created and has not merged or discarded, creations whose Worktree row is not
 * written yet included, and the merges it started within the window, except those the checks gate refused.
 */
async function readBudget(database: PostgresDatabase, userId: string, now: number) {
  return await database.prepare(`SELECT
    (SELECT COUNT(*)::integer FROM worktrees WHERE creator_user_id = $userId AND processed_at IS NULL)
    + (SELECT COUNT(*)::integer FROM operations
       WHERE actor_user_id = $userId AND kind = 'create_worktree' AND state = 'pending'
         AND NOT EXISTS (SELECT 1 FROM worktrees WHERE id = operations.payload_json::jsonb ->> 'worktreeId')) AS open,
    (SELECT COUNT(*)::integer FROM operations
     WHERE actor_user_id = $userId AND kind = 'merge_worktree' AND created_at > $since
       AND NOT (state = 'failed' AND last_error_code = 'CHECKS_REQUIRED')) AS merged`)
    .get({ userId, since: now - AGENT_MERGE_WINDOW_MS }) as
    { readonly open: number; readonly merged: number };
}

/** Counted in the transaction that records the next create or merge, so concurrent ones cannot pass an agent's budget. People are not counted. */
export async function assertAgentBudget(
  database: PostgresDatabase,
  userId: string,
  action: "openWorktree" | "mergeWorktree",
  now: number,
  adding = 1,
): Promise<void> {
  const principal = requesterCategory(await readRequester(database, userId));
  if (principal === "human") return;
  assertCeiling(principal, action, { ...await readBudget(database, userId, now), adding });
}

export class PostgresAccessRepository implements AccessRepository {
  // Reuse SQL compilation, not authorization results. Every execution binds
  // the current actor and reads current data on this repository's connection.
  private _resolveNodeStatement: PostgresStatement | undefined;
  private _resolveAuthorizationStatement: PostgresStatement | undefined;

  constructor(private readonly _database: PostgresDatabase) {}

  async findResourceByUnitId(unitId: string): Promise<ResourceMappingRow | null> {
    return await this.readUnitMapping(unitId);
  }

  private async readUnitMapping(unitId: string): Promise<ResourceMappingRow | null> {
    return (
      (await this._database
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
           WHERE univer.unit_id = ?`,
        )
        .get(unitId) as ResourceMappingRow | undefined) ?? null
    );
  }

  async findResource(resourceId: string): Promise<ResourceMappingRow | null> {
    return await this.readResourceRow(resourceId);
  }

  private async readResourceRow(resourceId: string): Promise<ResourceMappingRow | null> {
    return (
      (await this._database
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
           WHERE resource.id = ?`,
        )
        .get(resourceId) as ResourceMappingRow | undefined) ?? null
    );
  }

  async findRequester(userId: string): Promise<Pick<NodeAuthorizationRow, "requester_kind" | "requester_claimed">> {
    return await readRequester(this._database, userId);
  }

  async countOwnedFiles(userId: string, operationId: string | null): Promise<number> {
    return await countOwnedFiles(this._database, userId, operationId);
  }

  async readBudget(userId: string, now: number): Promise<{ readonly open: number; readonly merged: number }> {
    return await readBudget(this._database, userId, now);
  }

  async resolveSpace(userId: string, spaceId: string): Promise<StoredSpaceAccess | null> {
    return await this.readSpaceRow(userId, spaceId);
  }

  private async readSpaceRow(userId: string, spaceId: string): Promise<StoredSpaceAccess | null> {
    const row = await this._database.prepare(`
      SELECT ${spaceAccessColumns}
      FROM spaces ${spaceMemberJoin}
      WHERE spaces.id = $spaceId AND ${visibleSpaceSql}
    `).get({ userId, spaceId }) as StoredSpaceAccess | undefined;
    return row ?? null;
  }

  async resolveNode(userId: string, nodeId: string): Promise<ResolvedNodeRow | null> {
    return await this.readNodeRow(userId, nodeId);
  }

  private async readNodeRow(userId: string, nodeId: string): Promise<ResolvedNodeRow | null> {
    return (
      (await (this._resolveNodeStatement ??= this._database.prepare(
        nodeAccessQuery(false),
      )).get({ nodeId, userId }) as ResolvedNodeRow | undefined) ?? null
    );
  }

  // Domain writes recheck these projections on the connection holding the write transaction.
  async readSpaceAccess(userId: string, spaceId: string) {
    const row = await this.readSpaceRow(userId, spaceId);
    return row && resolveStoredSpaceAccess(userId, row);
  }

  async readNodeAccess(userId: string, nodeId: string) {
    return resolveStoredNodeAccess(userId, await this.readNodeRow(userId, nodeId));
  }

  async readResourceAccess(userId: string, resourceId: string) {
    const mapping = await this.readResourceRow(resourceId);
    return mapping && resolveStoredResourceAccess(mapping, await this.readNodeAccess(userId, mapping.node_id));
  }

  async readUnitContentAccess(userId: string, unitId: string) {
    const mapping = await this.readUnitMapping(unitId);
    return mapping && resolveStoredContentAccess(userId, mapping, await this.readNodeAuthorization(userId, mapping.node_id));
  }

  async resolveNodeAuthorization(userId: string, nodeId: string): Promise<NodeAuthorizationRow | null> {
    return await this.readNodeAuthorization(userId, nodeId);
  }

  private async readNodeAuthorization(userId: string, nodeId: string): Promise<NodeAuthorizationRow | null> {
    return (
      (await (this._resolveAuthorizationStatement ??= this._database.prepare(
        nodeAccessQuery(true),
      )).get({ nodeId, userId }) as NodeAuthorizationRow | undefined) ?? null
    );
  }

  async resolveOwnedResources(userId: string, resourceIds: readonly string[]): Promise<OwnedResourceRow[]> {
    if (resourceIds.length === 0) return [];
    return await this._database
      .prepare(`
      SELECT ${nodeDisplayColumns()}
        space.type AS space_type, space.name AS space_name, space.landing AS space_landing,
        1 AS requester_owns, space.public_read::integer AS public_read, 0 AS previewed,
        NULL AS member_role, NULL AS grant_role,
        NULL AS grant_navigation_root_id, NULL AS link_sharing_role,
        NULL AS navigation_root_id, NULL AS requester_kind, NULL AS requester_claimed
      FROM nodes AS node
      JOIN spaces AS space ON space.id = node.space_id
      ${resourceJoins()}
      WHERE resource.id IN (${resourceIds.map(() => "?").join(", ")})
        AND ${ownsSpaceSql("space.owner_user_id", "?")}
        AND node.trash_batch_id IS NULL
    `)
      .all(...resourceIds, userId, userId) as unknown as OwnedResourceRow[];
  }
}

function nodeDisplayColumns(): string {
  return `             node.id,
             node.space_id,
             node.parent_id,
             node.name,
             resource.id AS resource_id,
             resource.kind AS resource_kind,
             univer.unit_id,
             univer.unit_type,
             blob.media_type AS blob_media_type,
             blob.byte_size AS blob_byte_size,
             blob.availability AS blob_availability,
             EXISTS (
               SELECT 1 FROM nodes AS child
               WHERE child.space_id = node.space_id
                 AND child.parent_id = node.id
                 AND child.trash_batch_id IS NULL
             )::integer AS has_children,
             node.updated_at,
             resource.node_id,
             blob.object_key,
             blob.original_filename,
             blob.media_type,
             blob.byte_size,
             blob.sha256,
             blob.etag,
             blob.availability,
`;
}

function resourceJoins(): string {
  return `           LEFT JOIN resources AS resource ON resource.node_id = node.id
           LEFT JOIN univer_resources AS univer
             ON univer.resource_id = resource.id
           LEFT JOIN blob_resources AS blob
             ON blob.resource_id = resource.id
`;
}

// Both projections use the same visibility and inherited-role rules. Content
// authorization omits directory fields and navigation-root traversals.
function nodeAccessQuery(contentOnly: boolean): string {
  return `WITH RECURSIVE ancestry(id, parent_id, depth) AS (
             SELECT id, parent_id, 0
             FROM nodes
             WHERE id = $nodeId AND trash_batch_id IS NULL
             UNION ALL
             SELECT parent.id, parent.parent_id, ancestry.depth + 1
             FROM nodes AS parent
             JOIN ancestry ON ancestry.parent_id = parent.id
             WHERE parent.trash_batch_id IS NULL
           )
           SELECT
             ${contentOnly ? "" : nodeDisplayColumns()}
             space.type AS space_type,
             space.landing AS space_landing,
             ${contentOnly ? "" : "space.name AS space_name,"}
             ${ownsSpaceSql("space.owner_user_id")}::integer AS requester_owns,
             space.public_read::integer AS public_read,
             ${previewedSql("space.owner_user_id")}::integer AS previewed,
             member.role AS member_role,
             (
               SELECT grant_node.role
               FROM ancestry
               JOIN node_grants AS grant_node
                 ON grant_node.node_id = ancestry.id
                AND grant_node.user_id = $userId
               ORDER BY
                 CASE grant_node.role WHEN 'editor' THEN 0 ELSE 1 END,
                 ancestry.depth DESC
               LIMIT 1
             ) AS grant_role,
             ${
               contentOnly
                 ? "NULL"
                 : `(
               SELECT ancestry.id
               FROM ancestry
               JOIN node_grants AS navigation_grant
                 ON navigation_grant.node_id = ancestry.id
                AND navigation_grant.user_id = $userId
               ORDER BY ancestry.depth DESC
               LIMIT 1
             )`
             } AS grant_navigation_root_id,
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
             ${
               contentOnly
                 ? "NULL"
                 : `(
               SELECT visible_root.id
               FROM (
                 SELECT ancestry.id, ancestry.depth
                 FROM ancestry
                 JOIN node_grants AS navigation_grant
                   ON navigation_grant.node_id = ancestry.id
                  AND navigation_grant.user_id = $userId
                 UNION ALL
                 SELECT ancestry.id, ancestry.depth
                 FROM ancestry
                 JOIN node_link_sharing AS link_sharing
                   ON link_sharing.node_id = ancestry.id
                  AND link_sharing.enabled = 1
               ) AS visible_root
               ORDER BY visible_root.depth DESC
               LIMIT 1
             )`
             } AS navigation_root_id,
             ${requesterColumns}
           FROM nodes AS node
           JOIN spaces AS space ON space.id = node.space_id
           ${contentOnly ? "" : resourceJoins()}
           LEFT JOIN space_members AS member
             ON member.space_id = space.id
            AND member.user_id = $userId
           WHERE node.id = $nodeId
             AND node.trash_batch_id IS NULL
             AND (
               ${ownsSpaceSql("space.owner_user_id")}
               OR (
                 NOT ${ownerSuspendedSql("space.owner_user_id")}
                 AND (
                   (space.type = 'team' AND member.user_id IS NOT NULL)
                   OR space.public_read
                   OR ${previewedSql("space.owner_user_id")}
                   OR (
                     space.type = 'personal'
                     AND (
                       EXISTS (
                         SELECT 1
                         FROM ancestry
                         JOIN node_grants AS visible_grant
                           ON visible_grant.node_id = ancestry.id
                          AND visible_grant.user_id = $userId
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
                 )
               )
             )`;
}
