import { workspaceError } from "./errors.js";
import { isWorkspaceRecord } from "./http.js";
import type { WorkspaceIssueState, WriteSource } from "./issue-model.js";
import { parseUnitType, type WorkspaceUnitType } from "./space-model.js";

export type WorkspaceWorktreeState = "draft" | "ready" | "merging" | "merged" | "discarded";

const WORKTREE_CAPABILITIES = [
  "review",
  "editDraft",
  "addUnit",
  "changeVisibility",
  "markReady",
  "reopen",
  "merge",
  "discard",
] as const;
export type WorkspaceWorktreeCapabilities = {
  readonly [Name in (typeof WORKTREE_CAPABILITIES)[number]]: boolean;
};

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
  readonly freshness: WorkspaceUnitFreshness | null;
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

export interface WorkspaceUnitFreshness {
  readonly addedAt: string;
  readonly baselineTrunkRevision: number;
  readonly label: "current" | "behind" | "stale";
  readonly revisionsBehind: number;
}

export interface WorkspaceWorktree {
  readonly id: string;
  readonly name: string;
  /** Repository-level `#N`; null for Worktrees created before numbering existed. Absent in responses that omit it. */
  readonly number?: number | null;
  readonly spaceId?: string;
  readonly summary?: string | null;
  readonly kind?: "user" | "team";
  readonly visibility?: "private" | "space";
  readonly creator?: { readonly id: string; readonly username: string };
  readonly createdAt?: string;
  readonly createdVia?: WriteSource;
  readonly updatedAt?: string;
  readonly state: WorkspaceWorktreeState;
  readonly units: readonly WorkspaceUnit[];
  /** What the signed-in user may do with it now. Absent in responses that omit it. */
  readonly capabilities?: WorkspaceWorktreeCapabilities;
  /** The Issue a Team Worktree serves; null when none is linked or the caller cannot read its Space. */
  readonly issue?: { readonly number: number; readonly title: string; readonly state: WorkspaceIssueState } | null;
  /** Declared checks that pass, fail or lack a counting result; null when the caller cannot review. Absent in lists. */
  readonly checks?: WorkspaceChecksSummary | null;
}

export interface WorkspaceChecksSummary {
  readonly passed: number;
  readonly failed: number;
  readonly missing: number;
}

export interface WorkspaceCheckResult {
  readonly reporter: { readonly id: string; readonly username: string; readonly displayName: string };
  readonly state: "passed" | "failed";
  readonly summary: string;
  readonly reportedAt: string;
  /** Reported on the content the pull request has now, or merged with. */
  readonly current: boolean;
  /** Current, and reported by someone who may merge the pull request. */
  readonly counts: boolean;
}

export interface WorkspaceCheck {
  readonly name: string;
  /** Declared in Trunk's `.agents/checks.md`; other reported names are not required. */
  readonly declared: boolean;
  readonly state: "passed" | "failed" | "missing";
  readonly results: readonly WorkspaceCheckResult[];
}

export function parseCheck(value: unknown): WorkspaceCheck {
  const results = isWorkspaceRecord(value) ? value["results"] : undefined;
  if (
    !isWorkspaceRecord(value) ||
    typeof value["name"] !== "string" ||
    typeof value["declared"] !== "boolean" ||
    (value["state"] !== "passed" && value["state"] !== "failed" && value["state"] !== "missing") ||
    !Array.isArray(results)
  ) {
    throw invalidResponse("Workspace response contains an invalid check");
  }
  return {
    name: value["name"],
    declared: value["declared"],
    state: value["state"],
    results: results.map((result: unknown) => {
      const reporter = isWorkspaceRecord(result) ? result["reporter"] : undefined;
      if (
        !isWorkspaceRecord(result) ||
        !isWorkspaceRecord(reporter) ||
        typeof reporter["id"] !== "string" ||
        typeof reporter["username"] !== "string" ||
        typeof reporter["displayName"] !== "string" ||
        (result["state"] !== "passed" && result["state"] !== "failed") ||
        typeof result["summary"] !== "string" ||
        typeof result["reportedAt"] !== "string" ||
        typeof result["current"] !== "boolean" ||
        typeof result["counts"] !== "boolean"
      ) {
        throw invalidResponse("Workspace response contains an invalid check result");
      }
      return {
        reporter: { id: reporter["id"], username: reporter["username"], displayName: reporter["displayName"] },
        state: result["state"],
        summary: result["summary"],
        reportedAt: result["reportedAt"],
        current: result["current"],
        counts: result["counts"],
      };
    }),
  };
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
  const spaceId = parseTeamSpaceId(value["teamSpace"]);
  const capabilities = value["capabilities"];
  const hasCapabilities =
    isWorkspaceRecord(capabilities) && WORKTREE_CAPABILITIES.every((name) => typeof capabilities[name] === "boolean");
  return {
    id: worktreeId,
    name: value["name"],
    state: value["state"],
    units: units.map((unit) => parseUnit(unit, worktreeId)),
    ...(Number.isSafeInteger(value["number"]) || value["number"] === null
      ? { number: value["number"] as number | null }
      : {}),
    ...(typeof value["summary"] === "string" || value["summary"] === null
      ? { summary: value["summary"] }
      : {}),
    ...(spaceId === undefined ? {} : { spaceId }),
    ...(value["kind"] === "user" || value["kind"] === "team" ? { kind: value["kind"] } : {}),
    ...(value["visibility"] === "private" || value["visibility"] === "space"
      ? { visibility: value["visibility"] }
      : {}),
    ...(value["createdVia"] === "browser" || value["createdVia"] === "agent" || value["createdVia"] === "unknown"
      ? { createdVia: value["createdVia"] }
      : {}),
    ...parseCreator(value["creator"]),
    ...(typeof value["createdAt"] === "string" ? { createdAt: value["createdAt"] } : {}),
    ...(typeof value["updatedAt"] === "string" ? { updatedAt: value["updatedAt"] } : {}),
    ...(hasCapabilities
      ? {
          capabilities: Object.fromEntries(
            WORKTREE_CAPABILITIES.map((name) => [name, capabilities[name]]),
          ) as WorkspaceWorktreeCapabilities,
        }
      : {}),
    ...parseIssueLink(value["issue"]),
    ...parseChecksSummary(value["checks"]),
  };
}

