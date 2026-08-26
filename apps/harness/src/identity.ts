/**
 * Pure host-side helpers for the harness identity route.
 *
 * These functions are deliberately free of cordis dependencies (only
 * `node:crypto` and `node:path` for safe child-path derivation), so they are
 * unit-testable and reused by both the route handler and the focused host test.
 *
 * Ownership boundary: the harness Host plugin derives the per-user workspace
 * directory from the verified Workspace user id (never from client input),
 * provisions that directory under `workspaceRoot`, and then owns the DSH
 * Workspace record (resolve-or-create) for it.
 * @module @univerjs/univer-workspace-harness/identity
 */

import { createHash } from "node:crypto";
import { basename, dirname, resolve } from "node:path";
import type { WorkspaceId, WorkspaceView } from "@deepseek-ai/dsh-client-connection/client";
import type { UwhIdentity, UwhMeView, UwhTemplate } from "./contract.ts";

/** Full SHA-256 hex digest length (64 hex chars) — the workspace child name scheme. */
export const SHA_256_HEX_LENGTH = 64;

/**
 * Derive the canonical per-user workspace directory name for an opaque user id.
 * The name is a pure function of the user id, so the directory path is stable
 * across Pod replacement and is never influenced by client input.
 */
export function workspacePathName(userId: string): string {
  return createHash("sha256").update(userId, "utf8").digest("hex");
}

/**
 * Whether a candidate path is one DIRECT SHA-256-named child of a root.
 */
export function isDirectSha256Child(workspaceRoot: string, candidate: string): boolean {
  const root = resolve(workspaceRoot);
  const normalized = resolve(candidate);
  if (dirname(normalized) !== root) return false;
  return new RegExp(`^[0-9a-f]{${SHA_256_HEX_LENGTH}}$`).test(basename(normalized));
}

/**
 * Derive and validate the per-user workspace path for a verified user id.
 */
export function workspacePathFor(
  workspaceRoot: string,
  userId: string,
): { ok: true; path: string } | { ok: false; reason: string } {
  if (userId === "") return { ok: false, reason: "missing user id" };
  const path = resolve(workspaceRoot, workspacePathName(userId));
  if (!isDirectSha256Child(workspaceRoot, path)) {
    return { ok: false, reason: "derived workspace path is not a direct SHA-256-named child of the configured workspace root" };
  }
  return { ok: true, path };
}

/**
 * Whether a sequence of session events is a BALANCED logical log.
 */
export function isBalancedLog(events: readonly { type: string }[]): boolean {
  let turns = 0;
  let steps = 0;
  for (const event of events) {
    if (event.type === "turn/start") turns++;
    else if (event.type === "turn/end") turns--;
    else if (event.type === "step/start") steps++;
    else if (event.type === "step/end") steps--;
    if (turns < 0 || steps < 0) return false;
  }
  return turns === 0 && steps === 0;
}

/**
 * Compute the balanced seed cut for a template source.
 */
export function seedCutForSource(
  events: readonly { type: string; seq: number }[],
): { ok: true; cut: number } | { ok: false; reason: string } {
  if (!isBalancedLog(events)) return { ok: false, reason: "template source log is not a balanced logical log" };
  let boundarySeq = -1;
  for (const event of events) if (event.type === "turn/end") boundarySeq = event.seq;
  if (boundarySeq === -1) return { ok: false, reason: "template source has no completed turn" };
  let cut = boundarySeq + 1;
  while (cut < events.length && events[cut]?.type !== "turn/start") cut++;
  return { ok: true, cut };
}

/** The minimal workspace facts the route projects (its durable record fields). */
export interface WorkspaceFacts {
  readonly id: WorkspaceId;
  readonly path: string;
  readonly title: string;
  readonly sessionIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Project a workspace entity onto the wire/JSON view the client consumes. */
export function projectWorkspaceView(workspace: WorkspaceFacts): WorkspaceView {
  return {
    workspaceId: workspace.id,
    path: workspace.path,
    title: workspace.title,
    sessionIds: [...workspace.sessionIds] as WorkspaceView["sessionIds"],
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}

/** Assemble the identity route response. */
export function buildMeView(
  identity: UwhIdentity,
  workspace: WorkspaceView,
  admin: boolean,
  workspaceOrigin: string,
  templates: UwhTemplate[],
): UwhMeView {
  return {
    identity,
    workspace,
    admin,
    workspaceOrigin,
    templates,
  };
}
