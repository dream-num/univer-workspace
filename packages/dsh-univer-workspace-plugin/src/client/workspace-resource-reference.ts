/**
 * Workspace Resource references for the native DSH composer.
 *
 * This module owns only the stable Resource reference, send-time ACL refresh,
 * and the public Session-input adapter. Candidate discovery and visible entry
 * points are deliberately separate product decisions.
 * @module dsh-univer-workspace-plugin/client/workspace-resource-reference
 */

import type { ISessions } from "@deepseek-ai/dsh-api-session-controller/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type {
  IConversation,
  ReferenceInsert,
  SessionInput,
  SessionInputResolver,
} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { ReferenceCodec } from "@deepseek-ai/dsh-client-ui-input-trigger/client";
import type {
  CandidateRequest,
  HeaderRequest,
  InputTriggerCandidate,
  InputTriggerCrumb,
  InputTriggerSource,
} from "@deepseek-ai/dsh-client-ui-input-trigger/client";
import type { ViewerSelection } from "./viewer/contracts.ts";

export const WORKSPACE_RESOURCE_REFERENCE_SOURCE = "univer-workspace-resource";
export const WORKSPACE_RESOURCE_PROXY_PATH = "/univer-workspace/api/resources";

type WorkspaceUnitType = "sheet" | "doc" | "slide" | "board" | "base";
type WorkspaceAccessRole = "owner" | "admin" | "editor" | "viewer";

/** Current authoritative Resource identity returned by Workspace. */
export interface WorkspaceResourceDescriptor {
  readonly resourceId: string;
  readonly unitId: string;
  readonly unitType: WorkspaceUnitType;
  readonly nodeId: string;
  readonly spaceId: string;
  readonly name: string;
  readonly accessRole: WorkspaceAccessRole;
  /** Optional display-only location supplied by discovery projections. */
  readonly location?: {
    readonly spaceName: string;
    readonly breadcrumbs: readonly string[];
  };
}

/** Insert-time value. `label` is display cache only; `resourceId` is identity. */
export interface WorkspaceResourceReferenceValue {
  readonly resourceId: string;
  readonly label: string;
  readonly selection?: ViewerSelection;
}

/** Explicit public DSH faces needed by the Session insertion adapter. */
export interface WorkspaceResourceReferenceContext {
  readonly sessions: ISessions;
  readonly conversation: Pick<IConversation, "input">;
}

export type WorkspaceResourceReferenceInsertResult =
  | { readonly kind: "inserted" }
  | { readonly kind: "session-unavailable" }
  | {
      readonly kind: "input-busy";
      readonly phase: "adjudicating" | "claimed" | "submitting";
    }
  | { readonly kind: "input-changed" };

export type WorkspaceResourceResolver = (
  resourceId: string,
  signal: AbortSignal,
) => Promise<WorkspaceResourceDescriptor>;

/** Result of upgrading persisted clipboard projections into native chips. */
export interface WorkspaceResourceDraftMigrationResult {
  readonly migrated: number;
  readonly skipped: number;
}

/** Discovery seam for the native @ menu; the product may provide A or D later. */
export type WorkspaceResourceCandidateResolver = (
  sessionId: string,
  request: CandidateRequest,
) => Promise<readonly WorkspaceResourceDescriptor[]>;

export interface WorkspaceResourceInputSourceLabels {
  readonly workspace: string;
  readonly browseWorkspace: string;
  readonly personalSpace: string;
  readonly teamSpace: string;
  readonly retry: string;
}

const DEFAULT_INPUT_SOURCE_LABELS: WorkspaceResourceInputSourceLabels = {
  workspace: "Workspace",
  browseWorkspace: "Browse Workspace",
  personalSpace: "Personal Space",
  teamSpace: "Team Space",
  retry: "Retry",
};

const UNIT_TYPES = new Set<WorkspaceUnitType>(["sheet", "doc", "slide", "board", "base"]);
const ACCESS_ROLES = new Set<WorkspaceAccessRole>(["owner", "admin", "editor", "viewer"]);

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function malformed(): never {
  throw new Error("workspace_resource_malformed");
}

