import {
  IBaseExchangeService,
  UniverBasesExchangeClientPlugin,
} from "@univerjs-pro/bases-exchange-client";
import { IBaseUIStateService } from "@univerjs-pro/bases-ui";
import {
  IDocExchangeService,
  UniverDocsExchangeClientPlugin,
} from "@univerjs-pro/docs-exchange-client";
import { ExchangeDocType, ExchangeFormat } from "@univerjs-pro/exchange-client";
import {
  IPdfExchangeService,
  UniverPdfsExchangeClientPlugin,
} from "@univerjs-pro/pdfs-exchange-client";
import {
  ISheetExchangeService,
  UniverSheetsExchangeClientPlugin,
} from "@univerjs-pro/sheets-exchange-client";
import {
  ISlideExchangeService,
  UniverSlidesExchangeClientPlugin,
} from "@univerjs-pro/slides-exchange-client";
import {
  DocumentFlavor,
  IUniverInstanceService,
  UniverInstanceType,
  type BaseDataModel,
  type DocumentDataModel,
  type IAccessor,
  type Injector,
  type Plugin,
  type PluginCtor,
  type UnitModel,
  type Workbook,
} from "@univerjs/core";
import { WorkbookExportPermission } from "@univerjs/sheets";
import { getCurrentRangeDisable$ } from "@univerjs/sheets-ui";
import type { Observable } from "rxjs";

export type WorkspaceExchangeUnitType = "sheet" | "doc" | "slide" | "base" | "pdf";

export interface ExportTargets {
  readonly items: readonly { readonly label: string; readonly value: string }[];
  readonly selectedId: string;
}

/**
 * One editor's view of the SDK exchange services. Every conversion goes
 * through the Workspace server's `/universer-api/exchange` endpoints that the
 * headless exchange client is configured with, so the server keeps owning the
 * license, the Personal Space import target and export authorization.
 */
/** Which version of converted Office attachments an export embeds (SDK 1.4 `oleAttachmentSource`). */
export interface WorkspaceExportOptions {
  readonly oleAttachmentSource?: "original" | "online";
}

export interface WorkspaceUnitExchange {
  currentUnit(): { readonly unitId: string; readonly name: string } | undefined;
  importToUnit(file: File): Promise<string | undefined>;
  exportByUnitId(
    unitId: string,
    format: ExchangeFormat,
    targetId?: string,
    options?: WorkspaceExportOptions
  ): Promise<File | undefined>;
  /** Worksheets or tables that CSV/TSV can export one at a time. */
  exportTargets?(): ExportTargets | undefined;
}

export interface WorkspaceExchangeDefinition {
  readonly unitType: WorkspaceExchangeUnitType;
  readonly instanceType: UniverInstanceType;
  /**
   * The SDK 1.1 package namespace. `@univerjs/docs`, `@univerjs-pro/bases`
   * and `@univerjs-pro/embed-ui` still dispatch or filter these operation
   * ids, so the Workspace UI registers them under the same names.
   */
  readonly namespace: string;
  readonly importExtensions: readonly string[];
  readonly exportFormats: readonly ExchangeFormat[];
  readonly headlessPlugin: PluginCtor<Plugin>;
  readonly placement:
    | { readonly kind: "ribbon"; readonly order: number }
    | { readonly kind: "base-toolbar" };
  readonly menuDisabled$?: (accessor: IAccessor) => Observable<boolean>;
  bind(injector: Injector): WorkspaceUnitExchange;
}

export function exchangeIds(definition: WorkspaceExchangeDefinition) {
  const { namespace, unitType } = definition;
  return {
    menu: `${namespace}.operation.exchange`,
    importUnit: `${namespace}.operation.import-${unitType}`,
    exportUnit: `${namespace}.operation.export-${unitType}`,
    exportByFormat: `${namespace}.operation.export-${unitType}-by-format`,
    exportDialog: `${namespace}.dialog.export-format`,
  } as const;
}

