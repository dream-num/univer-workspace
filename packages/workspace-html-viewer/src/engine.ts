import {
  BindingEngine,
  type BindingEngineOptions,
  type CellReference,
  type CellValue,
  type InsertRowsWithValuesParams,
} from "@univerjs-labs/binding-engine";
import type { BindingUnitMetadata } from "@univerjs-labs/html-view-renderer/render";
import "@univerjs/sheets/facade";
import { FUniver } from "@univerjs/core/facade";
import {
  LocaleType,
  Univer,
  UserManagerService,
  IAuthzIoService,
  IUndoRedoService,
  IMentionIOService,
  IPermissionService,
  type Plugin,
  type PluginCtor,
} from "@univerjs/core";
import { UniverDocsPlugin } from "@univerjs/docs";
import { UniverSheetsPlugin, WorkbookInsertRowPermission } from "@univerjs/sheets";
import { UniverSheetsConditionalFormattingPlugin } from "@univerjs/sheets-conditional-formatting";
import { UniverSheetsDataValidationPlugin } from "@univerjs/sheets-data-validation";
import { UniverSheetsDrawingPlugin } from "@univerjs/sheets-drawing";
import { UniverSheetsFilterPlugin } from "@univerjs/sheets-filter";
import { UniverSheetsFormulaPlugin } from "@univerjs/sheets-formula";
import { UniverSheetsHyperLinkPlugin } from "@univerjs/sheets-hyper-link";
import { UniverSheetsNotePlugin } from "@univerjs/sheets-note";
import { UniverSheetsNumfmtPlugin } from "@univerjs/sheets-numfmt";
import { UniverSheetsSortPlugin } from "@univerjs/sheets-sort";
import { UniverSheetsTablePlugin } from "@univerjs/sheets-table";
import { UniverSheetsThreadCommentPlugin } from "@univerjs/sheets-thread-comment";
import { UniverProFormulaEnginePlugin } from "@univerjs-pro/engine-formula";
import { UniverSheetsChartPlugin } from "@univerjs-pro/sheets-chart";
import { UniverSheetsOutlinePlugin } from "@univerjs-pro/sheets-outline";
import { UniverSheetsPivotTablePlugin } from "@univerjs-pro/sheets-pivot";
import { UniverSheetsShapePlugin } from "@univerjs-pro/sheets-shape";
import { UniverSheetSparklinePlugin } from "@univerjs-pro/sheets-sparkline";
import { UniverRenderEnginePlugin } from "@univerjs/engine-render";
import { UniverNetworkPlugin, ISocketService, WebSocketService } from "@univerjs/network";
import { UniverCollaborationPlugin } from "@univerjs-pro/collaboration";
import {
  CollaborationController,
  CollaborationSessionService,
  CollaborationStatus,
  UniverCollaborationClientPlugin,
} from "@univerjs-pro/collaboration-client";
import { BrowserCollaborationSocketService } from "@univerjs-pro/collaboration-client-ui";
import { UniverLicensePlugin } from "@univerjs-pro/license";

export type HtmlViewWriteErrorCode = "signInRequired" | "editPermissionRequired";
export type HtmlViewWriteMode = "saved" | "trial" | "rejected";
export type TranslateHtmlViewWriteError = (code: HtmlViewWriteErrorCode) => string;

export class HtmlViewWriteError extends Error {
  constructor(
    readonly code: HtmlViewWriteErrorCode,
    translate: TranslateHtmlViewWriteError,
  ) {
    super(translate(code));
    this.name = "HtmlViewWriteError";
  }
}

export class WorkspaceBindingEngine extends BindingEngine {
  private trialStarted = false;
  private readonly trialStatusListeners = new Set<(status: CollaborationStatus) => void>();

  constructor(
    options: BindingEngineOptions,
    private readonly canEdit: boolean,
    private readonly anonymous: boolean,
    private readonly translateError: TranslateHtmlViewWriteError,
    private readonly startTrial?: () => void,
  ) {
    super(options);
  }

  override setCellValue(reference: CellReference, value: CellValue): void {
    this.assertCanWrite();
    super.setCellValue(reference, value);
  }

  override insertRowsWithValues(params: InsertRowsWithValuesParams): void {
    this.assertCanWrite();
    super.insertRowsWithValues(params);
  }

  private assertCanWrite(): void {
    if ((this.anonymous || !this.canEdit) && this.startTrial) {
      if (!this.trialStarted) {
        this.startTrial();
        this.trialStarted = true;
        for (const listener of this.trialStatusListeners) listener(CollaborationStatus.NOT_COLLAB);
      }
      return;
    }
    // Authentication takes precedence over resource permissions for every write.
    // Reject before a Facade write can silently do nothing.
    if (this.anonymous) throw new HtmlViewWriteError("signInRequired", this.translateError);
    if (!this.canEdit) throw new HtmlViewWriteError("editPermissionRequired", this.translateError);
  }

  override getCollaborationStatus(): CollaborationStatus {
    return this.trialStarted ? CollaborationStatus.NOT_COLLAB : super.getCollaborationStatus();
  }

  override subscribeCollaborationStatus(listener: (status: CollaborationStatus) => void) {
    this.trialStatusListeners.add(listener);
    const subscription = super.subscribeCollaborationStatus((status) =>
      listener(this.trialStarted ? CollaborationStatus.NOT_COLLAB : status),
    );
    return { dispose: () => { this.trialStatusListeners.delete(listener); subscription.dispose(); } };
  }

  override async flush(): Promise<void> {
    if (!this.trialStarted) await super.flush();
  }

  override dispose(): void {
    this.trialStatusListeners.clear();
    super.dispose();
  }
}

