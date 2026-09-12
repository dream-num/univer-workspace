import {
  IAuthzIoService,
  IMentionIOService,
  IUndoRedoService,
  LocaleType,
  Univer,
} from "@univerjs/core";
import { FUniver } from "@univerjs/core/facade";
import { UniverDocsPlugin } from "@univerjs/docs";
import { UniverSheetsPlugin } from "@univerjs/sheets";
import { UniverSheetsFormulaPlugin } from "@univerjs/sheets-formula";
import { ISocketService, UniverNetworkPlugin, WebSocketService } from "@univerjs/network";
import { UniverCollaborationPlugin } from "@univerjs-pro/collaboration";
import { UniverCollaborationClientPlugin } from "@univerjs-pro/collaboration-client";
import { UniverProFormulaEnginePlugin } from "@univerjs-pro/engine-formula";
import { UniverLicensePlugin } from "@univerjs-pro/license";
import type { BindingUniverFactory } from "./types.js";

// 无应用身份、凭据或来源策略；socketService 沿用 SDK 配置，由使用环境选择。
export const createDefaultBindingUniver: BindingUniverFactory = (collaborationClientConfig) => {
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
    univer.registerPlugin(UniverLicensePlugin);
    univer.registerPlugin(UniverDocsPlugin);
    univer.registerPlugin(UniverSheetsPlugin);
    univer.registerPlugin(UniverProFormulaEnginePlugin);
    univer.registerPlugin(UniverSheetsFormulaPlugin);
    univer.registerPlugin(UniverNetworkPlugin);
    univer.__getInjector().add<ISocketService>([ISocketService, { useClass: WebSocketService }]);
    univer.registerPlugin(UniverCollaborationPlugin);
    univer.registerPlugin(UniverCollaborationClientPlugin, collaborationClientConfig);
    return { univer, univerAPI: FUniver.newAPI(univer) };
  } catch (error) {
    univer.dispose();
    throw error;
  }
};
