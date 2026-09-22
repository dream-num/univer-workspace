import { afterEach, describe, expect, it, vi } from "vitest";
import type { FUniver } from "@univerjs/core/facade";
vi.mock("@univerjs/docs-ui/facade", () => ({}));
vi.mock("@univerjs/sheets-ui/facade", () => ({}));
vi.mock("@univerjs-pro/slides/facade", () => ({}));
import { installNativePreviewNavigation, locateNativePreview } from "../../web/src/features/editor/native-preview";

describe("native preview navigation", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("uses current paragraph text/offset and a collapsed caret; rejects changed quotes", () => {
    const paragraph = { getText: vi.fn(() => "Cash consideration"), getInfo: vi.fn(() => ({ startOffset: 100 })) };
    const doc = { getParagraph: vi.fn(() => paragraph), setSelection: vi.fn() };
    const api = { getDocument: vi.fn(() => doc) } as unknown as FUniver;
    const focus = { kind: "doc", paragraphId: "p-1", quote: "consideration" } as const;
    expect(locateNativePreview(api, "contract", focus)).toBe(true);
    expect(doc.setSelection).toHaveBeenCalledWith(105, 105);
    paragraph.getText.mockReturnValue("Changed clause");
    expect(locateNativePreview(api, "contract", focus)).toBe(false);
    expect(doc.setSelection).toHaveBeenCalledTimes(1);
  });
  it("checks Sheet bounds before changing the active sheet or scrolling", () => {
    const range = { getRange: () => ({ startRow: 19, endRow: 19, startColumn: 1, endColumn: 1 }), activate: vi.fn() };
    const sheet = { getRange: () => range, getMaxRows: () => 10, getMaxColumns: () => 20, scrollToCell: vi.fn() };
    const workbook = { getSheetBySheetId: () => sheet, setActiveSheet: vi.fn() };
    const api = { getWorkbook: () => workbook } as unknown as FUniver;
    expect(locateNativePreview(api, "book", { kind: "sheet", sheetId: "tab", range: "B20" })).toBe(false);
    expect(workbook.setActiveSheet).not.toHaveBeenCalled();
    expect(range.activate).not.toHaveBeenCalled();
    expect(sheet.scrollToCell).not.toHaveBeenCalled();
  });
  it("selects a Slide by stable identity and refuses a missing page", () => {
    const slide = { id: "page-2" };
    const presentation = { getSlideById: vi.fn((): unknown => slide), setActiveSlide: vi.fn() };
    const api = { getPresentation: () => presentation } as unknown as FUniver;
    const focus = { kind: "slide", slideId: "page-2" } as const;
    expect(locateNativePreview(api, "deck", focus)).toBe(true);
    expect(presentation.setActiveSlide).toHaveBeenCalledWith(slide);
    presentation.getSlideById.mockReturnValue(null);
    expect(locateNativePreview(api, "deck", focus)).toBe(false);
    expect(presentation.setActiveSlide).toHaveBeenCalledTimes(1);
  });
});


describe("native frame message identity", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("accepts only its same-origin parent, Unit and token, and removes its listener", () => {
    const parent = { postMessage: vi.fn() };
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    vi.stubGlobal("window", { parent, location: { origin: "https://workspace.example" }, addEventListener, removeEventListener });
    const api = {} as FUniver;
    const observer = installNativePreviewNavigation(api, "doc", "token");
    const receive = addEventListener.mock.calls[0]![1];
    const event = { source: parent, origin: "https://workspace.example", data: {
      channel: "workspace-native-unit-v1", unitId: "doc", token: "token", action: "status",
    } };
    for (const invalid of [{ ...event, source: {} }, { ...event, origin: "https://other.example" },
      { ...event, data: { ...event.data, token: "old" } }, { ...event, data: { ...event.data, unitId: "other" } }]) receive(invalid);
    expect(parent.postMessage).toHaveBeenCalledTimes(1); // Initial ready only.
    receive(event);
    expect(parent.postMessage).toHaveBeenCalledTimes(2);
    observer.dispose();
    expect(removeEventListener).toHaveBeenCalledWith("message", receive);
  });
});
