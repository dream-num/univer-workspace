import { randomUUID } from "node:crypto";
import { checkedBlobContent, WorkspaceBlobFeature } from "./blob.js";
import { executeWithStableIdentity, WorkspaceApplicationError, workspaceError } from "./errors.js";
import { contentLength, inspectSource, memorySource, openSource, prepareDownload, type WorkspaceBlobBytes } from "./files.js";
import { findWorkspaceHtmlViewDraft, parseHtmlViewDraft, type WorkspaceHtmlViewDraft } from "./html-view-draft.js";
import { isWorkspaceRecord, type AuthenticatedWorkspaceHttp, type WorkspaceHttp } from "./http.js";
import { resolveRepoReference, type ResolvedWorkspaceRepo } from "./repo-ref.js";
import type { WorkspaceRuntimeScope } from "./runtime-target.js";
import type { BrowseSpaceInput, WorkspaceSpaceFeature } from "./space.js";
import { parseDetachedNode, parseSpace, type WorkspaceSpace, type WorkspaceUnitType } from "./space-model.js";
import { worktreeUnits } from "./unit.js";
import { getWorktree } from "./worktree.js";
import { parseUnit, parseWorktree, type WorkspaceUnit, type WorkspaceWorktree } from "./worktree-model.js";

export type WorkspaceForkState = "clean" | "drafting" | "proposed" | "merging";

export type WorkspaceForkWorktree = Omit<WorkspaceWorktree, "units">;

export interface WorkspaceFork {
  readonly id: string;
  readonly name: string;
  readonly fullName: string;
  readonly owner: { readonly id: string; readonly username: string };
  /** Null once the owner can no longer read the upstream. */
  readonly upstream: WorkspaceSpace | null;
  readonly state: WorkspaceForkState;
  /** Null while the fork is clean. */
  readonly worktree: WorkspaceForkWorktree | null;
  readonly createdAt: string;
}

/** A fork address is `<owner>/<name>`. A Worktree ID never contains `/`, so the two cannot be confused. */
export function isForkAddress(text: string): boolean {
  return /^[^/\s]+\/[^/\s]+$/u.test(text.trim());
}

/**
 * A fork reads as the upstream Trunk overlaid with its one open Worktree, and its first write opens that
 * Worktree. Only the fork's owner sees it: another user's fork and a missing one both answer 404.
 */
export class WorkspaceForkFeature {
  public constructor(private readonly authenticatedHttp: AuthenticatedWorkspaceHttp) {}

  public async create(input: { readonly name: string; readonly upstreamSpaceId: string }): Promise<WorkspaceFork> {
    return parseFork(await (await this.authenticatedHttp()).json("/api/forks", { body: input, method: "POST" }));
  }

  public async list(): Promise<readonly WorkspaceFork[]> {
    const body = await (await this.authenticatedHttp()).json("/api/forks");
    if (!Array.isArray(body["forks"])) throw invalidResponse("Workspace response is missing forks.");
    return body["forks"].map(parseFork);
  }

  /** Takes `<owner>/<name>` or a fork ID. */
  public async get(reference: string): Promise<WorkspaceFork> {
    const text = reference.trim();
    if (text === "") throw workspaceError("workspace-argument-invalid", "A fork reference must not be empty.");
    const http = await this.authenticatedHttp();
    if (!isForkAddress(text)) return parseFork(await http.json(`/api/forks/${encodeURIComponent(text)}`));
    const [owner, name] = text.split("/") as [string, string];
    return parseFork(await http.json(`/api/forks/lookup?${new URLSearchParams({ name, owner }).toString()}`));
  }

  /** Deletes the fork record only. Its open Worktree stays an ordinary Team Worktree of the upstream. */
  public async delete(
    reference: string,
  ): Promise<{ readonly fork: WorkspaceFork; readonly worktree: WorkspaceForkWorktree | null }> {
    const fork = await this.get(reference);
    const body = await (await this.authenticatedHttp()).json(`/api/forks/${encodeURIComponent(fork.id)}`, {
      method: "DELETE",
    });
    return { fork, worktree: parseForkWorktree(body["worktree"]) };
  }

  public async units(reference: string): Promise<readonly WorkspaceUnit[]> {
    const fork = await this.get(reference);
    return fork.worktree === null ? [] : worktreeUnits(await getWorktree(await this.authenticatedHttp(), fork.worktree.id));
  }

  public async addUnit(reference: string, resourceId: string): Promise<WorkspaceUnit> {
    return await this.addTrunkUnit(await this.get(reference), resourceId);
  }

