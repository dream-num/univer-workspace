import { ApplicationError } from "../../../middleware/errors.js";
import type { NodeAccess } from "../../../modules/access/index.js";
import { assertNotDelegatedPageWrite } from "../../../modules/blobs/html-view-guard.js";
import type { Principal } from "../../../modules/identity/index.js";
import { nodeForbidden, nodeNotFound } from "../../../modules/nodes/nodes.errors.js";
import { checkCreateTarget } from "../access/resource-target.js";
import type { SqliteAccessRepository } from "../access/access.repository.js";
import type { SqliteDatabase } from "../connection.js";
import type { NodePatch, NodeCursor, NodeListRow, BreadcrumbRow, NodesRepository, SpaceOwnerRow } from "../../../modules/nodes/nodes.repository.js";

export class SqliteNodesRepository implements NodesRepository {
  constructor(private readonly _database: SqliteDatabase, private readonly access: SqliteAccessRepository) {}

  async findSpaceOwner(spaceId: string): Promise<SpaceOwnerRow> {
    return this._database.connection
      .prepare(
        `SELECT
           owner.display_name,
           owner.kind,
           agents.owner_user_id IS NOT NULL AS claimed
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
    this._database.connection
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
    return this._database.transaction((db) => {
      this.requireTarget(input.createdBy, input.spaceId, input.parentNodeId);
      db.prepare(`
        INSERT INTO nodes (id, space_id, parent_id, name, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(input.id, input.spaceId, input.parentNodeId, input.name, input.createdBy, input.createdAt, input.createdAt);
      return this.requireNode(input.createdBy, input.id);
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
             name COLLATE NOCASE > ? COLLATE NOCASE
             OR (name = ? COLLATE NOCASE AND id > ?)
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
    return this._database.connection
      .prepare(
        `SELECT id, name
         FROM nodes
         WHERE space_id = ?
           AND parent_id IS ?
           AND trash_batch_id IS NULL
           ${cursorClause}
         ORDER BY name COLLATE NOCASE, id
         LIMIT ?`
      )
      .all(...parameters) as unknown as NodeListRow[];
  }

  async breadcrumbs(nodeId: string): Promise<BreadcrumbRow[]> {
    return this._database.connection
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

  async copies(nodeId: string): Promise<{ readonly copiedFromNodeId: string | null; readonly copyCount: number }> {
    const row = this._database.connection
      .prepare(
        `SELECT copied_from_node_id,
                (SELECT COUNT(*) FROM nodes AS copy WHERE copy.copied_from_node_id = source.id) AS copy_count
         FROM nodes AS source WHERE source.id = ?`
      )
      .get(nodeId) as { readonly copied_from_node_id: string | null; readonly copy_count: number } | undefined;
    return { copiedFromNodeId: row?.copied_from_node_id ?? null, copyCount: row?.copy_count ?? 0 };
  }

  private isSelfOrDescendant(nodeId: string, candidateId: string): boolean {
    return Boolean(
      this._database.connection
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
    return this._database.transaction((db) => {
      const userId = actor.user.id;
      const source = this.requireNode(userId, nodeId);
      if (patch.name !== undefined) {
        if (!source.capabilities.rename) throw nodeForbidden();
        if (source.resourceKind === "blob") assertNotDelegatedPageWrite(actor, [patch.name]);
      }
      if (patch.parentNodeId !== undefined) {
        if (!source.capabilities.move) throw nodeForbidden();
        if (patch.parentNodeId !== null && this.isSelfOrDescendant(nodeId, patch.parentNodeId)) {
          throw new ApplicationError("CONFLICT", 409, "A Node cannot be moved into itself or one of its descendants.");
        }
        this.requireTarget(userId, source.spaceId, patch.parentNodeId);
      }
      db.prepare("UPDATE nodes SET name = ?, parent_id = ?, updated_at = ? WHERE id = ?").run(
        patch.name ?? source.name, patch.parentNodeId === undefined ? source.parentNodeId : patch.parentNodeId, updatedAt, nodeId,
      );
      return this.requireNode(userId, nodeId);
    });
  }

  private requireNode(userId: string, nodeId: string): NodeAccess {
    const node = this.access.readNodeAccess(userId, nodeId);
    if (!node) throw nodeNotFound();
    return node;
  }

  private requireTarget(userId: string, spaceId: string, parentNodeId: string | null): void {
    const target = checkCreateTarget(this.access, userId, spaceId, parentNodeId);
    if (target === "notFound") throw nodeNotFound();
    if (target === "forbidden") throw nodeForbidden();
  }
}
