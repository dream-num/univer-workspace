import { getWorktree } from "@univerjs/univer-workspace-client-core";
import { pullSpaceId, WorkspaceSpaceFeature } from "@univerjs/univer-workspace-client-core/product";
import type { OpContext } from "../context.js";

/** Attributes the call to the Space of a Worktree scope; trunk has no Worktree to resolve. */
export async function attributeRepo(
  ctx: OpContext,
  scope: { readonly kind: "trunk" } | { readonly kind: "worktree"; readonly worktreeId: string },
): Promise<void> {
  if (scope.kind === "worktree")
    ctx.usage.repo =
      (await pullSpaceId(
        new WorkspaceSpaceFeature(async () => ctx.http()),
        await getWorktree(ctx.http(), scope.worktreeId),
      )) ?? null;
}