export interface WorkspaceHtmlEngineOptions {
  unitId: string;
  canEdit: boolean;
  /** Translate at write time, before SDK serialization sends the message into the iframe. */
  translateError: TranslateHtmlViewWriteError;
  user: { id: string; displayName: string; avatarUrl?: string | null; anonymous?: boolean };
  license: string;
  collaborationClientConfig: Omit<
    BindingEngineOptions["collaborationClientConfig"],
    "socketService"
  >;
  networkConfig?: { useFetchImpl?: boolean };
  /** Host-owned referenced-Unit policy, including UniverEmbedPlugin registration. */
  registerEmbed: (univer: Univer) => void;
  /** Opt in to local, unsaved writes for read-only users. Hosts must label trial edits. */
  enableReadOnlyTrial?: boolean;
  onTrialStarted?: () => void;
}

export function getHtmlViewSheetPlugins(): PluginCtor<Plugin>[] {
  return [
    UniverProFormulaEnginePlugin,
    UniverSheetsPlugin,
    UniverSheetsFormulaPlugin,
    UniverSheetsNumfmtPlugin,
    UniverSheetsDrawingPlugin,
    UniverSheetsConditionalFormattingPlugin,
    UniverSheetsDataValidationPlugin,
    UniverSheetsFilterPlugin,
    UniverSheetsHyperLinkPlugin,
    UniverSheetsNotePlugin,
    UniverSheetsSortPlugin,
    UniverSheetsTablePlugin,
    UniverSheetsThreadCommentPlugin,
    UniverSheetsChartPlugin,
    UniverSheetsOutlinePlugin,
    UniverSheetsPivotTablePlugin,
    UniverSheetsShapePlugin,
    UniverSheetSparklinePlugin,
  ];
}

export function createWorkspaceHtmlUniver(license: string): Univer {
  const univer = new Univer({
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: {} },
    override: [
      [IAuthzIoService, null],
      [IUndoRedoService, null],
      [IMentionIOService, null],
    ],
  });
  try {
    univer.registerPlugin(UniverLicensePlugin, { license });
    univer.registerPlugin(UniverRenderEnginePlugin);
    univer.registerPlugin(UniverDocsPlugin);
    for (const plugin of getHtmlViewSheetPlugins()) univer.registerPlugin(plugin);
    return univer;
  } catch (error) {
    univer.dispose();
    throw error;
  }
}

/** Creates one isolated HTML source runtime; ownership transfers to Binding Host after load. */
export async function createWorkspaceHtmlEngine(
  options: WorkspaceHtmlEngineOptions,
  signal: AbortSignal,
): Promise<BindingEngine & { readonly writeMode: HtmlViewWriteMode; getMetadata(): BindingUnitMetadata }> {
  signal.throwIfAborted();
  const { unitId } = options;
  const readOnly = options.user.anonymous || !options.canEdit;
  const writeMode: HtmlViewWriteMode = readOnly
    ? options.enableReadOnlyTrial ? "trial" : "rejected"
    : "saved";
  let univerAPI!: FUniver;
  let runtime!: Univer;
  const engine = new WorkspaceBindingEngine(
    {
      unitId,
      collaborationClientConfig: {
        socketService: BrowserCollaborationSocketService,
        enableAuthServer: true,
        enableSingleActiveInstanceLock: false,
        sendChangesetTimeout: 200,
        ...options.collaborationClientConfig,
        ...(writeMode === "trial" ? { enableOfflineEditing: false } : {}),
      },
      createUniver(config) {
        const univer = createWorkspaceHtmlUniver(options.license);
        try {
          univer.registerPlugin(UniverNetworkPlugin, options.networkConfig);
          univer
            .__getInjector()
            .add<ISocketService>([ISocketService, { useClass: WebSocketService }]);
          univer.registerPlugin(UniverCollaborationPlugin);
          univer.registerPlugin(UniverCollaborationClientPlugin, config);
          options.registerEmbed(univer);
          univer
            .__getInjector()
            .get(UserManagerService)
            .setCurrentUser({
              userID: options.user.id,
              name: options.user.displayName,
              avatar: options.user.avatarUrl ?? "",
            });
          runtime = univer;
          univerAPI = FUniver.newAPI(univer);
          return { univer, univerAPI };
        } catch (error) {
          univer.dispose();
          throw error;
        }
      },
    },
    options.canEdit,
    options.user.anonymous ?? false,
    options.translateError,
    writeMode === "trial" ? () => {
      // Each source owns its runtime; stop every collaboration producer before enabling local edits.
      const injector = runtime.__getInjector();
      injector.get(CollaborationController).dispose();
      injector.get(CollaborationSessionService).dispose();
      univerAPI.getWorkbook(unitId)!.setEditable(true);
      injector.get(IPermissionService).updatePermissionPoint(new WorkbookInsertRowPermission(unitId).id, true);
      options.onTrialStarted?.();
    } : undefined,
  );
  let disposed = false;
  const dispose = () => {
    if (!disposed) {
      disposed = true;
      engine.dispose();
    }
  };
  signal.addEventListener("abort", dispose, { once: true });
  try {
    await engine.load();
    signal.throwIfAborted();
    if (readOnly)
      univerAPI.getWorkbook(unitId)!.setEditable(false);
    return Object.assign(engine, {
      writeMode,
      getMetadata(): BindingUnitMetadata {
        const workbook = univerAPI.getWorkbook(unitId);
        return {
          unitId,
          ...(workbook ? { name: workbook.getName() } : {}),
          sheets:
            workbook?.getSheets().map((sheet) => ({
              sheetId: sheet.getSheetId(),
              name: sheet.getSheetName(),
            })) ?? [],
        };
      },
    });
  } catch (error) {
    dispose();
    throw error;
  } finally {
    signal.removeEventListener("abort", dispose);
  }
}
