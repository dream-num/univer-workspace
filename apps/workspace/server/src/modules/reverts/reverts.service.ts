import { createHash, randomUUID } from "node:crypto";
import { ApplicationError } from "../../middleware/errors.js";
import type { AccessResolver } from "../access/index.js";
import type { User } from "../identity/index.js";
import type { IssuesModule } from "../issues/index.js";
import { operationView } from "../operations/index.js";
import type { TrashModule, TrashRepository } from "../trash/index.js";
import type { MergedChanges, MergedUnit, TrunkChangeset, WorktreeBackend, WorktreeChangesetSubmitResult, WorktreesModule } from "../worktrees/index.js";
import type { RevertError, RevertOperationRow, RevertsRepository } from "./reverts.repository.js";
import type {
  RevertForce,
  RevertItem,
  RevertLaterEdit,
  RevertPayload,
  RevertPlan,
  RevertResult,
  RevertScope,
  RevertsModule,
  RevertWork,
} from "./reverts.types.js";

const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 5;
const FIRST_RETRY_MS = 5_000;
/** Each lost race on Trunk head is one more restore attempt before the revert waits and tries again. */
const MAX_HEAD_RACES = 5;
const MAX_FORCED = 200;

const BLOCKED = "Edited on Trunk after this task's merge. Reverting would overwrite those edits.";

/** A page published by one of the pull requests: a new page goes to Trash, a replaced one cannot come back. */
export interface RevertedPage {
  readonly name: string;
  readonly kind: "create" | "replace";
  readonly nodeId: string | null;
}

class LeaseLost extends Error {}

