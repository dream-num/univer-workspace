import { randomUUID } from "node:crypto";
import {
  UnitStoreError,
  type UnitStore,
} from "../../integrations/univer/unit-store.js";
import { ApplicationError } from "../../middleware/errors.js";
import type {
  AccessResolver,
  ResourceAccess,
  UnitType,
} from "../access/index.js";
import { nodeSummary, resourceSummary } from "../nodes/nodes.service.js";
import {
  ResourcesRepository,
  operationView,
  type ReservedCreateResource,
} from "./resources.repository.js";
import type {
  CreateResourceIntent,
  CreateResourcePayload,
  OperationView,
  ResourceCreateResponse,
  ResourceOpenView,
  ResourceResponse,
} from "./resources.types.js";

export type CreateResourceResult =
  | { readonly status: 200 | 201; readonly body: ResourceCreateResponse }
  | {
      readonly status: 202;
      readonly body: { readonly operation: OperationView };
    };

export interface ResourcesModule {
  create(
    userId: string,
    operationId: unknown,
    input: unknown
  ): Promise<CreateResourceResult>;
  get(userId: string, resourceId: string): ResourceResponse;
  open(userId: string, resourceId: string): ResourceOpenView;
  getOperation(userId: string, operationId: string): OperationView;
  retry(userId: string, operationId: string): Promise<OperationView>;
  resumeDue(workerId: string, limit?: number): Promise<number>;
}

export function createResourcesModule(options: {
  readonly repository: ResourcesRepository;
  readonly access: AccessResolver;
  readonly unitStore: UnitStore;
  readonly now?: () => number;
}): ResourcesModule {
  const now = options.now ?? Date.now;

  async function execute(
    reservation: ReservedCreateResource
  ): Promise<CreateResourceResult> {
    if (reservation.row.state === "completed") {
      return completedResult(
        reservation.created ? 201 : 200,
        reservation.row,
        reservation.payload
      );
    }
    options.repository.markAttempt(reservation.row.id, now());
    try {
      const created = await options.unitStore.createUnit({
        unitId: reservation.payload.unitId,
        unitType: reservation.payload.unitType,
        name: reservation.payload.name,
        userId: reservation.row.actor_user_id,
        ...(reservation.payload.initialData === undefined
          ? {}
          : { initialData: reservation.payload.initialData }),
      });
      if (created.unitId !== reservation.payload.unitId) {
        throw new UnitStoreError(
          "UNIT_ID_MISMATCH",
          "Collaboration Unit identity did not match the reserved Unit.",
          false
        );
      }
      options.repository.markUnitCreated(reservation.row.id, now());
      const completed = options.repository.completeCreateResource({
        operationId: reservation.row.id,
        actorUserId: reservation.row.actor_user_id,
        payload: reservation.payload,
        completedAt: now(),
      });
      return completedResult(
        reservation.created ? 201 : 200,
        completed,
        reservation.payload
      );
    } catch (error) {
      const normalized = operationError(error);
      if (normalized.retryable) {
        options.repository.markPendingError(
          reservation.row.id,
          normalized,
          now() + 5_000,
          now()
        );
      } else {
        options.repository.markFailed(
          reservation.row.id,
          normalized,
          now()
        );
      }
      return {
        status: 202,
        body: {
          operation: getOperation(
            options.repository,
            reservation.row.actor_user_id,
            reservation.row.id
          ),
        },
      };
    }
  }

  function completedResult(
    status: 200 | 201,
    row: ReservedCreateResource["row"],
    payload: CreateResourcePayload
  ): CreateResourceResult {
    const access = options.access.resolveResource(
      row.actor_user_id,
      payload.resourceId
    );
    if (!access) {
      throw new Error(
        "Completed Resource operation has no discoverable Resource."
      );
    }
    return {
      status,
      body: {
        operation: operationView(row),
        node: nodeSummary(access.node),
      },
    };
  }

  return {
    async create(userId, operationIdValue, inputValue) {
      const operationId = validOperationId(operationIdValue);
      const intent = validCreateResource(inputValue);
      validateTarget(userId, intent, options.access);
      const reservation = options.repository.reserveCreateResource({
        operationId,
        actorUserId: userId,
        payload: {
          ...intent,
          nodeId: randomUUID(),
          resourceId: randomUUID(),
          unitId: randomUUID(),
        },
        createdAt: now(),
      });
      assertSameIntent(userId, intent, reservation);
      if (!reservation.created && reservation.row.state !== "completed") {
        return {
          status: 202,
          body: { operation: operationView(reservation.row) },
        };
      }
      return execute(reservation);
    },

    get(userId, resourceId) {
      const access = requireResourceAccess(options.access, userId, resourceId);
      return {
        resource: resourceSummary(access.node)!,
        node: nodeSummary(access.node),
      };
    },

    open(userId, resourceId) {
      const access = requireResourceAccess(options.access, userId, resourceId);
      if (!access.capabilities.openContent) throw notFound();
      if (access.kind === "blob") {
        if (access.availability !== "ready") {
          throw new ApplicationError(
            "CONFLICT",
            409,
            "Blob content is not currently available."
          );
        }
        options.repository.recordRecent(userId, resourceId, now());
        return {
          resource: {
            id: access.id,
            kind: "blob",
            nodeId: access.node.id,
            spaceId: access.node.spaceId,
            name: access.node.name,
            accessRole: access.node.role,
            originalFilename: access.originalFilename,
            mediaType: access.mediaType,
            byteSize: access.byteSize,
            sha256: access.sha256,
            contentUrl: `/api/blob-resources/${encodeURIComponent(access.id)}/content`,
            downloadUrl: `/api/blob-resources/${encodeURIComponent(access.id)}/download`,
          },
        };
      }
      options.repository.recordRecent(userId, resourceId, now());
      return {
        resource: {
          id: access.id,
          kind: "univer",
          nodeId: access.node.id,
          spaceId: access.node.spaceId,
          name: access.node.name,
          unitId: access.unitId,
          unitType: access.unitType,
          accessRole: access.node.role,
          editorMode: access.capabilities.editContent
            ? "edit"
            : "readOnly",
        },
      };
    },

    getOperation(userId, operationId) {
      return getOperation(options.repository, userId, operationId);
    },

    async retry(userId, operationId) {
      const existing = options.repository.getOperation(operationId, userId);
      if (!existing) throw notFound();
      if (existing.state !== "failed") {
        throw new ApplicationError(
          "CONFLICT",
          409,
          "Only a failed operation can be retried."
        );
      }
      options.repository.retry(operationId, userId, now());
      const reservation = options.repository.reserveCreateResource({
        operationId,
        actorUserId: userId,
        payload: JSON.parse(
          existing.payload_json
        ) as CreateResourcePayload,
        createdAt: now(),
      });
      return (await execute(reservation)).body.operation;
    },

    async resumeDue(workerId, limit = 20) {
      const claimed = options.repository.claimDue(
        workerId,
        now(),
        now() + 30_000,
        limit
      );
      for (const reservation of claimed) await execute(reservation);
      return claimed.length;
    },
  };
}

