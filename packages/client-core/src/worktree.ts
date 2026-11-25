import { createHash, randomUUID } from "node:crypto";
import { sessionIdentity } from "./auth.js";
import {
  executeWithStableIdentity,
  isWorkspaceResultUnknown,
  WorkspaceApplicationError,
  workspaceError,
} from "./errors.js";
import { isWorkspaceRecord, type AuthenticatedWorkspaceHttp, type WorkspaceHttp } from "./http.js";
import { rethrowUnlessServerOutdated } from "./space.js";
import { usernameKey } from "./username.js";
import {
  parseCheck,
  parseRevertItem,
  parseRevertPlan,
  parseWorktree,
  type WorkspaceCheck,
  type WorkspaceRevertPlan,
  type WorkspaceRevertResult,
  type WorkspaceWorktree,
  type WorkspaceWorktreeState,
} from "./worktree-model.js";

/** One merged pull request, or every merged pull request linked to an Issue. */
export type WorkspaceRevertTarget =
  | { readonly worktreeId: string }
  | { readonly spaceId: string; readonly issueNumber: number };

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
  /** Keep only Worktrees the signed-in user, whose ID this is, may merge and did not create; filtered while paging. */
  readonly reviewerId?: string;
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
    const filtered =
      input.creatorId !== undefined || input.creatorUsername !== undefined || input.reviewerId !== undefined;
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
                  usernameKey(worktree.creator.username) === usernameKey(input.creatorUsername))) &&
              (input.reviewerId === undefined ||
                (worktree.capabilities?.merge === true && worktree.creator?.id !== input.reviewerId)),
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
    readonly issueNumber?: number;
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
        ...(input.issueNumber === undefined ? {} : { issueNumber: input.issueNumber }),
      },
      operation: async (sameInput) => {
        const body = await http.json("/api/worktrees", {
          body: {
            kind: sameInput.scope.kind === "user" ? "user" : "team",
            name: sameInput.name,
            summary: sameInput.summary ?? null,
            ...(sameInput.issueNumber === undefined ? {} : { issueNumber: sameInput.issueNumber }),
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
      readonly issueNumber?: number | null;
    },
  ): Promise<WorkspaceWorktree> {
    const id = requireId(worktreeId, "Worktree ID");
    const body = await (await this.authenticatedHttp()).json(
      `/api/worktrees/${encodeURIComponent(id)}`,
      { body: input, method: "PATCH" },
    );
    return parseWorktree(body["worktree"], id);
  }

  /**
   * Leaves out every file that is in Trash or permanently deleted, which no merge can write, so the other files can
   * merge. Those files stay as they are. The server takes this only on a draft, so a ready pull request goes back to
   * draft and is marked ready again.
   */
  public async leaveOutTrashed(worktreeId: string): Promise<WorkspaceWorktree> {
    const id = requireId(worktreeId, "Worktree ID");
    const worktree = await this.get(id);
    const trashed = worktree.units.filter(
      (unit) => unit.change !== "deleted" && (unit.fileState === "inTrash" || unit.fileState === "deleted"),
    );
    if (!trashed.length) return worktree;
    const ready = worktree.state === "ready";
    if (ready) await this.transition(id, "reopen");
    const http = await this.authenticatedHttp();
    for (const unit of trashed) {
      await http.json(
        `/api/worktrees/${encodeURIComponent(id)}/units/${encodeURIComponent(unit.unitId)}/removal`,
        { body: { removed: true }, method: "POST" },
      );
    }
    if (ready) await this.transition(id, "ready");
    return await this.get(id);
  }

  /** Declared checks in Trunk's `.agents/checks.md` order, then reported names that are not declared. */
  public async checks(worktreeId: string): Promise<readonly WorkspaceCheck[]> {
    const id = requireId(worktreeId, "Worktree ID");
    const body = await (await this.authenticatedHttp()).json(`/api/worktrees/${encodeURIComponent(id)}/checks`);
    if (!Array.isArray(body["checks"])) {
      throw workspaceError("workspace-invalid-response", "Workspace response is missing checks.");
    }
    return body["checks"].map((check: unknown) => parseCheck(check));
  }

  /** Reports one check on the ready pull request's current content; the server binds the content. */
  public async reportCheck(
    worktreeId: string,
    name: string,
    input: { readonly state: "passed" | "failed"; readonly summary?: string },
  ): Promise<WorkspaceCheck> {
    const id = requireId(worktreeId, "Worktree ID");
    const body = await (await this.authenticatedHttp()).json(
      `/api/worktrees/${encodeURIComponent(id)}/checks/${encodeURIComponent(requireId(name, "Check name"))}`,
      { body: input, method: "PUT" },
    );
    return parseCheck(body["check"]);
  }

  /** What a revert would do to each file, read from server facts. Nothing changes. */
  public async revertPlan(target: WorkspaceRevertTarget): Promise<WorkspaceRevertPlan> {
    return parseRevertPlan(await (await this.authenticatedHttp()).json(revertPath(target)));
  }

  /**
   * Takes the merged changes out of Trunk and leaves each blocked file as it is: only a person in the browser may
   * overwrite later edits. A resend after an unknown result is safe, because a file the first one restored is then
   * blocked by that restore.
   */
  public async revert(target: WorkspaceRevertTarget): Promise<WorkspaceRevertResult> {
    const body = await (await this.authenticatedHttp()).json(revertPath(target), { idempotencyKey: randomUUID(), method: "POST" });
    const operation = body["operation"];
    if (!isWorkspaceRecord(operation) || typeof operation["id"] !== "string" || typeof operation["state"] !== "string") {
      throw workspaceError("workspace-invalid-response", "Workspace response is missing the revert Operation.");
    }
    const error = operation["error"];
    const items = body["items"];
    return {
      operation: {
        id: operation["id"],
        state: operation["state"],
        error: isWorkspaceRecord(error) && typeof error["code"] === "string" && typeof error["message"] === "string"
          ? { code: error["code"], message: error["message"] }
          : null,
      },
      items: Array.isArray(items) ? items.map((item: unknown) => parseRevertItem(item)) : null,
    };
  }

  public async transition(worktreeId: string, action: LifecycleAction): Promise<WorkspaceWorktree> {
    const id = requireId(worktreeId, "Worktree ID");
    const http = await this.authenticatedHttp();
    const { from, to } = LIFECYCLE[action];
    let before: LifecycleRead;
    let keyed: { readonly idempotencyKey?: string };
    try {
      before = await readLifecycle(http, id, id);
      if (!from.includes(before.worktree.state)) {
        throw workspaceError(
          "workspace-lifecycle-invalid",
          `Cannot ${action} pull request ${label(before.worktree)} while it is ${before.worktree.state}.`,
        );
      }
      // The server keeps one Operation per key for whoever sent it first, so the key names the caller too.
      keyed = action === "merge" || action === "discard"
        ? { idempotencyKey: stableKey(action, id, (await sessionIdentity(http)).subject.id) }
        : {};
    } catch (error) {
      if (!isWorkspaceResultUnknown(error)) throw error;
      throw workspaceError(
        "workspace-request-failed",
        `Workspace could not be reached, so the ${action} request was not sent and nothing changed.`,
        { cause: error.message, worktreeId: id },
      );
    }
    try {
      const body = await http.json(`/api/worktrees/${encodeURIComponent(id)}/${action}`, {
        ...keyed,
        method: "POST",
      });
      const result = parseWorktree(body["worktree"], id);
      if (result.state !== to) {
        throw workspaceError(
          "workspace-result-mismatch",
          "Workspace lifecycle response Worktree state does not match the requested operation.",
          {
            actual: { worktree: result },
            expected: { state: to, worktreeId: id },
          },
        );
      }
      return result;
    } catch (error) {
      // Once a merge finished, the server replays only the Operation that recorded it and refuses everyone else.
      const refused = error instanceof WorkspaceApplicationError && error.code === "FORBIDDEN";
      if (action === "merge" && before.processed && refused) {
        throw workspaceError("workspace-lifecycle-invalid", `Pull request ${label(before.worktree)} is already merged.`);
      }
      if (!isWorkspaceResultUnknown(error)) throw error;
      const confirmed = await readLifecycle(http, id);
      const { worktree } = confirmed;
      // A merged pull request that is not processed yet stopped partway, so it does not confirm a merge.
      if (worktree.id === id && worktree.state === to && (action !== "merge" || confirmed.processed)) return worktree;
      throw workspaceError(
        "workspace-result-unknown",
        "Workspace lifecycle result could not be confirmed from the current Worktree state.",
        {
          actualId: worktree.id,
          actualState: worktree.state,
          expectedState: to,
          worktreeId: id,
        },
      );
    }
  }
}

type LifecycleAction = "ready" | "reopen" | "merge" | "discard";

const LIFECYCLE: Record<
  LifecycleAction,
  { readonly from: readonly WorkspaceWorktreeState[]; readonly to: WorkspaceWorktreeState }
> = {
  ready: { from: ["draft"], to: "ready" },
  reopen: { from: ["ready"], to: "draft" },
  // A merge that stopped partway is finished by sending it again; the server decides who may finish it.
  merge: { from: ["ready", "merging", "merged"], to: "merged" },
  discard: { from: ["draft", "ready"], to: "discarded" },
};

interface LifecycleRead {
  readonly worktree: WorkspaceWorktree;
  /** The server finished the merge or discard on its side, including activating the pull request's new files. */
  readonly processed: boolean;
}

async function readLifecycle(http: WorkspaceHttp, worktreeId: string, expectedId?: string): Promise<LifecycleRead> {
  const raw = (await http.json(`/api/worktrees/${encodeURIComponent(worktreeId)}`))["worktree"];
  return {
    worktree: parseWorktree(raw, expectedId),
    processed: isWorkspaceRecord(raw) && typeof raw["processedAt"] === "string",
  };
}

function label(worktree: WorkspaceWorktree): string {
  return worktree.number == null ? worktree.id : `#${String(worktree.number)}`;
}

export async function getWorktree(
  http: WorkspaceHttp,
  worktreeId: string,
): Promise<WorkspaceWorktree> {
  const body = await http.json(`/api/worktrees/${encodeURIComponent(worktreeId)}`);
  return parseWorktree(body["worktree"], worktreeId);
}

function revertPath(target: WorkspaceRevertTarget): string {
  if ("worktreeId" in target) return `/api/worktrees/${encodeURIComponent(requireId(target.worktreeId, "Worktree ID"))}/revert`;
  if (!Number.isSafeInteger(target.issueNumber) || target.issueNumber < 1) {
    throw workspaceError("workspace-argument-invalid", "Issue number must be a positive integer.");
  }
  return `/api/spaces/${encodeURIComponent(requireId(target.spaceId, "Space ID"))}/issues/${String(target.issueNumber)}/revert`;
}

export function stableKey(kind: string, ...parts: readonly string[]): string {
  const hash = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  return `workspace-${kind}-${hash}`;
}

function requireId(value: string, label: string): string {
  const id = value.trim();
  if (id === "") {
    throw workspaceError("workspace-argument-invalid", `${label} must not be empty.`);
  }
  return id;
}
