import { randomUUID } from "node:crypto";
import {
  transformSnapshotToDocumentData,
  transformSnapshotToSlideData,
  transformSnapshotToWorkbookData,
} from "@univerjs-pro/collaboration";
import type { BlobStore } from "../../integrations/blob/blob-store.js";
import type { UnitSnapshotStore, UnitStore } from "../../integrations/univer/unit-store.js";
import { logger } from "../../logging/logger.js";
import { ApplicationError } from "../../middleware/errors.js";
import { assertCeiling, type AccessResolver, type UnitType } from "../access/index.js";
import { assertNotDelegatedPageWrite } from "../blobs/html-view-guard.js";
import { principalCategory, type Principal } from "../identity/index.js";
import { nodeNotFound } from "../nodes/nodes.errors.js";
import { nodeSummary } from "../nodes/nodes.service.js";
import { operationView } from "../operations/index.js";
import type { WorktreeBackend, WorktreesModule } from "../worktrees/index.js";
import type { CopiesRepository, CopyError, CopyOperationRow } from "./copies.repository.js";
import type { CopiedAsset, CopyableUnitType, CopyPayload, CopyRequest, CopyResult } from "./copies.types.js";
import { remapIds, uuidsIn } from "./unit-id-remap.js";

const MAX_ATTEMPTS = 5;
const FIRST_RETRY_MS = 5_000;
const LEASE_MS = 30_000;

export interface CopiesModule {
  /**
   * Copies a file the requester can open into a file of their own that records its source. The
   * copy lands at the root of their Personal Space, or as a new file in a draft pull request.
   */
  copy(actor: Principal, sourceNodeId: string, operationId: unknown, input: unknown): Promise<CopyResult>;
  /** Continues copies whose request died or whose last attempt failed. */
  resumeDue(workerId: string, limit?: number): Promise<number>;
}

