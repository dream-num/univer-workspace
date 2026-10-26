import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { ApplicationError } from "../../middleware/errors.js";

/** One coordinator per Collaboration runtime. Every SDK mutation enters before
 * taking SDK locks. Nested Worktree -> trunk commits reenter the same lease.
 * The existing SQLite deployment permits one writer Server (see AGENTS.md).
 * Review capture, version validation and merge run under this same boundary. */
export class ReviewCommitCoordinator {
  private tail: Promise<void> = Promise.resolve();
  private lease = new AsyncLocalStorage<{ active: boolean }>();
  private reviews = new Map<
    string,
    { actor: string; worktree: string; version: string; expires: number }
  >();
  async run<T>(action: () => Promise<T>): Promise<T> {
    if (this.lease.getStore()?.active) return action();
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const lease = { active: true };
    try {
      return await this.lease.run(lease, action);
    } finally {
      lease.active = false;
      release();
    }
  }
  issue(actor: string, worktree: string, version: string) {
    const now = Date.now();
    for (const [key, value] of this.reviews) if (value.expires <= now) this.reviews.delete(key);
    const token = randomUUID();
    this.reviews.set(token, { actor, worktree, version, expires: now + 30 * 60 * 1000 });
    return token;
  }
  validate(token: unknown, actor: string, worktree: string, version: string) {
    const review = typeof token === "string" ? this.reviews.get(token) : undefined;
    if (
      !review ||
      review.actor !== actor ||
      review.worktree !== worktree ||
      review.expires <= Date.now() ||
      review.version !== version
    )
      throw new ApplicationError(
        "CONFLICT",
        409,
        "The shared document or proposed changes changed. Review the current version before applying.",
      );
  }
  consume(token: string) {
    this.reviews.delete(token);
  }
}
