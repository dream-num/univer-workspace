export const NATIVE_PREVIEW_CHANNEL = "workspace-native-unit-v1";
export type NativePreviewFocus =
  | { kind: "doc"; paragraphId: string; quote: string }
  | { kind: "sheet"; sheetId: string; range: string }
  | { kind: "slide"; slideId: string };
const identity = (value: unknown): value is string =>
  typeof value === "string" && /^[\w-]{1,128}$/.test(value);

export function parseNativePreviewFocus(value: unknown): NativePreviewFocus | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  // Accept the original Workspace paragraph/quote shape as well.
  if ((v.kind === "doc" || v.kind === undefined) && identity(v.paragraphId) &&
      typeof v.quote === "string" && v.quote.length > 0 && v.quote.length <= 300)
    return { kind: "doc", paragraphId: v.paragraphId, quote: v.quote };
  if (v.kind === "sheet" && identity(v.sheetId) && typeof v.range === "string" &&
      /^[A-Z]{1,3}[1-9]\d{0,6}(?::[A-Z]{1,3}[1-9]\d{0,6})?$/.test(v.range))
    return { kind: "sheet", sheetId: v.sheetId, range: v.range };
  if (v.kind === "slide" && identity(v.slideId)) return { kind: "slide", slideId: v.slideId };
  return null;
}