  public async createUnit(
    reference: string,
    input: {
      readonly idempotencyKey?: string;
      readonly initialData?: Readonly<Record<string, unknown>>;
      readonly name: string;
      readonly parentNodeId?: string;
      readonly spaceId: string;
      readonly type: WorkspaceUnitType;
    },
  ): Promise<WorkspaceUnit> {
    const unit = await this.write(
      await this.get(reference),
      {
        name: input.name,
        ...(input.initialData === undefined ? {} : { initialData: input.initialData }),
        source: "worktree",
        targetParentNodeId: input.parentNodeId ?? null,
        targetSpaceId: input.spaceId,
        unitType: input.type,
      },
      input.idempotencyKey ?? randomUUID(),
    );
    if (
      unit.source !== "worktree" ||
      unit.type !== input.type ||
      unit.name !== input.name ||
      unit.target?.spaceId !== input.spaceId ||
      unit.target.parentNodeId !== (input.parentNodeId ?? null)
    ) {
      throw workspaceError("workspace-result-mismatch", "Workspace Unit response does not match the requested new file.");
    }
    return unit;
  }

  /** A read of one Unit through the fork: its open Worktree when that holds the Unit, the upstream Trunk otherwise. */
  public async readScope(reference: string, unitId: string): Promise<WorkspaceRuntimeScope> {
    const http = await this.authenticatedHttp();
    const { fork, worktree } = await this.open(http, reference);
    if (worktree?.units.some((unit) => unit.unitId === unitId)) return { kind: "worktree", worktreeId: worktree.id };
    await upstreamResourceId(http, fork, unitId);
    return { kind: "trunk" };
  }

  /**
   * The Worktree a write to one Unit goes to. An upstream Trunk file joins the fork's open Worktree first, and
   * the fork's first write opens it. The server refuses a Worktree that is not a draft with `FORK_WORKTREE_NOT_DRAFT`.
   */
  public async writeScope(
    reference: string,
    unitId: string,
  ): Promise<{ readonly kind: "worktree"; readonly worktreeId: string }> {
    const http = await this.authenticatedHttp();
    const { fork, worktree } = await this.open(http, reference);
    const unit = worktree?.units.find((candidate) => candidate.unitId === unitId);
    if (unit?.source === "worktree") return { kind: "worktree", worktreeId: unit.worktreeId };
    const resourceId = unit?.resourceId ?? (await upstreamResourceId(http, fork, unitId));
    return { kind: "worktree", worktreeId: (await this.addTrunkUnit(fork, resourceId)).worktreeId };
  }

  /**
   * The Worktree a page draft through the fork attaches to. A clean fork opens it with no Unit, and the server
   * refuses a Worktree that is not a draft with `FORK_WORKTREE_NOT_DRAFT`.
   */
  public async openWorktree(reference: string): Promise<WorkspaceForkWorktree> {
    const fork = await this.get(reference);
    const body = await (await this.authenticatedHttp()).json(`/api/forks/${encodeURIComponent(fork.id)}/worktree`, {
      idempotencyKey: randomUUID(),
      method: "POST",
    });
    const { units: _units, ...summary } = parseWorktree(body["worktree"]);
    return summary;
  }

  /**
   * Proposes new bytes for an upstream file that is not a page, as a draft attached to the fork's open Worktree,
   * which a clean fork opens. The upstream keeps its bytes until the pull request merges. `etag` is the upstream
   * file's current ETag, which `openBlob` returns.
   */
  public async replaceBlob(
    reference: string,
    input: { readonly etag: string; readonly idempotencyKey?: string; readonly resourceId: string } &
      ({ readonly filePath: string } | WorkspaceBlobBytes),
  ): Promise<{ readonly worktree: WorkspaceForkWorktree; readonly draft: WorkspaceHtmlViewDraft }> {
    const fork = await this.get(reference);
    const source = "filePath" in input ? await inspectSource(input.filePath) : memorySource(input);
    const http = await this.authenticatedHttp();
    const identity = { etag: input.etag, forkId: fork.id, idempotencyKey: input.idempotencyKey ?? randomUUID(), resourceId: input.resourceId };
    return await executeWithStableIdentity({
      identity,
      publicIdentity: { ...identity, fork: fork.fullName, byteSize: source.byteSize },
      operation: async (same) => {
        const body = await http.json(
          `/api/forks/${encodeURIComponent(same.forkId)}/blob-resources/${encodeURIComponent(same.resourceId)}/content`,
          {
            method: "PUT",
            ifMatch: same.etag,
            idempotencyKey: same.idempotencyKey,
            contentLength: source.byteSize,
            contentType: "application/octet-stream",
            streamBody: openSource(source),
          },
        );
        const draft = parseHtmlViewDraft(body["draft"], http.origin);
        if (draft.targetResourceId !== same.resourceId) {
          throw workspaceError("workspace-result-mismatch", "Workspace returned a draft of a different file.");
        }
        return { worktree: requireForkWorktree(body["worktree"]), draft };
      },
    });
  }

