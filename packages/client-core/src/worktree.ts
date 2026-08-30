import { createHash, randomUUID } from "node:crypto";
import {
  executeWithStableIdentity,
  isWorkspaceResultUnknown,
  type WorkspaceApplicationError,
  workspaceError,
} from "./errors.js";
import type { AuthenticatedWorkspaceHttp, WorkspaceHttp } from "./http.js";
import {
  parseWorktree,
  type WorkspaceWorktree,
  type WorkspaceWorktreeState,
} from "./worktree-model.js";

export interface ListWorktreesInput {
  readonly scope?: "user" | "space";
  readonly spaceId?: string;
  readonly view: "active" | "processed";
}

export class WorkspaceWorktreeFeature {
  public constructor(private readonly authenticatedHttp: AuthenticatedWorkspaceHttp) {}

  public async list(
    input: ListWorktreesInput,
    signal?: AbortSignal,
  ): Promise<readonly WorkspaceWorktree[]> {
    const query = new URLSearchParams({ scope: input.view });
    if (input.scope !== undefined) query.set("kind", input.scope === "user" ? "user" : "team");
    if (input.spaceId !== undefined) query.set("teamSpaceId", input.spaceId);
    const http = await this.authenticatedHttp(signal);
    signal?.throwIfAborted();
    const body = await http.json(`/api/worktrees?${query.toString()}`, {
      ...(signal === undefined ? {} : { signal }),
    });
    if (!Array.isArray(body["items"])) {
      throw workspaceError("workspace-invalid-response", "Workspace response is missing Worktrees.");
    }
    return body["items"].map((item) => parseWorktree(item));
  }

  public async get(worktreeId: string, signal?: AbortSignal): Promise<WorkspaceWorktree> {
    const http = await this.authenticatedHttp(signal);
    signal?.throwIfAborted();
    return await getWorktree(http, requireId(worktreeId, "Worktree ID"), signal);
  }

  public async create(input: {
    readonly idempotencyKey?: string;
    readonly name: string;
    readonly scope:
      | { readonly kind: "user" }
      | { readonly kind: "space"; readonly spaceId: string };
    readonly visibility?: "private" | "space";
  }, signal?: AbortSignal): Promise<WorkspaceWorktree> {
    const http = await this.authenticatedHttp(signal);
    signal?.throwIfAborted();
    const idempotencyKey = input.idempotencyKey ?? randomUUID();
    return await executeWithStableIdentity({
      identity: {
        idempotencyKey,
        name: input.name,
        scope: input.scope,
        ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
      },
      operation: async (sameInput) => {
        const body = await http.json("/api/worktrees", {
          body: {
            kind: sameInput.scope.kind === "user" ? "user" : "team",
            name: sameInput.name,
            summary: null,
            ...(sameInput.scope.kind === "space"
              ? {
                  teamSpaceId: sameInput.scope.spaceId,
                  visibility: sameInput.visibility ?? "private",
                }
              : {}),
          },
          idempotencyKey: sameInput.idempotencyKey,
          method: "POST",
          ...(signal === undefined ? {} : { signal }),
        });
        return parseWorktree(body);
      },
      ...(signal === undefined ? {} : { signal }),
    });
  }

  public async update(
    worktreeId: string,
    input: { readonly name?: string; readonly visibility?: "private" | "space" },
    signal?: AbortSignal,
  ): Promise<WorkspaceWorktree> {
    const id = requireId(worktreeId, "Worktree ID");
    const http = await this.authenticatedHttp(signal);
    signal?.throwIfAborted();
    const body = await http.json(
      `/api/worktrees/${encodeURIComponent(id)}`,
      { body: input, method: "PATCH", ...(signal === undefined ? {} : { signal }) },
    );
    return parseWorktree(body["worktree"], id);
  }

  public async transition(
    worktreeId: string,
    action: "ready" | "reopen" | "merge" | "discard",
    signal?: AbortSignal,
  ): Promise<WorkspaceWorktree> {
    const id = requireId(worktreeId, "Worktree ID");
    const http = await this.authenticatedHttp(signal);
    signal?.throwIfAborted();
    const current = await getWorktree(http, id, signal);
    assertTransition(current, action);
    const expected: Record<typeof action, WorkspaceWorktreeState> = {
      discard: "discarded",
      merge: "merged",
      ready: "ready",
      reopen: "draft",
    };
    signal?.throwIfAborted();
    try {
      const body = await http.json(`/api/worktrees/${encodeURIComponent(id)}/${action}`, {
        ...(action === "merge" || action === "discard"
          ? { idempotencyKey: stableKey(action, id) }
          : {}),
        method: "POST",
        ...(signal === undefined ? {} : { signal }),
      });
      const result = parseWorktree(body["worktree"], id);
      if (result.state !== expected[action]) {
        throw workspaceError(
          "workspace-result-mismatch",
          "Workspace lifecycle response Worktree state does not match the requested operation.",
          {
            actual: { worktree: result },
            expected: { state: expected[action], worktreeId: id },
          },
        );
      }
      return result;
    } catch (error) {
      if (!isWorkspaceResultUnknown(error)) throw error;
      if (signal?.aborted) throw lifecycleUnknown(id, expected[action]);
      let confirmed: WorkspaceWorktree;
      try {
        const body = await http.json(`/api/worktrees/${encodeURIComponent(id)}`, {
          ...(signal === undefined ? {} : { signal }),
        });
        confirmed = parseWorktree(body["worktree"]);
      } catch (readError) {
        if (signal?.aborted || isWorkspaceResultUnknown(readError)) {
          throw lifecycleUnknown(id, expected[action]);
        }
        throw readError;
      }
      if (confirmed.id === id && confirmed.state === expected[action]) return confirmed;
      throw workspaceError(
        "workspace-result-unknown",
        "Workspace lifecycle result could not be confirmed from the current Worktree state.",
        {
          actualId: confirmed.id,
          actualState: confirmed.state,
          expectedState: expected[action],
          worktreeId: id,
        },
      );
    }
  }
}

export async function getWorktree(
  http: WorkspaceHttp,
  worktreeId: string,
  signal?: AbortSignal,
): Promise<WorkspaceWorktree> {
  signal?.throwIfAborted();
  const body = await http.json(`/api/worktrees/${encodeURIComponent(worktreeId)}`, {
    ...(signal === undefined ? {} : { signal }),
  });
  return parseWorktree(body["worktree"], worktreeId);
}

export function stableKey(kind: string, ...parts: readonly string[]): string {
  const hash = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  return `workspace-${kind}-${hash}`;
}

function assertTransition(
  worktree: WorkspaceWorktree,
  action: "ready" | "reopen" | "merge" | "discard",
): void {
  const allowed =
    (action === "ready" && worktree.state === "draft") ||
    (action === "reopen" && worktree.state === "ready") ||
    (action === "merge" && worktree.state === "ready") ||
    (action === "discard" && (worktree.state === "draft" || worktree.state === "ready"));
  if (!allowed) {
    throw workspaceError(
      "workspace-lifecycle-invalid",
      `Cannot ${action} Worktree ${worktree.id} from ${worktree.state}.`,
    );
  }
}

function requireId(value: string, label: string): string {
  const id = value.trim();
  if (id === "") {
    throw workspaceError("workspace-argument-invalid", `${label} must not be empty.`);
  }
  return id;
}

function lifecycleUnknown(
  worktreeId: string,
  expectedState: WorkspaceWorktreeState,
): WorkspaceApplicationError {
  return workspaceError(
    "workspace-result-unknown",
    "Workspace lifecycle result could not be confirmed from the current Worktree state.",
    { expectedState, worktreeId },
  );
}
