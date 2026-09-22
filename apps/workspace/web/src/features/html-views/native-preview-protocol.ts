import { parseNativePreviewFocus, type NativePreviewFocus } from "../editor/preview";

export const HTML_PREVIEW_CHANNEL = "workspace-native-preview-v1";
export interface PreviewRect { left: number; top: number; width: number; height: number }
export interface PreviewRequest {
  unitId: string;
  requestId: string;
  rect: PreviewRect;
  focus?: NativePreviewFocus;
}

export function parsePreviewMessage(data: unknown, nonce: string): PreviewRequest | "close" | "share" | null {
  if (!data || typeof data !== "object") return null;
  const value = data as Record<string, unknown>;
  if (value.channel !== HTML_PREVIEW_CHANNEL || value.nonce !== nonce) return null;
  if (value.action === "close" || value.action === "share") return value.action;
  if (value.action !== "show" || typeof value.unitId !== "string" ||
      !/^[\w-]{1,128}$/.test(value.unitId) || typeof value.requestId !== "string" ||
      !/^[\w-]{1,128}$/.test(value.requestId) || !value.rect || typeof value.rect !== "object") return null;
  const rect = value.rect as Record<string, unknown>;
  if (![rect.left, rect.top, rect.width, rect.height].every(n =>
    typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e7)) return null;
  if ((rect.width as number) < 0 || (rect.height as number) < 0) return null;
  const focus = value.focus === undefined ? undefined : parseNativePreviewFocus(value.focus);
  if (focus === null) return null;
  return { unitId: value.unitId, requestId: value.requestId,
    rect: { left: rect.left as number, top: rect.top as number, width: rect.width as number, height: rect.height as number },
    ...(focus ? { focus } : {}) };
}

export function boundPreviewRect(rect: PreviewRect, width: number, height: number): PreviewRect {
  const left = Math.max(0, Math.min(width, rect.left));
  const top = Math.max(0, Math.min(height, rect.top));
  return { left, top, width: Math.max(0, Math.min(width, rect.left + rect.width) - left),
    height: Math.max(0, Math.min(height, rect.top + rect.height) - top) };
}

/** The only DOM adapter: search this viewer's public DOM, including open shadow roots.
 * No SDK classes, private properties or credentials enter the template protocol. */
export function findHtmlFrame(root: ParentNode | null): HTMLIFrameElement | null {
  if (!root) return null;
  for (const child of root.children) {
    if (child instanceof HTMLIFrameElement) return child;
    const found = findHtmlFrame(child.shadowRoot) ?? findHtmlFrame(child);
    if (found) return found;
  }
  return null;
}
