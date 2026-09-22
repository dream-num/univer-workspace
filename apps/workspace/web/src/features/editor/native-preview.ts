import type { FUniver } from "@univerjs/core/facade";
import "@univerjs/docs-ui/facade";
import "@univerjs/sheets-ui/facade";
import "@univerjs-pro/slides/facade";

import { NATIVE_PREVIEW_CHANNEL, parseNativePreviewFocus, type NativePreviewFocus } from "./preview";

/** Navigation only: no content mutation, stale offsets, or arbitrary Facade execution. */
export function locateNativePreview(api: FUniver, unitId: string, focus: NativePreviewFocus): boolean {
  if (focus.kind === "doc") {
    const doc = api.getDocument(unitId);
    const paragraph = doc?.getParagraph(focus.paragraphId);
    const offset = paragraph?.getText().indexOf(focus.quote) ?? -1;
    if (!doc || !paragraph || offset < 0) return false;
    const anchor = paragraph.getInfo().startOffset + offset;
    doc.setSelection(anchor, anchor);
    return true;
  }
  if (focus.kind === "sheet") {
    const workbook = api.getWorkbook(unitId);
    const sheet = workbook?.getSheetBySheetId(focus.sheetId);
    if (!workbook || !sheet) return false;
    const range = sheet.getRange(focus.range);
    const rect = range.getRange();
    if (rect.endRow >= sheet.getMaxRows() || rect.endColumn >= sheet.getMaxColumns()) return false;
    workbook.setActiveSheet(sheet);
    range.activate();
    sheet.scrollToCell(rect.startRow, rect.startColumn);
    return true;
  }
  const presentation = api.getPresentation(unitId);
  const slide = presentation?.getSlideById(focus.slideId);
  if (!presentation || !slide) return false;
  presentation.setActiveSlide(slide);
  return true;
}

/** Only the trusted same-origin preview parent can ask for bounded navigation. */
export function installNativePreviewNavigation(api: FUniver, unitId: string, token: string) {
  const send = (status: string, requestId?: string) => window.parent.postMessage({
    channel: NATIVE_PREVIEW_CHANNEL, token, unitId, status, requestId,
  }, window.location.origin);
  const receive = (event: MessageEvent) => {
    if (window.parent === window || event.source !== window.parent ||
        event.origin !== window.location.origin || event.data?.channel !== NATIVE_PREVIEW_CHANNEL ||
        event.data?.token !== token || event.data?.unitId !== unitId) return;
    if (event.data.action === "status") { send("ready"); return; }
    const focus = parseNativePreviewFocus(event.data.focus);
    if (event.data.action !== "focus" || !focus || (typeof event.data.requestId !== "string" || !/^[\w-]{1,128}$/.test(event.data.requestId))) return;
    try { send(locateNativePreview(api, unitId, focus) ? "located" : "missing", event.data.requestId); }
    catch { send("missing", event.data.requestId); }
  };
  window.addEventListener("message", receive);
  send("ready");
  return { dispose: () => window.removeEventListener("message", receive) };
}
