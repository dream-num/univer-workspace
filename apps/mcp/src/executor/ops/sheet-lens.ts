import {
  WorkspaceSheetLensEngine,
  type WorkspaceRuntimeCaller,
  type SheetLensRequest,
} from "@univerjs/univer-workspace-client-core";
import { opSpecs } from "../../shared/executor-protocol.js";
import type { BoundRuntime, Handler } from "../context.js";
import { attributeRepo } from "./scope.js";

export function createSheetLensHandler(maxCachedBytes: number): Handler<"content.sheet-lens"> {
  const runtimes = new WeakMap<WorkspaceRuntimeCaller, BoundRuntime>();
  const engine = new WorkspaceSheetLensEngine({
    maxCachedBytes,
    // Operator decision recorded in docs/design/sheet-outline/large-sheets.zh-CN.md.
    maxBoxCells: 1_000_000,
    exportUnitData: ({ target, caller }) => {
      const runtime = caller && runtimes.get(caller);
      if (!runtime) throw new Error("Sheet Lens caller has no bound runtime.");
      return runtime.exportUnitData({ target });
    },
  });
  return async (ctx, input) => {
    const source = ctx.source();
    const target =
      input.scope.kind === "trunk"
        ? await source.resolveTrunkRuntimeTarget({ unitId: input.unitId })
        : await source.resolveRuntimeTarget({
            unitId: input.unitId,
            worktreeId: input.scope.worktreeId,
          });
    await attributeRepo(ctx, input.scope);
    ctx.usage.unitType = target.unitType;
    const caller = { userId: ctx.userId };
    runtimes.set(caller, ctx.runtime);
    try {
      // The RPC schema validates the union; Zod optional properties also include undefined.
      const result = await engine.run(target, caller, input.request as SheetLensRequest);
      ctx.usage.cache = result.cache;
      ctx.usage.timings = result.timings;
      return { output: opSpecs["content.sheet-lens"].output.parse(result) };
    } finally {
      runtimes.delete(caller);
    }
  };
}
