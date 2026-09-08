/**
 * Resource discovery, opening, creation, and request idempotency.
 * @module dsh-univer-workspace-plugin/provider/resources-api
 */

import { randomBytes } from "node:crypto";
import type { WorkspaceHttpClient } from "./workspace-contract.ts";
import type { WorkspaceDocumentOpen } from "../shared/wire.ts";
import type { JsonValue } from "../json-value.ts";
import { WorkspaceApiError, accessRole, readJson, stringField } from "./api-errors.ts";

function unitType(value: unknown): WorkspaceDocumentOpen["unitType"] | undefined {
  return value === "sheet" ||
    value === "doc" ||
    value === "slide" ||
    value === "board" ||
    value === "base"
    ? value
    : undefined;
}

/** Narrow the `/api/resources/{id}/open` response. */
export function narrowOpen(raw: unknown): WorkspaceDocumentOpen {
  const record = (raw ?? {}) as { resource?: unknown };
  const resource = (record.resource ?? null) as Record<string, unknown> | null;
  if (resource === null || resource.kind !== "univer") {
    throw new WorkspaceApiError(
      "workspace open returned a non-Univer resource",
      502,
      "MALFORMED_OPEN",
    );
  }
  const unitId = stringField(resource.unitId);
  const type = unitType(resource.unitType);
  const nodeId = stringField(resource.nodeId);
  const spaceId = stringField(resource.spaceId);
  const resourceId = stringField(resource.id);
  const name = stringField(resource.name);
  if (
    unitId === undefined ||
    type === undefined ||
    nodeId === undefined ||
    spaceId === undefined ||
    resourceId === undefined ||
    name === undefined
  ) {
    throw new WorkspaceApiError(
      "workspace open returned a malformed descriptor",
      502,
      "MALFORMED_OPEN",
    );
  }
  return {
    nodeId,
    resourceId,
    unitId,
    unitType: type,
    name,
    spaceId,
    accessRole: accessRole(resource.accessRole),
    editorMode: resource.editorMode === "readOnly" ? "readOnly" : "edit",
  };
}

/**
 * Narrow the response returned by `GET /api/unit-resources/:unitId`.
 *
 * That endpoint deliberately returns the ordinary Resource/Node summaries;
 * unlike `/resources/:id/open`, a Resource summary has no `unitId`, `nodeId`,
 * `spaceId`, or `editorMode` fields.  Reusing `narrowOpen` here therefore
 * rejected every valid Unit lookup as a malformed open descriptor.  The Unit
 * id is authoritative in the route parameter, while the Node and Resource
 * summaries provide the remaining identity and ACL metadata.
 */
export function narrowUnitResource(raw: unknown, requestedUnitId: string): WorkspaceDocumentOpen {
  const envelope = (raw ?? {}) as Record<string, unknown>;
  const resourceRaw = envelope.resource;
  const nodeRaw = envelope.node;
  if (
    typeof requestedUnitId !== "string" ||
    requestedUnitId.trim() === "" ||
    resourceRaw === null ||
    typeof resourceRaw !== "object" ||
    Array.isArray(resourceRaw) ||
    nodeRaw === null ||
    typeof nodeRaw !== "object" ||
    Array.isArray(nodeRaw)
  ) {
    throw new WorkspaceApiError(
      "workspace unit resource returned a malformed descriptor",
      502,
      "MALFORMED_UNIT_RESOURCE",
    );
  }

  const resource = resourceRaw as Record<string, unknown>;
  const node = nodeRaw as Record<string, unknown>;
  const nodeResourceRaw = node.resource;
  if (
    nodeResourceRaw === null ||
    typeof nodeResourceRaw !== "object" ||
    Array.isArray(nodeResourceRaw)
  ) {
    throw new WorkspaceApiError(
      "workspace unit resource returned a malformed descriptor",
      502,
      "MALFORMED_UNIT_RESOURCE",
    );
  }
  const nodeResource = nodeResourceRaw as Record<string, unknown>;

  const resourceId = stringField(resource.id);
  const nodeId = stringField(node.id);
  const spaceId = stringField(node.spaceId);
  const name = stringField(node.name);
  const type = unitType(resource.unitType);
  const nodeType = unitType(nodeResource.unitType);
  if (
    resource.kind !== "univer" ||
    nodeResource.kind !== "univer" ||
    resourceId === undefined ||
    nodeId === undefined ||
    spaceId === undefined ||
    name === undefined ||
    type === undefined ||
    nodeType !== type ||
    stringField(nodeResource.id) !== resourceId
  ) {
    throw new WorkspaceApiError(
      "workspace unit resource returned a malformed descriptor",
      502,
      "MALFORMED_UNIT_RESOURCE",
    );
  }

  // Some compatible Workspace deployments include the Unit id in the
  // summary; if present, it must agree with the route parameter.  The
  // canonical endpoint does not, so inject the requested id below.
  const embeddedUnitId = resource.unitId;
  if (embeddedUnitId !== undefined && embeddedUnitId !== requestedUnitId) {
    throw new WorkspaceApiError(
      "workspace unit resource returned a mismatched Unit",
      502,
      "MALFORMED_UNIT_RESOURCE",
    );
  }

  const capabilities = resource.capabilities;
  if (
    capabilities !== undefined &&
    (capabilities === null || typeof capabilities !== "object" || Array.isArray(capabilities))
  ) {
    throw new WorkspaceApiError(
      "workspace unit resource returned malformed capabilities",
      502,
      "MALFORMED_UNIT_RESOURCE",
    );
  }
  const editorMode =
    (capabilities as Record<string, unknown> | undefined)?.editContent === true
      ? "edit"
      : "readOnly";
  return {
    nodeId,
    resourceId,
    unitId: requestedUnitId,
    unitType: type,
    name,
    spaceId,
    accessRole: accessRole(node.accessRole),
    editorMode,
  };
}
/** Open one Resource's editor descriptor. */
export async function openResource(
  client: WorkspaceHttpClient,
  resourceId: string,
): Promise<WorkspaceDocumentOpen> {
  const raw = await readJson(
    await client.request(`/api/resources/${encodeURIComponent(resourceId)}/open`, {
      method: "POST",
    }),
    "resource open",
  );
  return narrowOpen(raw);
}

