import { DEFAULT_WORKSHEET_ROW_COUNT, DEFAULT_WORKSHEET_COLUMN_COUNT, type IWorkbookData } from "@univerjs/core";
import { getHtmlViewUnitIds, parseHtmlView } from "@univerjs-labs/html-view";

/** The original Workspace HTML View binding validation, shared by both Agent hosts. */
export async function validateHtmlView(html: string, loadSheet: (unitId: string) => Promise<IWorkbookData>, signal?: AbortSignal) {
  const parsed = parseHtmlView(html);
  const unitIds = getHtmlViewUnitIds(parsed);
  for (const unitId of unitIds) {
    signal?.throwIfAborted();
    const workbook = await loadSheet(unitId);
    signal?.throwIfAborted();
    for (const binding of parsed.bindings.filter((binding) => binding.reference.unitId === unitId)) {
      const { reference } = binding;
      const sheet = Object.hasOwn(workbook.sheets, reference.sheetId) ? workbook.sheets[reference.sheetId] : undefined;
      if (!sheet) throw new Error(`Source worksheet not found: ${reference.sheetId}`);
      if ((binding.kind === "range" ? binding.reference.range.endRow : binding.reference.row) >= (sheet.rowCount ?? DEFAULT_WORKSHEET_ROW_COUNT) ||
          (binding.kind === "range" ? binding.reference.range.endColumn : binding.reference.col) >= (sheet.columnCount ?? DEFAULT_WORKSHEET_COLUMN_COUNT))
        throw new Error("Source binding is outside the worksheet.");
    }
  }
  return { valid: true as const, unitIds, bindingCount: parsed.bindings.length };
}
