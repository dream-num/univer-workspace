import type { IImportedFile } from "@univerjs-pro/exchange-node";

/**
 * SDK 1.4.0: once a PDF import stores its decoded fonts as resources, the PDF editor draws text
 * with the embedded subset programs and renders most CJK glyphs of those subsets blank (seen with
 * CFF `font/otf` subsets from a Word-exported PDF; the editor only validates TrueType subsets).
 * Keeping PDF fonts inline leaves them unbound, so text draws with the browser's fallback fonts.
 *
 * Scope: PDF imports only. Images, the source PDF and raw streams still become Trunk Assets, and
 * PDF export writes the inline fonts back unchanged. Cost: the editor shows fallback fonts instead
 * of the document's own, and font bytes stay in the Unit snapshot.
 *
 * Remove when a CJK PDF imported with bound fonts renders all of its text in the PDF editor.
 */
export function keepsPdfImportFontInline(file: IImportedFile): boolean {
  return file.mimeType.startsWith("font/");
}
