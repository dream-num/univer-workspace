import type { Handler } from "../context.js";
import { exchangeFeature } from "./exchange.js";

export const exchangeImport: Handler<"exchange.import"> = async (ctx, input, bytes) => {
  ctx.usage.repo = input.spaceId;
  const { fileName, ...result } = await exchangeFeature(ctx).importBuffer({
    bytes,
    worktreeId: input.worktreeId,
    spaceId: input.spaceId,
    fileName: input.fileName,
    idempotencyKey: input.idempotencyKey,
    ...(input.type === undefined ? {} : { type: input.type }),
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.parentNodeId === undefined ? {} : { parentNodeId: input.parentNodeId }),
  });
  ctx.usage.unitType = result.type;
  ctx.usage.cost.committed_revisions += 1;
  return { output: { ...result, sourcePath: fileName } };
};
