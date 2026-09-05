/**
 * Space and Node discovery against the authenticated Workspace API.
 * @module dsh-univer-workspace-plugin/provider/spaces-api
 */

import type { WorkspaceHttpClient } from "./workspace-contract.ts";
import type { DocumentListOptions, WorkspaceDocument } from "../shared/wire.ts";
import { WorkspaceApiError, accessRole, readJson, stringField } from "./api-errors.ts";

/** A Space as returned by the Workspace API, before the dsh link is resolved. */
export interface RemoteSpace {
  readonly spaceId: string;
  readonly type: "personal" | "team";
  readonly name: string;
  readonly accessRole: "owner" | "admin" | "editor" | "viewer";
  readonly capabilities?: Readonly<Record<string, boolean>>;
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
    throw new WorkspaceApiError(
      "workspace space list returned a malformed Space",
      502,
      "MALFORMED_SPACE",
    );
  }
  const capabilities =
    record.capabilities !== null && typeof record.capabilities === "object"
      ? (Object.fromEntries(
          Object.entries(record.capabilities as Record<string, unknown>).filter(
            ([, value]) => typeof value === "boolean",
          ),
        ) as Record<string, boolean>)
      : undefined;
  return {
    spaceId,
    type: spaceType(record.type),
    name,
    accessRole: accessRole(record.accessRole),
    ...(capabilities === undefined ? {} : { capabilities }),
  };
}

/** Narrow the `/api/spaces` response into the plugin's own shape. */
export function narrowSpaces(raw: unknown): RemoteSpace[] {
  const record = (raw ?? {}) as { spaces?: unknown };
  if (!Array.isArray(record.spaces)) {
    throw new WorkspaceApiError(
      "workspace space list returned no spaces array",
      502,
      "MALFORMED_SPACES",
    );
  }
  return record.spaces.map((space) => narrowSpace(space));
}
/** A page returned by either the Space-root or Node-children endpoint. */
export interface WorkspaceNodePage {
  readonly documents: WorkspaceDocument[];
  readonly nextCursor: string | null;
}

/** Narrow one Node from a Workspace node-page payload. */
function narrowDocument(raw: unknown, spaceId: string): WorkspaceDocument | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const nodeId = stringField(record.id);
  const name = stringField(record.name);
  if (nodeId === undefined || name === undefined) return undefined;
  const rawSpaceId = stringField(record.spaceId);
  if (rawSpaceId !== undefined && rawSpaceId !== spaceId) {
    throw new WorkspaceApiError(
      "workspace node list returned a node from another Space",
      502,
      "MALFORMED_NODES",
    );
  }
  const rawParentNodeId = record.parentNodeId;
  const parentNodeId =
    rawParentNodeId === null || rawParentNodeId === undefined
      ? null
      : (stringField(rawParentNodeId) ?? null);
  if (rawParentNodeId !== undefined && rawParentNodeId !== null && parentNodeId === null) {
    throw new WorkspaceApiError(
      "workspace node list returned a malformed parentNodeId",
      502,
      "MALFORMED_NODES",
    );
  }
  const resource = (record.resource ?? null) as Record<string, unknown> | null;
  const resourceId = resource !== null ? (stringField(resource.id) ?? null) : null;
  const kind = resource?.kind;
  const resourceKind = kind === "univer" || kind === "blob" ? kind : null;
  const unitTypeRaw = kind === "univer" ? stringField(resource?.unitType) : undefined;
  const unitType =
    unitTypeRaw === "sheet" ||
    unitTypeRaw === "doc" ||
    unitTypeRaw === "slide" ||
    unitTypeRaw === "board" ||
    unitTypeRaw === "base"
      ? unitTypeRaw
      : null;
  // Node-list Resource summaries carry no unitId (the Unit descriptor is only
  // resolved by the open endpoint), so the list answer leaves it null and
  // consumers call univer_open per resource.
  const unitId = null;
  const nodeCapabilities =
    record.capabilities !== null && typeof record.capabilities === "object"
      ? (record.capabilities as Record<string, boolean>)
      : undefined;
  const resourceCapabilities =
    resource?.capabilities !== null && typeof resource?.capabilities === "object"
      ? (resource.capabilities as Record<string, boolean>)
      : undefined;
  const mediaType = resourceKind === "blob" ? stringField(resource?.mediaType) : undefined;
  const byteSize =
    resourceKind === "blob" && typeof resource?.byteSize === "number"
      ? resource.byteSize
      : undefined;
  const availability =
    resourceKind === "blob" &&
    (resource?.availability === "ready" || resource?.availability === "quarantined")
      ? resource.availability
      : undefined;
  return {
    nodeId,
    name,
    parentNodeId,
    hasChildren: record.hasChildren === true,
    updatedAt: stringField(record.updatedAt) ?? null,
    resourceId,
    resourceKind,
    ...(mediaType === undefined ? {} : { mediaType }),
    ...(byteSize === undefined ? {} : { byteSize }),
    ...(availability === undefined ? {} : { availability }),
    unitId,
    unitType,
    accessRole: accessRole(record.accessRole),
    ...(nodeCapabilities === undefined ? {} : { nodeCapabilities }),
    ...(resourceCapabilities === undefined ? {} : { resourceCapabilities }),
  };
}

