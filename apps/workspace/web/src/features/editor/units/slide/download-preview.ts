import type { FUniver } from "@univerjs/core/facade";
import type {} from "@univerjs-pro/slides/facade";
import type {} from "@univerjs-pro/slides-exchange-client/facade";
import type {} from "@univerjs-pro/exchange-client/facade";
import type {} from "@univerjs/sheets-formula/facade";

/** Export the live native preview, including its calculated reference values.
 * Unit-ID export reads server caches, which may predate the visible source edit.
 * Snapshot exchange uses the existing authenticated upload/export service and
 * does not write document content or change its collaboration revision. */
export async function downloadSlidePreview(api: FUniver, unitId: string): Promise<void> {
  const presentation = api.getPresentation(unitId);
  if (!presentation) throw new Error("Presentation is not available.");
  const formula = api.getFormula();
  const calculated = formula.onCalculationResultApplied(30_000);
  formula.executeCalculation();
  await calculated;
  const file = await api.exportSlideBySnapshotAsync(presentation.save());
  if (!file) throw new Error("PowerPoint export did not produce a file.");
  api.downloadFile(file, presentation.getName().replace(/\.pptx$/i, ""), "pptx");
}
