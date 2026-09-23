import { LifecycleStages } from "@univerjs/core";
import type { FUniver } from "@univerjs/core/facade";
// Each native editor preset installs its own UI Facade. Import only the types
// here: a Sheet UI extension in a Doc host observes referenced, headless Sheets
// and requests UI services that the Doc runtime deliberately does not install.
import type {} from "@univerjs/docs-ui/facade";
import type {} from "@univerjs/sheets-ui/facade";
import type {} from "@univerjs-pro/slides/facade";

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
export function installNativePreviewNavigation(api: FUniver, unitId: string, token: string, download?: () => Promise<void>) {
  const send = (status: string, requestId?: string) => window.parent.postMessage({
    channel: NATIVE_PREVIEW_CHANNEL, token, unitId, status, requestId,
    ...(download ? { downloadFormat: "pptx" } : {}),
  }, window.location.origin);
  let disposed = false;
  let downloading = false;
  let ready = api.getCurrentLifecycleStage() >= LifecycleStages.Rendered;
  let lifecycle: { dispose(): void } | undefined;
  const receive = (event: MessageEvent) => {
    if (window.parent === window || event.source !== window.parent ||
        event.origin !== window.location.origin || event.data?.channel !== NATIVE_PREVIEW_CHANNEL ||
        event.data?.token !== token || event.data?.unitId !== unitId) return;
    if (event.data.action === "status") { if (ready) send("ready"); return; }
    if (!ready || disposed) return;
    if (event.data.action === "download" && download && !downloading &&
        typeof event.data.requestId === "string" && /^[\w-]{1,128}$/.test(event.data.requestId)) {
      const requestId = event.data.requestId;
      downloading = true;
      send("downloading", requestId);
      void Promise.resolve().then(download).then(
        () => { if (!disposed) send("downloaded", requestId); },
        () => { if (!disposed) send("download-error", requestId); },
      ).finally(() => { downloading = false; });
      return;
    }
    const focus = parseNativePreviewFocus(event.data.focus);
    if (event.data.action !== "focus" || !focus || (typeof event.data.requestId !== "string" || !/^[\w-]{1,128}$/.test(event.data.requestId))) return;
    try { send(locateNativePreview(api, unitId, focus) ? "located" : "missing", event.data.requestId); }
    catch { send("missing", event.data.requestId); }
  };
  window.addEventListener("message", receive);
  // Snapshot loading precedes Sheet scroll-controller registration. Do not let
  // the parent navigate until the native render modules are installed.
  if (ready) send("ready");
  else lifecycle = api.addEvent(api.Event.LifeCycleChanged, ({ stage }) => {
    if (stage < LifecycleStages.Rendered) return;
    ready = true;
    lifecycle?.dispose();
    send("ready");
  });
  return { dispose() { disposed = true; lifecycle?.dispose(); window.removeEventListener("message", receive); } };
}
