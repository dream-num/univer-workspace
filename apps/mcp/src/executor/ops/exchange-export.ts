import {
  WorkspaceUnitFeature,
  workspaceError,
} from "@univerjs/univer-workspace-client-core/product";
import type { Handler } from "../context.js";
import { exchangeFeature } from "./exchange.js";

export const exchangeExport: Handler<"exchange.export"> = async (ctx, input) => {
  const units = await new WorkspaceUnitFeature(async () => ctx.http()).list(input.worktreeId);
  const unit = units.find((candidate) => candidate.unitId === input.unitId);
  if (!unit) throw workspaceError("WORKSPACE_UNIT_NOT_FOUND", "The Unit is not in this Worktree.");
  const { bytes, format: _format, ...output } = await exchangeFeature(ctx).exportBuffer(input);
  ctx.usage.unitType = output.type;
  return { output: { ...output, name: unit.name }, bytes };
};
