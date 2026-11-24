import { workspaceError } from "./errors.js";
import { isWorkspaceRecord } from "./http.js";

export type WorkspaceUnitType = "sheet" | "doc" | "slide" | "base" | "board" | "pdf";
export type WorkspaceAccessRole = "owner" | "admin" | "editor" | "viewer";

export interface WorkspaceSpace {
  readonly id: string;
  readonly name: string;
  readonly type?: "personal" | "team";
  /** Present on full Space views, absent on the Space summaries embedded in other responses. */
  readonly accessRole?: WorkspaceAccessRole;
  readonly affiliation?: "owner" | "member" | "none";
  readonly description?: string;
  /** `<owner>/<slug>`, `<owner>/personal`, or null for a Team Space without a slug. */
  readonly fullName?: string | null;
  readonly owner?: { readonly id: string; readonly username: string };
  readonly publicRead?: boolean;
  /** Who besides its members may fork the Team Space and propose; it applies only while `publicRead` is true. */
  readonly proposals?: WorkspaceSpaceProposals;
  /** Hours after a submission at which an Issue nobody sent back is accepted; null when off. */
  readonly acceptAfterHours?: number | null;
  /** `checks`: an agent that does not own the Team Space lands changes only by a merge whose declared checks all passed. */
  readonly landing?: WorkspaceSpaceLanding;
  readonly slug?: string | null;
  /** What the caller may do in the Space, on full Space views from a server that reports every one of them. */
  readonly capabilities?: WorkspaceSpaceCapabilities;
}

const SPACE_CAPABILITIES = [
  "browseRoot",
  "createAtRoot",
  "renameSpace",
  "manageMembers",
  "viewTrash",
  "createIssue",
  "triageIssues",
  "manageIssueLabels",
  "propose",
] as const;
export type WorkspaceSpaceCapabilities = { readonly [Name in (typeof SPACE_CAPABILITIES)[number]]: boolean };

export const SPACE_PROPOSALS = ["members", "accountable", "anyone"] as const;
export type WorkspaceSpaceProposals = (typeof SPACE_PROPOSALS)[number];

export const SPACE_LANDINGS = ["review", "checks"] as const;
export type WorkspaceSpaceLanding = (typeof SPACE_LANDINGS)[number];

export const TEAM_ROLES = ["admin", "editor", "viewer"] as const;
export type WorkspaceTeamRole = (typeof TEAM_ROLES)[number];

export interface WorkspaceTeamUser {
  readonly displayName: string;
  readonly id: string;
  readonly username: string;
}

export interface WorkspaceTeamMember {
  readonly createdAt: string;
  readonly grantedBy: WorkspaceTeamUser;
  readonly role: WorkspaceTeamRole;
  readonly updatedAt: string;
  readonly user: WorkspaceTeamUser;
}

