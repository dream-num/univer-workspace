import { createHash } from "node:crypto";
import { forbidden, notFound } from "../../../modules/worktrees/worktrees.errors.js";
import { checkCreateTarget } from "../access/resource-target.js";
import { type PostgresAccessRepository, assertFileQuota, ownsSpaceSql, spaceOwnerIdsSql } from "../access/access.repository.js";
import type { PostgresDatabase } from "../connection.js";
import type { UnitType } from "../../../modules/access/index.js";
import type { WriteSource } from "../../../modules/identity/index.js";
import type { WorktreeKind, WorktreeVisibility } from "../../../modules/worktrees/worktrees.types.js";
import type {
  WorktreeCursor,
  WorktreeRow,
  WorktreeUnitRow,
  WorktreeReservation,
  WorktreeOperationRow,
  WorktreesRepository,
} from "../../../modules/worktrees/worktrees.repository.js";

export class PostgresWorktreesRepository implements WorktreesRepository {
  constructor(private readonly _database: PostgresDatabase, private readonly access: PostgresAccessRepository) {}

  async hasCreatedWorktree(userId: string): Promise<boolean> {
    return Boolean(
      await this._database
        .prepare("SELECT 1 FROM worktrees WHERE creator_user_id = ? LIMIT 1")
        .get(userId)
    );
  }

  async audience(worktreeId: string): Promise<string[]> {
    const rows = await this._database
      .prepare(
        `SELECT audience.user_id
         FROM (
           ${spaceOwnerIdsSql(`SELECT worktree.creator_user_id AS user_id
           FROM worktrees AS worktree
           WHERE worktree.id = ?`)}

           UNION

           SELECT team.owner_user_id AS user_id
           FROM worktrees AS worktree
           JOIN spaces AS team ON team.id = worktree.team_space_id
           WHERE worktree.id = ?

           UNION

           SELECT membership.user_id
           FROM worktrees AS worktree
           JOIN space_members AS membership
             ON membership.space_id = worktree.team_space_id
           WHERE worktree.id = ?
             AND (
               worktree.visibility = 'space'
               OR membership.role = 'admin'
             )
         ) AS audience
         ORDER BY audience.user_id`
      )
      .all(worktreeId, worktreeId, worktreeId, worktreeId) as unknown as Array<{
      readonly user_id: string;
    }>;
    return rows.map((row) => row.user_id);
  }

  async listCandidates(input: {
    readonly userId: string;
    readonly scope: "active" | "processed" | "all";
    readonly touchedSince?: number;
    readonly search: string;
    readonly order: "updatedAtDesc" | "createdAtDesc";
    readonly kind: WorktreeKind | null;
    readonly teamSpaceId: string | null;
    readonly creatorUserId?: string;
    readonly cursor: WorktreeCursor | null;
    readonly limit: number;
  }): Promise<WorktreeRow[]> {
    const predicates = [
      input.scope === "all"
        ? "1 = 1"
        : input.scope === "active"
          ? "worktree.processed_at IS NULL"
          : "worktree.processed_at IS NOT NULL",
    ];
    const orderColumn = input.order === "createdAtDesc" ? "created_at" : "updated_at";
    // worktreeSelect() binds the actor three times and the visibility test four more.
    const parameters: Array<string | number> = Array<string>(7).fill(input.userId);
    if (input.kind) {
      predicates.push("worktree.kind = ?");
      parameters.push(input.kind);
    }
    if (input.teamSpaceId) {
      predicates.push("worktree.team_space_id = ?");
      parameters.push(input.teamSpaceId);
    }
    if (input.creatorUserId) {
      predicates.push("worktree.creator_user_id = ?");
      parameters.push(input.creatorUserId);
    }
    if (input.touchedSince !== undefined) {
      predicates.push("(worktree.created_at >= ? OR worktree.processed_at >= ?)");
      parameters.push(input.touchedSince, input.touchedSince);
    }
    if (input.search) {
      predicates.push(`(
        strpos(lower(worktree.name), lower(? COLLATE "C")) > 0
        OR strpos(lower(coalesce(worktree.summary, '')), lower(? COLLATE "C")) > 0
        OR strpos(lower(creator.display_name), lower(? COLLATE "C")) > 0
        OR strpos(lower(creator.username), lower(? COLLATE "C")) > 0
        OR strpos(lower(coalesce(team.name, '')), lower(? COLLATE "C")) > 0
      )`);
      parameters.push(...Array<string>(5).fill(input.search));
    }
    if (input.cursor) {
      predicates.push(
        `(worktree.${orderColumn} < ?
          OR (worktree.${orderColumn} = ? AND worktree.id > ?))`
      );
      parameters.push(
        input.cursor.timestamp,
        input.cursor.timestamp,
        input.cursor.id
      );
    }
    parameters.push(input.limit);
    return await this._database
      .prepare(
        `${worktreeSelect()}
         WHERE (
           (worktree.kind = 'user' AND ${ownsSpaceSql("worktree.creator_user_id", "?")})
           OR (worktree.kind = 'team' AND (
             worktree.creator_user_id = ?
             OR team.owner_user_id = ?
             OR (member.user_id IS NOT NULL AND (
               worktree.visibility = 'space' OR member.role = 'admin'
             ))
           ))
         )
           AND ${predicates.join(" AND ")}
         ORDER BY worktree.${orderColumn} DESC, worktree.id
         LIMIT ?`
      )
      .all(...parameters) as unknown as WorktreeRow[];
  }

