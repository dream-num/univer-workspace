import { describe, expect, it, vi } from "vitest";
import type { ICommandService } from "@univerjs/core";
import { SetFormulaCalculationResultMutation } from "@univerjs/engine-formula";
import { refreshReferencedFormulaResults } from "../../web/src/features/editor/workarounds/referenced-formula-results";

function setup(sources = new Set(["source"])) {
  let receive!: Parameters<ICommandService["onCommandExecuted"]>[0];
  const detach = vi.fn();
  const commands = {
    onCommandExecuted: vi.fn((fn: typeof receive) => { receive = fn; return { dispose: detach }; }),
  };
  const formulas = {
    getFormulaDirtyMap: vi.fn(() => ({ body: { cash: true, shares: true }, schedule: { cash: true } })),
    markFormulaDirty: vi.fn(),
  };
  const disposable = refreshReferencedFormulaResults(commands, formulas, "host", sources);
  const emit = (unitData: object, unitOtherData: object = {}) => receive({
    id: SetFormulaCalculationResultMutation.id, params: { unitData, unitOtherData },
  });
  return { formulas, emit, disposable, detach, sources };
}

describe("referenced formula results", () => {
  it("refreshes both consideration fields and repeated schedule fields after source calculation", async () => {
    const test = setup();
    let sourceCash = 75;
    let displayedCash = sourceCash;
    test.formulas.markFormulaDirty.mockImplementation(() => { displayedCash = sourceCash; });
    // Input replay has already evaluated the Host against the old Source cache.
    sourceCash = 105;
    test.emit({ source: { summary: { 15: { 1: { v: sourceCash, t: 2 } } } } });
    expect(displayedCash).toBe(75);
    await Promise.resolve();
    expect(displayedCash).toBe(105);
    expect(test.formulas.markFormulaDirty.mock.calls).toEqual([
      ["host", "body", "cash"], ["host", "body", "shares"], ["host", "schedule", "cash"],
    ]);
  });

  it("does not loop on the resulting Host-only formula batch", async () => {
    const test = setup();
    test.formulas.markFormulaDirty.mockImplementation(() => test.emit({}, { host: {} }));
    test.emit({ source: { summary: {} } });
    await Promise.resolve();
    await Promise.resolve();
    expect(test.formulas.markFormulaDirty).toHaveBeenCalledTimes(3);
  });

  it("ignores unrelated sources, host values and frozen preview sources", async () => {
    const test = setup(new Set());
    test.emit({ source: { sheet: {} } });
    test.sources.add("source");
    test.emit({ unrelated: { sheet: {} }, host: { sheet: {} }, source: {} });
    await Promise.resolve();
    expect(test.formulas.markFormulaDirty).not.toHaveBeenCalled();
  });

  it("coalesces source batches before reading current Host registrations", async () => {
    const test = setup();
    test.emit({ source: { first: {} } });
    test.emit({ source: { second: {} } });
    await Promise.resolve();
    expect(test.formulas.getFormulaDirtyMap).toHaveBeenCalledExactlyOnceWith("host");
  });

  it("cancels queued work and unsubscribes when the editor closes", async () => {
    const test = setup();
    test.emit({ source: { summary: {} } });
    test.disposable.dispose();
    await Promise.resolve();
    expect(test.detach).toHaveBeenCalledOnce();
    expect(test.formulas.markFormulaDirty).not.toHaveBeenCalled();
  });
});
