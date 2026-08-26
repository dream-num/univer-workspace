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

/** The 90-day runtime development license, used only when no config/env license is set. */
const DEVELOPMENT_LICENSE =
  "2088168239728517120-1-eyJpIjoiMjA4ODE2ODIzOTcyODUxNzEyMCIsInYiOiIxIiwicCI6ImtPN3hWUG5mZVFYSlY2ZjRiSk03MFk5NHdOZTZkR3VRTDNxdklqRFpZblU9IiwiZG0iOlsibG9jYWxob3N0Il0sInJ0IjozLCJmdCI6eyJ1ZiI6eyJtdSI6MjE0NzQ4MzY0NiwiZXQiOjE3OTQ3NTg0MDAsIm1tIjoyMTQ3NDgzNjQ2LCJjdSI6MjE0NzQ4MzY0Nn0sInNmIjp7ImV0IjoxNzk0NzU4NDAwLCJydiI6dHJ1ZSwicHRuIjoyMTQ3NDgzNjQ2LCJtaXMiOjIxNDc0ODM2NDYsIm1wbiI6MjE0NzQ4MzY0NiwibmMiOjIxNDc0ODM2NDYsImllYyI6MCwiZmNjIjowfSwiZGYiOnsiZXQiOjE3OTQ3NTg0MDAsInJ2Ijp0cnVlLCJtaXMiOjIxNDc0ODM2NDYsIm1wbiI6MjE0NzQ4MzY0NiwiaWVjIjowfSwid3NmIjp7ImV0IjoxNzk0NzU4NDAwLCJobiI6MjE0NzQ4MzY0Nn19LCJ1ZCI6MTc5NDc1ODQwMCwiYXQiOjE3ODY2OTMxMTAsImUiOiJkZXZlbG9wZXJAdW5pdmVyLmFpIiwiZCI6OCwibiI6MTl9-ZidzNthAEZRZ13xLQUagdaUsjaMjrr5BDf4JGx9Zzsw1PgmNLak8wuZWQ1le9eMYUyubIa5YI4JpExgdHhN1BA==-1794758400";

export interface Config {
  /** Root under which per-user, per-Space mechanical directories live. */
  workspaceRoot: string;
  /** Univer runtime license for the headless runtime (empty -> fall back to the built-in development license). */
  license: string;
}

export const Config: z<Config> = z.object({
  workspaceRoot: z.string().required(),
  license: z.string().default(""),
});

export const name = "dsh-univer-workspace-plugin";

export const inject = ["storageDomain", "workspaceAuth", "workspaceRegistry"];

export function apply(ctx: Context, config: Config): void {
  const workerUrl = new URL("./worker.js", import.meta.url);
  const license = resolveLicense(config.license);
  ctx.plugin(serviceProvider, { workspaceRoot: config.workspaceRoot, license, workerUrl });
  ctx.plugin(tools);
  ctx.plugin(webServer);
  ctx.plugin(skills);
}

function resolveLicense(configured: string): string {
  const env = process.env.UNIVER_LICENSE?.trim();
  if (env !== undefined && env !== "") return env;
  if (configured.trim() !== "") return configured;
  return DEVELOPMENT_LICENSE;
}