export function createRevertsModule(options: {
  readonly repository: RevertsRepository;
  readonly access: AccessResolver;
  readonly worktrees: Pick<WorktreesModule, "mergedChanges">;
  readonly issues: Pick<IssuesModule, "get" | "recordReverted">;
  readonly trash: Pick<TrashModule, "trashNodeOnce" | "restore">;
  readonly trashBatches: Pick<TrashRepository, "findBatch">;
  readonly backend: Pick<WorktreeBackend, "trunkRevision" | "trunkChangesets" | "restoreTrunk">;
  readonly publishedPages: (worktreeId: string) => Promise<readonly RevertedPage[]>;
  readonly users: (userIds: readonly string[]) => Promise<readonly User[]>;
  readonly now?: () => number;
}): RevertsModule {
  const now = options.now ?? Date.now;
  const { repository, access, backend } = options;

  async function scoped(userId: string, scope: RevertScope) {
    if (scope.kind === "pullRequest") {
      const changes = await options.worktrees.mergedChanges(userId, scope.worktreeId);
      return {
        changes: changes.merged ? [changes] : [],
        decides: changes.decides,
        spaceId: changes.teamSpaceId,
        notDecider: "Only someone who may merge this pull request can revert it.",
      };
    }
    const issue = await options.issues.get(userId, scope.spaceId, scope.number);
    const changes: MergedChanges[] = [];
    for (const pull of issue.pullRequests) {
      if (pull.state !== "merged") continue;
      const merged = await options.worktrees.mergedChanges(userId, pull.id);
      if (merged.merged) changes.push(merged);
    }
    return {
      changes,
      decides: issue.capabilities.close,
      spaceId: scope.spaceId,
      notDecider: "Only someone who may accept this Issue can revert it.",
    };
  }

  async function laterEdits(item: RevertWork, head: number, userId: string, sid?: string): Promise<readonly TrunkChangeset[]> {
    const merges = new Set(item.mergeRevisions);
    const first = Math.min(...merges);
    return (await backend.trunkChangesets(item.unitId!, item.univerType!, first, head, userId))
      .filter((changeset) => !merges.has(changeset.revision) && changeset.sid !== sid);
  }

  async function editors(edits: readonly TrunkChangeset[]): Promise<RevertLaterEdit[]> {
    const users = new Map((await options.users([...new Set(edits.map((edit) => edit.userId))])).map((user) => [user.id, user]));
    const byUser = new Map<string, { revisions: number; last: number | null }>();
    for (const edit of edits) {
      const entry = byUser.get(edit.userId) ?? { revisions: 0, last: null };
      entry.revisions += 1;
      if (edit.createdAt !== null) entry.last = Math.max(entry.last ?? 0, edit.createdAt);
      byUser.set(edit.userId, entry);
    }
    return [...byUser].map(([id, { revisions, last }]) => {
      const user = users.get(id);
      return {
        user: user ? { id: user.id, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl } : null,
        revisions,
        lastEditedAt: last === null ? null : new Date(last).toISOString(),
      };
    });
  }

  function base(unit: MergedUnit): Omit<RevertWork, "action" | "state" | "reason"> {
    return {
      name: unit.name, nodeId: unit.nodeId, unitId: unit.unitId, unitType: unit.unitType,
      targetRevision: null, headRevision: null, laterEdits: [],
    };
  }

  async function restoreItem(userId: string, unit: MergedUnit, revisions: readonly number[], recovering: boolean): Promise<RevertWork> {
    const item: RevertWork = {
      ...base(unit), action: "restore", state: "ready", reason: null,
      univerType: unit.univerType, mergeRevisions: [...revisions].sort((a, b) => a - b),
      targetRevision: Math.min(...revisions) - 1,
    };
    const head = await backend.trunkRevision(unit.unitId, userId);
    if (head === null) return { ...item, state: "unavailable", reason: "This file no longer exists." };
    const content = await access.resolveResourceContent(userId, unit.resourceId);
    // A file this revert brings back from Trash is checked when it is back.
    if (!content && !recovering) return { ...item, headRevision: head, state: "unavailable", reason: "This file is in Trash, or you cannot open it." };
    if (content && !content.capabilities.editContent) return { ...item, headRevision: head, state: "refused", reason: "You cannot edit this file." };
    const edits = await laterEdits(item, head, userId);
    return edits.length
      ? { ...item, headRevision: head, state: "blocked", reason: BLOCKED, laterEdits: await editors(edits) }
      : { ...item, headRevision: head };
  }

  async function trashItem(userId: string, name: string, nodeId: string | null, unit?: MergedUnit): Promise<RevertWork> {
    const item: RevertWork = {
      ...(unit ? base(unit) : { name, nodeId, unitId: null, unitType: null, targetRevision: null, headRevision: null, laterEdits: [] }),
      action: "trash", state: "ready", reason: null,
    };
    const node = nodeId === null ? null : await access.resolveNode(userId, nodeId);
    if (!node) return { ...item, state: "unavailable", reason: "This file is in Trash already, or you cannot see it." };
    if (!node.capabilities.trash) return { ...item, state: "refused", reason: "Only an owner or admin of this Space can move this file to Trash." };
    return item;
  }

  async function recoverItem(userId: string, unit: MergedUnit, batchId: string): Promise<RevertWork> {
    const item: RevertWork = { ...base(unit), action: "recover", state: "ready", reason: null, batchId };
    const batch = await options.trashBatches.findBatch(batchId);
    if (!batch) return { ...item, state: "unavailable", reason: "This file was deleted from Trash permanently." };
    if (batch.restored_at !== null) return { ...item, state: "done", reason: "This file is already back from Trash." };
    if (!(await access.resolveSpace(userId, batch.space_id))?.capabilities.viewTrash) {
      return { ...item, state: "refused", reason: "Only an owner or admin of this Space can restore this file from Trash." };
    }
    return item;
  }

  /** Every item the scope's merges call for, in the order a revert does them: back from Trash, restored, to Trash. */
  async function workFor(userId: string, changes: readonly MergedChanges[]): Promise<RevertWork[]> {
    const modified = new Map<string, { unit: MergedUnit; revisions: number[] }>();
    const added = new Map<string, MergedUnit>();
    const removed = new Map<string, { unit: MergedUnit; batchId: string }>();
    for (const pull of changes) {
      for (const unit of pull.units) {
        const { change } = unit;
        if (change.kind === "modified") {
          const entry = modified.get(unit.unitId) ?? { unit, revisions: [] };
          entry.revisions.push(change.trunkRevision);
          modified.set(unit.unitId, entry);
        } else if (change.kind === "added") {
          added.set(unit.unitId, unit);
        } else {
          removed.set(unit.unitId, { unit, batchId: change.removalBatchId });
        }
      }
    }
    // A file the set added did not exist before it, so it only goes to Trash.
    for (const unitId of added.keys()) {
      modified.delete(unitId);
      removed.delete(unitId);
    }
    const items: RevertWork[] = [];
    for (const { unit, batchId } of removed.values()) items.push(await recoverItem(userId, unit, batchId));
    const recovering = new Set(items.filter((item) => item.state === "ready").map((item) => item.unitId));
    for (const { unit, revisions } of modified.values()) items.push(await restoreItem(userId, unit, revisions, recovering.has(unit.unitId)));
    for (const unit of added.values()) items.push(await trashItem(userId, unit.name, unit.nodeId, unit));
    for (const pull of changes) {
      for (const page of await options.publishedPages(pull.id)) {
        items.push(page.kind === "create"
          ? await trashItem(userId, page.name, page.nodeId)
          : {
              action: "none", state: "unavailable", name: page.name, nodeId: page.nodeId, unitId: null, unitType: null,
              targetRevision: null, headRevision: null, laterEdits: [],
              reason: "A replaced page cannot be reverted: its earlier version was deleted.",
            });
      }
    }
    return items;
  }

  async function planFor(userId: string, browser: boolean, scope: RevertScope): Promise<{
    readonly plan: RevertPlan;
    readonly work: readonly RevertWork[];
    readonly error: ApplicationError | null;
  }> {
    const { changes, decides, spaceId, notDecider } = await scoped(userId, scope);
    const work = await workFor(userId, changes);
    let error: ApplicationError | null = null;
    if (!changes.length) {
      error = new ApplicationError("CONFLICT", 409, "Nothing to revert: no pull request here is merged.");
    } else if (!decides) {
      error = new ApplicationError("FORBIDDEN", 403, notDecider);
    } else if (spaceId !== null) {
      try {
        await access.assertChangesTrunk(userId, spaceId);
      } catch (refusal) {
        if (!(refusal instanceof ApplicationError)) throw refusal;
        error = new ApplicationError(refusal.code, refusal.status, `A revert changes Trunk without a merge. ${refusal.message}`);
      }
    }
    const refused = work.filter((item) => item.state === "refused");
    if (!error && refused.length) {
      error = new ApplicationError("FORBIDDEN", 403, `You cannot revert every change. ${refused.map((item) => `${item.name}: ${item.reason}`).join(" ")}`);
    }
    if (!error && !work.some((item) => item.state === "ready" || item.state === "blocked")) {
      error = new ApplicationError("CONFLICT", 409, "Nothing is left to revert.");
    }
    return {
      work,
      error,
      plan: {
        pullRequests: changes.map(({ id, number, title }) => ({ id, number, title })),
        items: work.map(view),
        capabilities: {
          revert: error === null,
          force: error === null && browser && work.some((item) => item.state === "blocked"),
        },
        refusal: error?.message ?? null,
      },
    };
  }

  async function submit(input: Parameters<WorktreeBackend["restoreTrunk"]>[0], userId: string): Promise<WorktreeChangesetSubmitResult> {
    try {
      return await backend.restoreTrunk(input, userId);
    } catch (error) {
      // The Trunk service's middleware refuses by throwing, as the protection guard does.
      const code = (error as { readonly code?: unknown } | null)?.code;
      if (code !== "PERMISSION_DENIED") throw error;
      return { status: "rejected", error: { code, message: error instanceof Error ? error.message : "Permission denied.", retryable: false } };
    }
  }

  /** Restores one Unit at head. A stored attempt is submitted again unchanged before a new one is stored. */
  async function restore(
    row: RevertOperationRow,
    payload: RevertPayload,
    item: RevertWork,
    store: (attempt: NonNullable<RevertWork["attempt"]>) => Promise<void>,
  ): Promise<RevertWork> {
    const userId = row.actor_user_id;
    const sid = `revert-${row.id}`;
    const through = payload.force.find((force) => force.unitId === item.unitId)?.headRevision ?? 0;
    let attempt = item.attempt;
    let reqId = attempt?.reqId ?? 0;
    for (let race = 0; race < MAX_HEAD_RACES; race += 1) {
      if (!attempt) {
        const head = await backend.trunkRevision(item.unitId!, userId);
        if (head === null) return { ...item, state: "unavailable", reason: "This file no longer exists." };
        const edits = await laterEdits(item, head, userId, sid);
        if (edits.some((edit) => edit.revision > through)) {
          return { ...item, state: "blocked", headRevision: head, reason: BLOCKED, laterEdits: await editors(edits) };
        }
        reqId += 1;
        attempt = { reqId, baseRev: head };
        await store(attempt);
      }
      const result = await submit({
        unitId: item.unitId!, type: item.univerType!, baseRev: attempt.baseRev,
        targetRevision: item.targetRevision!, sid, reqId: attempt.reqId,
      }, userId);
      if (!("error" in result)) return { ...item, attempt, state: "done", reason: null };
      const { code, message, retryable } = result.error;
      // Neither committed, and a stale base never will, so the next attempt reads head again.
      if (code === "OT_CONFLICT" || code === "REVISION_MISMATCH") {
        attempt = undefined;
        continue;
      }
      if (code === "PERMISSION_DENIED") {
        return { ...item, attempt, state: "failed", reason: "You cannot edit every protected range or object in this file, so it was not restored." };
      }
      if (retryable) throw Object.assign(new Error(message), { code, retryable });
      return { ...item, attempt, state: "failed", reason: message };
    }
    throw Object.assign(new Error("Trunk kept changing while this file was being restored."), { code: "CONFLICT", retryable: true });
  }

  async function trashNode(row: RevertOperationRow, item: RevertWork): Promise<RevertWork> {
    try {
      await options.trash.trashNodeOnce(row.actor_user_id, item.nodeId!, trashBatchId(row.id, item.nodeId!));
      return { ...item, state: "done", reason: null };
    } catch (error) {
      if (!(error instanceof ApplicationError)) throw error;
      if (error.code === "NOT_FOUND") return { ...item, state: "unavailable", reason: "This file is in Trash already, or you cannot see it." };
      return { ...item, state: "failed", reason: error.message };
    }
  }

  async function recover(row: RevertOperationRow, item: RevertWork): Promise<RevertWork> {
    try {
      await options.trash.restore(row.actor_user_id, item.batchId!);
      return { ...item, state: "done", reason: null };
    } catch (error) {
      if (!(error instanceof ApplicationError)) throw error;
      if (error.code === "RESTORE_PARENT_IN_TRASH") {
        return { ...item, state: "unavailable", reason: "Its folder is in Trash. Restore the folder from Trash first." };
      }
      if (error.code === "NOT_FOUND") {
        const batch = await options.trashBatches.findBatch(item.batchId!);
        return batch?.restored_at
          ? { ...item, state: "done", reason: "This file is already back from Trash." }
          : { ...item, state: "unavailable", reason: "This file is no longer in Trash." };
      }
      return { ...item, state: "failed", reason: error.message };
    }
  }

  /** One attempt by the lease holder. Each item's outcome is stored before the next starts, so a resumed revert skips it. */
  async function run(operationId: string, runner: string): Promise<void> {
    const row = await repository.beginAttempt(operationId, runner, now(), now() + LEASE_MS);
    if (!row) return;
    let payload = JSON.parse(row.payload_json) as RevertPayload;
    const save = async (index: number, item: RevertWork) => {
      const next = { ...payload, items: payload.items.map((old, at) => (at === index ? item : old)) };
      if (!(await repository.save(row.id, runner, next, now(), now() + LEASE_MS))) throw new LeaseLost();
      payload = next;
    };
    try {
      for (let index = 0; index < payload.items.length; index += 1) {
        const item = payload.items[index]!;
        if (item.state !== "ready") continue;
        const outcome = item.action === "recover" ? await recover(row, item)
          : item.action === "restore" ? await restore(row, payload, item, (attempt) => save(index, { ...item, attempt }))
          : await trashNode(row, item);
        await save(index, outcome);
      }
      if (payload.scope.kind === "issue") {
        await options.issues.recordReverted(row.actor_user_id, payload.scope.spaceId, payload.scope.number, row.id);
      }
      await repository.complete({ operationId: row.id, runner, payload, result: { items: payload.items.map(view) }, completedAt: now() });
    } catch (error) {
      if (error instanceof LeaseLost) return;
      const failure = revertError(error);
      if (!failure.retryable || row.attempt_count >= MAX_ATTEMPTS) {
        await repository.fail({ operationId: row.id, runner, error: failure, failedAt: now() });
      } else {
        await repository.defer({
          operationId: row.id, runner, error: failure,
          nextAttemptAt: now() + FIRST_RETRY_MS * 2 ** (row.attempt_count - 1), updatedAt: now(),
        });
      }
    }
  }

  function result(status: 200 | 201, row: RevertOperationRow): RevertResult {
    const operation = operationView(row);
    if (row.state === "pending") return { status: 202, body: { operation } };
    return { status, body: { operation, items: (JSON.parse(row.payload_json) as RevertPayload).items.map(view) } };
  }

  function replay(userId: string, scope: RevertScope, force: readonly RevertForce[], row: RevertOperationRow): RevertResult {
    const payload = JSON.parse(row.payload_json) as Partial<RevertPayload>;
    if (
      row.kind !== "revert_worktrees" ||
      row.actor_user_id !== userId ||
      JSON.stringify(payload.scope) !== JSON.stringify(scope) ||
      JSON.stringify(payload.force) !== JSON.stringify(force)
    ) {
      throw new ApplicationError("CONFLICT", 409, "Idempotency-Key is already associated with another request.");
    }
    return result(200, row);
  }

  return {
    async plan(userId, browser, scope) {
      return (await planFor(userId, browser, scope)).plan;
    },

    async revert(userId, browser, scope, operationIdValue, inputValue) {
      const operationId = validOperationId(operationIdValue);
      const force = validForce(inputValue);
      if (force.length && !browser) {
        throw new ApplicationError("FORBIDDEN", 403, "Only a person signed in to the browser can overwrite later edits. Revert without force to leave those files as they are.");
      }
      const existing = await repository.find(operationId);
      if (existing) return replay(userId, scope, force, existing);
      const { work, error } = await planFor(userId, browser, scope);
      if (error) throw error;
      const items = work.map((item): RevertWork => {
        const forced = force.find((entry) => entry.unitId === item.unitId);
        if (!forced || item.action !== "restore") return item;
        if (item.state !== "blocked") throw new ApplicationError("CONFLICT", 409, `${item.name} has no later edits to overwrite. View the plan again.`);
        // Edits after the head the person saw were not named to them, so they keep the Unit blocked.
        return item.headRevision! > forced.headRevision ? item : { ...item, state: "ready", reason: null };
      });
      for (const entry of force) {
        if (!items.some((item) => item.action === "restore" && item.unitId === entry.unitId)) {
          throw new ApplicationError("INVALID_INPUT", 400, "force names a file this revert does not restore.", "force");
        }
      }
      if (!items.some((item) => item.state === "ready")) {
        throw new ApplicationError("CONFLICT", 409, "Every file left to revert was edited after the merge. A person can overwrite those edits in the browser.");
      }
      const runner = randomUUID();
      const reserved = await repository.reserve({
        operationId, actorUserId: userId, payload: { scope, force, items }, runner, createdAt: now(), leaseExpiresAt: now() + LEASE_MS,
      });
      if (!reserved.created) return replay(userId, scope, force, reserved.row);
      await run(operationId, runner);
      return result(201, (await repository.find(operationId))!);
    },

    async retry(userId, operationId) {
      const runner = randomUUID();
      if (!(await repository.retry(operationId, userId, runner, now(), now() + LEASE_MS))) {
        throw new ApplicationError("CONFLICT", 409, "Only a failed operation can be retried.");
      }
      await run(operationId, runner);
    },

    async resumeDue(workerId, limit = 20) {
      const rows = await repository.claimDue(workerId, now(), now() + LEASE_MS, limit);
      for (const row of rows) await run(row.id, workerId);
      return rows.length;
    },
  };
}