/** Strictly narrow `GET /api/resources/{resourceId}`. */
export function narrowWorkspaceResourceDescriptor(
  raw: unknown,
  requestedResourceId: string,
): WorkspaceResourceDescriptor {
  const envelope = record(raw);
  const resource = record(envelope?.resource);
  const node = record(envelope?.node);
  const nodeResource = record(node?.resource);
  if (
    resource === undefined ||
    node === undefined ||
    nodeResource === undefined ||
    resource.kind !== "univer" ||
    nodeResource.kind !== "univer"
  ) {
    return malformed();
  }

  const resourceId = nonEmptyString(resource.id);
  const nodeResourceId = nonEmptyString(nodeResource.id);
  const unitId = nonEmptyString(resource.unitId);
  const nodeUnitId = nonEmptyString(nodeResource.unitId);
  const unitType = resource.unitType;
  const nodeUnitType = nodeResource.unitType;
  const nodeId = nonEmptyString(node.id);
  const spaceId = nonEmptyString(node.spaceId);
  const name = nonEmptyString(node.name);
  const accessRole = node.accessRole;

  if (
    resourceId === undefined ||
    resourceId !== requestedResourceId ||
    nodeResourceId !== resourceId ||
    unitId === undefined ||
    nodeUnitId !== unitId ||
    !UNIT_TYPES.has(unitType as WorkspaceUnitType) ||
    nodeUnitType !== unitType ||
    nodeId === undefined ||
    spaceId === undefined ||
    name === undefined ||
    !ACCESS_ROLES.has(accessRole as WorkspaceAccessRole)
  ) {
    return malformed();
  }

  return {
    resourceId,
    unitId,
    unitType: unitType as WorkspaceUnitType,
    nodeId,
    spaceId,
    name,
    accessRole: accessRole as WorkspaceAccessRole,
  };
}

/** Re-read one Resource through the authenticated same-origin product proxy. */
export async function fetchWorkspaceResourceDescriptor(
  resourceId: string,
  signal: AbortSignal,
): Promise<WorkspaceResourceDescriptor> {
  const response = await fetch(
    `${WORKSPACE_RESOURCE_PROXY_PATH}/${encodeURIComponent(resourceId)}`,
    {
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal,
    },
  );
  if (response.status === 401) throw new Error("workspace_connection_required");
  if (response.status === 403 || response.status === 404) {
    throw new Error("workspace_resource_unavailable");
  }
  if (!response.ok) throw new Error(`workspace_resource_lookup_failed:${response.status}`);
  return narrowWorkspaceResourceDescriptor(await response.json(), resourceId);
}

/**
 * Encode one source-owned ref. The label survives copy/draft projection but is
 * never trusted as identity or model metadata; serialization re-fetches it.
 */
export function encodeWorkspaceResourceReference(value: WorkspaceResourceReferenceValue): string {
  if (value.resourceId === "" || value.label === "") throw new Error("workspace_reference_invalid");
  return JSON.stringify({
    v: 1,
    resourceId: value.resourceId,
    label: value.label,
    ...(value.selection === undefined ? {} : { selection: value.selection }),
  });
}

/** Decode and validate the source-owned ref. */
export function decodeWorkspaceResourceReference(ref: string): WorkspaceResourceReferenceValue {
  let value: unknown;
  try {
    value = JSON.parse(ref);
  } catch {
    throw new Error("workspace_reference_invalid");
  }
  const decoded = record(value);
  const resourceId = nonEmptyString(decoded?.resourceId);
  const label = nonEmptyString(decoded?.label);
  const selection = narrowViewerSelection(decoded?.selection);
  if (decoded?.v !== 1 || resourceId === undefined || label === undefined) {
    throw new Error("workspace_reference_invalid");
  }
  return selection === undefined ? { resourceId, label } : { resourceId, label, selection };
}

function narrowViewerSelection(value: unknown): ViewerSelection | undefined {
  if (value === undefined) return undefined;
  const candidate = record(value);
  if (candidate?.kind === "sheet-range") {
    const sheetName = nonEmptyString(candidate.sheetName);
    const a1Notation = nonEmptyString(candidate.a1Notation);
    return sheetName === undefined || a1Notation === undefined
      ? malformedSelection()
      : { kind: "sheet-range", sheetName, a1Notation };
  }
  if (candidate?.kind === "text") {
    const text = nonEmptyString(candidate.text);
    return text === undefined ? malformedSelection() : { kind: "text", text };
  }
  return malformedSelection();
}

function malformedSelection(): never {
  throw new Error("workspace_reference_invalid");
}

function escapeMarkdownLabel(label: string): string {
  return label.replaceAll("\\", "\\\\").replaceAll("]", "\\]");
}

