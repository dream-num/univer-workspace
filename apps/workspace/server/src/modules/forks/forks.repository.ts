export interface StoredFork {
  readonly id: string;
  readonly ownerUserId: string;
  readonly ownerUsername: string;
  readonly upstreamSpaceId: string;
  readonly name: string;
  readonly createdAt: number;
  readonly openWorktreeId: string | null;
}

export type CreateForkResult =
  | { readonly status: "created" | "existing"; readonly fork: StoredFork }
  | { readonly status: "nameTaken" };

export interface ForksRepository {
  /**
   * Returns the owner's fork of that name when it already forks the same upstream. Otherwise checks the
   * name against the owner's Team Space slugs and the unclaimed-agent quota, and inserts, in one transaction.
   */
  create(input: {
    readonly id: string;
    readonly ownerUserId: string;
    readonly upstreamSpaceId: string;
    readonly name: string;
    readonly createdAt: number;
  }): Promise<CreateForkResult>;
  /** The actor's forks and those of the agents the actor owns. `findOwned` and `deleteOwned` reach the same forks. */
  listOwned(actorUserId: string): Promise<StoredFork[]>;
  findOwned(actorUserId: string, key: { readonly forkId: string } | { readonly username: string; readonly name: string }): Promise<StoredFork | null>;
  /** Returns null when the actor reaches no such fork. Its open Worktree stays, with no fork. */
  deleteOwned(actorUserId: string, forkId: string): Promise<StoredFork | null>;
}
