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

/**
 * Runtime development license fallback when no config/env license is set.
 * Issued 2026-10-08; expires 2027-01-08T16:00:00Z. Rotate within 90 days.
 */
const DEVELOPMENT_LICENSE =
  "2101948364242481153-1-eyJpIjoiMjEwMTk0ODM2NDI0MjQ4MTE1MyIsInYiOiIxIiwicCI6IjFjU015MTRQR1BFeDFUS1lHSllndmxYRDBHeGFNSXFzM1JOSHN1ZjVtYXM9IiwiZG0iOlsibG9jYWxob3N0Il0sInJ0IjozLCJmdCI6eyJ1ZiI6eyJtdSI6MjE0NzQ4MzY0NiwiZXQiOjE3OTk0MjQwMDAsIm1tIjoyMTQ3NDgzNjQ2LCJjdSI6MjE0NzQ4MzY0Nn0sInNmIjp7ImV0IjoxNzk5NDI0MDAwLCJydiI6dHJ1ZSwicHRuIjoyMTQ3NDgzNjQ2LCJtaXMiOjIxNDc0ODM2NDYsIm1wbiI6MjE0NzQ4MzY0NiwibmMiOjIxNDc0ODM2NDYsImllYyI6MCwiZmNjIjowfSwiZGYiOnsiZXQiOjE3OTk0MjQwMDAsInJ2Ijp0cnVlLCJtaXMiOjIxNDc0ODM2NDYsIm1wbiI6MjE0NzQ4MzY0NiwiaWVjIjowfSwid3NmIjp7ImV0IjoxNzk5NDI0MDAwLCJobiI6MjE0NzQ4MzY0Nn19LCJ1ZCI6MTc5OTQyNDAwMCwiYXQiOjE3OTE0MzAyNzYsImUiOiJkZXZlbG9wZXJAdW5pdmVyLmFpIiwiZCI6OCwibiI6MjgyfQ==-oFAPy7K3/SZ9zKJ83pF7LcBP5Lawt8iEq305R0re59UqzQDkwhkeZv6/f0jXwAhDuj1oSjNPhGYB3XKC13l3AA==-1799424000";

export interface Config {
  /** Root under which per-user, per-Space mechanical directories live. */
  workspaceRoot: string;
  /** Univer runtime license for the headless runtime (empty -> fall back to the built-in development license). */
  license: string;
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
  const license = resolveLicense(config.license);
  ctx.plugin(serviceProvider, { workspaceRoot: config.workspaceRoot, license, workerUrl });
  ctx.plugin(tools, { license });
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

function resolveLicense(configured: string): string {
  const env = process.env.UNIVER_LICENSE?.trim();
  if (env !== undefined && env !== "") return env;
  if (configured.trim() !== "") return configured;
  return DEVELOPMENT_LICENSE;
}