function currentUnit<T extends UnitModel>(
  injector: Injector,
  type: UniverInstanceType,
  name: (unit: T) => string | undefined
) {
  const unit = injector
    .get(IUniverInstanceService)
    .getCurrentUnitOfType<T>(type);
  return unit ? { unitId: unit.getUnitId(), name: name(unit) ?? "" } : undefined;
}

const SPREADSHEET_EXTENSIONS = ["xls", "xlsx", "csv", "tsv"] as const;
const GRID_EXPORT_FORMATS = [
  ExchangeFormat.XLSX,
  ExchangeFormat.CSV,
  ExchangeFormat.TSV,
] as const;

export const SHEET_EXCHANGE: WorkspaceExchangeDefinition = {
  unitType: "sheet",
  instanceType: UniverInstanceType.UNIVER_SHEET,
  namespace: "sheets-exchange-client",
  importExtensions: SPREADSHEET_EXTENSIONS,
  exportFormats: GRID_EXPORT_FORMATS,
  headlessPlugin: UniverSheetsExchangeClientPlugin,
  placement: { kind: "ribbon", order: 0.03 },
  menuDisabled$: (accessor) =>
    getCurrentRangeDisable$(accessor, { workbookTypes: [WorkbookExportPermission] }),
  bind(injector) {
    const service = () => injector.get(ISheetExchangeService);
    const workbook = () =>
      injector
        .get(IUniverInstanceService)
        .getCurrentUnitOfType<Workbook>(UniverInstanceType.UNIVER_SHEET);
    return {
      currentUnit: () =>
        currentUnit<Workbook>(injector, UniverInstanceType.UNIVER_SHEET, (unit) =>
          unit.getSnapshot().name
        ),
      importToUnit: (file) => service().importSheetToUnitId(file),
      exportByUnitId: (unitId, format, sheetId, options) =>
        service().exportSheetByUnitId(unitId, format, sheetId, options),
      exportTargets() {
        const unit = workbook();
        if (!unit) return undefined;
        return {
          selectedId:
            unit.getActiveSheet(true)?.getSheetId() ??
            unit.getSheets()[0]?.getSheetId() ??
            "",
          items: unit.getSheets().map((sheet) => ({
            label: sheet.getName(),
            value: sheet.getSheetId(),
          })),
        };
      },
    };
  },
};

export const DOC_EXCHANGE: WorkspaceExchangeDefinition = {
  unitType: "doc",
  instanceType: UniverInstanceType.UNIVER_DOC,
  namespace: "docs-exchange-client",
  importExtensions: ["doc", "docx"],
  exportFormats: [ExchangeFormat.DOCX],
  headlessPlugin: UniverDocsExchangeClientPlugin,
  placement: { kind: "ribbon", order: 0.3 },
  bind(injector) {
    const service = () => injector.get(IDocExchangeService);
    const document = () =>
      injector
        .get(IUniverInstanceService)
        .getCurrentUnitOfType<DocumentDataModel>(UniverInstanceType.UNIVER_DOC);
    return {
      currentUnit: () =>
        currentUnit<DocumentDataModel>(injector, UniverInstanceType.UNIVER_DOC, (unit) =>
          unit.getSnapshot().title
        ),
      importToUnit(file) {
        // Keep the imported document in the current document's layout flavor.
        const flavor = document()?.getDocumentStyle().documentFlavor;
        const docType =
          flavor === DocumentFlavor.MODERN
            ? ExchangeDocType.MODERN
            : flavor === DocumentFlavor.TRADITIONAL
              ? ExchangeDocType.TRADITIONAL
              : undefined;
        return service().importDocToUnitId(
          file,
          docType === undefined ? undefined : { docType }
        );
      },
      exportByUnitId: (unitId, _format, _targetId, options) =>
        service().exportDocByUnitId(unitId, options),
    };
  },
};

