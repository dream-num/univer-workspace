import type { PublicUser } from "../permissions/index.js";
import type { SpaceAccess } from "../access/index.js";
import { ApplicationError } from "../../middleware/errors.js";
import { forbidden, invalid, notFound } from "./issues.errors.js";
import type { IssueRelations, IssueRow, IssueUpdate, LabelRow, VerdictRow } from "./issues.repository.js";
import type { IssueEventKind, IssueState, IssueStateReason, RequestedVerdictKind } from "./issues.types.js";

interface IssueEvent {
  readonly kind: IssueEventKind;
  readonly payload: Record<string, unknown>;
}

export function requireIssueSpace(space: SpaceAccess | null): SpaceAccess {
  if (!space) throw notFound();
  if (space.type !== "team") throw new ApplicationError("CONFLICT", 409, "Issues are available only in team spaces.");
  return space;
}

export function checkCreateRelations(space: SpaceAccess, relations: IssueRelations): void {
  if (Object.values(relations).some((ids) => ids.length > 0) && !space.capabilities.triageIssues) throw forbidden();
}

export function checkCommentWrite(space: SpaceAccess, userId: string, author: string, action: "update" | "delete"): void {
  const manager = space.role === "owner" || space.role === "admin";
  if (!space.member || (userId !== author && !(action === "delete" && manager))) throw forbidden();
}

/** Derive mutations and audit events from the issue as read in the write transaction. */
export function planIssueUpdate(row: IssueRow, patch: IssueUpdate, userId: string, triage: boolean) {
  const touchesText = patch.title !== undefined || patch.body !== undefined || patch.state !== undefined;
  const touchesRelations = patch.labelIds !== undefined || patch.assigneeUserIds !== undefined || patch.nodeIds !== undefined;
  if ((touchesText && row.author_user_id !== userId && !triage) || (touchesRelations && !triage)) throw forbidden();

  const events: IssueEvent[] = [];
  const title = patch.title ?? row.title;
  const body = patch.body ?? row.body;
  const text = title !== row.title || body !== row.body ? { title, body } : null;
  if (title !== row.title) events.push({ kind: "renamed", payload: { from: row.title, to: title } });

  let state: { value: IssueState; reason: IssueStateReason | null; closedBy: string | null } | null = null;
  if (patch.state === "closed" && (row.state !== "closed" || row.state_reason !== patch.stateReason)) {
    state = { value: "closed", reason: patch.stateReason, closedBy: userId };
    events.push({ kind: "closed", payload: { reason: patch.stateReason } });
  } else if (patch.state === "open" && row.state === "closed") {
    state = { value: "open", reason: null, closedBy: null };
    events.push({ kind: "reopened", payload: {} });
  }
  return { text, state, events };
}

export function planVerdict(input: {
  readonly issue: IssueRow;
  readonly latest: VerdictRow | null;
  readonly space: SpaceAccess;
  readonly assignee: boolean;
  readonly userId: string;
  readonly kind: RequestedVerdictKind;
  readonly body: string;
  readonly now: number;
}): { readonly createdAt: number } | null {
  const { issue, latest, space, kind } = input;
  const unchanged = kind === "accepted"
    ? issue.state === "closed" && issue.state_reason === "completed"
    : issue.state === "open";
  if (unchanged && latest?.kind === kind && latest.actor_user_id === input.userId && latest.body === input.body) return null;
  const allowed = kind === "submitted"
    ? space.member && input.assignee
    : space.member && (issue.author_user_id === input.userId || space.capabilities.triageIssues);
  if (!allowed) {
    throw new ApplicationError("FORBIDDEN", 403, kind === "submitted"
      ? "Only an assignee of this Issue may submit it."
      : "Only someone who may close this Issue may accept it or send it back.");
  }
  if (issue.state === "closed") throw new ApplicationError("ISSUE_CLOSED", 409, "This Issue is closed.");
  if (kind === "submitted" && latest?.kind === "submitted") {
    throw new ApplicationError("ISSUE_ALREADY_SUBMITTED", 409, "This Issue is already submitted for acceptance.");
  }
  if (kind !== "submitted" && latest?.kind !== "submitted") {
    throw new ApplicationError("ISSUE_NOT_SUBMITTED", 409, "This Issue is not submitted for acceptance.");
  }
  // Replica clocks may disagree, and the latest verdict must stay the one with the greatest time.
  return { createdAt: Math.max(input.now, (latest?.created_at ?? 0) + 1) };
}

const relationLimits = {
  labelIds: [20, "An Issue can have at most 20 labels."],
  assigneeUserIds: [10, "An Issue can have at most 10 assignees."],
  nodeIds: [20, "An Issue can reference at most 20 files."],
} as const;

export function relationDelta(field: keyof IssueRelations, current: readonly string[], desired: readonly string[]) {
  const wanted = new Set(desired);
  const [max, message] = relationLimits[field];
  if (wanted.size > max) throw invalid(message, field);
  const have = new Set(current);
  return { removed: current.filter((id) => !wanted.has(id)), added: [...wanted].filter((id) => !have.has(id)) };
}

export function checkLabelCapacity(count: number): void {
  if (count >= 100) throw invalid("A Space can have at most 100 labels.", "name");
}

export function labelEvent(kind: "labeled" | "unlabeled", spaceId: string, label: LabelRow | null): IssueEvent {
  if (!label || label.space_id !== spaceId) throw invalid("Label does not belong to this Space.", "labelIds");
  return { kind, payload: { labelId: label.id, name: label.name, color: label.color } };
}

export function assigneeEvent(
  kind: "assigned" | "unassigned", userId: string, user: PublicUser | undefined, participant?: boolean,
): IssueEvent {
  if (kind === "assigned" && !participant) {
    throw invalid("Assignees must be the owner or a member of this Space.", "assigneeUserIds");
  }
  return { kind, payload: { userId, username: user?.username ?? null, displayName: user?.displayName ?? null } };
}

export function referenceEvent(
  kind: "node_referenced" | "node_unreferenced", nodeId: string, spaceId: string,
  node: { readonly name: string; readonly spaceId: string } | null,
): IssueEvent {
  if (kind === "node_referenced" && node?.spaceId !== spaceId) {
    throw invalid("Referenced files must be in this Space.", "nodeIds");
  }
  return { kind, payload: { nodeId, name: node?.name ?? null } };
}
