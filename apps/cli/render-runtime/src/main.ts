/**
 * 机器页面入口:装配无头 Univer,暴露 window.__univerRenderRuntime 供 Node 宿主调用。
 * 无协同/无网络),暴露 window.__univerRenderRuntime 供 daemon 宿主 page.evaluate 调用。
 * 失败约定见 support.ts codedError:reject message 以错误码前缀开头。
 */
import "./preset/styles.css";
import "./preset/facades.js";

import type {
  UniverRenderRuntimePage,
  UniverRenderRuntimePageGlobals,
} from "@univer-cli/univer-render-runtime";
import { LocaleType, Univer } from "@univerjs/core";
import { FUniver } from "@univerjs/core/facade";
import { ViewAssetIoOwner, registerViewRendering } from "./preset/index.js";
import { CONTENT_EN_US } from "./preset/machine-locale.js";
import { UnitRegistry } from "./units.js";
import { measureText } from "./measure.js";
import { captureSlideLayout, renderSlidePage } from "./slide-ops.js";
import { renderSheetRange } from "./sheet-ops.js";
import { captureDocLayout, renderDocPage } from "./doc-ops.js";
import { composeContactSheet } from "./compose.js";
import { renderBoardContent } from "./board-ops.js";
import { prepareBaseView } from "./base-ops.js";

const univer = new Univer({
  locale: LocaleType.EN_US,
  locales: { [LocaleType.EN_US]: CONTENT_EN_US },
});

registerViewRendering(univer, {
  container: "app",
  assetIoOwner: ViewAssetIoOwner.Local,
  license: window.__univerRenderLicense,
  workbenchChrome: "visible",
});

const registry = new UnitRegistry(univer);
const univerAPI = FUniver.newAPI(univer);

declare global {
  interface Window extends UniverRenderRuntimePageGlobals {}
}

window.__univerRenderRuntime = {
  ready: true,
  loadUnit: (input) => registry.load(input),
  measureText: async (input) => measureText(univer, input),
  captureSlideLayout: (input) =>
    captureSlideLayout(univer, registry.require(input.unitKey), input.pages),
  captureDocLayout: (input) =>
    captureDocLayout(univer, registry.require(input.unitKey), input.pages),
  renderSlidePage: (input) =>
    renderSlidePage(univer, registry.require(input.unitKey), input.page, input.scale ?? 1),
  renderSheetRange: (input) =>
    renderSheetRange(univer, registry.require(input.unitKey), {
      range: input.range,
      ...(input.sheetName === undefined ? {} : { sheetName: input.sheetName }),
      ...(input.scale === undefined ? {} : { scale: input.scale }),
    }),
  renderDocPage: (input) =>
    renderDocPage(univer, registry.require(input.unitKey), input.page, input.scale ?? 1),
  prepareBaseView: (input) => prepareBaseView(univer, univerAPI, registry.require(input.unitKey)),
  renderBoardContent: (input) =>
    renderBoardContent(univerAPI, registry.require(input.unitKey), {
      ...(input.elementIds === undefined ? {} : { elementIds: input.elementIds }),
      ...(input.padding === undefined ? {} : { padding: input.padding }),
      ...(input.region === undefined ? {} : { region: input.region }),
      ...(input.scale === undefined ? {} : { scale: input.scale }),
    }),
  composeContactSheet: (input) => composeContactSheet(input),
} satisfies UniverRenderRuntimePage;