function view({ univerType: _type, mergeRevisions: _merges, batchId: _batch, attempt: _attempt, ...item }: RevertWork): RevertItem {
  return item;
}

function trashBatchId(operationId: string, nodeId: string): string {
  return `revert-${createHash("sha256").update(JSON.stringify([operationId, nodeId])).digest("hex")}`;
}

/** Collaboration errors say whether a retry can help. A refusal by Workspace cannot be retried. */
function revertError(error: unknown): RevertError & { readonly retryable: boolean } {
  const candidate = (error ?? {}) as { readonly code?: unknown; readonly retryable?: unknown };
  return {
    code: typeof candidate.code === "string" ? candidate.code : "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : "The revert failed.",
    retryable: !(error instanceof ApplicationError) && (typeof candidate.retryable === "boolean" ? candidate.retryable : true),
  };
}

function validForce(value: unknown): readonly RevertForce[] {
  if (value === undefined || value === null) return [];
  if (typeof value !== "object" || Array.isArray(value)) throw invalidInput("The request body must be an object.");
  const { force, ...rest } = value as { readonly force?: unknown };
  if (Object.keys(rest).length) throw invalidInput(`Unknown field ${Object.keys(rest)[0]}.`, Object.keys(rest)[0]);
  if (force === undefined) return [];
  if (!Array.isArray(force) || force.length > MAX_FORCED) throw invalidInput(`force must be a list of at most ${MAX_FORCED} files.`, "force");
  const entries = force.map((entry): RevertForce => {
    const { unitId, headRevision } = (entry ?? {}) as { readonly unitId?: unknown; readonly headRevision?: unknown };
    if (typeof unitId !== "string" || !unitId || !Number.isSafeInteger(headRevision) || (headRevision as number) < 1) {
      throw invalidInput("Each force entry needs a unitId and the headRevision its plan showed.", "force");
    }
    return { unitId, headRevision: headRevision as number };
  });
  if (new Set(entries.map((entry) => entry.unitId)).size !== entries.length) throw invalidInput("force names a file twice.", "force");
  return entries;
}

function validOperationId(value: unknown): string {
  if (typeof value !== "string" || value.length < 16 || value.length > 200 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw invalidInput("Idempotency-Key must contain 16 to 200 URL-safe characters.", "Idempotency-Key");
  }
  return value;
}

function invalidInput(message: string, field?: string): ApplicationError {
  return new ApplicationError("INVALID_INPUT", 400, message, field);
}
