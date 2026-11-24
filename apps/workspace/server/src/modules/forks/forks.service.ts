import { createHash, randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { ApplicationError } from "../../middleware/errors.js";
import type { AccessResolver } from "../access/index.js";
import type { HtmlViewDraftsModule, HtmlViewDraftView } from "../html-view-drafts/index.js";
import type { Principal, WriteSource } from "../identity/index.js";
import { validSlug } from "../spaces/space-slug.js";
import type { SpaceProposals, SpacesModule } from "../spaces/index.js";
import type { WorktreesModule, WorktreeState, WorktreeSummary, WorktreeUnit } from "../worktrees/index.js";
import type { ForksRepository, StoredFork } from "./forks.repository.js";
import type { ForkState, ForkView } from "./forks.types.js";

export interface ForksModule {
  create(
    userId: string,
    input: { readonly upstreamSpaceId: unknown; readonly name: unknown },
  ): Promise<{ readonly status: 200 | 201; readonly body: ForkView }>;
  list(userId: string): Promise<{ readonly forks: readonly ForkView[] }>;
  get(userId: string, forkId: string): Promise<ForkView>;
  lookup(userId: string, owner: unknown, name: unknown): Promise<ForkView>;
  delete(userId: string, forkId: string): Promise<{ readonly worktree: WorktreeSummary | null }>;
  addUnit(
    userId: string,
    forkId: string,
    operationId: unknown,
    input: unknown,
    createdVia: WriteSource | null,
  ): Promise<{ readonly status: 200 | 201; readonly body: { readonly worktree: WorktreeSummary; readonly unit: WorktreeUnit } }>;
  openWorktree(
    userId: string,
    forkId: string,
    operationId: unknown,
    createdVia: WriteSource | null,
  ): Promise<{ readonly status: 200 | 201; readonly body: { readonly worktree: WorktreeSummary } }>;
  replaceBlob(
    actor: Principal,
    forkId: string,
    resourceId: string,
    operationId: unknown,
    input: { readonly ifMatch: unknown; readonly contentLength: unknown },
    body: Readable,
  ): Promise<{ readonly status: 200 | 201; readonly body: { readonly worktree: WorktreeSummary; readonly draft: HtmlViewDraftView } }>;
}

// A reader of a public Team Space is refused only by the Space's `proposals` setting, so the refusal names it.
const PROPOSAL_REFUSALS: Readonly<Record<SpaceProposals, string>> = {
  members: "This Team Space's proposals setting is members, so only its Space Members may fork it and propose changes. Ask its owner or an admin to add you or to change the setting.",
  accountable: "This Team Space's proposals setting is accountable, so besides its Space Members only people and claimed agents may fork it and propose changes. An unclaimed agent needs a human to claim it first.",
  anyone: "This account may not fork this Team Space or propose changes to it.",
};

// A merged or discarded Worktree stays open until its Operation finishes, so its fork still reads as merging.
const FORK_STATES: Readonly<Record<WorktreeState, ForkState>> = {
  draft: "drafting",
  ready: "proposed",
  merging: "merging",
  merged: "merging",
  discarded: "merging",
};

export function createForksModule(options: {
  readonly repository: ForksRepository;
  readonly access: AccessResolver;
  readonly spaces: SpacesModule;
  readonly worktrees: WorktreesModule;
  readonly drafts: Pick<HtmlViewDraftsModule, "replaceBlob">;
  readonly now?: () => number;
}): ForksModule {
  const now = options.now ?? Date.now;

  async function openWorktree(userId: string, worktreeId: string | null): Promise<WorktreeSummary | null> {
    const found = worktreeId && await options.worktrees.get(userId, worktreeId).catch(nullWhenNotFound);
    if (!found) return null;
    const { units: _units, ...summary } = found.worktree;
    return summary;
  }

  async function openForkWorktree(userId: string, fork: StoredFork, key: string, createdVia: WriteSource | null): Promise<string> {
    // One Idempotency-Key covers opening the Worktree and adding the Unit, so the opening Operation takes a derived ID.
    const operationId = createHash("sha256").update(JSON.stringify([fork.id, key, "open"])).digest("base64url");
    try {
      const { body } = await options.worktrees.create(userId, operationId, {
        kind: "team", teamSpaceId: fork.upstreamSpaceId, name: fork.name, summary: null, visibility: "private",
      }, createdVia, fork.id);
      return body.id;
    } catch (error) {
      // A concurrent first write that opened the Worktree first wins, and this write joins it.
      const opened = (await options.repository.findOwned(userId, { forkId: fork.id }))?.openWorktreeId;
      if (!opened) throw error;
      return opened;
    }
  }

  async function draftWorktree(userId: string, forkId: string, key: string, createdVia: WriteSource | null) {
    const fork = await options.repository.findOwned(userId, { forkId });
    if (!fork || !(await options.access.resolveSpace(userId, fork.upstreamSpaceId))) throw notFound();
    const worktreeId = fork.openWorktreeId ?? await openForkWorktree(userId, fork, key, createdVia);
    const { worktree } = await options.worktrees.get(userId, worktreeId);
    if (worktree.state !== "draft") {
      throw new ApplicationError("FORK_WORKTREE_NOT_DRAFT", 409,
        `The fork's Worktree is ${worktree.state}, and only a draft takes writes. Reopen a ready Worktree to write again.`);
    }
    return { ...worktree, opened: fork.openWorktreeId === null };
  }

  async function view(userId: string, fork: StoredFork): Promise<ForkView> {
    const [upstream, worktree] = await Promise.all([
      options.spaces.get(userId, fork.upstreamSpaceId).catch(nullWhenNotFound),
      openWorktree(userId, fork.openWorktreeId),
    ]);
    return {
      id: fork.id,
      name: fork.name,
      fullName: `${fork.ownerUsername}/${fork.name}`,
      owner: { id: fork.ownerUserId, username: fork.ownerUsername },
      upstream,
      state: worktree ? FORK_STATES[worktree.state] : "clean",
      worktree,
      createdAt: new Date(fork.createdAt).toISOString(),
    };
  }

  return {
    async create(userId, input) {
      const name = validSlug(input.name, "name", "Fork name");
      if (typeof input.upstreamSpaceId !== "string" || !input.upstreamSpaceId) {
        throw new ApplicationError("INVALID_INPUT", 400, "upstreamSpaceId is required.", "upstreamSpaceId");
      }
      const upstream = await options.spaces.get(userId, input.upstreamSpaceId).catch(nullWhenNotFound);
      if (!upstream || upstream.type !== "team") throw notFound();
      if (!upstream.capabilities.propose) throw new ApplicationError("FORBIDDEN", 403, PROPOSAL_REFUSALS[upstream.proposals]);
      const result = await options.repository.create({
        id: randomUUID(),
        ownerUserId: userId,
        upstreamSpaceId: upstream.id,
        name,
        createdAt: now(),
      });
      if (result.status === "nameTaken") {
        throw new ApplicationError("SPACE_SLUG_TAKEN", 409, "The name is already used by another Team Space or fork of this owner.", "name");
      }
      return { status: result.status === "created" ? 201 : 200, body: await view(userId, result.fork) };
    },

    async list(userId) {
      const forks = await options.repository.listOwned(userId);
      return { forks: await Promise.all(forks.map((fork) => view(userId, fork))) };
    },

    async get(userId, forkId) {
      const fork = await options.repository.findOwned(userId, { forkId });
      if (!fork) throw notFound();
      return view(userId, fork);
    },

    async lookup(userId, owner, name) {
      if (typeof owner !== "string" || typeof name !== "string" || !owner || !name) {
        throw new ApplicationError("INVALID_INPUT", 400, "owner and name are required.", "owner");
      }
      const fork = await options.repository.findOwned(userId, { username: owner, name });
      if (!fork) throw notFound();
      return view(userId, fork);
    },

    async delete(userId, forkId) {
      const fork = await options.repository.deleteOwned(userId, forkId);
      if (!fork) throw notFound();
      return { worktree: await openWorktree(userId, fork.openWorktreeId) };
    },

    async addUnit(userId, forkId, operationIdValue, input, createdVia) {
      const key = validOperationId(operationIdValue);
      const { units, opened: _opened, ...worktree } = await draftWorktree(userId, forkId, key, createdVia);
      if (!worktree.capabilities.addUnit) throw new ApplicationError("FORBIDDEN", 403, "This Worktree action is not allowed.");
      const worktreeId = worktree.id;
      const trunk = input as { readonly source?: unknown; readonly resourceId?: unknown } | null;
      const present = trunk?.source === "trunk" && units.find((unit) => unit.source === "trunk" && unit.resourceId === trunk.resourceId);
      if (present) return { status: 200, body: { worktree, unit: present } };
      const { unit } = (await options.worktrees.addUnit(userId, worktreeId, key, input)).body;
      return { status: 201, body: { worktree: (await openWorktree(userId, worktreeId))!, unit } };
    },

    async openWorktree(userId, forkId, operationIdValue, createdVia) {
      const key = validOperationId(operationIdValue);
      const { units: _units, opened, ...worktree } = await draftWorktree(userId, forkId, key, createdVia);
      if (!worktree.capabilities.editDraft) throw new ApplicationError("FORBIDDEN", 403, "This Worktree action is not allowed.");
      return { status: opened ? 201 : 200, body: { worktree } };
    },

    async replaceBlob(actor, forkId, resourceId, operationIdValue, input, body) {
      const key = validOperationId(operationIdValue);
      const { opened: _opened, ...worktree } = await draftWorktree(actor.user.id, forkId, key, actor.writeSource);
      if (!worktree.capabilities.editDraft) throw new ApplicationError("FORBIDDEN", 403, "This Worktree action is not allowed.");
      const { status, draft } = await options.drafts.replaceBlob(actor, key, { resourceId, ...input }, worktree, body);
      return { status, body: { worktree: (await openWorktree(actor.user.id, worktree.id))!, draft } };
    },
  };
}

function validOperationId(value: unknown): string {
  if (typeof value !== "string" || value.length < 16 || value.length > 200 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ApplicationError("INVALID_INPUT", 400, "Idempotency-Key must contain 16 to 200 URL-safe characters.", "Idempotency-Key");
  }
  return value;
}

function nullWhenNotFound(error: unknown): null {
  if (error instanceof ApplicationError && error.code === "NOT_FOUND") return null;
  throw error;
}

function notFound(): ApplicationError {
  return new ApplicationError("NOT_FOUND", 404, "The resource was not found.");
}
