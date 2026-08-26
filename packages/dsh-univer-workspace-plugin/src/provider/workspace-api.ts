/**
 * Typed access to the Univer Workspace product HTTP API over one User's
 * authenticated client.
 *
 * Every function narrows the wire JSON it reads into the plugin's own plain
 * shapes and throws {@link WorkspaceApiError} on an unexpected response, so
 * the provider never leaks `unknown` upward.
 * @module dsh-univer-workspace-plugin/provider/workspace-api
 */

import type { WorkspaceHttpClient } from "@univerjs/univer-workspace-harness";
import type { WorkspaceDocument, WorkspaceDocumentOpen } from "../shared/wire.ts";

/** A Space as returned by the Workspace API, before the dsh link is resolved. */
export interface RemoteSpace {
  readonly spaceId: string;
  readonly type: "personal" | "team";
  readonly name: string;
  readonly accessRole: "owner" | "admin" | "editor" | "viewer";
}

/** An unexpected Workspace API response. */
export class WorkspaceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "WorkspaceApiError";
  }
}

/** Parse a JSON response or throw a typed error. */
async function readJson(response: Response, operation: string): Promise<unknown> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    throw new WorkspaceApiError(
      `workspace ${operation} failed: ${body.error?.message ?? response.statusText}`,
      response.status,
      body.error?.code ?? "WORKSPACE_ERROR",
    );
  }
  return response.json() as unknown;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function accessRole(value: unknown): "owner" | "admin" | "editor" | "viewer" {
  return value === "owner" || value === "admin" || value === "editor" || value === "viewer"
    ? value
    : "viewer";
}

function spaceType(value: unknown): "personal" | "team" {
  return value === "team" ? "team" : "personal";
}

/** Narrow one Space from the `/api/spaces` payload. */
function narrowSpace(raw: unknown): RemoteSpace {
  const record = (raw ?? {}) as Record<string, unknown>;
  const spaceId = stringField(record.id);
  const name = stringField(record.name);
  if (spaceId === undefined || name === undefined) {
    throw new WorkspaceApiError("workspace space list returned a malformed Space", 502, "MALFORMED_SPACE");
  }
  return {
    spaceId,
    type: spaceType(record.type),
    name,
    accessRole: accessRole(record.accessRole),
  };
}

/** Narrow the `/api/spaces` response into the plugin's own shape. */
export function narrowSpaces(raw: unknown): RemoteSpace[] {
  const record = (raw ?? {}) as { spaces?: unknown };
  if (!Array.isArray(record.spaces)) {
    throw new WorkspaceApiError("workspace space list returned no spaces array", 502, "MALFORMED_SPACES");
  }
  return record.spaces.map(space => narrowSpace(space));
}

/** Narrow one Node from the `/api/spaces/{id}/nodes` payload. */
function narrowDocument(raw: unknown): WorkspaceDocument | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const nodeId = stringField(record.id);
  const name = stringField(record.name);
  if (nodeId === undefined || name === undefined) return undefined;
  const resource = (record.resource ?? null) as Record<string, unknown> | null;
  const resourceId = resource !== null ? stringField(resource.id) ?? null : null;
  const kind = resource?.kind;
  const unitTypeRaw = kind === "univer" ? stringField(resource?.unitType) : undefined;
  const unitType = unitTypeRaw === "sheet" || unitTypeRaw === "doc" || unitTypeRaw === "slide" || unitTypeRaw === "board" || unitTypeRaw === "base"
    ? unitTypeRaw
    : null;
  const unitId = resourceId !== null && kind === "univer"
    ? (stringField((record as { resource?: { unitId?: unknown } }).resource?.unitId) ?? null)
    : null;
  return {
    nodeId,
    name,
    resourceId,
    unitId,
    unitType,
    accessRole: accessRole(record.accessRole),
  };
}

/** Narrow the `/api/spaces/{id}/nodes` response. */
export function narrowNodes(raw: unknown, spaceId: string): WorkspaceDocument[] {
  const record = (raw ?? {}) as { nodes?: unknown };
  if (!Array.isArray(record.nodes)) {
    throw new WorkspaceApiError("workspace node list returned no nodes array", 502, "MALFORMED_NODES");
  }
  const documents: WorkspaceDocument[] = [];
  for (const node of record.nodes) {
    const document = narrowDocument(node);
    if (document !== undefined) documents.push(document);
  }
  void spaceId;
  return documents;
}

function unitType(value: unknown): WorkspaceDocumentOpen["unitType"] | undefined {
  return value === "sheet" || value === "doc" || value === "slide" || value === "board" || value === "base"
    ? value
    : undefined;
}

/** Narrow the `/api/resources/{id}/open` response. */
export function narrowOpen(raw: unknown): WorkspaceDocumentOpen {
  const record = (raw ?? {}) as { resource?: unknown };
  const resource = (record.resource ?? null) as Record<string, unknown> | null;
  if (resource === null || resource.kind !== "univer") {
    throw new WorkspaceApiError("workspace open returned a non-Univer resource", 502, "MALFORMED_OPEN");
  }
  const unitId = stringField(resource.unitId);
  const type = unitType(resource.unitType);
  const nodeId = stringField(resource.nodeId);
  const spaceId = stringField(resource.spaceId);
  const resourceId = stringField(resource.id);
  const name = stringField(resource.name);
  if (unitId === undefined || type === undefined || nodeId === undefined || spaceId === undefined || resourceId === undefined || name === undefined) {
    throw new WorkspaceApiError("workspace open returned a malformed descriptor", 502, "MALFORMED_OPEN");
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

/** List the current User's Spaces. */
export async function listSpaces(client: WorkspaceHttpClient): Promise<RemoteSpace[]> {
  const raw = await readJson(await client.request("/api/spaces"), "space list");
  return narrowSpaces(raw);
}

/** List a Space's root documents. */
export async function listSpaceDocuments(client: WorkspaceHttpClient, spaceId: string): Promise<WorkspaceDocument[]> {
  const raw = await readJson(await client.request(`/api/spaces/${encodeURIComponent(spaceId)}/nodes`), "node list");
  return narrowNodes(raw, spaceId);
}

/** Open one Resource's editor descriptor. */
export async function openResource(client: WorkspaceHttpClient, resourceId: string): Promise<WorkspaceDocumentOpen> {
  const raw = await readJson(
    await client.request(`/api/resources/${encodeURIComponent(resourceId)}/open`, { method: "POST" }),
    "resource open",
  );
  return narrowOpen(raw);
}
