import { describe, expect, it, vi } from "vitest";
import type { FUniver } from "@univerjs/core/facade";
import { downloadSlidePreview } from "../../web/src/features/editor/units/slide/download-preview";

describe("live preview PPTX export", () => {
  it("exports the selected presentation's post-calculation snapshot, not an old server or active-Unit cache", async () => {
    let finish!: () => void;
    const calculated = new Promise<void>(resolve => { finish = resolve; });
    let amount = 75;
    const presentation = { save: vi.fn(() => ({ id: "requested", amount })), getName: () => "Board Briefing.pptx" };
    const file = {};
    const exportSnapshot = vi.fn(async () => file);
    const downloadFile = vi.fn();
    const getPresentation = vi.fn(() => presentation);
    const api = { getPresentation, getFormula: () => ({ onCalculationResultApplied: () => calculated, executeCalculation: vi.fn() }),
      exportSlideBySnapshotAsync: exportSnapshot, downloadFile } as unknown as FUniver;
    const exporting = downloadSlidePreview(api, "requested");
    expect(exportSnapshot).not.toHaveBeenCalled();
    amount = 105; finish(); await exporting;
    expect(getPresentation).toHaveBeenCalledWith("requested");
    expect(exportSnapshot).toHaveBeenCalledWith({ id: "requested", amount: 105 });
    expect(downloadFile).toHaveBeenCalledWith(file, "Board Briefing", "pptx");
  });

  it("does not download an empty conversion result", async () => {
    const downloadFile = vi.fn();
    const api = { getPresentation: () => ({ save: () => ({}), getName: () => "Deck" }),
      getFormula: () => ({ onCalculationResultApplied: async () => undefined, executeCalculation: vi.fn() }),
      exportSlideBySnapshotAsync: async () => undefined, downloadFile } as unknown as FUniver;
    await expect(downloadSlidePreview(api, "deck")).rejects.toThrow("did not produce a file");
    expect(downloadFile).not.toHaveBeenCalled();
  });
});
