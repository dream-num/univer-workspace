import { BASE_TOOLBAR_EXTRA_ACTIONS } from "@univerjs-pro/bases-ui";
import { ExchangeFormat, IExchangeService } from "@univerjs-pro/exchange-client";
import {
  CommandType,
  DependentOn,
  ICommandService,
  Injector,
  LocaleService,
  LocaleType,
  Plugin,
  setDependencies,
  type ICommand,
  type IDisposable,
} from "@univerjs/core";
import { DirectExportIcon, ExportIcon, FolderIcon } from "@univerjs/icons";
import {
  BuiltInUIPart,
  ComponentManager,
  connectInjector,
  getMenuHiddenObservable,
  IconManager,
  IDialogService,
  IMenuManagerService,
  IMessageService,
  IUIPartsService,
  MenuItemType,
  RibbonStartGroup,
  type MenuSchemaType,
} from "@univerjs/ui";
import { exchangeIds, type WorkspaceExchangeDefinition } from "./definitions";
import { WorkspaceImportExportService } from "./import-export-service";
import { IMPORT_EXPORT_LOCALES, importExportKey } from "./locale";
import { BaseExchangeToolbarActions, ExportFormatDialog, UploadNotification } from "./views";

export interface WorkspaceImportExportConfig {
  readonly mobile: boolean;
  /** Workspace page of an imported Unit, opened from the upload notification. */
  readonly resolveUnitLink: (unitId: string) => Promise<string | undefined>;
}

/** 1.1 sheet and base export operations took their sheet or table under these names. */
interface ExportByFormatParams {
  readonly format: ExchangeFormat;
  readonly sheetId?: string;
  readonly tableId?: string;
}

export function pickFile(accept: string): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    const finish = () => resolve(input.files?.[0] ?? undefined);
    input.addEventListener("change", finish, { once: true });
    input.addEventListener("cancel", finish, { once: true });
    input.click();
  });
}

/**
 * Create the Workspace import/export plugin for one Unit type. SDK 1.3 exchange
 * clients are headless, so this restores the SDK 1.1 menus, export-format
 * dialog and upload notification on top of them, under the 1.1 operation ids.
 */
