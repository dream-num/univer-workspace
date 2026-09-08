/**
 * Pure presentation derivations for the Session-level task card. These helpers
 * project the merged Univer Turn files of a whole Session into the Worktree
 * candidates (or the single trunk Resource fallback) the card may surface;
 * none of them rewrite the Turn projection or the Worktree model.
 * @module dsh-univer-workspace-plugin/client/components/session-task-card-model
 */

import type { UniverTurnFile } from "../conversation/univer-turn-definition.ts";
import { opensFloatingWindow } from "../conversation/univer-turn-definition.ts";
import type { WorktreeStatus } from "../../shared/state.ts";
import { absorbWorktreeCoveredTrunkFiles } from "./turn-context-card-model.ts";

/** One Worktree touched by this Session, newest operation last wins. */
export interface SessionWorktreeCandidate {
  readonly docKey: string;
  readonly worktreeId: string;
  readonly label: string | null;
  readonly preferredUnitId: string | null;
  readonly preferredUnitType: string | null;
  /** Monotonic rank in Session traversal order; larger means more recent. */
  readonly recency: number;
}

/** The latest independent trunk Resource, used only when no Worktree exists. */
export interface SessionResourceFallback {
  readonly docKey: string;
  readonly resourceId: string;
  readonly label: string | null;
  readonly preferredUnitId: string | null;
  readonly unitType: string | null;
  readonly recency: number;
}

/** What the Session task card may offer: Worktree cards, else one trunk card. */
export interface SessionCardCandidates {
  /** Distinct Worktrees, most recently touched first. */
  readonly worktrees: readonly SessionWorktreeCandidate[];
  /** `null` whenever any Worktree candidate exists. */
  readonly fallback: SessionResourceFallback | null;
}

/** A Worktree the Session still acts on; merged/discarded Worktrees are done. */
export function isProcessedWorktreeStatus(status: WorktreeStatus): boolean {
  return status === "merged" || status === "discarded";
}

/**
 * Reduce all Session Turn files into long-lived task-card intent candidates.
 * This is a deliberate intent projection, NOT the in-message Turn card's
 * presentation absorption: the Turn card absorbs trunk files covered by ANY
 * succeeded Worktree operation, while this projection first drops every
 * operation that does not qualify via `opensFloatingWindow`, then absorbs
 * trunk files covered by those qualifying Worktree operations only. A
 * succeeded but non-qualifying Worktree operation therefore neither creates
 * a candidate nor absorbs a trunk Resource, so the Resource fallback can
 * still surface. Recency only ranks qualifying operations, keeping their
 * original relative traversal order. Worktree identity comes from the
 * qualifying operation's `worktreeId`; a `wt:` file with no qualifying
 * operation never fabricates a Worktree candidate and never suppresses the
 * Resource fallback. Independent trunk Resources accumulate separately and
 * the most recent one becomes the fallback, but only when no Worktree
 * candidate exists at all.
 */
export function sessionCardCandidates(files: readonly UniverTurnFile[]): SessionCardCandidates {
  const qualifying: UniverTurnFile[] = [];
  for (const file of files) {
    const operations = file.operations.filter((operation) => opensFloatingWindow(operation));
    if (operations.length > 0) qualifying.push({ docKey: file.docKey, operations });
  }
  const absorbed = absorbWorktreeCoveredTrunkFiles(qualifying);
  const worktrees = new Map<string, SessionWorktreeCandidate>();
  const resources = new Map<string, SessionResourceFallback>();
  let recency = 0;
  for (const file of absorbed) {
    for (const operation of file.operations) {
      recency += 1;
      if (operation.worktreeId !== null) {
        const worktreeId = operation.worktreeId;
        const docKey = `wt:${worktreeId}`;
        const previous = worktrees.get(worktreeId);
        worktrees.set(worktreeId, {
          docKey,
          worktreeId,
          label: operation.label ?? previous?.label ?? null,
          preferredUnitId: operation.unitId ?? previous?.preferredUnitId ?? null,
          preferredUnitType: operation.unitType ?? previous?.preferredUnitType ?? null,
          recency,
        });
        continue;
      }
      const resourceId =
        operation.resourceId ?? (file.docKey.startsWith("res:") ? file.docKey.slice(4) : null);
      if (resourceId === null) continue;
      const docKey = `res:${resourceId}`;
      const previous = resources.get(resourceId);
      resources.set(resourceId, {
        docKey,
        resourceId,
        label: operation.label ?? previous?.label ?? null,
        preferredUnitId: operation.unitId ?? previous?.preferredUnitId ?? null,
        unitType: operation.unitType ?? previous?.unitType ?? null,
        recency,
      });
    }
  }
  const candidates = [...worktrees.values()].sort((a, b) => b.recency - a.recency);
  const fallback =
    candidates.length > 0
      ? null
      : ([...resources.values()].sort((a, b) => b.recency - a.recency)[0] ?? null);
  return { worktrees: candidates, fallback };
}

/**
 * One focus suggestion delivered to the Session task card. The Dock owns
 * intent; the card owns selection. `nonce` makes repeated intents for the
 * same target observable, `source` distinguishes a new Agent operation from
 * an explicit manual open request.
 */
export interface SessionTaskFocusIntent {
  readonly nonce: number;
  readonly source: "operation" | "manual";
  readonly docKey: string;
  readonly worktreeId: string | null;
  readonly preferredUnitId: string | null;
}

/**
 * The card's default current Worktree when the user has not pinned one: the
 * most recent still-active candidate, else the most recent processed one.
 * Live status comes from the polled file state; an unknown status counts as
 * active so a loading Worktree is never demoted behind a processed one.
 */
export function defaultCurrentWorktreeId(
  worktrees: readonly SessionWorktreeCandidate[],
  statusOf: (candidate: SessionWorktreeCandidate) => WorktreeStatus | undefined,
): string | null {
  const active = worktrees.find((candidate) => {
    const status = statusOf(candidate);
    return status === undefined || !isProcessedWorktreeStatus(status);
  });
  return (active ?? worktrees[0])?.worktreeId ?? null;
}
