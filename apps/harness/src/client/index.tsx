/**
 * @univerjs/univer-workspace-harness — browser half.
 *
 * Harness browser code is deliberately limited to DSH integration that cannot
 * live in a Workspace capability package: stable session-hash routing.
 * Workspace UI, Space selection, Viewer
 * chrome, templates, settings and branding are supplied by the two plugins
 * composed by the Harness profile.
 */
import type { ClientContext } from "./dsh-runtime-types.ts";
import * as sessionRoute from "./session-route.ts";

/** Required services for the two small DSH integration adapters. */
export const inject = ["sessions"];

/** Apply only the generic DSH routing adapter. */
export function apply(ctx: ClientContext): void {
  ctx.plugin(sessionRoute);
}
