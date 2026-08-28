import { workspaceError } from "./errors.js";
import { isWorkspaceRecord } from "./http.js";

export type WorkspaceUnitType = "sheet" | "doc" | "slide" | "base" | "board";
export type WorkspaceAccessRole = "owner" | "admin" | "editor" | "viewer";

export interface WorkspaceSpace {
  readonly id: string;
  readonly name: string;
  readonly type?: "personal" | "team";
}

export interface WorkspaceResourceCapabilities {
  readonly downloadContent: boolean;
  readonly editContent: boolean;
  readonly openContent: boolean;
}

export interface WorkspaceNodeCapabilities {
  readonly browseChildren: boolean;
  readonly createChildren: boolean;
  readonly move: boolean;
  readonly rename: boolean;
  readonly share: boolean;
  readonly trash: boolean;
}

export interface WorkspaceUniverResource {
  readonly capabilities: WorkspaceResourceCapabilities;
  readonly kind: "univer";
  readonly resourceId: string;
  readonly unitId?: string;
  readonly unitType: WorkspaceUnitType;
}

export interface WorkspaceBlobResource {
  readonly availability: "ready" | "quarantined";
  readonly byteSize: number;
  readonly capabilities: WorkspaceResourceCapabilities;
  readonly kind: "blob";
  readonly mediaType: string;
  readonly resourceId: string;
}

export type WorkspaceNodeResource = WorkspaceUniverResource | WorkspaceBlobResource;

export interface WorkspaceNodeSummary {
  readonly accessRole: WorkspaceAccessRole;
  readonly capabilities: WorkspaceNodeCapabilities;
  readonly hasChildren: boolean;
  readonly name: string;
  readonly nodeId: string;
  readonly parentNodeId: string | null;
  readonly resource: WorkspaceNodeResource | null;
  readonly spaceId: string;
  readonly updatedAt: string;
}

export interface WorkspaceNode extends WorkspaceNodeSummary {
  readonly path: string;
}

export interface WorkspaceTrashBatch {
  readonly capabilities: {
    readonly removePermanently: boolean;
    readonly restore: boolean;
  };
  readonly nodeCount: number;
  readonly originalLocation: {
    readonly breadcrumbs: readonly { readonly name: string; readonly nodeId: string }[];
  };
  readonly removeBlockedBy: WorkspaceTrashBlocker | null;
  readonly restoreBlockedBy: WorkspaceTrashBlocker | null;
  readonly root: {
    readonly name: string;
    readonly nodeId: string;
    readonly resource:
      | {
          readonly kind: "univer";
          readonly resourceId: string;
          readonly unitType: WorkspaceUnitType;
        }
      | {
          readonly byteSize: number;
          readonly kind: "blob";
          readonly mediaType: string;
          readonly resourceId: string;
        }
      | null;
  };
  readonly spaceId: string;
  readonly trashBatchId: string;
  readonly trashedAt: string;
  readonly trashedBy: {
    readonly avatarUrl: string | null;
    readonly id: string;
    readonly name: string;
    readonly username: string;
  };
}

export type WorkspaceTrashBlocker =
  | {
      readonly code: "RESTORE_PARENT_IN_TRASH" | "NESTED_TRASH_BATCH";
      readonly trashBatchId: string;
    }
  | {
      readonly code: "ACTIVE_WORKTREE_RESOURCE_REFERENCE";
    };

export interface WorkspaceNodeDirectory {
  readonly breadcrumbs: readonly { readonly name: string; readonly nodeId: string }[];
  readonly navigationRootNodeId: string | null;
  readonly nodes: readonly WorkspaceNode[];
  readonly parentNode: WorkspaceNode | null;
  readonly space: WorkspaceSpace;
}

export function parseSpace(value: unknown): WorkspaceSpace {
  if (
    !isWorkspaceRecord(value) ||
    typeof value["id"] !== "string" ||
    typeof value["name"] !== "string" ||
    (value["type"] !== undefined && value["type"] !== "personal" && value["type"] !== "team")
  ) {
    throw invalidResponse("Workspace response contains an invalid Space");
  }
  return {
    id: value["id"],
    name: value["name"],
    ...(value["type"] === undefined ? {} : { type: value["type"] }),
  };
}

