// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IUniverInstanceService, LifecycleService, LifecycleStages, LocaleType, type Univer } from "@univerjs/core";
import { ReadonlyUniverWorkbookView } from "../src/sheet/readonly-workbook-pane.js";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function fixture() {
  let rendered!: () => void;
  const ready = new Promise<void>(resolve => { rendered = resolve; });
  const onStage = vi.fn(() => ready);
  const readWorkbook = vi.fn(() => null);
  const createUnit = vi.fn();
  const dispose = vi.fn();
  const univer = {
    createUnit,
    __getInjector: () => ({ get: (id: unknown) => {
      if (id === LifecycleService) return { onStage };
      if (id === IUniverInstanceService) return { getCurrentUnitOfType: readWorkbook };
      throw new Error("Render-dependent service requested before readiness");
    } }),
  } as unknown as Univer;
  const createUniver = async () => ({ univer, dispose });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  return { root, rendered, onStage, readWorkbook, createUnit, dispose, createUniver };
}

afterEach(() => { document.body.replaceChildren(); });

describe("comparison pane render lifecycle", () => {
  it("keeps peer scroll effects away from a model that has not rendered", async () => {
    const f = fixture();
    await act(async () => {
      f.root.render(<ReadonlyUniverWorkbookView createUniver={f.createUniver}
        locale={LocaleType.EN_US} darkMode={false} snapshot={{ id: "sheet" }}
        controlledScroll={{ key: "peer-scroll", sheetId: "s1", offsetX: 0, offsetY: 0,
          sheetViewStartColumn: 0, sheetViewStartRow: 25, sourceRole: "base" }} />);
    });
    expect(f.createUnit).toHaveBeenCalledOnce();
    expect(f.onStage).toHaveBeenCalledWith(LifecycleStages.Rendered);
    expect(f.readWorkbook).not.toHaveBeenCalled();
    await act(async () => { f.rendered(); });
    expect(f.readWorkbook).toHaveBeenCalledOnce();
    await act(async () => { f.root.unmount(); });
  });

  it("does not resume an old pane when rendering finishes after switching away", async () => {
    const f = fixture();
    await act(async () => {
      f.root.render(<ReadonlyUniverWorkbookView createUniver={f.createUniver}
        locale={LocaleType.EN_US} darkMode={false} snapshot={{ id: "old-sheet" }} />);
    });
    await act(async () => { f.root.unmount(); });
    await act(async () => { f.rendered(); });
    expect(f.readWorkbook).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(f.dispose).toHaveBeenCalledOnce());
  });
});
