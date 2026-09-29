import { workspaceError } from "./errors.js";
import { isWorkspaceRecord } from "./http.js";

export type WorkspaceIssueState = "open" | "closed";
export type WorkspaceIssueStateReason = "completed" | "not_planned";

export interface WorkspaceIssueUser {
  readonly displayName: string;
  readonly id: string;
  readonly username: string;
}

export interface WorkspaceIssueLabel {
  readonly color: string;
  readonly description: string;
  readonly id: string;
  readonly name: string;
}

export interface WorkspaceIssueReference {
  readonly available: boolean;
  readonly name: string | null;
  readonly nodeId: string;
  readonly resource:
    | { readonly id: string; readonly kind: "univer"; readonly unitId: string; readonly unitType: string }
    | { readonly id: string; readonly kind: "blob"; readonly mediaType: string }
    | null;
}

export interface WorkspaceIssueSummary {
  readonly assignees: readonly WorkspaceIssueUser[];
  readonly author: WorkspaceIssueUser;
  readonly closedAt: string | null;
  readonly closedBy: WorkspaceIssueUser | null;
  readonly commentCount: number;
  readonly createdAt: string;
  readonly id: string;
  readonly labels: readonly WorkspaceIssueLabel[];
  readonly number: number;
  readonly referenceCount: number;
  readonly space: { readonly id: string; readonly name: string };
  readonly state: WorkspaceIssueState;
  readonly stateReason: WorkspaceIssueStateReason | null;
  readonly title: string;
  readonly updatedAt: string;
}

export interface WorkspaceIssue extends WorkspaceIssueSummary {
  readonly body: string;
  readonly capabilities: {
    readonly close: boolean;
    readonly comment: boolean;
    readonly edit: boolean;
    readonly triage: boolean;
  };
  readonly references: readonly WorkspaceIssueReference[];
}

export interface WorkspaceIssuePage {
  readonly counts: { readonly closed: number; readonly open: number };
  readonly issues: readonly WorkspaceIssueSummary[];
  readonly nextCursor: string | null;
}

export type WorkspaceIssueTimelineItem =
  | {
      readonly author: WorkspaceIssueUser;
      readonly body: string;
      readonly createdAt: string;
      readonly id: string;
      readonly type: "comment";
      readonly updatedAt: string;
    }
  | {
      readonly actor: WorkspaceIssueUser;
      readonly createdAt: string;
      readonly id: string;
      readonly kind: string;
      readonly payload: Readonly<Record<string, unknown>>;
      readonly type: "event";
    };

export interface WorkspaceIssueTimelinePage {
  readonly items: readonly WorkspaceIssueTimelineItem[];
  readonly nextCursor: string | null;
}

export function parseIssuePage(value: Record<string, unknown>): WorkspaceIssuePage {
  const counts = value["counts"];
  if (
    !Array.isArray(value["items"]) ||
    !isWorkspaceRecord(counts) ||
    typeof counts["open"] !== "number" ||
    typeof counts["closed"] !== "number"
  ) {
    throw invalidResponse("Workspace Issue page is malformed");
  }
  return {
    counts: { closed: counts["closed"], open: counts["open"] },
    issues: value["items"].map((item) => parseIssueSummary(item)),
    nextCursor: parseCursor(value["nextCursor"]),
  };
}

export function parseIssueSummary(value: unknown): WorkspaceIssueSummary {
  if (
    !isWorkspaceRecord(value) ||
    typeof value["id"] !== "string" ||
    !Number.isInteger(value["number"]) ||
    !isWorkspaceRecord(value["space"]) ||
    typeof value["space"]["id"] !== "string" ||
    typeof value["space"]["name"] !== "string" ||
    typeof value["title"] !== "string" ||
    (value["state"] !== "open" && value["state"] !== "closed") ||
    !Array.isArray(value["labels"]) ||
    !Array.isArray(value["assignees"]) ||
    typeof value["commentCount"] !== "number" ||
    typeof value["referenceCount"] !== "number" ||
    typeof value["createdAt"] !== "string" ||
    typeof value["updatedAt"] !== "string"
  ) {
    throw invalidResponse("Workspace response contains an invalid Issue");
  }
  const reason = value["stateReason"];
  if (reason !== null && reason !== "completed" && reason !== "not_planned") {
    throw invalidResponse("Workspace Issue has an invalid state reason");
  }
  if (value["closedAt"] !== null && typeof value["closedAt"] !== "string") {
    throw invalidResponse("Workspace Issue has an invalid closed time");
  }
  return {
    assignees: value["assignees"].map((user) => parseUser(user)),
    author: parseUser(value["author"]),
    closedAt: value["closedAt"],
    closedBy: value["closedBy"] === null ? null : parseUser(value["closedBy"]),
    commentCount: value["commentCount"],
    createdAt: value["createdAt"],
    id: value["id"],
    labels: value["labels"].map((label) => parseLabel(label)),
    number: value["number"] as number,
    referenceCount: value["referenceCount"],
    space: { id: value["space"]["id"], name: value["space"]["name"] },
    state: value["state"],
    stateReason: reason,
    title: value["title"],
    updatedAt: value["updatedAt"],
  };
}

