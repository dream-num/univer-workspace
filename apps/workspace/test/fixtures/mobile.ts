import { unmount } from "@univerjs/design";
import Locale0 from "@univerjs/preset-sheets-drawing/locales/zh-CN";
import Locale1 from "@univerjs/preset-sheets-conditional-formatting/locales/zh-CN";
import Locale2 from "@univerjs/preset-sheets-data-validation/locales/zh-CN";
import Locale3 from "@univerjs/preset-sheets-filter/locales/zh-CN";
import Locale4 from "@univerjs/preset-sheets-find-replace/locales/zh-CN";
import Locale5 from "@univerjs/preset-sheets-hyper-link/locales/zh-CN";
import Locale6 from "@univerjs/preset-sheets-sort/locales/zh-CN";
import Locale7 from "@univerjs/preset-sheets-table/locales/zh-CN";
import Locale8 from "@univerjs/preset-sheets-thread-comment/locales/zh-CN";
import Locale9 from "@univerjs/preset-sheets-advanced/locales/zh-CN";
import { createUniver, LocaleType, mergeLocales, type IPreset, type IPresetPlugin } from "@univerjs/presets";
import * as Core from "@univerjs/preset-sheets-core";
import * as Drawing from "@univerjs/preset-sheets-drawing";
import * as Conditional from "@univerjs/preset-sheets-conditional-formatting";
import * as Validation from "@univerjs/preset-sheets-data-validation";
import * as Filter from "@univerjs/preset-sheets-filter";
import * as Find from "@univerjs/preset-sheets-find-replace";
import * as Link from "@univerjs/preset-sheets-hyper-link";
import * as Sort from "@univerjs/preset-sheets-sort";
import * as Table from "@univerjs/preset-sheets-table";
import * as Comment from "@univerjs/preset-sheets-thread-comment";
import * as Advanced from "@univerjs/preset-sheets-advanced";
import * as Chart from "@univerjs-pro/chart-ui";
import * as Shape from "@univerjs-pro/shape-editor-ui";
import CoreZhCN from "@univerjs/preset-sheets-core/locales/zh-CN";

import { resolveUniverLicense } from "../../web/src/features/editor/features/univer-license";
import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-sheets-drawing/lib/index.css";
import "@univerjs/preset-sheets-conditional-formatting/lib/index.css";
import "@univerjs/preset-sheets-data-validation/lib/index.css";
import "@univerjs/preset-sheets-filter/lib/index.css";
import "@univerjs/preset-sheets-find-replace/lib/index.css";
import "@univerjs/preset-sheets-hyper-link/lib/index.css";
import "@univerjs/preset-sheets-sort/lib/index.css";
import "@univerjs/preset-sheets-table/lib/index.css";
import "@univerjs/preset-sheets-thread-comment/lib/index.css";
import "@univerjs/preset-sheets-advanced/lib/index.css";

