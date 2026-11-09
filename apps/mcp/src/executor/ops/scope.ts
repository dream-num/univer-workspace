import { getWorktree, WorkspaceRenderUnitLoader } from "@univerjs/univer-workspace-client-core";
import { pullSpaceId, WorkspaceSpaceFeature } from "@univerjs/univer-workspace-client-core/product";
import type { OpContext } from "../context.js";

type Scope =
  | { readonly kind: "trunk" }
  | { readonly kind: "worktree"; readonly worktreeId: string };

/** Attributes the call to the Space of a Worktree scope; trunk has no Worktree to resolve. */
export async function attributeRepo(ctx: OpContext, scope: Scope): Promise<void> {
  if (scope.kind === "worktree")
    ctx.usage.repo =
      (await pullSpaceId(
        new WorkspaceSpaceFeature(async () => ctx.http()),
        await getWorktree(ctx.http(), scope.worktreeId),
      )) ?? null;
}

/** The render unit loader that the uvw render commands use, reading through this call's source. */
export function renderUnitLoader(ctx: OpContext): WorkspaceRenderUnitLoader {
  return new WorkspaceRenderUnitLoader({
    runtime: ctx.runtime,
    openSource: async () => ctx.source(),
  });
}

/** Attributes the call, then loads the scope's render unit. */
export async function loadRenderUnit(ctx: OpContext, scope: Scope, unitId: string) {
  await attributeRepo(ctx, scope);
  return renderUnitLoader(ctx).loadUnit({ scope, unitId });
}
