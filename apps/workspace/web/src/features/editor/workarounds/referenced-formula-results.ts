import type { ICommandService, IDisposable } from "@univerjs/core";
import {
  SetFormulaCalculationResultMutation,
  type ISetFormulaCalculationResultMutation,
  type RegisterOtherFormulaService,
} from "@univerjs/engine-formula";

/**
 * SDK 1.0.0-rc.0 can evaluate external Host formulas before the Source's new
 * calculated values are applied. Source input replay dirties the Host, but the
 * subsequent local result application does not, leaving shapes one batch behind.
 * Re-evaluate only Host formulas after a live Source result batch. The follow-up
 * contains unitOtherData, not Source unitData, so it cannot retrigger itself.
 * Remove when the SDK invalidates external consumers after Source results apply.
 */
export function refreshReferencedFormulaResults(
  commands: Pick<ICommandService, "onCommandExecuted">,
  formulas: Pick<RegisterOtherFormulaService, "getFormulaDirtyMap" | "markFormulaDirty">,
  hostUnitId: string,
  liveSourceIds: ReadonlySet<string>,
): IDisposable {
  let disposed = false;
  let pending = false;
  const listener = commands.onCommandExecuted((command) => {
    if (command.id !== SetFormulaCalculationResultMutation.id) return;
    const results = command.params as ISetFormulaCalculationResultMutation | undefined;
    if (!Object.keys(results?.unitData ?? {}).some(
      (id) => id !== hostUnitId && liveSourceIds.has(id) &&
        Object.keys(results!.unitData[id] ?? {}).length > 0,
    ) || pending || disposed) return;

    pending = true;
    // Finish applying the current result to Sheets and Shapes before invalidating.
    queueMicrotask(() => {
      pending = false;
      if (disposed) return;
      for (const [subUnitId, ids] of Object.entries(formulas.getFormulaDirtyMap(hostUnitId))) {
        for (const formulaId of Object.keys(ids)) {
          formulas.markFormulaDirty(hostUnitId, subUnitId, formulaId);
        }
      }
    });
  });
  return { dispose() { disposed = true; listener.dispose(); } };
}