export function createWorkspaceImportExportPlugin(definition: WorkspaceExchangeDefinition) {
  const ids = exchangeIds(definition);
  const dialogComponent = `workspace-import-export.${definition.unitType}.export-format-dialog`;
  const multipleFormats = definition.exportFormats.length > 1;

  class WorkspaceImportExportPlugin extends Plugin {
    static override pluginName = `WORKSPACE_${definition.unitType.toUpperCase()}_IMPORT_EXPORT_PLUGIN`;
    static override packageName = "@univerjs/univer-workspace";
    static override type = definition.instanceType;

    constructor(
      private readonly config: WorkspaceImportExportConfig,
      protected override readonly _injector: Injector,
      localeService: LocaleService
    ) {
      super();
      localeService.load({
        [LocaleType.EN_US]: IMPORT_EXPORT_LOCALES.enUS,
        [LocaleType.ZH_CN]: IMPORT_EXPORT_LOCALES.zhCN,
      });
    }

    override onReady(): void {
      const injector = this._injector;
      const exchangeService = injector.get(IExchangeService);
      const localeService = injector.get(LocaleService);
      const service = new WorkspaceImportExportService({
        definition,
        exchange: definition.bind(injector),
        requestState$: exchangeService.requestState$,
        downloadFile: (file, name, format) => exchangeService.downloadFile(file, name, format),
        interruptImportTask: () => exchangeService.interruptImportTask(),
        showMessage: (message) => injector.get(IMessageService).show(message),
        translate: (key, ...args) => localeService.t(key, ...args),
        pickFile,
        resolveUnitLink: this.config.resolveUnitLink,
      });
      this.disposeWithMe(service);
      for (const command of this.commands(service)) {
        this.disposeWithMe(injector.get(ICommandService).registerCommand(command));
      }
      // Workspace's @univerjs/icons release is typed against another React
      // types copy than @univerjs/ui; the components are the same at runtime.
      const icons = { DirectExportIcon, ExportIcon, FolderIcon } as unknown as Parameters<
        IconManager["register"]
      >[0];
      this.disposeWithMe(injector.get(IconManager).register(icons));
      this.disposeWithMe(injector.get(ComponentManager).register(dialogComponent, ExportFormatDialog));

      const mobile = this.config.mobile;
      const Notification = () => <UploadNotification service={service} mobile={mobile} />;
      const uiParts = injector.get(IUIPartsService);
      this.disposeWithMe(
        uiParts.registerComponent(BuiltInUIPart.CONTENT, () => connectInjector(Notification, injector))
      );
      if (definition.placement.kind === "ribbon") {
        injector.get(IMenuManagerService).mergeMenu(this.menuSchema(definition.placement.order));
      } else {
        const commandService = injector.get(ICommandService);
        const ToolbarActions = () => (
          <BaseExchangeToolbarActions
            onImport={() => void commandService.executeCommand(ids.importUnit)}
            onExport={() => void commandService.executeCommand(ids.exportUnit)}
          />
        );
        this.disposeWithMe(
          uiParts.registerComponent(BASE_TOOLBAR_EXTRA_ACTIONS, () => connectInjector(ToolbarActions, injector))
        );
      }
    }

    private commands(service: WorkspaceImportExportService): ICommand[] {
      const injector = this._injector;
      const importUnit: ICommand = {
        id: ids.importUnit,
        type: CommandType.OPERATION,
        handler: async () => {
          await service.importFile();
          return true;
        },
      };
      const exportByFormat: ICommand<ExportByFormatParams> = {
        id: ids.exportByFormat,
        type: CommandType.OPERATION,
        handler: async (_accessor, params) =>
          params ? service.exportUnit(params.format, params.sheetId ?? params.tableId) : false,
      };
      const exportUnit: ICommand = {
        id: ids.exportUnit,
        type: CommandType.OPERATION,
        handler: async () => {
          if (!multipleFormats) return service.exportUnit(definition.exportFormats[0]!);
          const targets = definition.bind(injector).exportTargets?.();
          if (!targets) return false;
          const localeService = injector.get(LocaleService);
          let dialog: IDisposable | null = null;
          const close = () => {
            dialog?.dispose();
            dialog = null;
          };
          dialog = injector.get(IDialogService).open({
            id: ids.exportDialog,
            title: { title: localeService.t(importExportKey("download")) },
            ...(this.config.mobile ? {} : { width: 420 }),
            draggable: false,
            mask: true,
            maskClosable: false,
            children: {
              label: {
                name: dialogComponent,
                props: {
                  ...targets,
                  formats: definition.exportFormats,
                  mobile: this.config.mobile,
                  onCancel: close,
                  onConfirm: async (format: ExchangeFormat, targetId: string) => {
                    await service.exportUnit(format, format === ExchangeFormat.XLSX ? undefined : targetId);
                    close();
                  },
                },
              },
            },
            onClose: close,
          });
          return true;
        },
      };
      return multipleFormats ? [importUnit, exportUnit, exportByFormat] : [importUnit, exportUnit];
    }

    private menuSchema(order: number): MenuSchemaType {
      return {
        [RibbonStartGroup.OTHERS]: {
          [ids.menu]: {
            order,
            gridLayout: { row: 1, column: 2, rowSpan: 2, showLabel: true },
            menuItemFactory: (accessor) => ({
              id: ids.menu,
              type: MenuItemType.SUBITEMS,
              icon: "DirectExportIcon",
              tooltip: importExportKey("file"),
              hidden$: getMenuHiddenObservable(accessor, definition.instanceType),
              ...(definition.menuDisabled$ ? { disabled$: definition.menuDisabled$(accessor) } : {}),
            }),
            [ids.importUnit]: {
              order: 0,
              menuItemFactory: () => ({
                id: ids.importUnit,
                type: MenuItemType.BUTTON,
                title: importExportKey("upload"),
                icon: "FolderIcon",
              }),
            },
            [ids.exportUnit]: {
              order: 1,
              menuItemFactory: () => ({
                id: ids.exportUnit,
                type: MenuItemType.BUTTON,
                title: importExportKey("download"),
                icon: "ExportIcon",
              }),
            },
          },
        },
      };
    }
  }

  setDependencies(WorkspaceImportExportPlugin, [Injector, LocaleService], 1);
  DependentOn(definition.headlessPlugin)(WorkspaceImportExportPlugin);
  return WorkspaceImportExportPlugin;
}
