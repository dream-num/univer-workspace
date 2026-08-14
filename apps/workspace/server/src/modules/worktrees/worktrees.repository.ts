import type { WorkspaceDatabase } from "../../db/database.js";
import type { UnitType } from "../access/index.js";
import type { OperationState } from "../resources/resources.types.js";
import type {
  WorktreeKind,
  WorktreeVisibility,
} from "./worktrees.types.js";

export interface WorktreeCursor {
  readonly updatedAt: number;
  readonly id: string;
}

export interface WorktreeRow {
  readonly id: string;
  readonly name: string;
  readonly summary: string | null;
  readonly creator_user_id: string;
  readonly kind: WorktreeKind;
  readonly team_space_id: string | null;
  readonly visibility: WorktreeVisibility;
  readonly processed_at: number | null;
  readonly created_at: number;
  readonly updated_at: number;
  readonly creator_username: string;
  readonly creator_display_name: string;
  readonly creator_avatar_url: string | null;
  readonly team_space_name: string | null;
  readonly team_owner_user_id: string | null;
  readonly actor_member_role: "admin" | "editor" | "viewer" | null;
  readonly unit_count: number;
}

export interface WorktreeUnitRow {
  readonly worktree_id: string;
  readonly unit_id: string;
  readonly resource_id: string;
  readonly node_id: string;
  readonly source: "trunk" | "worktree";
  readonly ordinal: number;
  readonly existing_name: string | null;
  readonly existing_unit_type: UnitType | null;
  readonly target_space_id: string | null;
  readonly target_parent_node_id: string | null;
  readonly new_name: string | null;
  readonly new_unit_type: UnitType | null;
  readonly activated_at: number | null;
  readonly discarded_at: number | null;
}

export type WorktreeOperationDatabaseKind =
  | "create_worktree"
  | "add_worktree_unit"
  | "create_worktree_unit"
  | "merge_worktree"
  | "discard_worktree"
  | "activate_worktree_resource";

export interface WorktreeOperationRow {
  readonly id: string;
  readonly kind: WorktreeOperationDatabaseKind;
  readonly actor_user_id: string;
  readonly state: OperationState;
  readonly step: string;
  readonly payload_json: string;
  readonly result_json: string | null;
  readonly last_error_code: string | null;
  readonly last_error_message: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

export class WorktreesRepository {
  constructor(private readonly _database: WorkspaceDatabase) {}

  listCandidates(input: {
    readonly userId: string;
    readonly scope: "active" | "processed";
    readonly kind: WorktreeKind | null;
    readonly teamSpaceId: string | null;
    readonly cursor: WorktreeCursor | null;
    readonly limit: number;
  }): WorktreeRow[] {
    const predicates = [
      input.scope === "active"
        ? "worktree.processed_at IS NULL"
        : "worktree.processed_at IS NOT NULL",
    ];
    const parameters: Array<string | number> = [
      input.userId,
      input.userId,
      input.userId,
    ];
    if (input.kind) {
      predicates.push("worktree.kind = ?");
      parameters.push(input.kind);
    }
    if (input.teamSpaceId) {
      predicates.push("worktree.team_space_id = ?");
      parameters.push(input.teamSpaceId);
    }
    if (input.cursor) {
      predicates.push(
        `(worktree.updated_at < ?
          OR (worktree.updated_at = ? AND worktree.id > ?))`
      );
      parameters.push(
        input.cursor.updatedAt,
        input.cursor.updatedAt,
        input.cursor.id
      );
    }
    parameters.push(input.limit);
    return this._database.connection
      .prepare(
        `${worktreeSelect()}
         WHERE (
           worktree.creator_user_id = ?
           OR team.owner_user_id = ?
           OR member.user_id IS NOT NULL
         )
           AND ${predicates.join(" AND ")}
         ORDER BY worktree.updated_at DESC, worktree.id
         LIMIT ?`
      )
      .all(...parameters) as unknown as WorktreeRow[];
  }

  get(worktreeId: string, userId: string): WorktreeRow | null {
    return (
      (this._database.connection
        .prepare(
          `${worktreeSelect()}
           WHERE worktree.id = ?`
        )
        .get(userId, worktreeId) as WorktreeRow | undefined) ?? null
    );
  }

  resourceUnit(resourceId: string): {
    readonly unitId: string;
    readonly unitType: UnitType;
  } | null {
    const row = this._database.connection
      .prepare(
        `SELECT unit_id, unit_type
         FROM univer_resources
         WHERE resource_id = ?`
      )
      .get(resourceId) as
      | {
          readonly unit_id: string;
          readonly unit_type: UnitType;
        }
      | undefined;
    return row
      ? { unitId: row.unit_id, unitType: row.unit_type }
      : null;
  }

