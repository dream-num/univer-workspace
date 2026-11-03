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
import * as collabProxy from "./collab-proxy/plugin.ts";
import * as sessionContext from "./session-context.ts";
import type { WorkspaceTemplate } from "./client/workspace-contract.ts";
import { DEVELOPMENT_LICENSE, DEVELOPMENT_LICENSE_KEY } from "./license.ts";

export interface Config {
  /** Root under which per-user, per-Space mechanical directories live. */
  workspaceRoot: string;
  /** Univer runtime license for the headless runtime (empty -> fall back to the built-in development license). */
  license: string;
  /** Key that Office exchange verifies the license with (empty -> fall back to the built-in development key). */
  licenseKey: string;
  /** Workspace product origin used by capability-owned authenticated routes. */
  workspaceOrigin: string;
  /** Public harness origin used for same-origin request validation. */
  publicOrigin: string;
  /** Deployment-configured template sessions. */
  templates: WorkspaceTemplate[];
}

const templatesZ = z.array(
  z.object({
    key: z.string().required(),
    sessionId: z.string().required(),
    label: z.string().default(""),
    agentPreset: z.string().default(""),
    description: z.string().default(""),
  }),
);

export const Config: z<Config> = z.object({
  workspaceRoot: z.string().required(),
  license: z.string().default(""),
  licenseKey: z.string().default(""),
  workspaceOrigin: z.string().required(),
  publicOrigin: z.string().required(),
  templates: templatesZ.default([]),
});

export const name = "dsh-univer-workspace-plugin";

// `workspaceAuth` is resolved lazily via ctx.get at call time rather than
// declared here: a cross-row hard dependency kept this whole bundle pending
// on the harness core row's startup order and could fail the entire boot.
export const inject = ["storageDomain", "workspaceRegistry"];

export function apply(ctx: Context, config: Config): void {
  const workerUrl = new URL("./worker.js", import.meta.url);
  const license = resolveLicense("UNIVER_LICENSE", config.license, DEVELOPMENT_LICENSE);
  const licenseKey = resolveLicense("UNIVER_LICENSE_KEY", config.licenseKey, DEVELOPMENT_LICENSE_KEY);
  ctx.plugin(serviceProvider, { workspaceRoot: config.workspaceRoot, license, workerUrl });
  ctx.plugin(tools, { license, licenseKey });
  ctx.plugin(webServer, {
    license,
    workspaceRoot: config.workspaceRoot,
    workspaceOrigin: config.workspaceOrigin,
    publicOrigin: config.publicOrigin,
    templates: config.templates,
  });
  ctx.plugin(skills);
  ctx.plugin(collabProxy);
  ctx.plugin(sessionContext);
}

function resolveLicense(variable: string, configured: string, fallback: string): string {
  const env = process.env[variable]?.trim();
  if (env !== undefined && env !== "") return env;
  if (configured.trim() !== "") return configured;
  return fallback;
}