/** Human-readable clipboard/draft projection retaining the stable Resource id. */
export function workspaceResourceClipboardText(ref: string): string {
  const value = decodeWorkspaceResourceReference(ref);
  const suffix =
    value.selection === undefined
      ? ""
      : ` · ${value.selection.kind === "sheet-range" ? `${value.selection.sheetName}!${value.selection.a1Notation}` : value.selection.text}`;
  return `@[${escapeMarkdownLabel(`${value.label}${suffix}`)}](univer-workspace-resource:${encodeURIComponent(value.resourceId)})`;
}

/**
 * Project model-facing Workspace Resource wire objects for the native Chat UI.
 *
 * Resource references are intentionally serialized as authoritative JSON for
 * the agent. The stock DSH user-message renderer, however, can only fold its
 * own `dsh-session` wire form. This display-only projection keeps the durable
 * message/model text untouched while letting that renderer show a compact
 * human label instead of leaking internal ids into the bubble.
 */
export function projectWorkspaceResourceMessageText(text: string): string {
  let output = "";
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf("{", cursor);
    if (start < 0) return output + text.slice(cursor);
    const end = balancedJsonObjectEnd(text, start);
    if (end === undefined) return output + text.slice(cursor);
    output += text.slice(cursor, start);
    const candidate = text.slice(start, end);
    output += workspaceResourceMessageProjection(candidate) ?? candidate;
    cursor = end;
  }
  return output;
}

function balancedJsonObjectEnd(text: string, start: number): number | undefined {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return index + 1;
  }
  return undefined;
}

function workspaceResourceMessageProjection(value: string): string | undefined {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const resourceId = nonEmptyString(
      parsed.kind === "univer-workspace-resource" ? parsed.resourceId : undefined,
    );
    const name = nonEmptyString(
      parsed.kind === "univer-workspace-resource" ? parsed.name : undefined,
    );
    if (resourceId === undefined || name === undefined) return undefined;
    return `@[${escapeMarkdownLabel(name)}](dsh-session:univer-workspace-resource:${encodeURIComponent(resourceId)})`;
  } catch {
    return undefined;
  }
}

/** Build the native DSH structured-reference payload for a known Resource. */
export function createWorkspaceResourceReferenceInsert(
  resource: Pick<WorkspaceResourceDescriptor, "resourceId" | "name">,
  selection?: ViewerSelection,
): ReferenceInsert {
  const ref = encodeWorkspaceResourceReference({
    resourceId: resource.resourceId,
    label: resource.name,
    ...(selection === undefined ? {} : { selection }),
  });
  return {
    source: WORKSPACE_RESOURCE_REFERENCE_SOURCE,
    ref,
    label: resource.name,
    appearance: "file",
    clipboardText: workspaceResourceClipboardText(ref),
  };
}

const PERSISTED_RESOURCE_REFERENCE =
  /@\[((?:\\.|[^\]])+)\]\(univer-workspace-resource:([A-Za-z0-9%._~-]+)\)/g;

function unescapeMarkdownLabel(label: string): string {
  return label.replaceAll(/\\([\\\]])/g, "$1");
}

function selectionFromClipboardLabel(label: string): ViewerSelection | undefined {
  const separator = label.lastIndexOf(" · ");
  if (separator <= 0) return undefined;
  const suffix = label.slice(separator + 3);
  const bang = suffix.lastIndexOf("!");
  if (bang <= 0) return undefined;
  const sheetName = suffix.slice(0, bang).trim();
  const a1Notation = suffix.slice(bang + 1).trim();
  return sheetName === "" || !/^[A-Z]+[1-9][0-9]*(?::[A-Z]+[1-9][0-9]*)?$/.test(a1Notation)
    ? undefined
    : { kind: "sheet-range", sheetName, a1Notation };
}

function resolveSessionInput(
  ctx: WorkspaceResourceReferenceContext,
  sessionId: string,
): SessionInput | undefined {
  const sessionScope = ctx.sessions.scope(sessionId as SessionId);
  if (sessionScope === undefined) return undefined;
  const rootInput = (
    ctx.conversation as unknown as {
      input?: SessionInputResolver | SessionInput;
    }
  ).input;
  const scopedConversation = (
    sessionScope as unknown as {
      get?: (name: string) => Pick<IConversation, "input"> | undefined;
    }
  ).get?.("conversation");
  const scopedInput = scopedConversation?.input as SessionInputResolver | SessionInput | undefined;
  const resolve = (
    value: SessionInputResolver | SessionInput | undefined,
  ): SessionInput | undefined => {
    if (value === undefined) return undefined;
    const resolver = value as Partial<SessionInputResolver>;
    return typeof resolver.for === "function"
      ? resolver.for(sessionScope)
      : (value as SessionInput);
  };
  return resolve(rootInput) ?? resolve(scopedInput);
}

