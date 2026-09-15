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
import { SnapshotService } from "@univerjs-pro/collaboration";
import { createWorkspaceReferencedUnitProviderRegistration } from "@univerjs/univer-workspace-reference-provider";
import { withWorkspaceSnapshotServerOverride, resolveUniverLicense } from "../editor";
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
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";

export class WorkspaceBindingEngine extends BindingEngine {
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
export async function createWorkspaceBindingEngine(
  unitId: string,
  user: { id: string; displayName: string; avatarUrl?: string | null },
  signal: AbortSignal,
  htmlResourceId?: string,
): Promise<BindingEngine> {
  signal.throwIfAborted();
  let canEdit: boolean;
  if (htmlResourceId) {
    const source = await api.GET("/api/html-views/{resourceId}/sources/{unitId}", {
      params: { path: { resourceId: htmlResourceId, unitId } },
      signal,
    });
    if (source.error) throw apiError(source.error);
    canEdit = source.data.editorMode === "edit";
  } else {
    const resolved = await api.GET("/api/unit-resources/{unitId}", {
      params: { path: { unitId } },
      signal,
    });
    if (resolved.error) throw apiError(resolved.error);
    const opened = await api.POST("/api/resources/{resourceId}/open", {
      params: { path: { resourceId: resolved.data.resource.id } },
      signal,
    });
    if (opened.error) throw apiError(opened.error);
    const source = opened.data.resource;
    if (source.kind !== "univer" || source.unitType !== "sheet" || source.unitId !== unitId)
      throw new Error("来源必须是可访问的 Sheet。");
    canEdit = source.editorMode === "edit";
  }
  const prefix = htmlResourceId
    ? `/universer-api/html-views/${encodeURIComponent(htmlResourceId)}`
    : "/universer-api";
  signal.throwIfAborted();
  let univerAPI!: FUniver;
  const engine = new WorkspaceBindingEngine(
    {
      unitId,
      collaborationClientConfig: {
        socketService: BrowserCollaborationSocketService,
        enableAuthServer: true,
        enableSingleActiveInstanceLock: false,
        snapshotServerUrl: `${prefix}/snapshot`,
        collabSubmitChangesetUrl: `${prefix}/comb`,
        collabWebSocketUrl: `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${prefix}/comb/connect`,
        wsSessionTicketUrl: `${prefix}/user/session-ticket`,
        authzUrl: `${prefix}/authz`,
        loginUrlKey: "/login",
        sendChangesetTimeout: 200,
        override: withWorkspaceSnapshotServerOverride(undefined, {
          hostScope: { kind: "trunk" },
          origin: location.origin,
          trunkSnapshotServerUrl: `${prefix}/snapshot`,
          resolveMergePreview: async () => {
            throw new Error("HTML view sources only support trunk.");
          },
        }),
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
          univer.registerPlugin(UniverLicensePlugin, { license: resolveUniverLicense() });
          univer.registerPlugin(UniverRenderEnginePlugin);
          univer.registerPlugin(UniverDocsPlugin);
          univer.registerPlugin(UniverSheetsPlugin);
          univer.registerPlugin(UniverProFormulaEnginePlugin);
          univer.registerPlugin(UniverSheetsFormulaPlugin);
          univer.registerPlugin(UniverNetworkPlugin);
          univer
            .__getInjector()
            .add<ISocketService>([ISocketService, { useClass: WebSocketService }]);
          univer.registerPlugin(UniverCollaborationPlugin);
          univer.registerPlugin(UniverCollaborationClientPlugin, config);
          univer.registerPlugin(UniverEmbedPlugin, {
            resourceRefUnitProviderRegistrations: [
              createWorkspaceReferencedUnitProviderRegistration({
                hostContext: { view: { kind: "trunk" }, mappedUnitIds: [unitId] },
                resolveSnapshotService: () => univer.__getInjector().get(SnapshotService),
              }),
            ],
          });
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
    canEdit,
  );
  const dispose = () => engine.dispose();
  signal.addEventListener("abort", dispose, { once: true });
  try {
    await engine.load();
    signal.throwIfAborted();
    if (!canEdit) univerAPI.getWorkbook(unitId)!.setEditable(false);
    return engine;
  } catch (error) {
    engine.dispose();
    throw error;
  } finally {
    signal.removeEventListener("abort", dispose);
  }
}
