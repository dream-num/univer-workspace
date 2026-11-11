import { HTML_PREVIEW_CHANNEL } from "./native-preview-protocol";
import type { HtmlViewWriteMode } from "@univerjs/univer-workspace-html-viewer/engine";

/** Serialized into the untrusted template. This function must have no module closures. */
function previewClient(channel: string, nonce: string) {
  let slot: HTMLElement | null = null;
  let unitId = "";
  let requestId = "";
  let focus: unknown;
  let frame = 0;
  let lastRect = "";
  const send = () => {
    frame = 0;
    if (!slot || !unitId) return;
    const r = slot.getBoundingClientRect();
    const visible = slot.isConnected && slot.getClientRects().length > 0;
    const rect = { left: r.left, top: r.top, width: visible ? r.width : 0, height: visible ? r.height : 0 };
    const key = JSON.stringify(rect);
    if (key === lastRect) return;
    lastRect = key;
    parent.postMessage({ channel, nonce, action: "show", unitId, requestId, rect, ...(focus ? { focus } : {}) }, "*");
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(send); };
  const observer = new ResizeObserver(schedule);
  const clear = () => {
    observer.disconnect();
    cancelAnimationFrame(frame); frame = 0;
    slot = null; unitId = ""; lastRect = "";
  };
  const api = {
    version: 1,
    capabilities: ["native-preview", "native-focus", "share-link", "write-mode"],
    getWriteMode(unitId: string): Promise<HtmlViewWriteMode> {
      return new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const receive = (event: MessageEvent) => {
          const data = event.data;
          if (event.source !== parent || data?.channel !== channel || data?.nonce !== nonce ||
              data?.action !== "write-mode" || data?.requestId !== id) return;
          clearTimeout(timer); removeEventListener("message", receive);
          if (data.mode === "trial" || data.mode === "saved" || data.mode === "rejected") resolve(data.mode);
          else reject(new Error("Load the source binding before requesting its write mode."));
        };
        const timer = setTimeout(() => {
          removeEventListener("message", receive); reject(new Error("Write mode request timed out."));
        }, 10_000);
        addEventListener("message", receive);
        parent.postMessage({ channel, nonce, action: "write-mode", unitId, requestId: id }, "*");
      });
    },
    showUnit(id: string, element: HTMLElement, options?: { focus?: unknown }) {
      if (!(element instanceof HTMLElement) || !element.isConnected) throw new Error("A connected preview slot is required.");
      clear(); slot = element; unitId = id; focus = options?.focus;
      requestId = crypto.randomUUID(); observer.observe(element); send();
    },
    hideUnit() { clear(); parent.postMessage({ channel, nonce, action: "close" }, "*"); },
    share() { parent.postMessage({ channel, nonce, action: "share" }, "*"); },
  };
  Object.defineProperty(window, "univerWorkspace", { value: Object.freeze(api), configurable: true });
  addEventListener("resize", schedule);
  addEventListener("scroll", schedule, true);
  // Layout shifts can move a slot without resizing it. Observe only while open.
  const timer = setInterval(() => { if (slot) schedule(); }, 250);
  addEventListener("message", event => {
    if (event.source !== parent || event.data?.channel !== channel || event.data?.nonce !== nonce) return;
    if (event.data.action === "closed") { clear(); dispatchEvent(new Event("workspace-preview-closed")); }
    if (event.data.action === "status" && event.data.requestId === requestId)
      dispatchEvent(new CustomEvent("workspace-preview-status", { detail: { unitId, status: event.data.status } }));
  });
  addEventListener("pagehide", () => { clear(); clearInterval(timer); }, { once: true });
  dispatchEvent(new Event("workspace-preview-ready"));
}

/** Add Workspace navigation only; SDK still owns sandbox, binding runtime and CSP. */
export function withNativePreviewClient(source: string, nonce: string): string {
  const document = new DOMParser().parseFromString(source, "text/html");
  const script = document.createElement("script");
  script.textContent = `(${previewClient.toString()})(${JSON.stringify(HTML_PREVIEW_CHANNEL)},${JSON.stringify(nonce)});`;
  document.head.prepend(script);
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}