export function createCopiesModule(options: {
  readonly repository: CopiesRepository;
  readonly access: AccessResolver;
  readonly worktrees: Pick<WorktreesModule, "get" | "assertCanCreateUnit">;
  readonly snapshots: Pick<UnitSnapshotStore, "materialize">;
  readonly unitStore: UnitStore;
  readonly worktreeBackend: Pick<WorktreeBackend, "createUnit" | "getWorktree" | "setUnitRemoved">;
  readonly store: BlobStore;
  readonly onWorktreeUnitAdded?: (worktreeId: string) => Promise<void>;
  readonly now?: () => number;
}): CopiesModule {
  const now = options.now ?? Date.now;
  const repository = options.repository;

  async function readUnit(unitId: string, unitType: CopyableUnitType, userId: string, pinned?: number) {
    const { snapshot, sheetBlocks, revision } = await options.snapshots.materialize({
      unitId,
      unitType,
      userId,
      ...(pinned === undefined ? {} : { revision: pinned }),
    });
    const data =
      unitType === "sheet" ? await transformSnapshotToWorkbookData(snapshot, structuredClone(sheetBlocks))
      : unitType === "doc" ? transformSnapshotToDocumentData(snapshot)
      : transformSnapshotToSlideData(snapshot);
    return { data: data as unknown as Readonly<Record<string, unknown>>, revision };
  }

  async function resolveTarget(userId: string, target: CopyRequest["target"]): Promise<CopyPayload["target"]> {
    if (target.kind === "worktree") {
      await options.worktrees.assertCanCreateUnit(userId, target.worktreeId, target.spaceId, target.parentNodeId);
      return target;
    }
    const spaceId = await repository.personalSpaceId(userId);
    if (!spaceId) throw nodeNotFound();
    return { kind: "space", spaceId };
  }

  /** Decides everything the copy will create before anything is written. */
  async function plan(actor: Principal, sourceNodeId: string, request: CopyRequest): Promise<CopyPayload> {
    const userId = actor.user.id;
    const node = await options.access.resolveNode(userId, sourceNodeId);
    if (!node) throw nodeNotFound();
    if (!node.resourceId) throw invalidInput("A folder cannot be copied.");
    const source = await options.access.resolveResource(userId, node.resourceId);
    if (!source?.capabilities.openContent) throw nodeNotFound();
    const base = {
      sourceNodeId,
      request,
      name: request.name ?? node.name,
      nodeId: randomUUID(),
      resourceId: randomUUID(),
      target: await resolveTarget(userId, request.target),
    };
    const category = principalCategory(actor.user);

    if (source.kind === "blob") {
      if (base.target.kind === "worktree") {
        throw invalidInput("Only a Unit can be copied into a pull request.", "target");
      }
      if (source.availability !== "ready") throw nodeNotFound();
      assertNotDelegatedPageWrite(actor, [base.name, source.originalFilename]);
      assertCeiling(category, "storeFile", { byteSize: source.byteSize });
      return {
        ...base,
        content: {
          kind: "blob",
          object: {
            sourceObjectKey: source.objectKey,
            objectKey: randomUUID(),
            originalFilename: source.originalFilename,
            mediaType: source.mediaType,
            byteSize: source.byteSize,
            sha256: source.sha256,
            etag: source.etag,
          },
        },
      };
    }

    const unitType = copyableUnitType(source.unitType);
    const read = await readUnit(source.unitId, unitType, userId);
    const candidates = [...uuidsIn(read.data)].filter((id) => id !== source.unitId);
    const readable = new Map([[source.unitId, true]]);
    const assets: CopiedAsset[] = [];
    for (const asset of await repository.findTrunkAssets(candidates)) {
      if (!readable.has(asset.unit_id)) {
        const owner = await options.access.resolveUnit(userId, asset.unit_id);
        readable.set(asset.unit_id, owner?.capabilities.openContent === true);
      }
      // An image of a file the requester cannot open stays a reference to that file.
      if (!readable.get(asset.unit_id)) continue;
      assets.push({
        sourceAssetId: asset.id,
        assetId: randomUUID(),
        sourceObjectKey: asset.object_key,
        objectKey: randomUUID(),
        originalFilename: asset.original_filename,
        mediaType: asset.media_type,
        byteSize: asset.byte_size,
        sha256: asset.sha256,
        etag: asset.etag,
      });
    }
    assertCeiling(category, "storeFile", { byteSize: assets.reduce((sum, asset) => sum + asset.byteSize, 0) });
    return {
      ...base,
      content: {
        kind: "univer",
        unitType,
        sourceUnitId: source.unitId,
        sourceRevision: read.revision,
        unitId: randomUUID(),
        assets,
      },
    };
  }

  async function copyObjects({ content }: CopyPayload): Promise<void> {
    for (const object of content.kind === "blob" ? [content.object] : content.assets) {
      const source = await options.store.open({ objectKey: object.sourceObjectKey });
      try {
        const stored = await options.store.put({
          objectKey: object.objectKey,
          body: source.stream,
          expectedByteSize: object.byteSize,
          detectMediaType: false,
        });
        if (stored.sha256 !== object.sha256) {
          throw new ApplicationError("CONFLICT", 409, "The source file changed while it was being copied.");
        }
      } finally {
        source.stream.destroy();
      }
    }
  }

  async function createUnit(payload: CopyPayload, userId: string): Promise<void> {
    const { content, target } = payload;
    if (content.kind !== "univer") return;
    const source = await readUnit(content.sourceUnitId, content.unitType, userId, content.sourceRevision);
    const unit = {
      unitId: content.unitId,
      unitType: content.unitType,
      name: payload.name,
      initialData: remapIds(
        source.data,
        new Map([
          [content.sourceUnitId, content.unitId],
          ...content.assets.map((asset) => [asset.sourceAssetId, asset.assetId] as const),
        ]),
      ),
    };
    if (target.kind !== "worktree") {
      await options.unitStore.createUnit({ ...unit, userId });
      return;
    }
    try {
      await options.worktreeBackend.createUnit({ ...unit, worktreeId: target.worktreeId }, userId);
    } catch (error) {
      // Workaround: the Trunk service answers a repeated creation with `already-exists`, but the
      // Worktree service refuses it, so the Unit of an attempt that died shows up as this refusal.
      // Remove the lookup when the Worktree service reports a repeated creation as a success.
      const worktree = await options.worktreeBackend.getWorktree(target.worktreeId, userId);
      if (!worktree.units.some((created) => created.unitID === content.unitId)) throw error;
    }
  }

  /** Removes the new Unit, then fails the Operation, which queues the copied objects for deletion. */
  async function abandon(row: CopyOperationRow, payload: CopyPayload): Promise<void> {
    const { content, target } = payload;
    if (content.kind === "univer") {
      try {
        if (target.kind === "worktree") {
          await options.worktreeBackend.setUnitRemoved(target.worktreeId, content.unitId, true, row.actor_user_id);
        } else {
          await options.unitStore.deleteUnit?.({ unitId: content.unitId, userId: row.actor_user_id });
        }
      } catch (error) {
        // A refusal means there is no such Unit to remove. Anything else is tried again once the
        // lease runs out, up to a cap, so that the Operation cannot stay pending forever.
        if (copyError(error).retryable) {
          if (row.attempt_count < MAX_ATTEMPTS * 2) return;
          logger.warn({ operationId: row.id, unitId: content.unitId }, "A failed copy could not remove its Unit");
        }
      }
    }
    await repository.fail(row.id, payload, now());
  }

  /** One attempt. Every step can run again after a crash without creating a second file. */
  async function run(operationId: string): Promise<void> {
    const row = await repository.beginAttempt(operationId, now());
    if (!row) return;
    const payload = JSON.parse(row.payload_json) as CopyPayload;
    if (row.step === "abandoning") return abandon(row, payload);
    try {
      if (row.step === "reserved") {
        await copyObjects(payload);
        await repository.setStep(row.id, "objects_copied", now());
      }
      if (row.step !== "unit_created") {
        await createUnit(payload, row.actor_user_id);
        await repository.setStep(row.id, "unit_created", now());
      }
      await repository.complete({
        operationId: row.id,
        actorUserId: row.actor_user_id,
        payload,
        completedAt: now(),
      });
    } catch (error) {
      const failure = copyError(error);
      const abandoning = !failure.retryable || row.attempt_count >= MAX_ATTEMPTS;
      const pending = await repository.defer({
        operationId: row.id,
        error: failure,
        abandoning,
        nextAttemptAt: now() + FIRST_RETRY_MS * 2 ** (row.attempt_count - 1),
        updatedAt: now(),
      });
      if (pending && abandoning) await abandon(row, payload);
      return;
    }
    if (payload.target.kind === "worktree") {
      // Realtime cache invalidation cannot change a completed product write.
      await options.onWorktreeUnitAdded?.(payload.target.worktreeId).catch(() => undefined);
    }
  }

  async function result(status: 200 | 201, row: CopyOperationRow): Promise<CopyResult> {
    const operation = operationView(row);
    if (row.state !== "completed") return { status: 202, body: { operation } };
    const payload = JSON.parse(row.payload_json) as CopyPayload;
    if (payload.target.kind === "worktree" && payload.content.kind === "univer") {
      const { unitId } = payload.content;
      const { worktree } = await options.worktrees.get(row.actor_user_id, payload.target.worktreeId);
      const unit = worktree.units.find((candidate) => candidate.unitId === unitId);
      if (!unit) throw new Error("Completed copy has no discoverable Worktree Unit.");
      return { status, body: { operation, unit } };
    }
    const access = await options.access.resolveResource(row.actor_user_id, payload.resourceId);
    if (!access) throw new Error("Completed copy has no discoverable Resource.");
    return { status, body: { operation, node: nodeSummary(access.node) } };
  }

  function replay(userId: string, sourceNodeId: string, request: CopyRequest, row: CopyOperationRow): Promise<CopyResult> {
    const payload = JSON.parse(row.payload_json) as Partial<CopyPayload>;
    if (
      row.kind !== "copy_node" ||
      row.actor_user_id !== userId ||
      payload.sourceNodeId !== sourceNodeId ||
      JSON.stringify(payload.request) !== JSON.stringify(request)
    ) {
      throw new ApplicationError("CONFLICT", 409, "Idempotency-Key is already associated with another request.");
    }
    return result(200, row);
  }

  return {
    async copy(actor, sourceNodeId, operationIdValue, inputValue) {
      const userId = actor.user.id;
      const operationId = validOperationId(operationIdValue);
      const request = validRequest(inputValue);
      const existing = await repository.find(operationId);
      if (existing) return replay(userId, sourceNodeId, request, existing);
      const reserved = await repository.reserve({
        operationId,
        actorUserId: userId,
        payload: await plan(actor, sourceNodeId, request),
        createdAt: now(),
      });
      if (!reserved.created) return replay(userId, sourceNodeId, request, reserved.row);
      await run(operationId);
      return result(201, (await repository.find(operationId))!);
    },

    async resumeDue(workerId, limit = 20) {
      const rows = await repository.claimDue(workerId, now(), now() + LEASE_MS, limit);
      for (const row of rows) await run(row.id);
      return rows.length;
    },
  };
}

