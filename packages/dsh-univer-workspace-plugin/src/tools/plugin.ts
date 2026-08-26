/**
 * The capability plugin's tools sub-plugin: registers every univer_ tool on
 * the tools registry, scoped to the plugin fiber so they disappear on stop.
 * @module dsh-univer-workspace-plugin/tools
 */

import type { Context } from "@deepseek-ai/cordis";
import { registerDiscoveryTools } from "./discovery.ts";

export const name = "univer-workspace-tools";

export const inject = ["tools", "univerWorkspace"];

/** Register every univer_ tool. */
export function apply(ctx: Context): void {
  ctx.effect(() => registerDiscoveryTools(ctx), "univer-workspace: discovery tools");
}
