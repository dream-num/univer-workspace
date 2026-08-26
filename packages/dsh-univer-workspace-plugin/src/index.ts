/**
 * @dsh-univer-workspace-plugin — host half (root composition plugin).
 *
 * Mounts the Univer Workspace capability service and its tools sub-plugin.
 * The browser half is loaded from the same row via `dsh.client`.
 * @module dsh-univer-workspace-plugin
 */

import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import * as serviceProvider from "./provider/service-provider.ts";
import * as tools from "./tools/plugin.ts";
import * as webServer from "./webServer/plugin.ts";
import * as skills from "./skills/plugin.ts";

export interface Config {
  /** Root under which per-user, per-Space mechanical directories live. */
  workspaceRoot: string;
}

export const Config: z<Config> = z.object({
  workspaceRoot: z.string().required(),
});

export const name = "dsh-univer-workspace-plugin";

export const inject = ["storageDomain", "workspaceAuth", "workspaceRegistry"];

export function apply(ctx: Context, config: Config): void {
  ctx.plugin(serviceProvider, { workspaceRoot: config.workspaceRoot });
  ctx.plugin(tools);
  ctx.plugin(webServer);
  ctx.plugin(skills);
}