export function parseIssue(value: unknown): WorkspaceIssue {
  const summary = parseIssueSummary(value);
  const record = value as Record<string, unknown>;
  const capabilities = record["capabilities"];
  if (
    typeof record["body"] !== "string" ||
    !Array.isArray(record["references"]) ||
    !isWorkspaceRecord(capabilities) ||
    typeof capabilities["edit"] !== "boolean" ||
    typeof capabilities["close"] !== "boolean" ||
    typeof capabilities["triage"] !== "boolean" ||
    typeof capabilities["comment"] !== "boolean"
  ) {
    throw invalidResponse("Workspace response contains an invalid Issue");
  }
  return {
    ...summary,
    body: record["body"],
    capabilities: {
      close: capabilities["close"],
      comment: capabilities["comment"],
      edit: capabilities["edit"],
      triage: capabilities["triage"],
    },
    references: record["references"].map((reference) => parseReference(reference)),
  };
}

export function parseIssueLabel(value: unknown): WorkspaceIssueLabel {
  return parseLabel(value);
}

export function parseTimelinePage(value: Record<string, unknown>): WorkspaceIssueTimelinePage {
  if (!Array.isArray(value["items"])) throw invalidResponse("Workspace Issue timeline is malformed");
  return {
    items: value["items"].map((item) => parseTimelineItem(item)),
    nextCursor: parseCursor(value["nextCursor"]),
  };
}

export function parseIssueComment(value: unknown): Extract<WorkspaceIssueTimelineItem, { type: "comment" }> {
  const item = parseTimelineItem(isWorkspaceRecord(value) ? { ...value, type: "comment" } : value);
  if (item.type !== "comment") throw invalidResponse("Workspace response contains an invalid comment");
  return item;
}

function parseTimelineItem(value: unknown): WorkspaceIssueTimelineItem {
  if (
    !isWorkspaceRecord(value) ||
    typeof value["id"] !== "string" ||
    typeof value["createdAt"] !== "string"
  ) {
    throw invalidResponse("Workspace Issue timeline contains an invalid item");
  }
  if (value["type"] === "comment" && typeof value["body"] === "string" && typeof value["updatedAt"] === "string") {
    return {
      author: parseUser(value["author"]),
      body: value["body"],
      createdAt: value["createdAt"],
      id: value["id"],
      type: "comment",
      updatedAt: value["updatedAt"],
    };
  }
  if (value["type"] === "event" && typeof value["kind"] === "string" && isWorkspaceRecord(value["payload"])) {
    return {
      actor: parseUser(value["actor"]),
      createdAt: value["createdAt"],
      id: value["id"],
      kind: value["kind"],
      payload: value["payload"],
      type: "event",
    };
  }
  throw invalidResponse("Workspace Issue timeline contains an invalid item");
}

function parseUser(value: unknown): WorkspaceIssueUser {
  if (
    !isWorkspaceRecord(value) ||
    typeof value["id"] !== "string" ||
    typeof value["username"] !== "string" ||
    typeof value["displayName"] !== "string"
  ) {
    throw invalidResponse("Workspace Issue contains an invalid User");
  }
  return { displayName: value["displayName"], id: value["id"], username: value["username"] };
}

function parseLabel(value: unknown): WorkspaceIssueLabel {
  if (
    !isWorkspaceRecord(value) ||
    typeof value["id"] !== "string" ||
    typeof value["name"] !== "string" ||
    typeof value["color"] !== "string" ||
    typeof value["description"] !== "string"
  ) {
    throw invalidResponse("Workspace Issue contains an invalid label");
  }
  return {
    color: value["color"],
    description: value["description"],
    id: value["id"],
    name: value["name"],
  };
}

function parseReference(value: unknown): WorkspaceIssueReference {
  if (
    !isWorkspaceRecord(value) ||
    typeof value["nodeId"] !== "string" ||
    typeof value["available"] !== "boolean" ||
    (value["name"] !== null && typeof value["name"] !== "string")
  ) {
    throw invalidResponse("Workspace Issue contains an invalid file reference");
  }
  const resource = value["resource"];
  let parsed: WorkspaceIssueReference["resource"] = null;
  if (resource !== null) {
    if (!isWorkspaceRecord(resource) || typeof resource["id"] !== "string") {
      throw invalidResponse("Workspace Issue reference has an invalid Resource");
    }
    if (
      resource["kind"] === "univer" &&
      typeof resource["unitId"] === "string" &&
      typeof resource["unitType"] === "string"
    ) {
      parsed = { id: resource["id"], kind: "univer", unitId: resource["unitId"], unitType: resource["unitType"] };
    } else if (resource["kind"] === "blob" && typeof resource["mediaType"] === "string") {
      parsed = { id: resource["id"], kind: "blob", mediaType: resource["mediaType"] };
    } else {
      throw invalidResponse("Workspace Issue reference has an invalid Resource");
    }
  }
  return { available: value["available"], name: value["name"], nodeId: value["nodeId"], resource: parsed };
}

function parseCursor(value: unknown): string | null {
  if (value !== null && typeof value !== "string") throw invalidResponse("Workspace page has an invalid cursor");
  return value;
}

function invalidResponse(message: string): Error {
  return workspaceError("workspace-invalid-response", message);
}