function detectOffsetAtClipboardOffset(
  snapshot: {
    readonly draft: string;
    readonly occurrences?: readonly { readonly offset: number; readonly length: number }[];
  },
  clipboardOffset: number,
): number {
  let offset = clipboardOffset;
  for (const occurrence of snapshot.occurrences ?? []) {
    const consumed = Math.max(0, Math.min(occurrence.length, clipboardOffset - occurrence.offset));
    if (consumed > 0) offset -= Math.max(0, consumed - 1);
  }
  return offset;
}

/**
 * Upgrade the alpha.4 persisted clipboard projection to native DSH chips.
 *
 * DSH intentionally persists the human-readable `clipboardText` projection of
 * a reference.  The projection is useful for copy/paste, but rendering it as
 * plain text loses the structured resource affordance after a reload.  This
 * adapter only recognizes the exact projection emitted by this package,
 * re-reads each Resource authoritatively, and applies guarded native inserts.
 */
export async function migrateWorkspaceResourceDraftReferences(
  ctx: WorkspaceResourceReferenceContext,
  sessionId: string,
  resolve: WorkspaceResourceResolver = fetchWorkspaceResourceDescriptor,
): Promise<WorkspaceResourceDraftMigrationResult> {
  const input = resolveSessionInput(ctx, sessionId);
  if (input === undefined) return { migrated: 0, skipped: 0 };
  const initial = input.state.getSnapshot();
  if (initial.phase !== "plain" || initial.draft === "") return { migrated: 0, skipped: 0 };

  const matches = [...initial.draft.matchAll(PERSISTED_RESOURCE_REFERENCE)];
  if (matches.length === 0) return { migrated: 0, skipped: 0 };
  let migrated = 0;
  let skipped = 0;
  const controller = new AbortController();
  try {
    for (const match of matches.reverse()) {
      const rawLabel = match[1];
      const encodedResourceId = match[2];
      if (rawLabel === undefined || encodedResourceId === undefined || match.index === undefined) {
        skipped += 1;
        continue;
      }
      let resourceId: string;
      try {
        resourceId = decodeURIComponent(encodedResourceId);
      } catch {
        skipped += 1;
        continue;
      }
      const label = unescapeMarkdownLabel(rawLabel);
      const snapshot = input.state.getSnapshot();
      if (
        snapshot.phase !== "plain" ||
        snapshot.draft.slice(match.index, match.index + match[0].length) !== match[0]
      ) {
        skipped += 1;
        continue;
      }
      try {
        const resource = await resolve(resourceId, controller.signal);
        const selection = selectionFromClipboardLabel(label);
        const inserted = input.insertReference(
          createWorkspaceResourceReferenceInsert(resource, selection),
          {
            start: detectOffsetAtClipboardOffset(snapshot, match.index),
            end: detectOffsetAtClipboardOffset(snapshot, match.index + match[0].length),
            draftRev: snapshot.draftRev,
          },
        );
        if (inserted) migrated += 1;
        else skipped += 1;
      } catch {
        skipped += 1;
      }
    }
  } finally {
    controller.abort();
  }
  return { migrated, skipped };
}

const DISCOVERY_API = "/univer-workspace/api";
const DISCOVERY_LIMIT = 50;
const DISCOVERY_CACHE_TTL_MS = 30_000;
const WORKSPACE_BROWSE_PREFIX = "workspace:";

interface ResourceDiscoveryCacheEntry {
  readonly loadedAt: number;
  readonly resources: readonly WorkspaceResourceDescriptor[];
}

interface BrowseSegment {
  readonly kind: "space" | "folder";
  readonly id: string;
  readonly name: string;
}

interface BrowsePath {
  readonly segments: readonly BrowseSegment[];
  readonly term: string;
}

interface WorkspaceDiscoverySpace {
  readonly spaceId: string;
  readonly type: "personal" | "team";
  readonly name: string;
}

interface WorkspaceDiscoveryDocument {
  readonly nodeId: string;
  readonly name: string;
  readonly parentNodeId: string | null;
  readonly hasChildren: boolean;
  readonly resourceId: string | null;
  readonly unitId: string | null;
  readonly unitType: WorkspaceUnitType | null;
  readonly accessRole: WorkspaceAccessRole;
}

