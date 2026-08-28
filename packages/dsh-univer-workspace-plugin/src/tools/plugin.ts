/**
 * The capability plugin's tools sub-plugin: registers every univer_ tool on
 * the tools registry, scoped to the plugin fiber so they disappear on stop.
 * @module dsh-univer-workspace-plugin/tools
 */

import type { Context } from "@deepseek-ai/cordis";
import { registerDiscoveryTools } from "./discovery.ts";
import { registerDocumentTools } from "./documents.ts";
import { registerWorktreeTools } from "./worktree.ts";
import { registerEditTool } from "./edit.ts";
import { registerExchangeTools } from "./exchange.ts";
import { registerUnitTool } from "./unit.ts";
import { registerApiTool } from "./api.ts";
import { registerResourcesTool } from "./resources.ts";
import { registerRenderTools, registerScreenshotTool } from "./render.ts";

export const name = "univer-workspace-tools";

export const inject = ["tools", "univerWorkspace"];

/** Register every univer_ tool. */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const disposeDiscovery = registerDiscoveryTools(ctx);
    const disposeDocuments = registerDocumentTools(ctx);
    const disposeWorktree = registerWorktreeTools(ctx);
    const disposeEdit = registerEditTool(ctx);
    const disposeExchange = registerExchangeTools(ctx);
    const disposeUnit = registerUnitTool(ctx);
    const disposeApi = registerApiTool(ctx);
    const disposeResources = registerResourcesTool(ctx);
    // Image results must be durably stored by DSH's attachment service.  Keep
    // the screenshot definition out of the base catalog and let Cordis load
    // it only while `attachments` is provided (the same gate as office).
    const disposeRender = registerRenderTools(ctx, { includeScreenshot: false });
    const inject = (ctx as unknown as {
      inject(deps: readonly string[], callback: (ctx: Context) => void): unknown;
    }).inject.bind(ctx);
    inject(["attachments"], (imageCtx) => {
      registerScreenshotTool(imageCtx);
    });
    return () => {
      disposeRender();
      disposeResources();
      disposeApi();
      disposeUnit();
      disposeExchange();
      disposeEdit();
      disposeWorktree();
      disposeDocuments();
      disposeDiscovery();
    };
  }, "univer-workspace: tools");
}
