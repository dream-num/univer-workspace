export { parseHtmlView, MAX_HTML_VIEW_BYTES } from "./sanitize.js";
export { parseCellReference, cellReferenceKey, getHtmlViewUnitIds } from "./reference.js";
export type { HtmlCellReference, HtmlViewBinding, HtmlViewDocument } from "./types.js";
export function isHtmlViewFilename(filename: string): boolean {
  return /\.univer\.html$/i.test(filename);
}