/** A Team Space's owner and members. The owner is never one of the members. */
export interface WorkspaceTeamMembers {
  readonly members: readonly WorkspaceTeamMember[];
  readonly owner: WorkspaceTeamUser;
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
  readonly unitId: string;
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

export interface WorkspaceLinkSharing {
  readonly enabled: boolean;
  /** Access for signed-in users. Anonymous visitors always read. */
  readonly role: "editor" | "viewer";
  /** Owner of the Space that holds the Node. `claimed` is present only for an agent. */
  readonly owner: {
    readonly username: string;
    readonly kind: "human" | "agent";
    readonly claimed?: boolean;
  };
  /** When the link stops working because its owner, an unclaimed agent, expires. */
  readonly expiresAt: string | null;
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
  const owner = value["owner"];
  const hasOwner =
    isWorkspaceRecord(owner) && typeof owner["id"] === "string" && typeof owner["username"] === "string";
  const capabilities = value["capabilities"];
  const hasCapabilities =
    isWorkspaceRecord(capabilities) && SPACE_CAPABILITIES.every((name) => typeof capabilities[name] === "boolean");
  return {
    id: value["id"],
    name: value["name"],
    ...(value["type"] === undefined ? {} : { type: value["type"] }),
    ...(isAccessRole(value["accessRole"]) ? { accessRole: value["accessRole"] } : {}),
    ...(value["affiliation"] === "owner" || value["affiliation"] === "member" || value["affiliation"] === "none"
      ? { affiliation: value["affiliation"] }
      : {}),
    ...(typeof value["description"] === "string" ? { description: value["description"] } : {}),
    ...(value["fullName"] === null || typeof value["fullName"] === "string"
      ? { fullName: value["fullName"] }
      : {}),
    ...(hasOwner ? { owner: { id: owner["id"] as string, username: owner["username"] as string } } : {}),
    ...(typeof value["publicRead"] === "boolean" ? { publicRead: value["publicRead"] } : {}),
    ...(SPACE_PROPOSALS.includes(value["proposals"] as WorkspaceSpaceProposals)
      ? { proposals: value["proposals"] as WorkspaceSpaceProposals }
      : {}),
    ...(value["acceptAfterHours"] === null || Number.isSafeInteger(value["acceptAfterHours"])
      ? { acceptAfterHours: value["acceptAfterHours"] as number | null }
      : {}),
    ...(SPACE_LANDINGS.includes(value["landing"] as WorkspaceSpaceLanding)
      ? { landing: value["landing"] as WorkspaceSpaceLanding }
      : {}),
    ...(value["slug"] === null || typeof value["slug"] === "string" ? { slug: value["slug"] } : {}),
    ...(hasCapabilities
      ? {
          capabilities: Object.fromEntries(
            SPACE_CAPABILITIES.map((name) => [name, capabilities[name]]),
          ) as WorkspaceSpaceCapabilities,
        }
      : {}),
  };
}

export function parseTeamMembers(value: Record<string, unknown>): WorkspaceTeamMembers {
  if (!Array.isArray(value["members"])) throw invalidResponse("Workspace response is missing Team members");
  return { owner: parseTeamUser(value["owner"]), members: value["members"].map(parseTeamMember) };
}

export function parseTeamMember(value: unknown): WorkspaceTeamMember {
  if (
    !isWorkspaceRecord(value) ||
    !(TEAM_ROLES as readonly unknown[]).includes(value["role"]) ||
    typeof value["createdAt"] !== "string" ||
    typeof value["updatedAt"] !== "string"
  ) {
    throw invalidResponse("Workspace response contains an invalid Team membership");
  }
  return {
    user: parseTeamUser(value["user"]),
    role: value["role"] as WorkspaceTeamRole,
    grantedBy: parseTeamUser(value["grantedBy"]),
    createdAt: value["createdAt"],
    updatedAt: value["updatedAt"],
  };
}

function parseTeamUser(value: unknown): WorkspaceTeamUser {
  if (
    !isWorkspaceRecord(value) ||
    typeof value["id"] !== "string" ||
    typeof value["username"] !== "string" ||
    typeof value["displayName"] !== "string"
  ) {
    throw invalidResponse("Workspace response contains an invalid Team member User");
  }
  return { displayName: value["displayName"], id: value["id"], username: value["username"] };
}

function isAccessRole(value: unknown): value is WorkspaceAccessRole {
  return value === "owner" || value === "admin" || value === "editor" || value === "viewer";
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

export function parseLinkSharing(value: Record<string, unknown>): WorkspaceLinkSharing {
  const owner = value["owner"];
  if (
    typeof value["enabled"] !== "boolean" ||
    (value["role"] !== "editor" && value["role"] !== "viewer") ||
    !isWorkspaceRecord(owner) ||
    typeof owner["username"] !== "string" ||
    (owner["kind"] !== "human" && owner["kind"] !== "agent") ||
    (owner["claimed"] !== undefined && typeof owner["claimed"] !== "boolean") ||
    (value["expiresAt"] !== null && typeof value["expiresAt"] !== "string")
  ) {
    throw invalidResponse("Workspace response contains invalid Link Sharing settings");
  }
  return {
    enabled: value["enabled"],
    role: value["role"],
    owner: {
      username: owner["username"],
      kind: owner["kind"],
      ...(owner["claimed"] === undefined ? {} : { claimed: owner["claimed"] }),
    },
    expiresAt: value["expiresAt"],
  };
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
    return {
      capabilities,
      kind: "univer",
      resourceId: value["id"],
      unitId: value["unitId"] as string,
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
    value === "board" ||
    value === "pdf"
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