  /**
   * An upstream file as the fork sees it: the owner's pending draft of it in the fork's open Worktree, or the
   * upstream bytes. `etag` is the upstream ETag either way, the one `replaceBlob` takes. The caller must consume or
   * close the stream.
   */
  public async openBlob(reference: string, resourceId: string) {
    const fork = await this.get(reference);
    const blobs = new WorkspaceBlobFeature(this.authenticatedHttp);
    const { node } = await blobs.get(resourceId);
    const upstream = requireUpstream(fork);
    if (node.spaceId !== upstream.id) {
      throw workspaceError(
        "workspace-argument-invalid",
        `Resource ${resourceId} is not a file of ${upstream.fullName ?? upstream.id}, the upstream of fork ${fork.fullName}.`,
        { fork: fork.fullName, resourceId },
      );
    }
    const http = await this.authenticatedHttp();
    const draft = fork.worktree === null ? undefined : await findWorkspaceHtmlViewDraft(this.authenticatedHttp, http.origin, {
      authorId: fork.owner.id, resourceId, worktreeId: fork.worktree.id,
    });
    if (draft === undefined) return { ...(await blobs.downloadStream(resourceId)), draft: null };
    const response = await http.request(`/api/html-view-drafts/${encodeURIComponent(draft.id)}/content`, { acceptEncoding: "identity" });
    const byteSize = contentLength(response, "Blob");
    if (byteSize === undefined || response.body === null) {
      await response.body?.cancel();
      throw workspaceError("workspace-invalid-response", "Workspace draft content response is missing its bytes or Content-Length.");
    }
    return {
      content: checkedBlobContent(response, byteSize),
      resourceId,
      nodeId: node.nodeId,
      spaceId: node.spaceId,
      fileName: node.name,
      byteSize,
      mediaType: response.headers.get("content-type") ?? "application/octet-stream",
      etag: draft.baseEtag,
      draft,
      close: async () => {
        await response.body?.cancel();
      },
    };
  }

  /** `openBlob` written to a local file. */
  public async downloadBlob(
    reference: string,
    input: { readonly force?: boolean; readonly outputPath: string; readonly resourceId: string },
  ): Promise<Record<string, unknown>> {
    const target = await prepareDownload({ kind: "blob", outputPath: input.outputPath, ...(input.force === true ? { force: true } : {}) });
    try {
      const stream = await this.openBlob(reference, input.resourceId);
      try {
        const written = await target.writeAndCommit(stream.content, stream.byteSize);
        return {
          resourceId: stream.resourceId,
          nodeId: stream.nodeId,
          outputPath: written.outputPath,
          byteSize: written.byteSize,
          mediaType: stream.mediaType,
          etag: stream.etag,
          draft: stream.draft,
        };
      } finally {
        await stream.close();
      }
    } finally {
      await target.discard();
    }
  }

  /** What `WorkspaceSpaceFeature.browse` and `find` list for the fork: the upstream as its open Worktree sees it. */
  public async listing(fork: WorkspaceFork): Promise<Pick<BrowseSpaceInput, "overlay" | "spaceId">> {
    const upstream = requireUpstream(fork);
    if (fork.worktree === null) return { spaceId: upstream.id };
    const worktree = await getWorktree(await this.authenticatedHttp(), fork.worktree.id);
    return { overlay: { accessRole: upstream.accessRole ?? "viewer", worktree }, spaceId: upstream.id };
  }

  private async open(
    http: WorkspaceHttp,
    reference: string,
  ): Promise<{ readonly fork: WorkspaceFork; readonly worktree: WorkspaceWorktree | null }> {
    const fork = await this.get(reference);
    return { fork, worktree: fork.worktree === null ? null : await getWorktree(http, fork.worktree.id) };
  }

  private async addTrunkUnit(fork: WorkspaceFork, resourceId: string): Promise<WorkspaceUnit> {
    // A key reused after the fork's Worktree merged would replay that Worktree's write and fail.
    const unit = await this.write(fork, { resourceId, source: "trunk" }, randomUUID());
    if (unit.source !== "trunk" || unit.resourceId !== resourceId || unit.target !== null) {
      throw workspaceError("workspace-result-mismatch", "Workspace response returned a different added Resource Unit.");
    }
    return unit;
  }