export function parseNodePage(
  value: Record<string, unknown>,
  spaceId: string,
  parentNodeId: string | undefined,
): WorkspaceNodeDirectory & { readonly nextCursor: string | null } {
  if (!Array.isArray(value["breadcrumbs"]) || !Array.isArray(value["nodes"])) {
    throw invalidResponse("Workspace Node page is missing breadcrumbs or Nodes");
  }
  const space = parseSpace(value["space"]);
  if (space.id !== spaceId) throw invalidResponse("Workspace Node page returned another Space");
  const breadcrumbs = parseBreadcrumbs(value["breadcrumbs"]);
  if (parentNodeId !== undefined && breadcrumbs.at(-1)?.nodeId !== parentNodeId) {
    throw invalidResponse("Workspace breadcrumbs do not match the requested parent Node");
  }
  const path = breadcrumbs.map((item) => item.name);
  const parentNode =
    value["parentNode"] === null
      ? null
      : parseNode(value["parentNode"], path.slice(0, -1), spaceId, undefined);
  if (
    (parentNodeId === undefined && parentNode !== null) ||
    (parentNodeId !== undefined && parentNode?.nodeId !== parentNodeId)
  ) {
    throw invalidResponse("Workspace Node page returned another parent Node");
  }
  if (value["navigationRootNodeId"] !== null && typeof value["navigationRootNodeId"] !== "string") {
    throw invalidResponse("Workspace Node page contains an invalid navigation root");
  }
  if (value["nextCursor"] !== null && typeof value["nextCursor"] !== "string") {
    throw invalidResponse("Workspace Node page contains an invalid cursor");
  }
  return {
    breadcrumbs,
    navigationRootNodeId: value["navigationRootNodeId"],
    nextCursor: value["nextCursor"],
    nodes: value["nodes"].map((item) => parseNode(item, path, spaceId, parentNodeId ?? null)),
    parentNode,
    space,
  };
}

export function parseNodeResponse(value: unknown, nodeId: string): WorkspaceNode {
  if (
    !isWorkspaceRecord(value) ||
    !Array.isArray(value["breadcrumbs"]) ||
    (value["navigationRootNodeId"] !== null && typeof value["navigationRootNodeId"] !== "string")
  ) {
    throw invalidResponse("Workspace Node response is invalid");
  }
  const space = parseSpace(value["space"]);
  const breadcrumbs = parseBreadcrumbs(value["breadcrumbs"]);
  const target = breadcrumbs.at(-1);
  if (target?.nodeId !== nodeId) {
    throw invalidResponse("Workspace Node breadcrumbs do not match the requested Node");
  }
  const node = parseNode(
    value["node"],
    breadcrumbs.slice(0, -1).map((item) => item.name),
    space.id,
    undefined,
  );
  if (node.nodeId !== nodeId || node.name !== target.name) {
    throw invalidResponse("Workspace Node response does not match the requested Node");
  }
  return node;
}

export function parseDetachedNode(value: unknown): WorkspaceNodeSummary {
  if (
    !isWorkspaceRecord(value) ||
    typeof value["spaceId"] !== "string" ||
    (value["parentNodeId"] !== null && typeof value["parentNodeId"] !== "string")
  ) {
    throw invalidResponse("Workspace response contains an invalid owning Node");
  }
  return parseNodeSummary(value, value["spaceId"], value["parentNodeId"]);
}

export function parseNodeSummary(
  value: unknown,
  spaceId: string,
  parentNodeId: string | null | undefined,
): WorkspaceNodeSummary {
  if (
    !isWorkspaceRecord(value) ||
    typeof value["id"] !== "string" ||
    value["id"].length === 0 ||
    value["spaceId"] !== spaceId ||
    (value["parentNodeId"] !== null && typeof value["parentNodeId"] !== "string") ||
    (parentNodeId !== undefined && value["parentNodeId"] !== parentNodeId) ||
    typeof value["name"] !== "string" ||
    typeof value["hasChildren"] !== "boolean" ||
    typeof value["updatedAt"] !== "string" ||
    !isWorkspaceRecord(value["capabilities"])
  ) {
    throw invalidResponse("Workspace response contains an invalid Node");
  }
  return {
    accessRole: accessRole(value["accessRole"]),
    capabilities: parseNodeCapabilities(value["capabilities"]),
    hasChildren: value["hasChildren"],
    name: value["name"],
    nodeId: value["id"],
    parentNodeId: value["parentNodeId"],
    resource: parseNodeResource(value["resource"]),
    spaceId,
    updatedAt: value["updatedAt"],
  };
}