  async get(worktreeId: string, userId: string): Promise<WorktreeRow | null> {
    return (
      (await this._database
        .prepare(
          `${worktreeSelect()}
           WHERE worktree.id = ?`
        )
        .get(userId, userId, userId, worktreeId) as WorktreeRow | undefined) ?? null
    );
  }

  async resourceUnit(resourceId: string): Promise<{
    readonly unitId: string;
    readonly unitType: UnitType;
  } | null> {
    const row = await this._database
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

  async create(input: {
    readonly id: string;
    readonly name: string;
    readonly summary: string | null;
    readonly creatorUserId: string;
    readonly kind: WorktreeKind;
    readonly teamSpaceId: string | null;
    readonly visibility: WorktreeVisibility;
    readonly createdVia: WriteSource | null;
    readonly createdAt: number;
  }): Promise<void> {
    // The number is allocated inside the insert transaction (BEGIN IMMEDIATE), so
    // concurrent writers serialize. Team Worktrees continue the Space's shared
    // Issue sequence; User Worktrees are numbered per creator.
    await this._database.transaction(async (database) => {
      if (await database.prepare("SELECT 1 FROM worktrees WHERE id = ?").get(input.id)) return;
      if (input.kind === "team" && input.teamSpaceId) await this.requireTarget(input.creatorUserId, input.teamSpaceId, null);
      const next = (input.kind === "team"
        ? await database.prepare(
            `SELECT GREATEST(
               COALESCE((SELECT MAX(number) FROM issues WHERE space_id = ?1), 0),
               COALESCE((SELECT MAX(number) FROM worktrees WHERE kind = 'team' AND team_space_id = ?1), 0)
             ) + 1 AS next`
          ).get(input.teamSpaceId)
        : await database.prepare(
            "SELECT COALESCE(MAX(number), 0) + 1 AS next FROM worktrees WHERE kind = 'user' AND creator_user_id = ?"
          ).get(input.creatorUserId)) as { next: number };
      await database
        .prepare(
          `INSERT INTO worktrees
            (
              id, number, name, summary, creator_user_id, kind, team_space_id,
              visibility, created_at, updated_at, created_via
            )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.id,
          next.next,
          input.name,
          input.summary,
          input.creatorUserId,
          input.kind,
          input.teamSpaceId,
          input.visibility,
          input.createdAt,
          input.createdAt,
          input.createdVia
        );
    });
  }

  /** Finds a numbered Worktree: in a Team Space, or among the user's own User Worktrees. */
  async findIdByNumber(
    scope: { readonly teamSpaceId: string } | { readonly creatorUserId: string },
    number: number
  ): Promise<string | null> {
    const row = ("teamSpaceId" in scope
      ? await this._database
          .prepare("SELECT id FROM worktrees WHERE kind = 'team' AND team_space_id = ? AND number = ?")
          .get(scope.teamSpaceId, number)
      : await this._database
          .prepare("SELECT id FROM worktrees WHERE kind = 'user' AND creator_user_id = ? AND number = ?")
          .get(scope.creatorUserId, number)) as { id: string } | undefined;
    return row?.id ?? null;
  }

  async update(input: Parameters<WorktreesRepository["update"]>[0]): Promise<boolean> {
    const result = await this._database.prepare(`
      UPDATE worktrees
      SET name = COALESCE($name, name),
          summary = CASE WHEN $setSummary = 1 THEN $summary ELSE summary END,
          visibility = COALESCE($visibility, visibility),
          updated_at = $updatedAt
      WHERE id = $id AND (
        creator_user_id = $actorId OR
        EXISTS (SELECT 1 FROM spaces WHERE id = worktrees.team_space_id AND owner_user_id = $actorId) OR
        EXISTS (SELECT 1 FROM space_members
                WHERE space_id = worktrees.team_space_id AND user_id = $actorId AND role = 'admin')
      )
    `).run({
      id: input.id,
      actorId: input.actorId,
      name: input.name ?? null,
      setSummary: Number(input.summary !== undefined),
      summary: input.summary ?? null,
      visibility: input.visibility ?? null,
      updatedAt: input.updatedAt,
    });
    return Number(result.changes) === 1;
  }

  async units(worktreeId: string): Promise<WorktreeUnitRow[]> {
    return await this._database
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

  async addTrunkUnit(input: {
    readonly worktreeId: string;
    readonly unitId: string;
    readonly resourceId: string;
    readonly addedAt: number;
  }): Promise<void> {
    await this._database
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

  async completeLocalUnit(input: {
    readonly operationId: string;
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
  }): Promise<void> {
    await this._database.transaction(async (database) => {
      await this.requireTarget(input.createdBy, input.targetSpaceId, input.targetParentNodeId);
      await database
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
      await database
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
      await this.finishOperation(input.operationId, { worktreeId: input.worktreeId, unitId: input.unitId }, input.createdAt);
      // A direct replay of a failed operation may no longer have a pending slot.
      await assertFileQuota(database, input.createdBy, 0);
    });
  }

  async activateLocalUnit(
    row: WorktreeUnitRow,
    actorUserId: string,
    creatorUserId: string,
    activatedAt: number
  ): Promise<void> {
    if (
      row.source !== "worktree" ||
      !row.target_space_id ||
      !row.new_name ||
      !row.new_unit_type
    ) {
      return;
    }
    const targetSpaceId = row.target_space_id;
    await this._database.transaction(async (database) => {
      const intent = await database.prepare(`
        SELECT activated_at, discarded_at FROM worktree_node_intents WHERE worktree_id = ? AND unit_id = ?
      `).get(row.worktree_id, row.unit_id);
      if (!intent || intent.discarded_at !== null) throw notFound();
      if (intent.activated_at !== null) return;
      await this.requireTarget(actorUserId, targetSpaceId, row.target_parent_node_id);
      await database
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
      await database
        .prepare(
          `INSERT INTO resources (id, node_id, kind, created_at, updated_at)
           VALUES (?, ?, 'univer', ?, ?)
           ON CONFLICT (id) DO NOTHING`
        )
        .run(row.resource_id, row.node_id, activatedAt, activatedAt);
      await database
        .prepare(
          `INSERT INTO univer_resources (resource_id, unit_id, unit_type)
           VALUES (?, ?, ?)
           ON CONFLICT (resource_id) DO NOTHING`
        )
        .run(row.resource_id, row.unit_id, row.new_unit_type);
      await database
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

  async markProcessed(worktreeId: string, processedAt: number): Promise<void> {
    await this._database
      .prepare(
        `UPDATE worktrees
         SET processed_at = COALESCE(processed_at, ?), updated_at = ?
         WHERE id = ?`
      )
      .run(processedAt, processedAt, worktreeId);
  }

  async markLocalUnitsDiscarded(worktreeId: string, discardedAt: number): Promise<void> {
    await this._database
      .prepare(
        `UPDATE worktree_node_intents
         SET discarded_at = ?, updated_at = ?
         WHERE worktree_id = ?
           AND activated_at IS NULL
           AND discarded_at IS NULL`
      )
      .run(discardedAt, discardedAt, worktreeId);
  }

  async markLocalUnitDiscarded(worktreeId: string, unitId: string, discardedAt: number): Promise<void> {
    await this._database
      .prepare(
        `UPDATE worktree_node_intents SET discarded_at = ?, updated_at = ?
       WHERE worktree_id = ? AND unit_id = ? AND activated_at IS NULL AND discarded_at IS NULL`,
      )
      .run(discardedAt, discardedAt, worktreeId, unitId);
  }

  async removalBatchId(worktreeId: string, unitId: string): Promise<string> {
    return this._removalBatchIdSync(worktreeId, unitId);
  }

  private _removalBatchIdSync(worktreeId: string, unitId: string): string {
    return `worktree-${createHash("sha256")
      .update(JSON.stringify([worktreeId, unitId]))
      .digest("hex")}`;
  }

  async hasRemovalReceipt(worktreeId: string, unitId: string, userId: string): Promise<boolean> {
    return Boolean(
      await this._database
        .prepare("SELECT 1 FROM trash_batches WHERE id = ? AND created_by = ?")
        .get(this._removalBatchIdSync(worktreeId, unitId), userId),
    );
  }

  async getOperation(operationId: string): Promise<WorktreeOperationRow | null> {
    return (
      (await this._database
        .prepare("SELECT * FROM operations WHERE id = ?")
        .get(operationId) as WorktreeOperationRow | undefined) ?? null
    );
  }

  private async requireTarget(userId: string, spaceId: string, parentNodeId: string | null): Promise<void> {
    const access = await checkCreateTarget(this.access, userId, spaceId, parentNodeId);
    if (access === "notFound") throw notFound();
    if (access === "forbidden") throw forbidden();
  }

  async reserveOperation(input: WorktreeReservation): Promise<{ readonly created: boolean; readonly row: WorktreeOperationRow }> {
    return await this._database.transaction(async (database) => {
      const existing = await database
        .prepare("SELECT * FROM operations WHERE id = ?")
        .get(input.id) as WorktreeOperationRow | undefined;
      if (existing) return { created: false, row: existing };
      if (input.kind === "create_worktree_unit") {
        await this.requireTarget(input.actorUserId, input.payload.targetSpaceId, input.payload.targetParentNodeId);
        await assertFileQuota(database, input.actorUserId, 1, input.id);
      } else if (input.kind === "create_worktree" && input.payload.teamSpaceId !== null) {
        await this.requireTarget(input.actorUserId, input.payload.teamSpaceId, null);
      } else if (input.kind === "add_worktree_unit") {
        const resource = await this.access.readResourceAccess(input.actorUserId, input.payload.resourceId);
        if (!resource || resource.kind !== "univer") throw notFound();
        if (!resource.capabilities.editContent) throw forbidden();
      }
      await database
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
        row: await database
          .prepare("SELECT * FROM operations WHERE id = ?")
          .get(input.id) as unknown as WorktreeOperationRow,
      };
    });
  }

  async completeOperation(
    operationId: string,
    result: Readonly<Record<string, unknown>>,
    completedAt: number
  ): Promise<WorktreeOperationRow> {
    await this.finishOperation(operationId, result, completedAt);
    return await this._database
      .prepare("SELECT * FROM operations WHERE id = ?")
      .get(operationId) as unknown as WorktreeOperationRow;
  }

  private async finishOperation(operationId: string, result: Readonly<Record<string, unknown>>, completedAt: number): Promise<void> {
    await this._database
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
  }

  async failOperation(
    operationId: string,
    error: { readonly code: string; readonly message: string },
    failedAt: number
  ): Promise<void> {
    await this._database
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
            ${ownsSpaceSql("worktree.creator_user_id", "?")}::integer AS actor_owns_creator_space,
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