  create(input: {
    readonly id: string;
    readonly name: string;
    readonly summary: string | null;
    readonly creatorUserId: string;
    readonly kind: WorktreeKind;
    readonly teamSpaceId: string | null;
    readonly visibility: WorktreeVisibility;
    readonly createdAt: number;
  }): void {
    this._database.connection
      .prepare(
        `INSERT INTO worktrees
          (
            id, name, summary, creator_user_id, kind, team_space_id,
            visibility, created_at, updated_at
          )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO NOTHING`
      )
      .run(
        input.id,
        input.name,
        input.summary,
        input.creatorUserId,
        input.kind,
        input.teamSpaceId,
        input.visibility,
        input.createdAt,
        input.createdAt
      );
  }

  update(input: {
    readonly id: string;
    readonly name: string;
    readonly summary: string | null;
    readonly visibility: WorktreeVisibility;
    readonly updatedAt: number;
  }): void {
    this._database.connection
      .prepare(
        `UPDATE worktrees
         SET name = ?, summary = ?, visibility = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.name,
        input.summary,
        input.visibility,
        input.updatedAt,
        input.id
      );
  }

  units(worktreeId: string): WorktreeUnitRow[] {
    return this._database.connection
      .prepare(
        `SELECT
           mapping.worktree_id,
           mapping.unit_id,
           mapping.resource_id,
           COALESCE(existing.id, future.node_id) AS node_id,
           mapping.source,
           mapping.ordinal,
           existing.name AS existing_name,
           existing_univer.unit_type AS existing_unit_type,
           future.target_space_id,
           future.target_parent_node_id,
           future.name AS new_name,
           future.unit_type AS new_unit_type,
           future.activated_at,
           future.discarded_at
         FROM worktree_units AS mapping
         LEFT JOIN resources AS existing_resource
           ON existing_resource.id = mapping.resource_id
         LEFT JOIN nodes AS existing
           ON existing.id = existing_resource.node_id
         LEFT JOIN univer_resources AS existing_univer
           ON existing_univer.resource_id = mapping.resource_id
         LEFT JOIN worktree_node_intents AS future
           ON future.worktree_id = mapping.worktree_id
          AND future.unit_id = mapping.unit_id
         WHERE mapping.worktree_id = ?
         ORDER BY mapping.ordinal, mapping.unit_id`
      )
      .all(worktreeId) as unknown as WorktreeUnitRow[];
  }

  addTrunkUnit(input: {
    readonly worktreeId: string;
    readonly unitId: string;
    readonly resourceId: string;
    readonly addedAt: number;
  }): void {
    this._database.connection
      .prepare(
        `INSERT INTO worktree_units
          (worktree_id, unit_id, resource_id, source, ordinal, added_at)
         VALUES (
           ?, ?, ?, 'trunk',
           COALESCE(
             (SELECT MAX(ordinal) + 1 FROM worktree_units WHERE worktree_id = ?),
             0
           ),
           ?
         )
         ON CONFLICT (worktree_id, unit_id) DO NOTHING`
      )
      .run(
        input.worktreeId,
        input.unitId,
        input.resourceId,
        input.worktreeId,
        input.addedAt
      );
  }

  addLocalUnit(input: {
    readonly worktreeId: string;
    readonly unitId: string;
    readonly resourceId: string;
    readonly nodeId: string;
    readonly targetSpaceId: string;
    readonly targetParentNodeId: string | null;
    readonly name: string;
    readonly unitType: UnitType;
    readonly createdBy: string;
    readonly createdAt: number;
  }): void {
    this._database.transaction((database) => {
      database
        .prepare(
          `INSERT INTO worktree_units
            (worktree_id, unit_id, resource_id, source, ordinal, added_at)
           VALUES (
             ?, ?, ?, 'worktree',
             COALESCE(
               (SELECT MAX(ordinal) + 1 FROM worktree_units WHERE worktree_id = ?),
               0
             ),
             ?
           )
           ON CONFLICT (worktree_id, unit_id) DO NOTHING`
        )
        .run(
          input.worktreeId,
          input.unitId,
          input.resourceId,
          input.worktreeId,
          input.createdAt
        );
      database
        .prepare(
          `INSERT INTO worktree_node_intents
            (
              worktree_id, unit_id, node_id, target_space_id, target_parent_node_id,
              name, unit_type, created_by, created_at, updated_at
            )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (worktree_id, unit_id) DO NOTHING`
        )
        .run(
          input.worktreeId,
          input.unitId,
          input.nodeId,
          input.targetSpaceId,
          input.targetParentNodeId,
          input.name,
          input.unitType,
          input.createdBy,
          input.createdAt,
          input.createdAt
        );
    });
  }

  activateLocalUnit(
    row: WorktreeUnitRow,
    creatorUserId: string,
    activatedAt: number
  ): void {
    if (
      row.source !== "worktree" ||
      !row.target_space_id ||
      !row.new_name ||
      !row.new_unit_type
    ) {
      return;
    }
    this._database.transaction((database) => {
      database
        .prepare(
          `INSERT INTO nodes
            (
              id, space_id, parent_id, name, created_by,
              created_at, updated_at
            )
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO NOTHING`
        )
        .run(
          row.node_id,
          row.target_space_id,
          row.target_parent_node_id,
          row.new_name,
          creatorUserId,
          activatedAt,
          activatedAt
        );
      database
        .prepare(
          `INSERT INTO resources (id, node_id, kind, created_at, updated_at)
           VALUES (?, ?, 'univer', ?, ?)
           ON CONFLICT (id) DO NOTHING`
        )
        .run(row.resource_id, row.node_id, activatedAt, activatedAt);
      database
        .prepare(
          `INSERT INTO univer_resources (resource_id, unit_id, unit_type)
           VALUES (?, ?, ?)
           ON CONFLICT (resource_id) DO NOTHING`
        )
        .run(row.resource_id, row.unit_id, row.new_unit_type);
      database
        .prepare(
          `UPDATE worktree_node_intents
           SET activated_at = ?, updated_at = ?
           WHERE worktree_id = ? AND unit_id = ? AND activated_at IS NULL`
        )
        .run(
          activatedAt,
          activatedAt,
          row.worktree_id,
          row.unit_id
        );
    });
  }

  markProcessed(worktreeId: string, processedAt: number): void {
    this._database.connection
      .prepare(
        `UPDATE worktrees
         SET processed_at = COALESCE(processed_at, ?), updated_at = ?
         WHERE id = ?`
      )
      .run(processedAt, processedAt, worktreeId);
  }

  markLocalUnitsDiscarded(worktreeId: string, discardedAt: number): void {
    this._database.connection
      .prepare(
        `UPDATE worktree_node_intents
         SET discarded_at = ?, updated_at = ?
         WHERE worktree_id = ?
           AND activated_at IS NULL
           AND discarded_at IS NULL`
      )
      .run(discardedAt, discardedAt, worktreeId);
  }

  reserveOperation(input: {
    readonly id: string;
    readonly kind: WorktreeOperationDatabaseKind;
    readonly actorUserId: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly createdAt: number;
  }): { readonly created: boolean; readonly row: WorktreeOperationRow } {
    return this._database.transaction((database) => {
      const existing = database
        .prepare("SELECT * FROM operations WHERE id = ?")
        .get(input.id) as WorktreeOperationRow | undefined;
      if (existing) return { created: false, row: existing };
      database
        .prepare(
          `INSERT INTO operations
            (
              id, kind, actor_user_id, step, state, payload_json,
              attempt_count, next_attempt_at, lease_owner,
              lease_expires_at, created_at, updated_at
            )
           VALUES (?, ?, ?, 'reserved', 'pending', ?, 0, ?, 'product-api', ?, ?, ?)`
        )
        .run(
          input.id,
          input.kind,
          input.actorUserId,
          JSON.stringify(input.payload),
          input.createdAt,
          input.createdAt + 60_000,
          input.createdAt,
          input.createdAt
        );
      return {
        created: true,
        row: database
          .prepare("SELECT * FROM operations WHERE id = ?")
          .get(input.id) as unknown as WorktreeOperationRow,
      };
    });
  }

  completeOperation(
    operationId: string,
    result: Readonly<Record<string, unknown>>,
    completedAt: number
  ): WorktreeOperationRow {
    this._database.connection
      .prepare(
        `UPDATE operations
         SET state = 'completed',
             step = 'completed',
             result_json = ?,
             completed_at = ?,
             updated_at = ?,
             lease_owner = NULL,
             lease_expires_at = NULL,
             last_error_code = NULL,
             last_error_message = NULL
         WHERE id = ?`
      )
      .run(
        JSON.stringify(result),
        completedAt,
        completedAt,
        operationId
      );
    return this._database.connection
      .prepare("SELECT * FROM operations WHERE id = ?")
      .get(operationId) as unknown as WorktreeOperationRow;
  }

  failOperation(
    operationId: string,
    error: { readonly code: string; readonly message: string },
    failedAt: number
  ): void {
    this._database.connection
      .prepare(
        `UPDATE operations
         SET state = 'failed',
             last_error_code = ?,
             last_error_message = ?,
             lease_owner = NULL,
             lease_expires_at = NULL,
             updated_at = ?
         WHERE id = ? AND state = 'pending'`
      )
      .run(error.code, error.message, failedAt, operationId);
  }
}

function worktreeSelect(): string {
  return `SELECT
            worktree.*,
            creator.username AS creator_username,
            creator.display_name AS creator_display_name,
            creator.avatar_url AS creator_avatar_url,
            team.name AS team_space_name,
            team.owner_user_id AS team_owner_user_id,
            member.role AS actor_member_role,
            (
              SELECT COUNT(*)
              FROM worktree_units AS counted
              WHERE counted.worktree_id = worktree.id
            ) AS unit_count
          FROM worktrees AS worktree
          JOIN users AS creator ON creator.id = worktree.creator_user_id
          LEFT JOIN spaces AS team ON team.id = worktree.team_space_id
          LEFT JOIN space_members AS member
            ON member.space_id = worktree.team_space_id
           AND member.user_id = ?`;
}
