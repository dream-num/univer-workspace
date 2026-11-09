import { WorkspaceContentExecutionFeature } from "@univerjs/univer-workspace-client-core";
import { getWorktree } from "@univerjs/univer-workspace-client-core";
import { pullSpaceId, WorkspaceSpaceFeature } from "@univerjs/univer-workspace-client-core/product";
import type { Handler } from "../context.js";

export const contentExecute: Handler<"content.execute"> = async (ctx, input) => {
  ctx.usage.repo =
    (await pullSpaceId(
      new WorkspaceSpaceFeature(async () => ctx.http()),
      await getWorktree(ctx.http(), input.worktreeId),
    )) ?? null;
  const result = await new WorkspaceContentExecutionFeature(ctx.source(), ctx.runtime).execute(
    input,
  );
  ctx.usage.cost.committed_revisions += result.committed ? 1 : 0;
  return { output: result };
};
