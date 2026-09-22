import { describe, expect, it, vi, beforeEach } from "vitest";
import { boundPreviewRect, HTML_PREVIEW_CHANNEL, parsePreviewMessage } from "../../web/src/features/html-views/native-preview-protocol";
import { parseNativePreviewFocus } from "../../web/src/features/editor/preview";
const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock("../../web/src/shared/api/client", () => ({ api }));
import { openNativeUnit } from "../../web/src/features/resources/native-unit-open";

const message = { channel: HTML_PREVIEW_CHANNEL, nonce: "page-one", action: "show", unitId: "source", requestId: "request-one",
  rect: { left: 10, top: 100, width: 800, height: 600 } };
describe("HTML native preview boundary", () => {
  it("rejects stale generations, malformed identities and non-finite coordinates", () => {
    expect(parsePreviewMessage(message, "page-two")).toBeNull();
    for (const patch of [{ unitId: "../admin" }, { requestId: "" }, { rect: { ...message.rect, left: Infinity } },
      { rect: { ...message.rect, height: -1 } }, { focus: { kind: "doc", paragraphId: "p", quote: "" } }])
      expect(parsePreviewMessage({ ...message, ...patch }, "page-one")).toBeNull();
  });
  it("takes identity and layout only; ignores claimed permissions, URLs and Worktree routing", () => {
    expect(parsePreviewMessage({ ...message, readOnly: false, url: "https://evil.example", worktreeId: "draft" }, "page-one"))
      .toEqual({ unitId: "source", requestId: "request-one", rect: message.rect });
  });
  it("clips all sides and keeps hidden slots at zero size", () => {
    expect(boundPreviewRect({ left: -20, top: -30, width: 1200, height: 900 }, 800, 600))
      .toEqual({ left: 0, top: 0, width: 800, height: 600 });
    expect(boundPreviewRect({ left: 900, top: 700, width: 100, height: 100 }, 800, 600))
      .toEqual({ left: 800, top: 600, width: 0, height: 0 });
    expect(parsePreviewMessage({ ...message, rect: { ...message.rect, height: 0 } }, "page-one")).not.toBeNull();
  });
  it("accepts bounded stable navigation without commands or offsets", () => {
    expect(parseNativePreviewFocus({ paragraphId: "p-1", quote: "Consideration", startOffset: 1 }))
      .toEqual({ kind: "doc", paragraphId: "p-1", quote: "Consideration" });
    expect(parseNativePreviewFocus({ kind: "sheet", sheetId: "tab", range: "B2:C9" })).not.toBeNull();
    expect(parseNativePreviewFocus({ kind: "slide", slideId: "slide-2" })).not.toBeNull();
    expect(parseNativePreviewFocus({ kind: "sheet", sheetId: "tab", range: "=IMPORTXML(A1)" })).toBeNull();
    expect(parseNativePreviewFocus({ kind: "doc", paragraphId: "p", quote: "x".repeat(301) })).toBeNull();
  });
});

describe("native Unit authorization", () => {
  beforeEach(() => vi.resetAllMocks());
  const signal = () => new AbortController().signal;
  it("does not open a target if identity resolution is forbidden", async () => {
    api.GET.mockResolvedValue({ error: { error: { code: "FORBIDDEN", message: "Denied" } } });
    await expect(openNativeUnit("private", signal())).rejects.toThrow();
    expect(api.POST).not.toHaveBeenCalled();
  });
  it("independently opens the server-resolved Resource and preserves viewer mode", async () => {
    api.GET.mockResolvedValue({ data: { node: { id: "node", name: "Model" }, resource: { id: "resolved" } } });
    api.POST.mockResolvedValue({ data: { resource: { kind: "univer", unitType: "sheet", unitId: "source", editorMode: "view" } } });
    const abort = signal();
    const result = await openNativeUnit("source", abort);
    expect(api.POST).toHaveBeenCalledWith("/api/resources/{resourceId}/open", { params: { path: { resourceId: "resolved" } }, signal: abort });
    expect(result.resource.editorMode).toBe("view");
  });
  it("rejects a different Unit or unsupported content type after authorization", async () => {
    api.GET.mockResolvedValue({ data: { node: { id: "node" }, resource: { id: "resource" } } });
    for (const resource of [{ kind: "univer", unitType: "sheet", unitId: "other" }, { kind: "blob" },
      { kind: "univer", unitType: "board", unitId: "source" }]) {
      api.POST.mockResolvedValue({ data: { resource } });
      await expect(openNativeUnit("source", signal())).rejects.toThrow();
    }
  });
  it("does not return a stale authorized result after cancellation", async () => {
    const controller = new AbortController();
    api.GET.mockResolvedValue({ data: { node: { id: "node" }, resource: { id: "resource" } } });
    api.POST.mockImplementation(async () => { controller.abort(); return { data: { resource: { kind: "univer", unitType: "sheet", unitId: "source" } } }; });
    await expect(openNativeUnit("source", controller.signal)).rejects.toThrow();
  });
});