function nextCursorOf(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value === "") {
    throw new WorkspaceApiError(
      "workspace node list returned an invalid nextCursor",
      502,
      "MALFORMED_NODES",
    );
  }
  return value;
}

/** Narrow one root/children page, retaining its pagination cursor. */
export function narrowNodePage(raw: unknown, spaceId: string): WorkspaceNodePage {
  const record = (raw ?? {}) as { nodes?: unknown; nextCursor?: unknown };
  if (!Array.isArray(record.nodes)) {
    throw new WorkspaceApiError(
      "workspace node list returned no nodes array",
      502,
      "MALFORMED_NODES",
    );
  }
  const documents: WorkspaceDocument[] = [];
  for (const node of record.nodes) {
    const document = narrowDocument(node, spaceId);
    if (document !== undefined) documents.push(document);
  }
  return { documents, nextCursor: nextCursorOf(record.nextCursor) };
}

/** Backwards-compatible one-page narrowing helper. */
export function narrowNodes(raw: unknown, spaceId: string): WorkspaceDocument[] {
  return narrowNodePage(raw, spaceId).documents;
}
/** List the current User's Spaces. */
export async function listSpaces(client: WorkspaceHttpClient): Promise<RemoteSpace[]> {
  const raw = await readJson(await client.request("/api/spaces"), "space list");
  return narrowSpaces(raw);
}
/** Maximum number of product pages walked by one list request. */
export const NODE_LIST_MAX_PAGES = 1_000;
/** Maximum number of unique Nodes returned by one list request. */
export const NODE_LIST_MAX_NODES = 50_000;
const NODE_LIST_PAGE_LIMIT = 100;

interface NodeQueueEntry {
  readonly nodeId: string;
}

/**
 * List every Node below a Space, not just its first root page.
 *
 * The Workspace API deliberately exposes a paged root endpoint and a separate
 * paged children endpoint.  A root-only request silently loses documents in
 * folders, and ignoring `nextCursor` loses Spaces with more than one page.
 * Walk both edges, de-duplicate ids defensively, and fail with a typed error
 * when a corrupt/repeating cursor or an unexpectedly huge tree would make a
 * request unbounded.
 */
