import {
  BindingEngine,
  type BindingEngineOptions,
  type CellReference,
  type CellValue,
  type InsertRowsWithValuesParams,
} from "@univerjs-labs/binding-engine";
import { FUniver } from "@univerjs/core/facade";
import { UniverProFormulaEnginePlugin } from "@univerjs-pro/engine-formula";
import { UniverEmbedPlugin } from "@univerjs-pro/embed";
import { UniverCollaborationEmbedPlugin } from "@univerjs-pro/collaboration-embed";
import { buildViewerUrls } from "../viewer/proxy.ts";
import type { ViewerBootstrap } from "../viewer-bootstrap.ts";
import { resolveHtmlViewSource } from "./source.ts";
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

class AgentBindingEngine extends BindingEngine {
  constructor(
    options: BindingEngineOptions,
    private readonly canEdit: boolean,
  ) {
    super(options);
  }

  override setCellValue(reference: CellReference, value: CellValue): void {
    // Workspace grants are product policy. Reject before a Facade write can silently do nothing.
    if (!this.canEdit) throw new Error("来源 Sheet 为只读，无法写入。");
    super.setCellValue(reference, value);
  }

  override insertRowsWithValues(params: InsertRowsWithValuesParams): void {
    if (!this.canEdit) throw new Error("来源 Sheet 为只读，无法写入。");
    super.insertRowsWithValues(params);
  }
}

// 产品身份和来源策略由应用装配；Engine 接管独立 Univer 的加载与释放。
export async function createAgentBindingEngine(
  unitId: string,
  bootstrap: ViewerBootstrap,
  signal: AbortSignal,
): Promise<BindingEngine> {
  signal.throwIfAborted();
  const source = await resolveHtmlViewSource(unitId, signal);
  const { user, license } = bootstrap;
  signal.throwIfAborted();
  let univerAPI!: FUniver;
  const engine = new AgentBindingEngine(
    {
      unitId,
      collaborationClientConfig: {
        socketService: BrowserCollaborationSocketService,
        enableAuthServer: true,
        enableSingleActiveInstanceLock: false,
        ...buildViewerUrls(),
        enableOfflineEditing: false,
        loginUrlKey: "/",
        sendChangesetTimeout: 200,
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
          univer.registerPlugin(UniverLicensePlugin, { license });
          univer.registerPlugin(UniverRenderEnginePlugin);
          univer.registerPlugin(UniverDocsPlugin);
          univer.registerPlugin(UniverSheetsPlugin);
          univer.registerPlugin(UniverProFormulaEnginePlugin);
          univer.registerPlugin(UniverSheetsFormulaPlugin);
          univer.registerPlugin(UniverNetworkPlugin, { useFetchImpl: true });
          univer
            .__getInjector()
            .add<ISocketService>([ISocketService, { useClass: WebSocketService }]);
          univer.registerPlugin(UniverCollaborationPlugin);
          univer.registerPlugin(UniverCollaborationClientPlugin, config);
          univer.registerPlugin(UniverEmbedPlugin);
          // DSH's existing Viewer uses the SDK's collaboration-backed reference provider.
          // All source engines use trunk and the same authenticated proxy endpoints.
          univer.registerPlugin(UniverCollaborationEmbedPlugin);
          univer
            .__getInjector()
            .get(UserManagerService)
            .setCurrentUser({
              userID: user.id,
              name: user.displayName,
              avatar: user.avatarUrl ?? "",
            });
          univerAPI = FUniver.newAPI(univer);
          return { univer, univerAPI };
        } catch (error) {
          univer.dispose();
          throw error;
        }
      },
    },
    source.editorMode === "edit",
  );
  const dispose = () => engine.dispose();
  signal.addEventListener("abort", dispose, { once: true });
  try {
    await engine.load();
    signal.throwIfAborted();
    if (source.editorMode !== "edit") univerAPI.getWorkbook(unitId)!.setEditable(false);
    return engine;
  } catch (error) {
    engine.dispose();
    throw error;
  } finally {
    signal.removeEventListener("abort", dispose);
  }
}