  private async write(
    fork: WorkspaceFork,
    body: Readonly<Record<string, unknown>>,
    idempotencyKey: string,
  ): Promise<WorkspaceUnit> {
    const http = await this.authenticatedHttp();
    const { initialData: _initialData, ...request } = body;
    return await executeWithStableIdentity({
      identity: { body, forkId: fork.id, idempotencyKey },
      publicIdentity: { ...request, fork: fork.fullName, idempotencyKey },
      operation: async (same) => {
        const response = await http.json(`/api/forks/${encodeURIComponent(same.forkId)}/units`, {
          body: same.body,
          idempotencyKey: same.idempotencyKey,
          method: "POST",
        });
        return parseUnit(response["unit"], parseWorktree(response["worktree"]).id);
      },
    });
  }
}

/**
 * A repository reference, or the fork that a fork address names. The owner's fork names and repository
 * slugs never clash, so at most one lookup matches, and the fork is looked up only after the Space lookup misses.
 */
export async function resolveRepoOrFork(
  spaces: Pick<WorkspaceSpaceFeature, "get" | "list" | "lookup">,
  forks: Pick<WorkspaceForkFeature, "get">,
  reference: string,
  origin?: string,
): Promise<ResolvedWorkspaceRepo | { readonly fork: WorkspaceFork }> {
  try {
    return await resolveRepoReference(spaces, reference, origin);
  } catch (error) {
    if (!isForkAddress(reference) || !isNotFound(error)) throw error;
    try {
      return { fork: await forks.get(reference) };
    } catch (forkError) {
      throw isNotFound(forkError) ? error : forkError;
    }
  }
}

async function upstreamResourceId(http: WorkspaceHttp, fork: WorkspaceFork, unitId: string): Promise<string> {
  const upstream = requireUpstream(fork);
  const node = parseDetachedNode((await http.json(`/api/unit-resources/${encodeURIComponent(unitId)}`))["node"]);
  if (node.spaceId !== upstream.id || node.resource?.kind !== "univer" || node.resource.unitId !== unitId) {
    throw workspaceError(
      "workspace-argument-invalid",
      `Unit ${unitId} is not a file of ${upstream.fullName ?? upstream.id}, the upstream of fork ${fork.fullName}.`,
      { fork: fork.fullName, unitId },
    );
  }
  return node.resource.resourceId;
}

function requireUpstream(fork: WorkspaceFork): WorkspaceSpace {
  if (fork.upstream !== null) return fork.upstream;
  throw workspaceError("workspace-not-found", `You can no longer read the upstream of fork ${fork.fullName}.`, {
    fork: fork.fullName,
  });
}

function parseFork(value: unknown): WorkspaceFork {
  const owner = isWorkspaceRecord(value) ? value["owner"] : undefined;
  if (
    !isWorkspaceRecord(value) ||
    typeof value["id"] !== "string" ||
    typeof value["name"] !== "string" ||
    typeof value["fullName"] !== "string" ||
    !isWorkspaceRecord(owner) ||
    typeof owner["id"] !== "string" ||
    typeof owner["username"] !== "string" ||
    !isState(value["state"]) ||
    typeof value["createdAt"] !== "string"
  ) {
    throw invalidResponse("Workspace response contains an invalid fork.");
  }
  const worktree = parseForkWorktree(value["worktree"]);
  if ((value["state"] === "clean") !== (worktree === null)) {
    throw invalidResponse("Workspace fork state does not match its open Worktree.");
  }
  return {
    id: value["id"],
    name: value["name"],
    fullName: value["fullName"],
    owner: { id: owner["id"], username: owner["username"] },
    upstream: value["upstream"] === null ? null : parseSpace(value["upstream"]),
    state: value["state"],
    worktree,
    createdAt: value["createdAt"],
  };
}

function requireForkWorktree(value: unknown): WorkspaceForkWorktree {
  const worktree = parseForkWorktree(value);
  if (worktree === null) throw invalidResponse("Workspace response is missing the fork's Worktree.");
  return worktree;
}

function parseForkWorktree(value: unknown): WorkspaceForkWorktree | null {
  if (value === null) return null;
  const { units: _units, ...summary } = parseWorktree(value);
  return summary;
}

function isState(value: unknown): value is WorkspaceForkState {
  return value === "clean" || value === "drafting" || value === "proposed" || value === "merging";
}

function isNotFound(error: unknown): boolean {
  return error instanceof WorkspaceApplicationError && isWorkspaceRecord(error.detail) && error.detail["status"] === 404;
}

function invalidResponse(message: string): Error {
  return workspaceError("workspace-invalid-response", message);
}