/** Encode a human-readable browse path while retaining stable node identities. */
export function encodeWorkspaceBrowsePath(segments: readonly BrowseSegment[]): string {
  if (segments.length === 0) return WORKSPACE_BROWSE_PREFIX;
  return `${WORKSPACE_BROWSE_PREFIX}${segments
    .map(({ kind, id, name }) => `${kind}:${encodeURIComponent(id)}:${encodeURIComponent(name)}`)
    .join("/")}/`;
}

function parseWorkspaceBrowseQuery(query: string): BrowsePath | undefined {
  if (!query.startsWith(WORKSPACE_BROWSE_PREFIX)) return undefined;
  const parts = query.slice(WORKSPACE_BROWSE_PREFIX.length).split("/");
  const trailing = parts.at(-1) ?? "";
  const encodedSegments = trailing === "" ? parts.slice(0, -1) : parts;
  const segments: BrowseSegment[] = [];
  for (const encoded of encodedSegments) {
    const separator = encoded.indexOf(":");
    const secondSeparator = encoded.indexOf(":", separator + 1);
    if (separator <= 0 || secondSeparator <= separator + 1) return undefined;
    const kind = encoded.slice(0, separator);
    if (kind !== "space" && kind !== "folder") return undefined;
    try {
      const id = decodeURIComponent(encoded.slice(separator + 1, secondSeparator));
      const name = decodeURIComponent(encoded.slice(secondSeparator + 1));
      if (id === "" || name === "") return undefined;
      segments.push({ kind, id, name });
    } catch {
      return undefined;
    }
  }
  return { segments, term: trailing === "" ? "" : trailing };
}

function workspaceBrowseCrumbs(
  path: BrowsePath,
  labels: WorkspaceResourceInputSourceLabels,
): readonly InputTriggerCrumb[] | undefined {
  if (path.segments.length === 0) {
    return path.term === ""
      ? [{ label: labels.workspace, value: browseValue([]), current: true }]
      : undefined;
  }
  return [
    { label: labels.workspace, value: browseValue([]) },
    ...path.segments.map((segment, index) => ({
      label: segment.name,
      value: browseValue(path.segments.slice(0, index + 1)),
      current: index === path.segments.length - 1,
    })),
  ];
}

function browseValue(path: readonly BrowseSegment[]): string {
  return JSON.stringify({ v: 1, kind: "browse", path });
}

function decodeBrowseValue(value: string): readonly BrowseSegment[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  const object = record(parsed);
  if (object?.v !== 1 || object.kind !== "browse" || !Array.isArray(object.path)) return undefined;
  const path: BrowseSegment[] = [];
  for (const entry of object.path) {
    const segment = record(entry);
    if (
      (segment?.kind !== "space" && segment?.kind !== "folder") ||
      typeof segment.id !== "string" ||
      segment.id === "" ||
      typeof segment.name !== "string" ||
      segment.name === ""
    ) {
      return undefined;
    }
    path.push({ kind: segment.kind, id: segment.id, name: segment.name });
  }
  if (path.length > 0 && path[0]!.kind !== "space") return undefined;
  if (path.slice(1).some((segment) => segment.kind !== "folder")) return undefined;
  return path;
}

function resourceDescription(resource: WorkspaceResourceDescriptor): string | undefined {
  if (resource.location === undefined) return resource.spaceId;
  const path = [resource.location.spaceName, ...resource.location.breadcrumbs];
  return path.join(" / ");
}

function resourceCandidate(resource: WorkspaceResourceDescriptor): InputTriggerCandidate {
  const description = resourceDescription(resource);
  return {
    name: resource.name,
    ...(description === undefined ? {} : { description }),
    icon: "file",
    value: encodeWorkspaceResourceReference({
      resourceId: resource.resourceId,
      label: resource.name,
    }),
  };
}

function browseSpaceDescription(
  space: WorkspaceDiscoverySpace,
  labels: WorkspaceResourceInputSourceLabels,
): string {
  return space.type === "personal" ? labels.personalSpace : labels.teamSpace;
}