function validateTarget(
  userId: string,
  input: CreateResourceIntent,
  access: AccessResolver
): void {
  if (input.parentNodeId === null) {
    const space = access.resolveSpace(userId, input.spaceId);
    if (!space) throw notFound();
    if (!space.capabilities.createAtRoot) throw forbidden();
    return;
  }
  const parent = access.resolveNode(userId, input.parentNodeId);
  if (!parent || parent.spaceId !== input.spaceId) throw notFound();
  if (!parent.capabilities.createChildren) throw forbidden();
}

function validCreateResource(value: unknown): CreateResourceIntent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidInput("A Resource definition is required.");
  }
  const record = value as Record<string, unknown>;
  if (record.kind !== "univer") {
    throw invalidInput("kind must be univer.", "kind");
  }
  const initialData = record.initialData;
  if (
    initialData !== undefined &&
    (typeof initialData !== "object" ||
      initialData === null ||
      Array.isArray(initialData))
  ) {
    throw invalidInput("initialData must be an object.", "initialData");
  }
  return {
    kind: "univer",
    spaceId: requiredId(record.spaceId, "spaceId"),
    parentNodeId: nullableId(
      record.parentNodeId,
      "parentNodeId"
    ),
    name: validName(record.name),
    unitType: validUnitType(record.unitType),
    ...(initialData === undefined
      ? {}
      : {
          initialData: initialData as Readonly<Record<string, unknown>>,
        }),
  };
}

function validOperationId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 16 ||
    value.length > 200 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw invalidInput(
      "Idempotency-Key must contain 16 to 200 URL-safe characters.",
      "Idempotency-Key"
    );
  }
  return value;
}

function requiredId(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) {
    throw invalidInput(`${field} is required.`, field);
  }
  return value;
}

function nullableId(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requiredId(value, field);
}

function validName(value: unknown): string {
  if (typeof value !== "string") {
    throw invalidInput("Resource name is required.", "name");
  }
  const name = value.trim();
  if (!name || name.length > 255) {
    throw invalidInput(
      "Resource name must contain between 1 and 255 characters.",
      "name"
    );
  }
  return name;
}

function validUnitType(value: unknown): UnitType {
  if (
    value !== "sheet" &&
    value !== "doc" &&
    value !== "slide" &&
    value !== "board" &&
    value !== "base"
  ) {
    throw invalidInput("unitType is invalid.", "unitType");
  }
  return value;
}

function assertSameIntent(
  userId: string,
  intent: CreateResourceIntent,
  reservation: ReservedCreateResource
): void {
  const payload = reservation.payload;
  if (
    reservation.row.actor_user_id !== userId ||
    payload.spaceId !== intent.spaceId ||
    payload.parentNodeId !== intent.parentNodeId ||
    payload.name !== intent.name ||
    payload.kind !== intent.kind ||
    payload.unitType !== intent.unitType ||
    JSON.stringify(payload.initialData) !==
      JSON.stringify(intent.initialData)
  ) {
    throw new ApplicationError(
      "CONFLICT",
      409,
      "Idempotency-Key is already associated with another request."
    );
  }
}

function requireResourceAccess(
  resolver: AccessResolver,
  userId: string,
  resourceId: string
): ResourceAccess {
  const access = resolver.resolveResource(userId, resourceId);
  if (!access) throw notFound();
  return access;
}

function getOperation(
  repository: ResourcesRepository,
  userId: string,
  operationId: string
): OperationView {
  const row = repository.getOperation(operationId, userId);
  if (!row) throw notFound();
  return operationView(row);
}

function operationError(error: unknown): {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
} {
  if (error instanceof UnitStoreError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }
  return {
    code: "INTERNAL_ERROR",
    message:
      error instanceof Error ? error.message : "Resource creation failed.",
    retryable: true,
  };
}

function invalidInput(message: string, field?: string): ApplicationError {
  return new ApplicationError("INVALID_INPUT", 400, message, field);
}

function forbidden(): ApplicationError {
  return new ApplicationError(
    "FORBIDDEN",
    403,
    "The current user cannot perform this action."
  );
}

function notFound(): ApplicationError {
  return new ApplicationError("NOT_FOUND", 404, "The resource was not found.");
}