export function parseNode(
  value: unknown,
  path: readonly string[],
  spaceId: string,
  parentNodeId: string | null | undefined,
): WorkspaceNode {
  const node = parseNodeSummary(value, spaceId, parentNodeId);
  return {
    ...node,
    path: `/${[...path, node.name].join("/")}`,
  };
}

export function parseTrashBatch(value: unknown, nodeId: string): WorkspaceTrashBatch {
  if (
    !isWorkspaceRecord(value) ||
    typeof value["id"] !== "string" ||
    value["id"].length === 0 ||
    typeof value["spaceId"] !== "string" ||
    !isWorkspaceRecord(value["root"]) ||
    value["root"]["id"] !== nodeId ||
    typeof value["root"]["name"] !== "string" ||
    !isWorkspaceRecord(value["originalLocation"]) ||
    !Array.isArray(value["originalLocation"]["breadcrumbs"]) ||
    !isWorkspaceRecord(value["trashedBy"]) ||
    typeof value["trashedAt"] !== "string" ||
    !Number.isSafeInteger(value["nodeCount"]) ||
    Number(value["nodeCount"]) < 1 ||
    !isExactBooleanRecord(value["capabilities"], ["restore", "removePermanently"])
  ) {
    throw invalidResponse("Workspace Trash Batch response is invalid");
  }
  const trashedBy = value["trashedBy"];
  if (
    typeof trashedBy["id"] !== "string" ||
    typeof trashedBy["username"] !== "string" ||
    typeof trashedBy["displayName"] !== "string" ||
    (trashedBy["avatarUrl"] !== null && typeof trashedBy["avatarUrl"] !== "string")
  ) {
    throw invalidResponse("Workspace Trash Batch contains an invalid user");
  }
  const capabilities = value["capabilities"] as {
    readonly removePermanently: boolean;
    readonly restore: boolean;
  };
  return {
    capabilities,
    nodeCount: Number(value["nodeCount"]),
    originalLocation: {
      breadcrumbs: parseBreadcrumbs(value["originalLocation"]["breadcrumbs"]),
    },
    removeBlockedBy: parseTrashBlocker(value["removeBlockedBy"]),
    restoreBlockedBy: parseTrashBlocker(value["restoreBlockedBy"]),
    root: {
      name: value["root"]["name"],
      nodeId,
      resource: parseTrashResource(value["root"]["resource"]),
    },
    spaceId: value["spaceId"],
    trashBatchId: value["id"],
    trashedAt: value["trashedAt"],
    trashedBy: {
      avatarUrl: trashedBy["avatarUrl"],
      id: trashedBy["id"],
      name: trashedBy["displayName"],
      username: trashedBy["username"],
    },
  };
}

export function parseNodeResource(value: unknown): WorkspaceNodeResource | null {
  if (value === null) return null;
  if (!isWorkspaceRecord(value) || typeof value["id"] !== "string" || value["id"].length === 0) {
    throw invalidResponse("Workspace Node contains an invalid Resource");
  }
  const capabilities = parseResourceCapabilities(value["capabilities"]);
  if (value["kind"] === "univer") {
    const unitId = value["unitId"];
    if (unitId !== undefined && (typeof unitId !== "string" || unitId.length === 0)) {
      throw invalidResponse("Workspace Node contains an invalid Univer Unit identity");
    }
    return {
      capabilities,
      kind: "univer",
      resourceId: value["id"],
      ...(unitId === undefined ? {} : { unitId }),
      unitType: parseUnitType(value["unitType"]),
    };
  }
  if (
    value["kind"] === "blob" &&
    typeof value["mediaType"] === "string" &&
    value["mediaType"].length > 0 &&
    Number.isSafeInteger(value["byteSize"]) &&
    Number(value["byteSize"]) >= 0 &&
    (value["availability"] === "ready" || value["availability"] === "quarantined")
  ) {
    return {
      availability: value["availability"],
      byteSize: Number(value["byteSize"]),
      capabilities,
      kind: "blob",
      mediaType: value["mediaType"],
      resourceId: value["id"],
    };
  }
  throw invalidResponse("Workspace Node contains an unsupported Resource");
}

