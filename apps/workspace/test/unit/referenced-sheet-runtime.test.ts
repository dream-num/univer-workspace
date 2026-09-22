import type { IWorkbookData, Workbook } from "@univerjs/core";
import type { IPreset, IPresetPlugin } from "@univerjs/presets";
import { afterEach, describe, expect, it, vi } from "vitest";

// Inspect the actual product preset definitions without mounting the React shell.
vi.mock("../../web/src/features/editor/collaboration-editor", () => ({
  createCollaborationEditor: (definition: unknown) => definition,
}));

function constructorOf(plugin: IPresetPlugin) {
  return Array.isArray(plugin) ? plugin[0] : plugin;
}

describe("Sheet sources in Doc and Slide editors", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(["doc", "slide"])(
    "reads referenced Sheet data after history replay in the %s host",
    async (hostType) => {
      vi.stubGlobal("Path2D", class {});
      const core = await import("@univerjs/core");
      const { UniverDocsPlugin } = await import("@univerjs/docs");
      const slides = await import("@univerjs-pro/slides");
      const { RefRangeService } = await import("@univerjs/sheets");
      const {
        SnapshotService,
        ISnapshotServerService: snapshotToken,
        UniverCollaborationPlugin,
      } = await import("@univerjs-pro/collaboration");
      const { EmbedFormulaReferenceDataProvider, UniverEmbedPlugin } =
        await import("@univerjs-pro/embed");
      const { createWorkspaceReferencedUnitProviderRegistration } =
        await import("@univerjs/univer-workspace-reference-provider");
      const { getReferencedSheetPlugins } =
        await import("../../web/src/features/editor/features/referenced-sheet-plugins");
      const editor =
        hostType === "doc"
          ? await import("../../web/src/features/editor/units/doc/doc-editor")
          : await import("../../web/src/features/editor/units/slide/slide-editor");
      const definition = editor.default as unknown as {
        createPresets(container: HTMLElement, license: string, scope: { kind: "trunk" }): IPreset[];
      };
      const sourceNames = new Set(
        getReferencedSheetPlugins().map((plugin) => constructorOf(plugin).pluginName),
      );
      const dataPlugins = new Map<string, IPresetPlugin>();
      for (const preset of definition.createPresets({ id: "host" } as HTMLElement, "", {
        kind: "trunk",
      })) {
        for (const plugin of preset.plugins) {
          const name = constructorOf(plugin).pluginName;
          if (sourceNames.has(name)) dataPlugins.set(name, plugin);
        }
      }
      const univer = new core.Univer({
        locale: core.LocaleType.EN_US,
        locales: { [core.LocaleType.EN_US]: {} },
        logLevel: core.LogLevel.SILENT,
      });
      const { createReferencedSheetSource } = await import("../fixtures/referenced-sheet-source");
      try {
        univer.registerPlugin(UniverDocsPlugin);
        if (hostType === "slide") univer.registerPlugin(slides.UniverSlidesPlugin);
        for (const plugin of dataPlugins.values()) {
          if (Array.isArray(plugin)) univer.registerPlugin(plugin[0], plugin[1]);
          else univer.registerPlugin(plugin);
        }
        const hostUnitType =
          hostType === "doc"
            ? core.UniverInstanceType.UNIVER_DOC
            : core.UniverInstanceType.UNIVER_SLIDE;
        const host =
          hostType === "doc"
            ? univer.createUnit(hostUnitType, core.getDocsEmptySnapshot("host-doc"))
            : univer.createUnit(hostUnitType, slides.getEmptySnapshot("host-slide"));
        const initial = univer.createUnit<Partial<IWorkbookData>, Workbook>(
          core.UniverInstanceType.UNIVER_SHEET,
          {
            id: "seed",
            name: "Source",
            sheetOrder: ["tab"],
            sheets: {
              tab: {
                id: "tab",
                name: "Sheet1",
                rowCount: 20,
                columnCount: 10,
                cellData: { 0: { 0: { v: 100, t: core.CellValueType.NUMBER } } },
              },
            },
          },
        );
        const data = { ...initial.save(), id: "source-sheet" };
        univer.__getInjector().get(core.IUniverInstanceService).disposeUnit("seed");
        const server = await createReferencedSheetSource(data);
        const getUnit = vi.spyOn(server, "getUnitOnRev");
        univer.__getInjector().add([snapshotToken, { useValue: server }]);
        univer.registerPlugin(UniverCollaborationPlugin);
        const registration = createWorkspaceReferencedUnitProviderRegistration({
          hostContext: { view: { kind: "trunk" } },
          resolveSnapshotService: () => univer.__getInjector().get(SnapshotService),
        });
        univer.registerPlugin(UniverEmbedPlugin, {
          resourceRefUnitProviderRegistrations: [registration],
        });
        const formulaData = await univer
          .__getInjector()
          .get(EmbedFormulaReferenceDataProvider)
          .readData({
            requestId: "amount",
            calculationId: "contract-amount",
            hostUnitId: hostType === "doc" ? "host-doc" : "host-slide",
            syntheticUnitId: "formula-source",
            target: {
              name: "Finance",
              unitType: core.UniverInstanceType.UNIVER_SHEET,
              uri: "#unit=source-sheet&type=sheet",
            },
            ranges: [
              {
                sheetName: "Finance",
                sheetId: "tab",
                range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
              },
            ],
          });
        const instances = univer.__getInjector().get(core.IUniverInstanceService);
        const loaded = instances.getUnit<Workbook>(
          "source-sheet",
          core.UniverInstanceType.UNIVER_SHEET,
        )!;
        expect(loaded.getSheetBySheetId("tab")!.getName()).toBe("Finance");
        expect(loaded.getSheetBySheetId("tab")!.getCell(0, 0)?.v).toBe(12500);
        expect(formulaData?.sheets[0]?.cells[0]?.cell.v).toBe(12500);
        expect(formulaData?.freshness).toBe("fresh");
        expect(univer.__getInjector().get(RefRangeService)).toBeDefined();
        expect(instances.getCurrentUnitOfType(hostUnitType)).toBe(host);
        expect(getUnit).toHaveBeenCalledOnce();
      } finally {
        univer.dispose();
      }
    },
    60_000,
  );
});
