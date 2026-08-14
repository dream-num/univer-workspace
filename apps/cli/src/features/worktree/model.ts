import { workspaceError } from "../../errors.js";
import { isWorkspaceRecord } from "../../transport/http.js";
import { parseUnitType, type WorkspaceUnitType } from "../space/model.js";

export type WorkspaceWorktreeState = "draft" | "ready" | "merging" | "merged" | "discarded";

export interface WorkspaceUnit {
  readonly activationState:
    | "notApplicable"
    | "waitingForMerge"
    | "pending"
    | "completed"
    | "failed"
    | "discarded";
  readonly change: "modified" | "added" | "deleted" | "unchanged";
  readonly draftHeadRevision: number;
  readonly mergeResult: "pending" | "merged" | "unchanged" | "conflict" | "failed";
  readonly name: string;
  readonly nodeId: string;
  readonly resourceId: string;
  readonly source: "trunk" | "worktree";
  readonly target: { readonly parentNodeId: string | null; readonly spaceId: string } | null;
  readonly type: WorkspaceUnitType;
  readonly unitId: string;
  readonly worktreeId: string;
}

export interface WorkspaceWorktree {
  readonly id: string;
  readonly name: string;
  readonly spaceId?: string;
  readonly state: WorkspaceWorktreeState;
  readonly units: readonly WorkspaceUnit[];
}

export function parseWorktree(value: unknown, expectedId?: string): WorkspaceWorktree {
  if (
    !isWorkspaceRecord(value) ||
    typeof value["id"] !== "string" ||
    value["id"].length === 0 ||
    typeof value["name"] !== "string" ||
    !isState(value["state"])
  ) {
    throw invalidResponse("Workspace response contains an invalid Worktree");
  }
  if (expectedId !== undefined && value["id"] !== expectedId) {
    throw workspaceError(
      "workspace-result-mismatch",
      "Workspace response returned a different Worktree.",
    );
  }
  const units = value["units"] ?? [];
  if (!Array.isArray(units)) throw invalidResponse("Workspace Worktree contains invalid Units");
  const worktreeId = value["id"];
  const spaceId =
    isWorkspaceRecord(value["teamSpace"]) && typeof value["teamSpace"]["id"] === "string"
      ? value["teamSpace"]["id"]
      : undefined;
  return {
    id: worktreeId,
    name: value["name"],
    state: value["state"],
    units: units.map((unit) => parseUnit(unit, worktreeId)),
    ...(spaceId === undefined ? {} : { spaceId }),
  };
}

export function parseUnit(value: unknown, worktreeId: string): WorkspaceUnit {
  if (
    !isWorkspaceRecord(value) ||
    typeof value["unitId"] !== "string" ||
    value["unitId"].length === 0 ||
    typeof value["resourceId"] !== "string" ||
    value["resourceId"].length === 0 ||
    typeof value["nodeId"] !== "string" ||
    value["nodeId"].length === 0 ||
    (value["source"] !== "trunk" && value["source"] !== "worktree") ||
    typeof value["name"] !== "string" ||
    !isRevision(value["draftHeadRevision"]) ||
    !isChange(value["change"]) ||
    !isMergeResult(value["mergeResult"]) ||
    !isActivation(value["activationState"]) ||
    "fileId" in value
  ) {
    throw invalidResponse("Workspace response contains an invalid Unit");
  }
  const target = parseTarget(value["target"]);
  if (
    (value["source"] === "trunk" && target !== null) ||
    (value["source"] === "worktree" && target === null)
  ) {
    throw invalidResponse("Workspace Unit source and target do not match");
  }
  return {
    activationState: value["activationState"],
    change: value["change"],
    draftHeadRevision: value["draftHeadRevision"],
    mergeResult: value["mergeResult"],
    name: value["name"],
    nodeId: value["nodeId"],
    resourceId: value["resourceId"],
    source: value["source"],
    target,
    type: parseUnitType(value["unitType"]),
    unitId: value["unitId"],
    worktreeId,
  };
}

function parseTarget(value: unknown): WorkspaceUnit["target"] {
  if (value === null) return null;
  if (
    !isWorkspaceRecord(value) ||
    typeof value["spaceId"] !== "string" ||
    (value["parentNodeId"] !== null && typeof value["parentNodeId"] !== "string")
  ) {
    throw invalidResponse("Workspace Unit contains an invalid target");
  }
  return { parentNodeId: value["parentNodeId"], spaceId: value["spaceId"] };
}

function isState(value: unknown): value is WorkspaceWorktreeState {
  return (
    value === "draft" ||
    value === "ready" ||
    value === "merging" ||
    value === "merged" ||
    value === "discarded"
  );
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isChange(value: unknown): value is WorkspaceUnit["change"] {
  return value === "modified" || value === "added" || value === "deleted" || value === "unchanged";
}

function isMergeResult(value: unknown): value is WorkspaceUnit["mergeResult"] {
  return (
    value === "pending" ||
    value === "merged" ||
    value === "unchanged" ||
    value === "conflict" ||
    value === "failed"
  );
}

function isActivation(value: unknown): value is WorkspaceUnit["activationState"] {
  return (
    value === "notApplicable" ||
    value === "waitingForMerge" ||
    value === "pending" ||
    value === "completed" ||
    value === "failed" ||
    value === "discarded"
  );
}

function invalidResponse(message: string): Error {
  return workspaceError("workspace-invalid-response", message);
}
