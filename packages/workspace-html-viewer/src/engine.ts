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
import { UniverProFormulaEnginePlugin } from "@univerjs-pro/engine-formula";
import {
  LocaleType,
  Univer,
  UserManagerService,
  IAuthzIoService,
  IUndoRedoService,
  IMentionIOService,
} from "@univerjs/core";
import { UniverDocsPlugin } from "@univerjs/docs";
import { UniverSheetsPlugin } from "@univerjs/sheets";
import { UniverSheetsFormulaPlugin } from "@univerjs/sheets-formula";
import { UniverRenderEnginePlugin } from "@univerjs/engine-render";
import { UniverNetworkPlugin, ISocketService, WebSocketService } from "@univerjs/network";
import { UniverCollaborationPlugin } from "@univerjs-pro/collaboration";
import { UniverCollaborationClientPlugin } from "@univerjs-pro/collaboration-client";
import { BrowserCollaborationSocketService } from "@univerjs-pro/collaboration-client-ui";
import { UniverLicensePlugin } from "@univerjs-pro/license";

export type HtmlViewWriteErrorCode = "signInRequired" | "editPermissionRequired";
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
  constructor(
    options: BindingEngineOptions,
    private readonly canEdit: boolean,
    private readonly anonymous: boolean,
    private readonly translateError: TranslateHtmlViewWriteError,
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
    // Authentication takes precedence over resource permissions for every write.
    // Reject before a Facade write can silently do nothing.
    if (this.anonymous) throw new HtmlViewWriteError("signInRequired", this.translateError);
    if (!this.canEdit) throw new HtmlViewWriteError("editPermissionRequired", this.translateError);
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
}

/** Creates one isolated HTML source runtime; ownership transfers to Binding Host after load. */
export async function createWorkspaceHtmlEngine(
  options: WorkspaceHtmlEngineOptions,
  signal: AbortSignal,
): Promise<BindingEngine & { getMetadata(): BindingUnitMetadata }> {
  signal.throwIfAborted();
  const { unitId } = options;
  let univerAPI!: FUniver;
  const engine = new WorkspaceBindingEngine(
    {
      unitId,
      collaborationClientConfig: {
        socketService: BrowserCollaborationSocketService,
        enableAuthServer: true,
        enableSingleActiveInstanceLock: false,
        sendChangesetTimeout: 200,
        ...options.collaborationClientConfig,
      },
      createUniver(config) {
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
          univer.registerPlugin(UniverLicensePlugin, { license: options.license });
          univer.registerPlugin(UniverRenderEnginePlugin);
          univer.registerPlugin(UniverDocsPlugin);
          univer.registerPlugin(UniverSheetsPlugin);
          univer.registerPlugin(UniverProFormulaEnginePlugin);
          univer.registerPlugin(UniverSheetsFormulaPlugin);
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
    if (options.user.anonymous || !options.canEdit)
      univerAPI.getWorkbook(unitId)!.setEditable(false);
    return Object.assign(engine, {
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
