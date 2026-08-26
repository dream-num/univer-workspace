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
    return () => {
      disposeExchange();
      disposeEdit();
      disposeWorktree();
      disposeDocuments();
      disposeDiscovery();
    };
  }, "univer-workspace: tools");
}
