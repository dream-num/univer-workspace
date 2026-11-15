import type { PublicUser } from "../permissions/index.js";
import { forbidden, invalid } from "./issues.errors.js";
import type { IssueRelations, IssueRow, IssueUpdate, LabelRow } from "./issues.repository.js";
import type { IssueEventKind, IssueState, IssueStateReason } from "./issues.types.js";

interface IssueEvent {
  readonly kind: IssueEventKind;
  readonly payload: Record<string, unknown>;
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