// A verification-only composition over public preset exports; never used by production.
const exports = { ...Core, ...Drawing, ...Conditional, ...Validation, ...Filter, ...Find, ...Link, ...Sort, ...Table, ...Comment, ...Advanced, ...Chart, ...Shape };
const replacements = new Map<unknown, unknown>();
for (const [name, value] of Object.entries(exports)) {
  if (!name.includes("Mobile") || !name.endsWith("Plugin")) continue;
  const desktop = exports[name.replace("Mobile", "") as keyof typeof exports]
    ?? exports[name.replace("MobileUI", "") as keyof typeof exports];
  if (desktop) replacements.set(desktop, value);
}
const status = document.querySelector<HTMLPreElement>("#status")!;
const report = (message: string) => { status.textContent = message; };
const errors: string[] = [];
window.addEventListener("error", (event) => { errors.push(event.message); report(`ERROR: ${errors.join("\n")}`); });
window.addEventListener("unhandledrejection", (event) => { errors.push(String(event.reason)); report(`ERROR: ${errors.join("\n")}`); });
const params = new URLSearchParams(location.search);
const stack = params.get("stack") ?? "core";
const desktop = params.has("desktop");
const omitPivot = params.has("omitPivot");
let runtime: ReturnType<typeof createUniver>;
let mounts = 0;
const mobileNames: string[] = [];
function mobile(preset: IPreset): IPreset {
  return { ...preset, plugins: preset.plugins.map((entry): IPresetPlugin => {
    const original = Array.isArray(entry) ? entry[0] : entry;
    const replacement = desktop ? undefined : replacements.get(original) as typeof original | undefined;
    if (!replacement) return entry;
    mobileNames.push(Object.entries(exports).find(([, value]) => value === replacement)?.[0] ?? "unknown");
    return Array.isArray(entry) ? [replacement, entry[1]] : replacement;
  }) };
}
function mount(snapshot?: Parameters<ReturnType<typeof createUniver>["univerAPI"]["createWorkbook"]>[0]) {
  mobileNames.length = 0;
  const presets = [Core.UniverSheetsCorePreset({ container: "app" })];
  if (stack !== "core") presets.push(
    Drawing.UniverSheetsDrawingPreset(), Conditional.UniverSheetsConditionalFormattingPreset(),
    Validation.UniverSheetsDataValidationPreset(), Filter.UniverSheetsFilterPreset(),
    Find.UniverSheetsFindReplacePreset(), Link.UniverSheetsHyperLinkPreset(),
    Sort.UniverSheetsSortPreset(), Table.UniverSheetsTablePreset(), Comment.UniverSheetsThreadCommentPreset(),
  );
  if (stack === "advanced") presets.unshift({ plugins: [[Advanced.UniverLicensePlugin, { license: resolveUniverLicense() }]] });
  if (stack === "advanced") presets.push(Advanced.UniverSheetsAdvancedPreset({ license: resolveUniverLicense(), universerEndpoint: location.origin }));
  runtime = createUniver({ locale: LocaleType.ZH_CN, locales: { [LocaleType.ZH_CN]: mergeLocales(CoreZhCN, Locale0, Locale1, Locale2, Locale3, Locale4, Locale5, Locale6, Locale7, Locale8, Locale9) }, presets: presets.map((preset) => mobile({ ...preset, plugins: preset.plugins.filter((entry) => {
      const plugin = Array.isArray(entry) ? entry[0] : entry;
      return !omitPivot || (plugin !== Advanced.UniverSheetsPivotTablePlugin && plugin !== Advanced.UniverSheetsPivotTableUIPlugin);
    }) })),
    plugins: stack === "advanced" ? [desktop ? Chart.UniverChartUIPlugin : Chart.UniverChartMobileUIPlugin, desktop ? Shape.UniverShapeEditorUIPlugin : Shape.UniverShapeEditorMobileUIPlugin] : [],
  });
  runtime.univerAPI.createWorkbook(snapshot ?? {
    id: "mobile-verification", name: "移动插件验证", sheetOrder: ["sheet1"],
    sheets: { sheet1: { id: "sheet1", name: "测试表", rowCount: 100, columnCount: 20,
      cellData: { 0: { 0: { v: "项目" }, 1: { v: "数量" }, 2: { v: "单价" }, 3: { v: "合计" } },
        1: { 0: { v: "苹果" }, 1: { v: 3 }, 2: { v: 5 }, 3: { f: "=B2*C2" } },
        2: { 0: { v: "香蕉" }, 1: { v: 4 }, 2: { v: 6 }, 3: { f: "=B3*C3" } } } } },
  });
  mounts++;
  report(`${stack}: mounted ${mounts}\n${mobileNames.join(", ")}`);
}
function sheet() { return runtime.univerAPI.getActiveWorkbook()!.getActiveSheet(); }
document.querySelector("#check")!.addEventListener("click", () => {
  report(`${stack}: mounted ${mounts}\nA2=${sheet().getRange("A2").getValue()} B2=${sheet().getRange("B2").getValue()} D2=${sheet().getRange("D2").getValue()}\nViewport=${innerWidth}×${innerHeight} errors=${errors.length} lifecycle=${runtime.univerAPI.getCurrentLifecycleStage()}`);
});
document.querySelector("#exercise")!.addEventListener("click", async () => {
  try {
    const range = sheet().getRange("B2"); const before = range.getValue();
    range.setValue(7); const after = range.getValue();
    await runtime.univerAPI.undo(); const undo = range.getValue();
    await runtime.univerAPI.redo(); const redo = range.getValue();
    report(`write=${after} undo=${undo} redo=${redo}: ${after === 7 && undo === before && redo === 7 ? "PASS" : "FAIL"}`);
  } catch (error) { report(String(error)); }
});
document.querySelector("#remount")!.addEventListener("click", () => {
  try {
    const snapshot = runtime.univerAPI.getActiveWorkbook()!.save();
    report("Disposing…");
    unmount(document.querySelector<HTMLElement>("#app")!);
    runtime.univer.dispose();
    report("Remounting…");
    mount(snapshot);
  } catch (error) {
    errors.push(String(error));
    report(`${status.textContent}\n${error instanceof Error ? error.stack : String(error)}`);
  }
});
mount();