export async function listSpaceDocuments(
  client: WorkspaceHttpClient,
  spaceId: string,
  options: DocumentListOptions = {},
): Promise<WorkspaceDocument[]> {
  if (spaceId.trim() === "") {
    throw new WorkspaceApiError("workspace node list requires a Space id", 400, "INVALID_SPACE_ID");
  }
  const documents: WorkspaceDocument[] = [];
  const seen = new Set<string>();
  const folders: NodeQueueEntry[] = [];
  let pages = 0;

  const appendPage = (page: WorkspaceNodePage): void => {
    pages += 1;
    if (pages > NODE_LIST_MAX_PAGES) {
      throw new WorkspaceApiError(
        "workspace node list exceeded the page safety limit",
        502,
        "NODE_LIST_TOO_LARGE",
      );
    }
    for (const document of page.documents) {
      if (seen.has(document.nodeId)) continue;
      seen.add(document.nodeId);
      documents.push(document);
      if (document.hasChildren) folders.push({ nodeId: document.nodeId });
      if (documents.length > NODE_LIST_MAX_NODES) {
        throw new WorkspaceApiError(
          "workspace node list exceeded the node safety limit",
          502,
          "NODE_LIST_TOO_LARGE",
        );
      }
    }
  };

  const readPage = async (path: string, operation: string): Promise<WorkspaceNodePage> => {
    const raw = await readJson(await client.request(path), operation);
    return narrowNodePage(raw, spaceId);
  };

  if (options.recursive === false) {
    let cursor: string | null = null;
    const cursors = new Set<string>();
    do {
      if (cursor !== null) {
        if (cursors.has(cursor)) {
          throw new WorkspaceApiError(
            "workspace node list returned a repeating nextCursor",
            502,
            "MALFORMED_NODES",
          );
        }
        cursors.add(cursor);
      }
      const query = new URLSearchParams({ limit: String(NODE_LIST_PAGE_LIMIT) });
      if (cursor !== null) query.set("cursor", cursor);
      const parentNodeId = options.parentNodeId ?? null;
      const path =
        parentNodeId === null
          ? `/api/spaces/${encodeURIComponent(spaceId)}/nodes?${query.toString()}`
          : `/api/nodes/${encodeURIComponent(parentNodeId)}/children?${query.toString()}`;
      const page = await readPage(path, parentNodeId === null ? "node list" : "node children list");
      appendPage(page);
      cursor = page.nextCursor;
    } while (cursor !== null);
    return filterDocumentProperties(documents, options);
  }

  // Root pages must be consumed before descending so the returned order is
  // stable (the product's root ordering followed by each folder's ordering).
  let cursor: string | null = null;
  const rootCursors = new Set<string>();
  do {
    if (cursor !== null) {
      if (rootCursors.has(cursor)) {
        throw new WorkspaceApiError(
          "workspace node list returned a repeating nextCursor",
          502,
          "MALFORMED_NODES",
        );
      }
      rootCursors.add(cursor);
    }
    const query = new URLSearchParams({ limit: String(NODE_LIST_PAGE_LIMIT) });
    if (cursor !== null) query.set("cursor", cursor);
    const page = await readPage(
      `/api/spaces/${encodeURIComponent(spaceId)}/nodes?${query.toString()}`,
      "node list",
    );
    appendPage(page);
    const next = page.nextCursor;
    cursor = next;
  } while (cursor !== null);

  // Descend breadth-first.  Each folder has its own cursor stream; a cursor
  // from one parent is never reused for another parent.
  for (let index = 0; index < folders.length; index += 1) {
    const folder = folders[index]!;
    let childCursor: string | null = null;
    const childCursors = new Set<string>();
    do {
      if (childCursor !== null) {
        if (childCursors.has(childCursor)) {
          throw new WorkspaceApiError(
            "workspace node children list returned a repeating nextCursor",
            502,
            "MALFORMED_NODES",
          );
        }
        childCursors.add(childCursor);
      }
      const query = new URLSearchParams({ limit: String(NODE_LIST_PAGE_LIMIT) });
      if (childCursor !== null) query.set("cursor", childCursor);
      const page = await readPage(
        `/api/nodes/${encodeURIComponent(folder.nodeId)}/children?${query.toString()}`,
        "node children list",
      );
      appendPage(page);
      const next = page.nextCursor;
      childCursor = next;
    } while (childCursor !== null);
  }
  const parentNodeId = options.parentNodeId === undefined ? null : options.parentNodeId;
  let selected = documents;
  if (options.parentNodeId !== undefined) {
    const descendants = new Set<string>();
    let frontier = documents
      .filter((document) => document.parentNodeId === parentNodeId)
      .map((document) => document.nodeId);
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const id of frontier) {
        if (descendants.has(id)) continue;
        descendants.add(id);
        for (const document of documents)
          if (document.parentNodeId === id) next.push(document.nodeId);
      }
      frontier = next;
    }
    selected = documents.filter((document) => descendants.has(document.nodeId));
  }
  return filterDocumentProperties(selected, options);
}

function filterDocumentProperties(
  documents: readonly WorkspaceDocument[],
  options: DocumentListOptions,
): WorkspaceDocument[] {
  let selected = [...documents];
  const query = options.query?.trim().toLocaleLowerCase();
  if (query !== undefined && query !== "") {
    selected = selected.filter((document) => document.name.toLocaleLowerCase().includes(query));
  }
  if (options.resourceKind !== undefined && options.resourceKind !== "all") {
    selected = selected.filter((document) =>
      options.resourceKind === "folder"
        ? document.resourceKind === null
        : document.resourceKind === options.resourceKind,
    );
  }
  if (options.unitType !== undefined) {
    selected = selected.filter((document) => document.unitType === options.unitType);
  }
  return selected;
}