export const SLIDE_EXCHANGE: WorkspaceExchangeDefinition = {
  unitType: "slide",
  instanceType: UniverInstanceType.UNIVER_SLIDE,
  namespace: "slides-exchange-client",
  importExtensions: ["ppt", "pptx"],
  exportFormats: [ExchangeFormat.PPTX],
  headlessPlugin: UniverSlidesExchangeClientPlugin,
  placement: { kind: "ribbon", order: 0.3 },
  bind(injector) {
    const service = () => injector.get(ISlideExchangeService);
    return {
      currentUnit: () =>
        currentUnit<UnitModel<{ readonly title?: string }>>(
          injector,
          UniverInstanceType.UNIVER_SLIDE,
          (unit) => unit.getSnapshot().title
        ),
      importToUnit: (file) => service().importSlideToUnitId(file),
      exportByUnitId: (unitId, _format, _targetId, options) =>
        service().exportSlideByUnitId(unitId, options),
    };
  },
};

export const PDF_EXCHANGE: WorkspaceExchangeDefinition = {
  unitType: "pdf",
  instanceType: UniverInstanceType.UNIVER_PDF,
  namespace: "pdfs-exchange-client",
  importExtensions: ["pdf"],
  exportFormats: [ExchangeFormat.PDF],
  headlessPlugin: UniverPdfsExchangeClientPlugin,
  placement: { kind: "ribbon", order: 0.3 },
  bind(injector) {
    const service = () => injector.get(IPdfExchangeService);
    return {
      currentUnit: () =>
        currentUnit<UnitModel<{ readonly name?: string }>>(
          injector,
          UniverInstanceType.UNIVER_PDF,
          (unit) => unit.getSnapshot().name
        ),
      importToUnit: (file) => service().importPdfToUnitId(file),
      exportByUnitId: (unitId) => service().exportPdfByUnitId(unitId),
    };
  },
};

export const BASE_EXCHANGE: WorkspaceExchangeDefinition = {
  unitType: "base",
  instanceType: UniverInstanceType.UNIVER_BASE,
  namespace: "bases-exchange-client",
  importExtensions: SPREADSHEET_EXTENSIONS,
  exportFormats: GRID_EXPORT_FORMATS,
  headlessPlugin: UniverBasesExchangeClientPlugin,
  placement: { kind: "base-toolbar" },
  bind(injector) {
    const service = () => injector.get(IBaseExchangeService);
    const base = () =>
      injector
        .get(IUniverInstanceService)
        .getCurrentUnitOfType<BaseDataModel>(UniverInstanceType.UNIVER_BASE);
    return {
      currentUnit: () =>
        currentUnit<BaseDataModel>(injector, UniverInstanceType.UNIVER_BASE, (unit) =>
          unit.getSnapshot().name
        ),
      importToUnit: (file) => service().importBaseToUnitId(file),
      exportByUnitId: (unitId, format, tableId) =>
        service().exportBaseByUnitId(unitId, format, tableId),
      exportTargets() {
        const unit = base();
        if (!unit) return undefined;
        const snapshot = unit.getSnapshot();
        const items = snapshot.tableOrder
          .map((tableId) => snapshot.tables[tableId])
          .filter((table) => table !== undefined)
          .map((table) => ({ label: table.name, value: table.id }));
        const activeTableId = injector.has(IBaseUIStateService)
          ? injector.get(IBaseUIStateService).getState().activeTableId
          : undefined;
        return {
          items,
          selectedId: items.some((item) => item.value === activeTableId)
            ? activeTableId!
            : items[0]?.value ?? "",
        };
      },
    };
  },
};

export const WORKSPACE_EXCHANGE_DEFINITIONS: Readonly<
  Record<WorkspaceExchangeUnitType, WorkspaceExchangeDefinition>
> = {
  sheet: SHEET_EXCHANGE,
  doc: DOC_EXCHANGE,
  slide: SLIDE_EXCHANGE,
  base: BASE_EXCHANGE,
  pdf: PDF_EXCHANGE,
};