function parseChecksSummary(value: unknown): Pick<WorkspaceWorktree, "checks"> {
  if (value === null) return { checks: null };
  return isWorkspaceRecord(value) && isRevision(value["passed"]) && isRevision(value["failed"]) && isRevision(value["missing"])
    ? { checks: { passed: value["passed"], failed: value["failed"], missing: value["missing"] } }
    : {};
}

function parseIssueLink(value: unknown): Pick<WorkspaceWorktree, "issue"> {
  if (value === null) return { issue: null };
  return isWorkspaceRecord(value) && Number.isSafeInteger(value["number"]) && typeof value["title"] === "string" &&
    (value["state"] === "open" || value["state"] === "closed")
    ? { issue: { number: value["number"] as number, title: value["title"], state: value["state"] } }
    : {};
}

function parseCreator(value: unknown): { readonly creator?: { readonly id: string; readonly username: string } } {
  return isWorkspaceRecord(value) && typeof value["id"] === "string" && typeof value["username"] === "string"
    ? { creator: { id: value["id"], username: value["username"] } }
    : {};
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
  if (value["worktreeId"] !== undefined && value["worktreeId"] !== worktreeId) {
    throw workspaceError(
      "workspace-result-mismatch",
      "Workspace response contains a Unit from a different Worktree.",
    );
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
    freshness: parseFreshness(value["freshness"]),
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

function parseTeamSpaceId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isWorkspaceRecord(value) || typeof value["id"] !== "string" || value["id"].length === 0) {
    throw invalidResponse("Workspace Worktree contains an invalid Team Space");
  }
  return value["id"];
}

function parseFreshness(value: unknown): WorkspaceUnitFreshness | null {
  // Servers released before freshness existed omit it.
  if (value === undefined || value === null) return null;
  if (
    !isWorkspaceRecord(value) ||
    (value["label"] !== "current" && value["label"] !== "behind" && value["label"] !== "stale") ||
    !isRevision(value["baselineTrunkRevision"]) ||
    !isRevision(value["revisionsBehind"]) ||
    typeof value["addedAt"] !== "string"
  ) {
    throw invalidResponse("Workspace Unit contains invalid freshness");
  }
  return {
    addedAt: value["addedAt"],
    baselineTrunkRevision: value["baselineTrunkRevision"],
    label: value["label"],
    revisionsBehind: value["revisionsBehind"],
  };
}

function parseTarget(value: unknown): WorkspaceUnit["target"] {
  if (value === null) return null;
  if (
    !isWorkspaceRecord(value) ||
    typeof value["spaceId"] !== "string" ||
    value["spaceId"].length === 0 ||
    (value["parentNodeId"] !== null &&
      (typeof value["parentNodeId"] !== "string" || value["parentNodeId"].length === 0))
  ) {
    throw invalidResponse("Workspace Unit contains an invalid target");
  }
  return { parentNodeId: value["parentNodeId"], spaceId: value["spaceId"] };
}

export function isState(value: unknown): value is WorkspaceWorktreeState {
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
