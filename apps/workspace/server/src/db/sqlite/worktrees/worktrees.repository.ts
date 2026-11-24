import { createHash } from "node:crypto";
import { forbidden, forkAlreadyOpen, notFound } from "../../../modules/worktrees/worktrees.errors.js";
import { checkCreateTarget, checkProposalTarget } from "../access/resource-target.js";
import { type SqliteAccessRepository, assertAgentBudget, assertFileQuota, assertProposalQuota, ownerSuspendedSql, ownsSpaceSql, proposesSql, spaceOwnerIdsSql } from "../access/access.repository.js";
import type { SqliteDatabase } from "../connection.js";
import { retryFailed } from "../operations/operations.repository.js";
import type { UnitType } from "../../../modules/access/index.js";
import type { WriteSource } from "../../../modules/identity/index.js";
import type { PublicUser } from "../../../modules/permissions/index.js";
import type { WorktreeKind, WorktreeVisibility } from "../../../modules/worktrees/worktrees.types.js";
import type {
  WorktreeCheckRow,
  WorktreeCursor,
  WorktreeRow,
  WorktreeUnitRow,
  WorktreeReservation,
  WorktreeOperationRow,
  WorktreesRepository,
} from "../../../modules/worktrees/worktrees.repository.js";

export class SqliteWorktreesRepository implements WorktreesRepository {
  constructor(private readonly _database: SqliteDatabase, private readonly access: SqliteAccessRepository) {}

  async hasCreatedWorktree(userId: string): Promise<boolean> {
    return Boolean(
      this._database.connection
        .prepare("SELECT 1 FROM worktrees WHERE creator_user_id = ? LIMIT 1")
        .get(userId)
    );
  }