function copyableUnitType(unitType: UnitType): CopyableUnitType {
  if (unitType === "sheet" || unitType === "doc" || unitType === "slide") return unitType;
  throw invalidInput(`A ${unitType} file cannot be copied yet.`);
}

/** Collaboration errors say whether a retry can help. A refusal by Workspace cannot be retried. */
function copyError(error: unknown): CopyError & { readonly retryable: boolean } {
  const candidate = (error ?? {}) as { readonly code?: unknown; readonly retryable?: unknown };
  return {
    code: typeof candidate.code === "string" ? candidate.code : "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : "The copy failed.",
    retryable:
      !(error instanceof ApplicationError) &&
      (typeof candidate.retryable === "boolean" ? candidate.retryable : true),
  };
}

function validRequest(value: unknown): CopyRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidInput("A copy definition is required.");
  }
  const { name, target } = value as Record<string, unknown>;
  if (name !== undefined && (typeof name !== "string" || !name.trim() || name.trim().length > 255)) {
    throw invalidInput("name must contain between 1 and 255 characters.", "name");
  }
  if (typeof target !== "object" || target === null) throw invalidInput("target is required.", "target");
  const { kind, worktreeId, spaceId, parentNodeId } = target as Record<string, unknown>;
  const request = { name: name === undefined ? null : name.trim() };
  if (kind === "personalSpace") return { ...request, target: { kind } };
  if (kind !== "worktree") throw invalidInput("target.kind must be personalSpace or worktree.", "target.kind");
  if (typeof worktreeId !== "string" || !worktreeId) throw invalidInput("target.worktreeId is required.", "target.worktreeId");
  if (typeof spaceId !== "string" || !spaceId) throw invalidInput("target.spaceId is required.", "target.spaceId");
  if (parentNodeId !== null && (typeof parentNodeId !== "string" || !parentNodeId)) {
    throw invalidInput("target.parentNodeId must be a Node ID or null.", "target.parentNodeId");
  }
  return { ...request, target: { kind, worktreeId, spaceId, parentNodeId } };
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
