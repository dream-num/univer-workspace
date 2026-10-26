import { createHash, randomUUID } from "node:crypto";
import {
  executeWithStableIdentity,
  isWorkspaceResultUnknown,
  workspaceError,
} from "./errors.js";
import type { AuthenticatedWorkspaceHttp, WorkspaceHttp } from "./http.js";
import { rethrowUnlessServerOutdated } from "./space.js";
import { usernameKey } from "./username.js";
import {
  parseWorktree,
  type WorkspaceWorktree,
  type WorkspaceWorktreeState,
} from "./worktree-model.js";

export interface ListWorktreesInput {
  readonly scope?: "user" | "space";
  readonly spaceId?: string;
  /** Total items to return; pages are followed until reached or exhausted. Defaults to one server page. */
  readonly limit?: number;
  /** Literal substring of name, summary, creator or Team Space name, matched by the server. */
  readonly search?: string;
  /** Keep only Worktrees created by this user; filtered while paging so `limit` counts matches. */
  readonly creatorId?: string;
  /** Same, by username (ASCII case-insensitive, matching SQLite NOCASE). */
  readonly creatorUsername?: string;
  /** Keep only these states (server-side, before paging). */
  readonly states?: readonly WorkspaceWorktreeState[];
  readonly view: "active" | "processed" | "all";
}

export class WorkspaceWorktreeFeature {
  public constructor(private readonly authenticatedHttp: AuthenticatedWorkspaceHttp) {}

  public async list(input: ListWorktreesInput): Promise<readonly WorkspaceWorktree[]> {
    const query = new URLSearchParams({ scope: input.view });
    if (input.scope !== undefined) query.set("kind", input.scope === "user" ? "user" : "team");
    if (input.spaceId !== undefined) query.set("teamSpaceId", input.spaceId);
    for (const state of input.states ?? []) query.append("state", state);
    if (input.search !== undefined) query.set("search", input.search);
    const http = await this.authenticatedHttp();
    const worktrees: WorkspaceWorktree[] = [];
    const filtered = input.creatorId !== undefined || input.creatorUsername !== undefined;
    let cursor: string | null = null;
    do {
      const page = new URLSearchParams(query);
      if (input.limit !== undefined) {
        page.set("limit", String(filtered ? 100 : Math.min(input.limit - worktrees.length, 100)));
      }
      if (cursor !== null) page.set("cursor", cursor);
      const body = await http.json(`/api/worktrees?${page.toString()}`);
      if (!Array.isArray(body["items"])) {
        throw workspaceError("workspace-invalid-response", "Workspace response is missing Worktrees.");
      }
      worktrees.push(
        ...body["items"]
          .map((item) => parseWorktree(item))
          .filter(
            (worktree) =>
              (input.creatorId === undefined || worktree.creator?.id === input.creatorId) &&
              (input.creatorUsername === undefined ||
                (worktree.creator !== undefined &&
                  usernameKey(worktree.creator.username) === usernameKey(input.creatorUsername))),
          ),
      );
      cursor = input.limit !== undefined && typeof body["nextCursor"] === "string" ? body["nextCursor"] : null;
    } while (cursor !== null && worktrees.length < (input.limit ?? 0));
    return input.limit === undefined ? worktrees : worktrees.slice(0, input.limit);
  }

  public async get(worktreeId: string): Promise<WorkspaceWorktree> {
    return await getWorktree(
      await this.authenticatedHttp(),
      requireId(worktreeId, "Worktree ID"),
    );
  }

  /** Addresses a Worktree by `#N`: a Team Space's Team Worktree, or the caller's own User Worktree in their Personal Space. */
  public async getByNumber(spaceId: string, number: number): Promise<WorkspaceWorktree> {
    const http = await this.authenticatedHttp();
    try {
      const body = await http.json(
        `/api/spaces/${encodeURIComponent(requireId(spaceId, "Space ID"))}/worktrees/${String(number)}`,
      );
      return parseWorktree(body["worktree"]);
    } catch (error) {
      return await rethrowUnlessServerOutdated(http, error);
    }
  }

  public async create(input: {
    readonly idempotencyKey?: string;
    readonly name: string;
    readonly scope:
      | { readonly kind: "user" }
      | { readonly kind: "space"; readonly spaceId: string };
    readonly summary?: string;
    readonly visibility?: "private" | "space";
  }): Promise<WorkspaceWorktree> {
    const http = await this.authenticatedHttp();
    const idempotencyKey = input.idempotencyKey ?? randomUUID();
    return await executeWithStableIdentity({
      identity: {
        idempotencyKey,
        name: input.name,
        scope: input.scope,
        ...(input.summary === undefined ? {} : { summary: input.summary }),
        ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
      },
      operation: async (sameInput) => {
        const body = await http.json("/api/worktrees", {
          body: {
            kind: sameInput.scope.kind === "user" ? "user" : "team",
            name: sameInput.name,
            summary: sameInput.summary ?? null,
            ...(sameInput.scope.kind === "space"
              ? {
                  teamSpaceId: sameInput.scope.spaceId,
                  visibility: sameInput.visibility ?? "private",
                }
              : {}),
          },
          idempotencyKey: sameInput.idempotencyKey,
          method: "POST",
        });
        return parseWorktree(body);
      },
    });
  }

  public async update(
    worktreeId: string,
    input: {
      readonly name?: string;
      readonly summary?: string | null;
      readonly visibility?: "private" | "space";
    },
  ): Promise<WorkspaceWorktree> {
    const id = requireId(worktreeId, "Worktree ID");
    const body = await (await this.authenticatedHttp()).json(
      `/api/worktrees/${encodeURIComponent(id)}`,
      { body: input, method: "PATCH" },
    );
    return parseWorktree(body["worktree"], id);
  }

  public async transition(
    worktreeId: string,
    action: "ready" | "reopen" | "merge" | "discard",
    reviewToken?: string,
  ): Promise<WorkspaceWorktree> {
    const id = requireId(worktreeId, "Worktree ID");
    const http = await this.authenticatedHttp();
    const current = await getWorktree(http, id);
    assertTransition(current, action);
    if (action === "merge" && !reviewToken) throw workspaceError("workspace-review-required", "Render the Server Worktree review and provide its reviewToken before merging.");
    const expected: Record<typeof action, WorkspaceWorktreeState> = {
      discard: "discarded",
      merge: "merged",
      ready: "ready",
      reopen: "draft",
    };
    try {
      const body = await http.json(`/api/worktrees/${encodeURIComponent(id)}/${action}`, {
        ...(action === "merge" || action === "discard"
          ? { idempotencyKey: stableKey(action, id) }
          : {}),
        method: "POST",
        ...(action === "merge" ? { body: { reviewToken } } : {}),
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
      const body = await http.json(`/api/worktrees/${encodeURIComponent(id)}`);
      const confirmed = parseWorktree(body["worktree"]);
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
): Promise<WorkspaceWorktree> {
  const body = await http.json(`/api/worktrees/${encodeURIComponent(worktreeId)}`);
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
