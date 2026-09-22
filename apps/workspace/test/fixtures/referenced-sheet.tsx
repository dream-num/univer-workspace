import { getDocsEmptySnapshot, IUniverInstanceService, LocaleType, Univer, UniverInstanceType, type IWorkbookData, type Workbook } from "@univerjs/core";
import { createUniver, type IPreset } from "@univerjs/presets";
import { RefRangeService } from "@univerjs/sheets";
import { getEmptySnapshot, type ISlideData, type SlideModel } from "@univerjs-pro/slides";
import { ISnapshotServerService, SnapshotService, UniverCollaborationPlugin } from "@univerjs-pro/collaboration";
import { UniverCollaborationClientPlugin } from "@univerjs-pro/collaboration-client";
import { BrowserCollaborationSocketService, UniverCollaborationClientUIPlugin } from "@univerjs-pro/collaboration-client-ui";
import { EmbedFormulaReferenceDataProvider, UniverEmbedPlugin } from "@univerjs-pro/embed";
import { UniverLicensePlugin } from "@univerjs-pro/license";
import { createWorkspaceReferencedUnitProviderRegistration } from "@univerjs/univer-workspace-reference-provider";
import { resolveUniverLicense } from "../../web/src/features/editor/features/univer-license";
import DocEditor, { docEditorLocales } from "../../web/src/features/editor/units/doc/doc-editor";
import SlideEditor, { slideEditorLocales } from "../../web/src/features/editor/units/slide/slide-editor";
import { createReferencedSheetSource } from "./referenced-sheet-source";
import "@univerjs-pro/collaboration-client/facade";

async function run() {
  const kind = new URLSearchParams(location.search).get("type") === "slide" ? "slide" : "doc";
  const seed = new Univer();
  const workbook = seed.createUnit<Partial<IWorkbookData>, Workbook>(UniverInstanceType.UNIVER_SHEET, {
    id: "source-sheet", name: "Source", sheetOrder: ["tab"],
    sheets: { tab: { id: "tab", name: "Sheet1", rowCount: 20, columnCount: 10, cellData: { 0: { 0: { v: 100, t: 2 } } } } },
  });
  const server = await createReferencedSheetSource(workbook.save());
  seed.dispose();
  const definition = (kind === "doc" ? DocEditor : SlideEditor) as unknown as {
    createPresets(container: HTMLElement, license: string, scope: { kind: "worktree"; worktreeId: string }): IPreset[];
  };
  let runtime: Univer;
  const provider = createWorkspaceReferencedUnitProviderRegistration({
    hostContext: { view: { kind: "trunk" } },
    resolveSnapshotService: () => runtime.__getInjector().get(SnapshotService),
  });
  const license = resolveUniverLicense();
  const { univer } = createUniver({
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: (kind === "doc" ? docEditorLocales : slideEditorLocales)["en-US"] },
    collaboration: true,
    presets: [{ plugins: [[UniverLicensePlugin, { license }]] }, ...definition.createPresets(document.getElementById("editor")!, license, { kind: "worktree", worktreeId: "fixture" })],
    plugins: [
      UniverCollaborationPlugin,
      [UniverCollaborationClientPlugin, { socketService: BrowserCollaborationSocketService, enableAuthServer: false, enableOfflineEditing: false, enableSingleActiveInstanceLock: false, override: [[ISnapshotServerService, { useValue: server }]] }],
      UniverCollaborationClientUIPlugin,
      [UniverEmbedPlugin, { resourceRefUnitProviderRegistrations: [provider] }],
    ],
  });
  runtime = univer;
  if (kind === "doc") runtime.createUnit(UniverInstanceType.UNIVER_DOC, getDocsEmptySnapshot("contract"));
  else runtime.createUnit<ISlideData, SlideModel>(UniverInstanceType.UNIVER_SLIDE, getEmptySnapshot("presentation"));
  const formulaData = await runtime.__getInjector().get(EmbedFormulaReferenceDataProvider).readData({
    requestId: "amount", calculationId: "contract-amount", hostUnitId: kind === "doc" ? "contract" : "presentation",
    syntheticUnitId: "formula-source", target: { name: "Finance", unitType: UniverInstanceType.UNIVER_SHEET, uri: "#unit=source-sheet&type=sheet" },
    ranges: [{ sheetName: "Finance", sheetId: "tab", range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 } }],
  });
  const source = runtime.__getInjector().get(IUniverInstanceService).getUnit<Workbook>("source-sheet", UniverInstanceType.UNIVER_SHEET)!;
  return { kind, values: { values: [[formulaData?.sheets[0]?.cells[0]?.cell.v]] }, formulaData, sheetName: source.getSheetBySheetId("tab")!.getName(), cursorDependency: !!runtime.__getInjector().get(RefRangeService) };
}

(window as unknown as { referenceResult: Promise<unknown> }).referenceResult = run();