/**
 * Resolve a Unit back to its product Resource and owning Space.
 *
 * Runtime execution receives a Unit id (especially for draft Worktree
 * operations), while the product ACL is expressed in terms of Resource/Node
 * ownership.  The public `/api/unit-resources/{unitId}` endpoint is the
 * canonical bridge for trunk Units; callers must still use the Worktree
 * detail contract for unactivated local Units.
 */
export async function resolveUnitResource(
  client: WorkspaceHttpClient,
  unitId: string,
): Promise<WorkspaceDocumentOpen> {
  const raw = await readJson(
    await client.request(`/api/unit-resources/${encodeURIComponent(unitId)}`),
    "unit resource resolve",
  );
  return narrowUnitResource(raw, unitId);
}
/** A fresh Idempotency-Key for one user intent. */
export function newIdempotencyKey(): string {
  return `uwh-${Date.now().toString(36)}-${randomBytes(12).toString("base64url")}`;
}

/** Request headers carrying an Idempotency-Key plus JSON. */
export function jsonWithIdempotency(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": newIdempotencyKey(),
    },
    body: JSON.stringify(body),
  };
}

/** Narrow a created resource/node answer into `{ resourceId, unitId, nodeId }`. */
export interface CreatedDocument {
  readonly resourceId: string;
  readonly unitId: string;
  readonly nodeId: string;
}

function narrowCreatedNode(raw: unknown): { readonly resourceId: string; readonly nodeId: string } {
  const record = (raw ?? {}) as { node?: unknown };
  const node = (record.node ?? null) as Record<string, unknown> | null;
  const resource = (node?.resource ?? null) as Record<string, unknown> | null;
  const nodeId = typeof node?.id === "string" ? node.id : undefined;
  const resourceId = typeof resource?.id === "string" ? resource.id : undefined;
  if (nodeId === undefined || resourceId === undefined || resource?.kind !== "univer") {
    throw new WorkspaceApiError(
      "workspace resource create returned a malformed node",
      502,
      "MALFORMED_CREATE",
    );
  }
  return { resourceId, nodeId };
}

/** Create a Univer document (a Node carrying a Univer Resource) in a Space.
 *
 * The create answer's Resource summary carries no unitId — the Unit descriptor
 * is resolved by the open endpoint — so creation here is create-then-open. A
 * 202 answer means the Idempotency-Key's operation is still in flight; the
 * same key is re-sent until the server replays the stored completed result.
 */
const CREATE_ATTEMPT_LIMIT = 20;
const CREATE_RETRY_DELAY_MS = 250;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function createDocument(
  client: WorkspaceHttpClient,
  input: {
    spaceId: string;
    parentNodeId: string | null;
    name: string;
    unitType: "sheet" | "doc" | "slide" | "board" | "base";
    initialData?: JsonValue;
  },
): Promise<CreatedDocument> {
  const body = JSON.stringify({
    kind: "univer",
    spaceId: input.spaceId,
    parentNodeId: input.parentNodeId,
    name: input.name,
    unitType: input.unitType,
    ...(input.initialData === undefined ? {} : { initialData: input.initialData }),
  });
  const headers = {
    "content-type": "application/json",
    "Idempotency-Key": newIdempotencyKey(),
  };
  let created: { resourceId: string; nodeId: string } | undefined;
  for (let attempt = 1; ; attempt++) {
    const response = await client.request("/api/resources", { method: "POST", headers, body });
    if (response.status === 202) {
      if (attempt >= CREATE_ATTEMPT_LIMIT) {
        throw new WorkspaceApiError(
          "workspace resource create is still pending",
          504,
          "CREATE_PENDING",
        );
      }
      await delay(CREATE_RETRY_DELAY_MS);
      continue;
    }
    created = narrowCreatedNode(await readJson(response, "resource create"));
    break;
  }
  const open = await openResource(client, created.resourceId);
  return { resourceId: created.resourceId, nodeId: created.nodeId, unitId: open.unitId };
}
