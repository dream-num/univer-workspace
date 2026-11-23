import { randomUUID } from "node:crypto";
import { ApplicationError } from "../../middleware/errors.js";
import type { AccessResolver } from "../access/index.js";
import { validSlug } from "../spaces/space-slug.js";
import type { SpacesModule } from "../spaces/index.js";
import type { WorktreesModule, WorktreeState, WorktreeSummary } from "../worktrees/index.js";
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
}

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
  readonly now?: () => number;
}): ForksModule {
  const now = options.now ?? Date.now;

  async function openWorktree(userId: string, worktreeId: string | null): Promise<WorktreeSummary | null> {
    const found = worktreeId && await options.worktrees.get(userId, worktreeId).catch(nullWhenNotFound);
    if (!found) return null;
    const { units: _units, ...summary } = found.worktree;
    return summary;
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
      const upstream = await options.access.resolveSpace(userId, input.upstreamSpaceId);
      if (!upstream || upstream.type !== "team") throw notFound();
      if (!upstream.member) {
        throw new ApplicationError("FORBIDDEN", 403, "A fork needs membership of its upstream Team Space, as its owner or as a Space Member of any role.");
      }
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
  };
}

function nullWhenNotFound(error: unknown): null {
  if (error instanceof ApplicationError && error.code === "NOT_FOUND") return null;
  throw error;
}

function notFound(): ApplicationError {
  return new ApplicationError("NOT_FOUND", 404, "The resource was not found.");
}
