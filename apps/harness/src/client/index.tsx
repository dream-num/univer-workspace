/**
 * @univerjs/univer-workspace-harness — browser half.
 *
 * Harness browser code is deliberately limited to DSH integration that cannot
 * live in a Workspace capability package: the authenticated prompt carrier
 * and stable session-hash routing. Workspace UI, Space selection, Viewer
 * chrome, templates, settings and branding are supplied by the two plugins
 * composed by the Harness profile.
 */
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import * as sessionInputGuard from "./session-input-guard.ts";
import * as sessionRoute from "./session-route.ts";

/** Required services for the two small DSH integration adapters. */
export const inject = ["connection", "sessions"];

/** Apply only the generic authenticated DSH adapters. */
export function apply(ctx: ClientContext): void {
  ctx.plugin(sessionInputGuard);
  ctx.plugin(sessionRoute);
}
