import { ApplicationError } from "../../../middleware/errors.js";
import type { NodeAccess } from "../../../modules/access/index.js";
import { assertNotDelegatedPageWrite } from "../../../modules/blobs/html-view-guard.js";
import type { Principal } from "../../../modules/identity/index.js";
import { nodeForbidden, nodeNotFound } from "../../../modules/nodes/nodes.errors.js";
import { checkCreateTarget } from "../access/resource-target.js";
import type { PostgresAccessRepository } from "../access/access.repository.js";
import type { PostgresDatabase } from "../connection.js";
import type { NodePatch, NodeCursor, NodeListRow, BreadcrumbRow, NodesRepository, SpaceOwnerRow } from "../../../modules/nodes/nodes.repository.js";

export class PostgresNodesRepository implements NodesRepository {
  constructor(private readonly _database: PostgresDatabase, private readonly access: PostgresAccessRepository) {}

  async findSpaceOwner(spaceId: string): Promise<SpaceOwnerRow> {
    return await this._database
      .prepare(
        `SELECT
           owner.display_name,
           owner.kind,
           (agents.owner_user_id IS NOT NULL)::integer AS claimed
         FROM spaces
         JOIN users AS owner ON owner.id = spaces.owner_user_id
         LEFT JOIN agents ON agents.user_id = owner.id
         WHERE spaces.id = ?`
      )
      .get(spaceId) as unknown as SpaceOwnerRow;
  }

  async createReport(input: {
    readonly id: string;
    readonly nodeId: string;
    readonly reporterUserId: string | null;
    readonly reason: string;
    readonly createdAt: number;
  }): Promise<void> {
    await this._database
      .prepare(
        `INSERT INTO node_reports (id, node_id, reporter_user_id, reason, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(input.id, input.nodeId, input.reporterUserId, input.reason, input.createdAt);
  }

  async createNode(input: {
    readonly id: string;
    readonly spaceId: string;
    readonly parentNodeId: string | null;
    readonly name: string;
    readonly createdBy: string;
    readonly createdAt: number;
  }): Promise<NodeAccess> {
    return await this._database.transaction(async (db) => {
      await this.requireTarget(input.createdBy, input.spaceId, input.parentNodeId);
      await db.prepare(`
        INSERT INTO nodes (id, space_id, parent_id, name, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(input.id, input.spaceId, input.parentNodeId, input.name, input.createdBy, input.createdAt, input.createdAt);
      return await this.requireNode(input.createdBy, input.id);
    });
  }

  async listChildren(
    spaceId: string,
    parentNodeId: string | null,
    cursor: NodeCursor | null,
    limit: number
  ): Promise<NodeListRow[]> {
    const cursorClause =
      cursor === null
        ? ""
        : `AND (
             lower(name COLLATE "C") > lower(? COLLATE "C")
             OR (lower(name COLLATE "C") = lower(?::text COLLATE "C") AND id > ?)
           )`;
    const parameters =
      cursor === null
        ? [spaceId, parentNodeId, limit]
        : [
            spaceId,
            parentNodeId,
            cursor.name,
            cursor.name,
            cursor.id,
            limit,
          ];
    return await this._database
      .prepare(
        `SELECT id, name
         FROM nodes
         WHERE space_id = ?
           AND parent_id IS NOT DISTINCT FROM ?
           AND trash_batch_id IS NULL
           ${cursorClause}
         ORDER BY lower(name COLLATE "C"), id
         LIMIT ?`
      )
      .all(...parameters) as unknown as NodeListRow[];
  }

  async breadcrumbs(nodeId: string): Promise<BreadcrumbRow[]> {
    return await this._database
      .prepare(
        `WITH RECURSIVE ancestry(id, parent_id, name, depth) AS (
           SELECT id, parent_id, name, 0 FROM nodes WHERE id = ?
           UNION ALL
           SELECT parent.id, parent.parent_id, parent.name, ancestry.depth + 1
           FROM nodes AS parent
           JOIN ancestry ON ancestry.parent_id = parent.id
         )
         SELECT id, name FROM ancestry ORDER BY depth DESC`
      )
      .all(nodeId) as unknown as BreadcrumbRow[];
  }

  async copiedFrom(nodeId: string): Promise<string | null> {
    const row = await this._database
      .prepare("SELECT copied_from_node_id FROM nodes WHERE id = ?")
      .get(nodeId) as { readonly copied_from_node_id: string | null } | undefined;
    return row?.copied_from_node_id ?? null;
  }

  private async isSelfOrDescendant(nodeId: string, candidateId: string): Promise<boolean> {
    return Boolean(
      await this._database
        .prepare(
          `WITH RECURSIVE descendants(id) AS (
             SELECT id FROM nodes WHERE id = ?
             UNION ALL
             SELECT child.id
             FROM nodes AS child
             JOIN descendants ON child.parent_id = descendants.id
           )
           SELECT 1 FROM descendants WHERE id = ?`
        )
        .get(nodeId, candidateId)
    );
  }

  async updateNode(actor: Principal, nodeId: string, patch: NodePatch, updatedAt: number): Promise<NodeAccess> {
    return await this._database.transaction(async (db) => {
      const userId = actor.user.id;
      const source = await this.requireNode(userId, nodeId);
      if (patch.name !== undefined) {
        if (!source.capabilities.rename) throw nodeForbidden();
        if (source.resourceKind === "blob") assertNotDelegatedPageWrite(actor, [patch.name]);
      }
      if (patch.parentNodeId !== undefined) {
        if (!source.capabilities.move) throw nodeForbidden();
        if (patch.parentNodeId !== null && await this.isSelfOrDescendant(nodeId, patch.parentNodeId)) {
          throw new ApplicationError("CONFLICT", 409, "A Node cannot be moved into itself or one of its descendants.");
        }
        await this.requireTarget(userId, source.spaceId, patch.parentNodeId);
      }
      await db.prepare("UPDATE nodes SET name = ?, parent_id = ?, updated_at = ? WHERE id = ?").run(
        patch.name ?? source.name, patch.parentNodeId === undefined ? source.parentNodeId : patch.parentNodeId, updatedAt, nodeId,
      );
      return await this.requireNode(userId, nodeId);
    });
  }

  private async requireNode(userId: string, nodeId: string): Promise<NodeAccess> {
    const node = await this.access.readNodeAccess(userId, nodeId);
    if (!node) throw nodeNotFound();
    return node;
  }

  private async requireTarget(userId: string, spaceId: string, parentNodeId: string | null): Promise<void> {
    const target = await checkCreateTarget(this.access, userId, spaceId, parentNodeId);
    if (target === "notFound") throw nodeNotFound();
    if (target === "forbidden") throw nodeForbidden();
  }
}