  async audience(worktreeId: string): Promise<string[]> {
    const rows = this._database.connection
      .prepare(
        `SELECT audience.user_id
         FROM (
           ${spaceOwnerIdsSql(`SELECT worktree.creator_user_id AS user_id
           FROM worktrees AS worktree
           WHERE worktree.id = ?`)}

           UNION

           ${spaceOwnerIdsSql(`SELECT team.owner_user_id AS user_id
           FROM worktrees AS worktree
           JOIN spaces AS team ON team.id = worktree.team_space_id
           WHERE worktree.id = ?`)}

           UNION

           SELECT membership.user_id
           FROM worktrees AS worktree
           JOIN space_members AS membership
             ON membership.space_id = worktree.team_space_id
           JOIN spaces AS team ON team.id = worktree.team_space_id
           WHERE worktree.id = ?
             AND NOT ${ownerSuspendedSql("team.owner_user_id")}
             AND (
               worktree.visibility = 'space'
               OR membership.role = 'admin'
               OR worktree.processed_at IS NOT NULL
             )
         ) AS audience
         ORDER BY audience.user_id`
      )
      .all(worktreeId, worktreeId, worktreeId, worktreeId, worktreeId) as unknown as Array<{
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
    readonly issueId?: string;
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
    const parameters: Record<string, string | number> = { userId: input.userId, limit: input.limit };
    if (input.kind) {
      predicates.push("worktree.kind = $kind");
      parameters.kind = input.kind;
    }
    if (input.teamSpaceId) {
      predicates.push("worktree.team_space_id = $teamSpaceId");
      parameters.teamSpaceId = input.teamSpaceId;
    }
    if (input.creatorUserId) {
      predicates.push("worktree.creator_user_id = $creatorUserId");
      parameters.creatorUserId = input.creatorUserId;
    }
    if (input.issueId) {
      predicates.push("worktree.issue_id = $issueId");
      parameters.issueId = input.issueId;
    }
    if (input.touchedSince !== undefined) {
      predicates.push("(worktree.created_at >= $touchedSince OR worktree.processed_at >= $touchedSince)");
      parameters.touchedSince = input.touchedSince;
    }
    if (input.search) {
      predicates.push(`(
        instr(lower(worktree.name), lower($search)) > 0
        OR instr(lower(coalesce(worktree.summary, '')), lower($search)) > 0
        OR instr(lower(creator.display_name), lower($search)) > 0
        OR instr(lower(creator.username), lower($search)) > 0
        OR instr(lower(coalesce(team.name, '')), lower($search)) > 0
      )`);
      parameters.search = input.search;
    }
    if (input.cursor) {
      predicates.push(
        `(worktree.${orderColumn} < $cursorTimestamp
          OR (worktree.${orderColumn} = $cursorTimestamp AND worktree.id > $cursorId))`
      );
      parameters.cursorTimestamp = input.cursor.timestamp;
      parameters.cursorId = input.cursor.id;
    }
    return this._database.connection
      .prepare(
        `${worktreeSelect()}
         WHERE (
           ${ownsSpaceSql("worktree.creator_user_id")}
           OR (worktree.kind = 'team' AND (
             ${ownsSpaceSql("team.owner_user_id")}
             OR (member.user_id IS NOT NULL AND (
               worktree.visibility = 'space' OR member.role = 'admin' OR worktree.processed_at IS NOT NULL
             ))
           ))
         )
           AND ${predicates.join(" AND ")}
         ORDER BY worktree.${orderColumn} DESC, worktree.id
         LIMIT $limit`
      )
      .all(parameters) as unknown as WorktreeRow[];
  }

  async get(worktreeId: string, userId: string): Promise<WorktreeRow | null> {
    return (
      (this._database.connection
        .prepare(
          `${worktreeSelect()}
           WHERE worktree.id = $worktreeId`
        )
        .get({ userId, worktreeId }) as WorktreeRow | undefined) ?? null
    );
  }

  async resourceUnit(resourceId: string): Promise<{
    readonly unitId: string;
    readonly unitType: UnitType;
  } | null> {
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
    readonly forkId: string | null;
    readonly issueId: string | null;
  }): Promise<void> {
    // The number is allocated inside the insert transaction (BEGIN IMMEDIATE), so
    // concurrent writers serialize. Team Worktrees continue the Space's shared
    // Issue sequence; User Worktrees are numbered per creator.
    this._database.transaction((database) => {
      if (database.prepare("SELECT 1 FROM worktrees WHERE id = ?").get(input.id)) return;
      if (input.kind === "team" && input.teamSpaceId) {
        this.requireTarget(input.creatorUserId, input.teamSpaceId, null, true);
        assertProposalQuota(database, input.creatorUserId, input.teamSpaceId);
      }
      if (input.forkId && database.prepare("SELECT 1 FROM worktrees WHERE fork_id = ? AND processed_at IS NULL").get(input.forkId)) throw forkAlreadyOpen();
      const next = (input.kind === "team"
        ? database.prepare(
            `SELECT MAX(
               COALESCE((SELECT MAX(number) FROM issues WHERE space_id = ?1), 0),
               COALESCE((SELECT MAX(number) FROM worktrees WHERE kind = 'team' AND team_space_id = ?1), 0)
             ) + 1 AS next`
          ).get(input.teamSpaceId)
        : database.prepare(
            "SELECT COALESCE(MAX(number), 0) + 1 AS next FROM worktrees WHERE kind = 'user' AND creator_user_id = ?"
          ).get(input.creatorUserId)) as { next: number };
      database
        .prepare(
          `INSERT INTO worktrees
            (
              id, number, name, summary, creator_user_id, kind, team_space_id,
              visibility, created_at, updated_at, created_via, fork_id, issue_id
            )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
          input.createdVia,
          input.forkId,
          input.issueId
        );
    });
  }

  /** Finds a numbered Worktree: in a Team Space, or among the user's own User Worktrees. */
  async findIdByNumber(
    scope: { readonly teamSpaceId: string } | { readonly creatorUserId: string },
    number: number
  ): Promise<string | null> {
    const row = ("teamSpaceId" in scope
      ? this._database.connection
          .prepare("SELECT id FROM worktrees WHERE kind = 'team' AND team_space_id = ? AND number = ?")
          .get(scope.teamSpaceId, number)
      : this._database.connection
          .prepare("SELECT id FROM worktrees WHERE kind = 'user' AND creator_user_id = ? AND number = ?")
          .get(scope.creatorUserId, number)) as { id: string } | undefined;
    return row?.id ?? null;
  }

  async update(input: Parameters<WorktreesRepository["update"]>[0]): Promise<boolean> {
    const result = this._database.connection.prepare(`
      UPDATE worktrees
      SET name = COALESCE($name, name),
          summary = CASE WHEN $setSummary THEN $summary ELSE summary END,
          visibility = COALESCE($visibility, visibility),
          issue_id = CASE WHEN $setIssue THEN $issueId ELSE issue_id END,
          updated_at = $updatedAt
      WHERE id = $id AND (
        creator_user_id = $actorId OR
        EXISTS (SELECT 1 FROM spaces WHERE id = worktrees.team_space_id AND ${ownsSpaceSql("spaces.owner_user_id", "$actorId")}) OR
        EXISTS (SELECT 1 FROM space_members JOIN spaces ON spaces.id = space_members.space_id
                WHERE space_id = worktrees.team_space_id AND user_id = $actorId AND role = 'admin'
                  AND NOT ${ownerSuspendedSql("spaces.owner_user_id")})
      )
    `).run({
      id: input.id,
      actorId: input.actorId,
      name: input.name ?? null,
      setSummary: Number(input.summary !== undefined),
      summary: input.summary ?? null,
      visibility: input.visibility ?? null,
      setIssue: Number(input.issueId !== undefined),
      issueId: input.issueId ?? null,
      updatedAt: input.updatedAt,
    });
    return Number(result.changes) === 1;
  }

  async findIssueId(teamSpaceId: string, number: number): Promise<string | null> {
    const row = this._database.connection
      .prepare("SELECT id FROM issues WHERE space_id = ? AND number = ?")
      .get(teamSpaceId, number) as { id: string } | undefined;
    return row?.id ?? null;
  }

  async units(worktreeId: string): Promise<WorktreeUnitRow[]> {
    return this._database.connection
      .prepare(
        `SELECT
           mapping.worktree_id,
           mapping.unit_id,
           mapping.resource_id,
           COALESCE(existing.id, future.node_id) AS node_id,
           mapping.source,
           mapping.ordinal,
           mapping.added_at,
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
    this._database.transaction((database) => {
      this.requireTarget(
        input.createdBy, input.targetSpaceId, input.targetParentNodeId,
        this.proposalSpace(input.worktreeId) !== null,
      );
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
      this.finishOperation(input.operationId, { worktreeId: input.worktreeId, unitId: input.unitId }, input.createdAt);
      // A direct replay of a failed operation may no longer have a pending slot.
      assertFileQuota(database, input.createdBy, 0);
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
    this._database.transaction((database) => {
      const intent = database.prepare(`
        SELECT activated_at, discarded_at, copied_from_node_id FROM worktree_node_intents WHERE worktree_id = ? AND unit_id = ?
      `).get(row.worktree_id, row.unit_id);
      if (!intent || intent.discarded_at !== null) throw notFound();
      if (intent.activated_at !== null) return;
      this.requireTarget(actorUserId, targetSpaceId, row.target_parent_node_id);
      database
        .prepare(
          `INSERT INTO nodes
            (
              id, space_id, parent_id, name, created_by,
              created_at, updated_at, copied_from_node_id
            )
           VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT id FROM nodes WHERE id = ?))
           ON CONFLICT (id) DO NOTHING`
        )
        .run(
          row.node_id,
          row.target_space_id,
          row.target_parent_node_id,
          row.new_name,
          creatorUserId,
          activatedAt,
          activatedAt,
          // The subquery drops the link when the source was purged while the pull request was open.
          intent.copied_from_node_id ?? null
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

  async markProcessed(worktreeId: string, processedAt: number): Promise<void> {
    this._database.connection
      .prepare(
        `UPDATE worktrees
         SET processed_at = COALESCE(processed_at, ?), updated_at = ?
         WHERE id = ?`
      )
      .run(processedAt, processedAt, worktreeId);
  }

  async markLocalUnitsDiscarded(worktreeId: string, discardedAt: number): Promise<void> {
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

  async markLocalUnitDiscarded(worktreeId: string, unitId: string, discardedAt: number): Promise<void> {
    this._database.connection
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
      this._database.connection
        .prepare("SELECT 1 FROM trash_batches WHERE id = ? AND created_by = ?")
        .get(this._removalBatchIdSync(worktreeId, unitId), userId),
    );
  }

  async mergers(worktreeIds: readonly string[]): Promise<ReadonlyMap<string, PublicUser>> {
    const rows = this._database.connection
      .prepare(
        `SELECT json_extract(operation.payload_json, '$.worktreeId') AS worktreeId,
                merger.id, merger.username, merger.display_name AS displayName, merger.avatar_url AS avatarUrl
         FROM operations AS operation
         JOIN users AS merger ON merger.id = operation.actor_user_id
         WHERE operation.kind = 'merge_worktree' AND operation.state = 'completed'
           AND json_extract(operation.payload_json, '$.worktreeId') IN (SELECT value FROM json_each(?))
         ORDER BY operation.updated_at`
      )
      .all(JSON.stringify(worktreeIds)) as unknown as Array<PublicUser & { readonly worktreeId: string }>;
    return new Map(rows.map(({ worktreeId, ...merger }) => [worktreeId, merger]));
  }

  async checks(worktreeId: string): Promise<WorktreeCheckRow[]> {
    return this._database.connection
      .prepare(
        `SELECT check_result.content_key, check_result.name, check_result.reporter_user_id,
                reporter.username AS reporter_username, reporter.display_name AS reporter_display_name,
                reporter.avatar_url AS reporter_avatar_url, check_result.state, check_result.summary, check_result.reported_at
         FROM worktree_checks AS check_result
         JOIN users AS reporter ON reporter.id = check_result.reporter_user_id
         WHERE check_result.worktree_id = ?
         ORDER BY check_result.reported_at DESC, check_result.reporter_user_id, check_result.content_key`
      )
      .all(worktreeId) as unknown as WorktreeCheckRow[];
  }

  async reportCheck(input: Parameters<WorktreesRepository["reportCheck"]>[0]): Promise<void> {
    this._database.connection
      .prepare(
        `INSERT INTO worktree_checks (worktree_id, content_key, name, reporter_user_id, state, summary, reported_at)
         VALUES ($worktreeId, $contentKey, $name, $reporterUserId, $state, $summary, $reportedAt)
         ON CONFLICT (worktree_id, content_key, name, reporter_user_id) DO UPDATE
         SET state = excluded.state, summary = excluded.summary, reported_at = excluded.reported_at
         WHERE worktree_checks.state <> excluded.state OR worktree_checks.summary <> excluded.summary`
      )
      .run(input);
  }

  async mergedContentKey(worktreeId: string): Promise<string | null> {
    const row = this._database.connection
      .prepare(
        `SELECT json_extract(payload_json, '$.contentKey') AS key
         FROM operations
         WHERE kind = 'merge_worktree' AND json_extract(payload_json, '$.worktreeId') = ?
           AND json_extract(payload_json, '$.contentKey') IS NOT NULL
         ORDER BY created_at DESC, id DESC
         LIMIT 1`
      )
      .get(worktreeId) as { key: string } | undefined;
    return row?.key ?? null;
  }

  async getOperation(operationId: string): Promise<WorktreeOperationRow | null> {
    return (
      (this._database.connection
        .prepare("SELECT * FROM operations WHERE id = ?")
        .get(operationId) as WorktreeOperationRow | undefined) ?? null
    );
  }

  private requireTarget(userId: string, spaceId: string, parentNodeId: string | null, proposal = false): void {
    const access = (proposal ? checkProposalTarget : checkCreateTarget)(this.access, userId, spaceId, parentNodeId);
    if (access === "notFound") throw notFound();
    if (access === "forbidden") throw forbidden();
  }

  /** The Space a Team Worktree proposes to. Its author needs only membership; whoever merges needs the write access. */
  private proposalSpace(worktreeId: string): string | null {
    const row = this._database.connection
      .prepare("SELECT team_space_id FROM worktrees WHERE id = ? AND kind = 'team'")
      .get(worktreeId) as { readonly team_space_id: string } | undefined;
    return row?.team_space_id ?? null;
  }

  async reserveOperation(input: WorktreeReservation): Promise<{ readonly created: boolean; readonly row: WorktreeOperationRow }> {
    return this._database.transaction((database) => {
      const existing = database
        .prepare("SELECT * FROM operations WHERE id = ?")
        .get(input.id) as WorktreeOperationRow | undefined;
      if (existing) return { created: false, row: existing };
      if (input.kind === "create_worktree_unit") {
        this.requireTarget(
          input.actorUserId, input.payload.targetSpaceId, input.payload.targetParentNodeId,
          this.proposalSpace(input.payload.worktreeId) !== null,
        );
        assertFileQuota(database, input.actorUserId, 1, input.id);
      } else if (input.kind === "create_worktree") {
        if (input.payload.teamSpaceId !== null) {
          this.requireTarget(input.actorUserId, input.payload.teamSpaceId, null, true);
          assertProposalQuota(database, input.actorUserId, input.payload.teamSpaceId);
        }
        assertAgentBudget(database, input.actorUserId, "openWorktree", input.createdAt);
      } else if (input.kind === "merge_worktree") {
        assertAgentBudget(database, input.actorUserId, "mergeWorktree", input.createdAt);
      } else if (input.kind === "add_worktree_unit") {
        const resource = this.access.readResourceAccess(input.actorUserId, input.payload.resourceId);
        if (!resource || resource.kind !== "univer") throw notFound();
        const teamSpaceId = this.proposalSpace(input.payload.worktreeId);
        if (teamSpaceId !== null) this.requireTarget(input.actorUserId, teamSpaceId, null, true);
        const { openContent, editContent } = resource.capabilities;
        if (!(teamSpaceId !== null ? openContent : editContent)) throw forbidden();
      }
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

  async completeOperation(
    operationId: string,
    result: Readonly<Record<string, unknown>>,
    completedAt: number
  ): Promise<WorktreeOperationRow> {
    this.finishOperation(operationId, result, completedAt);
    return this._database.connection
      .prepare("SELECT * FROM operations WHERE id = ?")
      .get(operationId) as unknown as WorktreeOperationRow;
  }

  private finishOperation(operationId: string, result: Readonly<Record<string, unknown>>, completedAt: number): void {
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
  }

  async retryOperation(operationId: string, actorUserId: string, retriedAt: number): Promise<void> {
    this._database.transaction((db) => retryFailed(db, operationId, actorUserId, retriedAt));
  }

  async failOperation(
    operationId: string,
    error: { readonly code: string; readonly message: string },
    failedAt: number
  ): Promise<void> {
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
            ${ownsSpaceSql("worktree.creator_user_id")} AS actor_owns_creator_space,
            creator.username AS creator_username,
            creator.display_name AS creator_display_name,
            creator.avatar_url AS creator_avatar_url,
            claimer.id AS claimer_user_id,
            claimer.username AS claimer_username,
            claimer.display_name AS claimer_display_name,
            claimer.avatar_url AS claimer_avatar_url,
            team.name AS team_space_name,
            issue.number AS issue_number,
            issue.title AS issue_title,
            issue.state AS issue_state,
            ${ownsSpaceSql("team.owner_user_id")} AS actor_owns_team_space,
            member.role AS actor_member_role,
            ${proposesSql("team")} AS actor_proposes,
            (
              SELECT COUNT(*)
              FROM worktree_units AS counted
              WHERE counted.worktree_id = worktree.id
            ) AS unit_count,
            (
              SELECT COUNT(*) FROM html_view_drafts AS draft
              WHERE draft.source_worktree_id = worktree.id
                AND draft.state = 'pending' AND draft.expires_at > unixepoch('subsec') * 1000
            ) AS pending_page_drafts
          FROM worktrees AS worktree
          JOIN users AS creator ON creator.id = worktree.creator_user_id
          LEFT JOIN agents AS agent ON agent.user_id = worktree.creator_user_id
          LEFT JOIN users AS claimer ON claimer.id = agent.owner_user_id
          LEFT JOIN spaces AS team ON team.id = worktree.team_space_id
          LEFT JOIN space_members AS member
            ON member.space_id = worktree.team_space_id
           AND member.user_id = $userId
           AND NOT ${ownerSuspendedSql("team.owner_user_id")}
          LEFT JOIN issues AS issue
            ON issue.id = worktree.issue_id
           AND (${ownsSpaceSql("team.owner_user_id")} OR member.user_id IS NOT NULL
             OR (team.public_read = 1 AND NOT ${ownerSuspendedSql("team.owner_user_id")}))`;
}