async function fetchDiscoveryJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${DISCOVERY_API}${path}`, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
    signal,
  });
  if (response.status === 401) throw new Error("workspace_connection_required");
  if (!response.ok) throw new Error(`workspace_resource_discovery_failed:${response.status}`);
  return (await response.json()) as T;
}

function descriptorFromProjection(item: unknown): WorkspaceResourceDescriptor | undefined {
  const object = record(item);
  const node = record(object?.node);
  const resource = record(object?.resource);
  const location = record(object?.location);
  const space = record(location?.space);
  const breadcrumbs = Array.isArray(location?.breadcrumbs) ? location.breadcrumbs : undefined;
  if (
    node === undefined ||
    resource === undefined ||
    resource.kind !== "univer" ||
    typeof resource.id !== "string" ||
    typeof resource.unitId !== "string" ||
    !UNIT_TYPES.has(resource.unitType as WorkspaceUnitType) ||
    typeof node.id !== "string" ||
    typeof node.spaceId !== "string" ||
    typeof node.name !== "string" ||
    !ACCESS_ROLES.has(node.accessRole as WorkspaceAccessRole)
  ) {
    return undefined;
  }
  const descriptor: WorkspaceResourceDescriptor = {
    resourceId: resource.id,
    unitId: resource.unitId,
    unitType: resource.unitType as WorkspaceUnitType,
    nodeId: node.id,
    spaceId: node.spaceId,
    name: node.name,
    accessRole: node.accessRole as WorkspaceAccessRole,
  };
  const displayLocation =
    typeof space?.name === "string" &&
    breadcrumbs !== undefined &&
    breadcrumbs.every((entry) => {
      const crumb = record(entry);
      return typeof crumb?.name === "string";
    })
      ? {
          spaceName: space.name,
          breadcrumbs: breadcrumbs.map((entry) => (record(entry) as { name: string }).name),
        }
      : undefined;
  return displayLocation === undefined ? descriptor : { ...descriptor, location: displayLocation };
}

async function descriptorFromDocument(
  document: WorkspaceDiscoveryDocument,
  space: WorkspaceDiscoverySpace,
  folders: readonly BrowseSegment[],
  signal: AbortSignal,
): Promise<WorkspaceResourceDescriptor | undefined> {
  if (document.resourceId === null) return undefined;

  const location = {
    spaceName: space.name,
    breadcrumbs: folders.map((folder) => folder.name),
  };
  if (
    document.unitId !== null &&
    document.unitType !== null &&
    UNIT_TYPES.has(document.unitType) &&
    ACCESS_ROLES.has(document.accessRole)
  ) {
    return {
      resourceId: document.resourceId,
      unitId: document.unitId,
      unitType: document.unitType,
      nodeId: document.nodeId,
      spaceId: space.spaceId,
      name: document.name,
      accessRole: document.accessRole,
      location,
    };
  }

  // The node listing is intentionally a lightweight directory projection and
  // may omit unitId. Re-read the existing Resource endpoint instead of
  // inventing an incomplete descriptor; the send-time codec performs the same
  // authoritative lookup before serializing a reference.
  try {
    const descriptor = await fetchWorkspaceResourceDescriptor(document.resourceId, signal);
    if (descriptor.spaceId !== space.spaceId || descriptor.nodeId !== document.nodeId) {
      return undefined;
    }
    return {
      ...descriptor,
      name: document.name,
      location,
    };
  } catch (error) {
    if (signal.aborted) throw error;
    return undefined;
  }
}

function filterResources(
  resources: readonly WorkspaceResourceDescriptor[],
  query: string,
): readonly WorkspaceResourceDescriptor[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (normalized === "") return resources;
  return resources.filter((resource) => {
    const haystack = [
      resource.name,
      resource.location?.spaceName,
      ...(resource.location?.breadcrumbs ?? []),
    ]
      .filter((value): value is string => value !== undefined)
      .join(" ")
      .toLocaleLowerCase();
    return haystack.includes(normalized);
  });
}

/** Keep the current Session's Space at the top without disturbing other order. */
export function prioritizeWorkspaceResources(
  resources: readonly WorkspaceResourceDescriptor[],
  preferredSpaceId: string | undefined,
): readonly WorkspaceResourceDescriptor[] {
  if (preferredSpaceId === undefined || preferredSpaceId === "") return resources;
  return resources
    .map((resource, index) => ({ resource, index }))
    .sort((left, right) => {
      const leftRank = left.resource.spaceId === preferredSpaceId ? 0 : 1;
      const rightRank = right.resource.spaceId === preferredSpaceId ? 0 : 1;
      return leftRank - rightRank || left.index - right.index;
    })
    .map(({ resource }) => resource);
}

function createDefaultWorkspaceResourceCandidateResolver(): WorkspaceResourceCandidateResolver {
  const cache = new Map<string, ResourceDiscoveryCacheEntry>();
  return async (sessionId, request) => {
    const cached = cache.get(sessionId);
    if (cached !== undefined && Date.now() - cached.loadedAt < DISCOVERY_CACHE_TTL_MS) {
      return filterResources(cached.resources, request.query);
    }
    const suffix = `?limit=${DISCOVERY_LIMIT}`;
    const [recent, owned, shared] = await Promise.all([
      fetchDiscoveryJson<{ items?: unknown[] }>(`/recent-resources${suffix}`, request.signal),
      fetchDiscoveryJson<{ items?: unknown[] }>(`/owned-by-me${suffix}`, request.signal),
      fetchDiscoveryJson<{ items?: unknown[] }>(`/shared-with-me${suffix}`, request.signal),
    ]);
    const resources: WorkspaceResourceDescriptor[] = [];
    const seen = new Set<string>();
    for (const item of [...(recent.items ?? []), ...(owned.items ?? []), ...(shared.items ?? [])]) {
      const descriptor = descriptorFromProjection(item);
      if (descriptor !== undefined && !seen.has(descriptor.resourceId)) {
        seen.add(descriptor.resourceId);
        resources.push(descriptor);
      }
    }
    cache.set(sessionId, { loadedAt: Date.now(), resources });
    return filterResources(resources, request.query);
  };
}

const DEFAULT_WORKSPACE_RESOURCE_CANDIDATE_RESOLVER =
  createDefaultWorkspaceResourceCandidateResolver();

async function browseWorkspaceCandidates(
  query: string,
  signal: AbortSignal,
  labels: WorkspaceResourceInputSourceLabels,
): Promise<readonly InputTriggerCandidate[]> {
  const parsed = parseWorkspaceBrowseQuery(query);
  if (parsed === undefined) return [];
  if (parsed.segments.length === 0) {
    const result = await fetchDiscoveryJson<{ spaces?: WorkspaceDiscoverySpace[] }>(
      "/spaces",
      signal,
    );
    const term = parsed.term.toLocaleLowerCase();
    return (result.spaces ?? [])
      .filter((space) => space.name.toLocaleLowerCase().includes(term))
      .map((space) => ({
        name: space.name,
        description: browseSpaceDescription(space, labels),
        icon: "folder" as const,
        drill: true,
        value: browseValue([{ kind: "space", id: space.spaceId, name: space.name }]),
      }));
  }

  const spaceSegment = parsed.segments[0]!;
  const space: WorkspaceDiscoverySpace = {
    spaceId: spaceSegment.id,
    type: "team",
    name: spaceSegment.name,
  };
  const parent = parsed.segments.at(-1)!;
  const parentNodeId = parent.kind === "folder" ? parent.id : null;
  const result = await fetchDiscoveryJson<{ documents?: WorkspaceDiscoveryDocument[] }>(
    `/spaces/${encodeURIComponent(space.spaceId)}/nodes${
      parentNodeId === null ? "" : `?parentNodeId=${encodeURIComponent(parentNodeId)}`
    }`,
    signal,
  );
  const term = parsed.term.toLocaleLowerCase();
  const rows: InputTriggerCandidate[] = [];
  const matchingDocuments = (result.documents ?? []).filter((document) =>
    document.name.toLocaleLowerCase().includes(term),
  );
  const candidates = await Promise.all(
    matchingDocuments.map(async (document) => {
      if (document.resourceId === null) {
        return {
          name: document.name,
          icon: "folder" as const,
          drill: true,
          value: browseValue([
            ...parsed.segments,
            { kind: "folder" as const, id: document.nodeId, name: document.name },
          ]),
        } satisfies InputTriggerCandidate;
      }
      const descriptor = await descriptorFromDocument(
        document,
        space,
        parsed.segments.slice(1),
        signal,
      );
      return descriptor === undefined ? undefined : resourceCandidate(descriptor);
    }),
  );
  rows.push(
    ...candidates.filter(
      (candidate): candidate is InputTriggerCandidate => candidate !== undefined,
    ),
  );
  return rows;
}

/** Create the source codec; access revocation rejects the complete DSH send. */
export function createWorkspaceResourceReferenceCodec(
  resolve: WorkspaceResourceResolver = fetchWorkspaceResourceDescriptor,
): ReferenceCodec {
  return {
    clipboardText: workspaceResourceClipboardText,
    async serialize(ref, signal) {
      const { resourceId, selection } = decodeWorkspaceResourceReference(ref);
      const resource = await resolve(resourceId, signal);
      return JSON.stringify({
        kind: "univer-workspace-resource",
        resourceId: resource.resourceId,
        unitId: resource.unitId,
        unitType: resource.unitType,
        nodeId: resource.nodeId,
        spaceId: resource.spaceId,
        name: resource.name,
        accessRole: resource.accessRole,
        ...(selection === undefined ? {} : { selection }),
      });
    },
  };
}

/** Register the Workspace Resource codec without choosing a discovery model. */
export function createWorkspaceResourceInputSource(
  resolveCandidates: WorkspaceResourceCandidateResolver = DEFAULT_WORKSPACE_RESOURCE_CANDIDATE_RESOLVER,
  labels: WorkspaceResourceInputSourceLabels = DEFAULT_INPUT_SOURCE_LABELS,
  currentSpaceId?: (sessionId: string) => string | undefined,
): InputTriggerSource {
  return {
    trigger: "@",
    name: WORKSPACE_RESOURCE_REFERENCE_SOURCE,
    order: 50,
    showGroupTitle: false,
    async candidates(session, request) {
      if (request.query.startsWith(WORKSPACE_BROWSE_PREFIX)) {
        return browseWorkspaceCandidates(request.query, request.signal, labels);
      }
      const resources = await resolveCandidates(session.sessionId, request);
      if (request.signal.aborted) return [];
      const candidates = prioritizeWorkspaceResources(
        resources,
        currentSpaceId?.(session.sessionId),
      ).map(resourceCandidate);
      if (
        request.query.trim() === "" &&
        resolveCandidates === DEFAULT_WORKSPACE_RESOURCE_CANDIDATE_RESOLVER
      ) {
        candidates.push({
          name: labels.browseWorkspace,
          description: labels.workspace,
          icon: "folder",
          drill: true,
          value: browseValue([]),
        });
      }
      return candidates;
    },
    header(_session, request: HeaderRequest) {
      const path = parseWorkspaceBrowseQuery(request.query);
      return path === undefined ? undefined : workspaceBrowseCrumbs(path, labels);
    },
    onPick({ candidate, action }) {
      if (candidate.value === undefined) return undefined;
      if (action === "drill") {
        const path = decodeBrowseValue(candidate.value);
        return path === undefined
          ? undefined
          : // Keep the native @ trigger in the draft. DSH's input tracker only
            // re-opens a menu for its registered trigger characters; replacing
            // the span with the payload alone would leave plain `workspace:`
            // text and close the menu after the first drill.
            { text: `@${encodeWorkspaceBrowsePath(path)}`, continue: true };
      }
      try {
        const value = decodeWorkspaceResourceReference(candidate.value);
        return {
          insert: createWorkspaceResourceReferenceInsert({
            resourceId: value.resourceId,
            name: value.label,
          }),
        };
      } catch {
        return undefined;
      }
    },
    codec: createWorkspaceResourceReferenceCodec(),
  };
}

/**
 * Append a structured Resource chip to one Session's native composer.
 *
 * The adapter uses only the public Sessions scope and Conversation input
 * resolver. It appends at the current draft end because caret access belongs
 * to the package-private composer keyboard face.
 */
export function insertWorkspaceResourceReference(
  ctx: WorkspaceResourceReferenceContext,
  sessionId: string,
  resource: Pick<WorkspaceResourceDescriptor, "resourceId" | "name">,
  selection?: ViewerSelection,
): WorkspaceResourceReferenceInsertResult {
  const input = resolveSessionInput(ctx, sessionId);
  if (input === undefined) return { kind: "session-unavailable" };
  const reference = createWorkspaceResourceReferenceInsert(resource, selection);
  // The native editor can commit a chip between reading its snapshot and
  // applying this explicit button action. Re-read once for that short CAS
  // race; a second miss still fails closed rather than overwriting input.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = input.state.getSnapshot();
    if (snapshot.phase !== "plain") return { kind: "input-busy", phase: snapshot.phase };
    const end = detectOffsetAtClipboardOffset(snapshot, snapshot.draft.length);
    if (
      input.insertReference(reference, {
        start: end,
        end,
        draftRev: snapshot.draftRev,
      })
    ) {
      return { kind: "inserted" };
    }
  }
  return { kind: "input-changed" };
}