export function parseUnitType(value: unknown): WorkspaceUnitType {
  if (
    value === "sheet" ||
    value === "doc" ||
    value === "slide" ||
    value === "base" ||
    value === "board"
  ) {
    return value;
  }
  throw invalidResponse("Workspace response contains an unsupported Unit type");
}

function parseBreadcrumbs(
  value: readonly unknown[],
): readonly { readonly name: string; readonly nodeId: string }[] {
  return value.map((item) => {
    if (
      !isWorkspaceRecord(item) ||
      typeof item["id"] !== "string" ||
      typeof item["name"] !== "string"
    ) {
      throw invalidResponse("Workspace response contains invalid breadcrumbs");
    }
    return { name: item["name"], nodeId: item["id"] };
  });
}

function parseTrashResource(value: unknown): WorkspaceTrashBatch["root"]["resource"] {
  if (value === null) return null;
  if (!isWorkspaceRecord(value) || typeof value["id"] !== "string" || value["id"].length === 0) {
    throw invalidResponse("Workspace Trash Batch contains an invalid Resource");
  }
  if (value["kind"] === "univer") {
    return {
      kind: "univer",
      resourceId: value["id"],
      unitType: parseUnitType(value["unitType"]),
    };
  }
  if (
    value["kind"] === "blob" &&
    typeof value["mediaType"] === "string" &&
    value["mediaType"].length > 0 &&
    Number.isSafeInteger(value["byteSize"]) &&
    Number(value["byteSize"]) >= 0
  ) {
    return {
      byteSize: Number(value["byteSize"]),
      kind: "blob",
      mediaType: value["mediaType"],
      resourceId: value["id"],
    };
  }
  throw invalidResponse("Workspace Trash Batch contains an unsupported Resource");
}

function parseTrashBlocker(value: unknown): WorkspaceTrashBlocker | null {
  if (value === null) return null;
  if (!isWorkspaceRecord(value)) {
    throw invalidResponse("Workspace Trash Batch contains an invalid blocker");
  }
  if (value["code"] === "ACTIVE_WORKTREE_RESOURCE_REFERENCE") {
    if (Object.keys(value).length !== 1) {
      throw invalidResponse("Workspace Trash Batch contains an invalid blocker");
    }
    return { code: value["code"] };
  }
  if (
    (value["code"] === "RESTORE_PARENT_IN_TRASH" || value["code"] === "NESTED_TRASH_BATCH") &&
    typeof value["trashBatchId"] === "string" &&
    value["trashBatchId"].length > 0 &&
    Object.keys(value).length === 2
  ) {
    return { code: value["code"], trashBatchId: value["trashBatchId"] };
  }
  throw invalidResponse("Workspace Trash Batch contains an invalid blocker");
}

function parseResourceCapabilities(value: unknown): WorkspaceResourceCapabilities {
  if (!isExactBooleanRecord(value, ["downloadContent", "editContent", "openContent"])) {
    throw invalidResponse("Workspace Resource contains invalid capabilities");
  }
  return value as unknown as WorkspaceResourceCapabilities;
}

function parseNodeCapabilities(value: unknown): WorkspaceNodeCapabilities {
  if (
    !isExactBooleanRecord(value, [
      "browseChildren",
      "createChildren",
      "rename",
      "move",
      "trash",
      "share",
    ])
  ) {
    throw invalidResponse("Workspace Node contains invalid capabilities");
  }
  return value as unknown as WorkspaceNodeCapabilities;
}

function isExactBooleanRecord(value: unknown, keys: readonly string[]): boolean {
  if (!isWorkspaceRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index] && typeof value[key] === "boolean")
  );
}

function accessRole(value: unknown): WorkspaceAccessRole {
  if (value === "owner" || value === "admin" || value === "editor" || value === "viewer")
    return value;
  throw invalidResponse("Workspace Node contains an invalid access role");
}

function invalidResponse(message: string): Error {
  return workspaceError("workspace-invalid-response", message);
}
