import { afterEach, describe, expect, it, vi } from "vitest";
import { LifecycleStages } from "@univerjs/core";
import type { FUniver } from "@univerjs/core/facade";
// Navigation types must not install every product UI Facade into the host.
vi.mock("@univerjs/docs-ui/facade", () => { throw new Error("Doc UI loaded by shared navigation"); });
vi.mock("@univerjs/sheets-ui/facade", () => { throw new Error("Sheet UI loaded by shared navigation"); });
vi.mock("@univerjs-pro/slides/facade", () => { throw new Error("Slides Facade loaded by shared navigation"); });
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
  it("exports only on a trusted request, coalesces clicks and ignores completion after disposal", async () => {
    const parent = { postMessage: vi.fn() };
    const addEventListener = vi.fn();
    vi.stubGlobal("window", { parent, location: { origin: "https://workspace.example" }, addEventListener, removeEventListener: vi.fn() });
    let finish!: () => void;
    const download = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const api = { getCurrentLifecycleStage: () => LifecycleStages.Rendered } as FUniver;
    const observer = installNativePreviewNavigation(api, "deck", "token", download);
    const receive = addEventListener.mock.calls[0]![1];
    const event = { source: parent, origin: "https://workspace.example", data: {
      channel: "workspace-native-unit-v1", unitId: "deck", token: "token", action: "download", requestId: "download-1",
    } };
    receive({ ...event, source: {} });
    receive({ ...event, data: { ...event.data, token: "old" } });
    receive({ ...event, data: { ...event.data, requestId: "" } });
    expect(download).not.toHaveBeenCalled();
    receive(event); receive(event);
    await Promise.resolve();
    expect(download).toHaveBeenCalledOnce();
    expect(parent.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ status: "downloading", requestId: "download-1" });
    observer.dispose(); finish();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(parent.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ status: "downloading" });
  });

  it("reports export errors without leaking details and permits an explicit retry", async () => {
    const parent = { postMessage: vi.fn() };
    const addEventListener = vi.fn();
    vi.stubGlobal("window", { parent, location: { origin: "https://workspace.example" }, addEventListener, removeEventListener: vi.fn() });
    const download = vi.fn().mockRejectedValueOnce(new Error("private internal URL")).mockResolvedValue(undefined);
    const observer = installNativePreviewNavigation({ getCurrentLifecycleStage: () => LifecycleStages.Rendered } as FUniver, "deck", "token", download);
    const receive = addEventListener.mock.calls[0]![1];
    const event = { source: parent, origin: "https://workspace.example", data: {
      channel: "workspace-native-unit-v1", unitId: "deck", token: "token", action: "download", requestId: "download-1",
    } };
    receive(event);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(parent.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ status: "download-error" });
    expect(JSON.stringify(parent.postMessage.mock.calls)).not.toContain("private internal URL");
    receive({ ...event, data: { ...event.data, requestId: "download-2" } });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(parent.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ status: "downloaded", requestId: "download-2" });
    observer.dispose();
  });

  it("announces readiness only after native render modules are installed", () => {
    const parent = { postMessage: vi.fn() };
    const addEventListener = vi.fn();
    vi.stubGlobal("window", { parent, location: { origin: "https://workspace.example" }, addEventListener, removeEventListener: vi.fn() });
    const detach = vi.fn();
    const addEvent = vi.fn((_event: string, _callback: (event: { stage: LifecycleStages }) => void) => ({ dispose: detach }));
    const api = { getCurrentLifecycleStage: () => LifecycleStages.Ready,
      Event: { LifeCycleChanged: "lifecycle" }, addEvent } as unknown as FUniver;
    const observer = installNativePreviewNavigation(api, "sheet", "token");
    expect(parent.postMessage).not.toHaveBeenCalled();
    const lifecycle = addEvent.mock.calls[0]![1] as (event: { stage: LifecycleStages }) => void;
    lifecycle({ stage: LifecycleStages.Ready });
    expect(parent.postMessage).not.toHaveBeenCalled();
    lifecycle({ stage: LifecycleStages.Rendered });
    expect(parent.postMessage).toHaveBeenCalledOnce();
    expect(detach).toHaveBeenCalledOnce();
    observer.dispose();
  });

  afterEach(() => vi.unstubAllGlobals());
  it("accepts only its same-origin parent, Unit and token, and removes its listener", () => {
    const parent = { postMessage: vi.fn() };
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    vi.stubGlobal("window", { parent, location: { origin: "https://workspace.example" }, addEventListener, removeEventListener });
    const api = { getCurrentLifecycleStage: () => LifecycleStages.Steady } as FUniver;
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
