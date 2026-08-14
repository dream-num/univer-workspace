import type { WorkspaceDatabase } from "../../db/database.js";

export interface NodeCursor {
  readonly name: string;
  readonly id: string;
}

export interface NodeListRow {
  readonly id: string;
  readonly name: string;
}

export interface BreadcrumbRow {
  readonly id: string;
  readonly name: string;
}

export class NodesRepository {
  constructor(private readonly _database: WorkspaceDatabase) {}

  createNode(input: {
    readonly id: string;
    readonly spaceId: string;
    readonly parentNodeId: string | null;
    readonly name: string;
    readonly createdBy: string;
    readonly createdAt: number;
  }): void {
    this._database.connection
      .prepare(
        `INSERT INTO nodes
          (id, space_id, parent_id, name, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.spaceId,
        input.parentNodeId,
        input.name,
        input.createdBy,
        input.createdAt,
        input.createdAt
      );
  }

  listChildren(
    spaceId: string,
    parentNodeId: string | null,
    cursor: NodeCursor | null,
    limit: number
  ): NodeListRow[] {
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

  breadcrumbs(nodeId: string): BreadcrumbRow[] {
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

  isSelfOrDescendant(nodeId: string, candidateId: string): boolean {
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

  updateNode(input: {
    readonly nodeId: string;
    readonly name: string;
    readonly parentNodeId: string | null;
    readonly updatedAt: number;
  }): void {
    this._database.connection
      .prepare(
        `UPDATE nodes
         SET name = ?, parent_id = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.name,
        input.parentNodeId,
        input.updatedAt,
        input.nodeId
      );
  }
}
