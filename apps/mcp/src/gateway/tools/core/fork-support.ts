import {
  pullUrl,
  repoUrl,
  type WorkspaceFork,
  type WorkspaceForkWorktree,
  type WorkspaceSpace,
} from "@univerjs/univer-workspace-client-core/product";
import { z } from "zod";
import type { ToolContext } from "../definition.js";

export const forkInput = z.string().describe("Fork address <owner>/<name>, or fork ID.");

type Linked<T> = T & { readonly url: string };

export function forkWithUrls(
  context: ToolContext,
  fork: WorkspaceFork,
): Omit<WorkspaceFork, "upstream" | "worktree"> & {
  readonly upstream: Linked<WorkspaceSpace> | null;
  readonly worktree: Linked<WorkspaceForkWorktree> | null;
} {
  return {
    ...fork,
    upstream: fork.upstream && { ...fork.upstream, url: repoUrl(context.identityOrigin, fork.upstream.id) },
    worktree: forkPullWithUrl(context, fork, fork.worktree),
  };
}

export function forkPullWithUrl(
  context: ToolContext,
  fork: WorkspaceFork,
  worktree: WorkspaceForkWorktree | null,
): Linked<WorkspaceForkWorktree> | null {
  return worktree && { ...worktree, url: pullUrl(context.identityOrigin, worktree, undefined, fork.upstream?.id) };
}
