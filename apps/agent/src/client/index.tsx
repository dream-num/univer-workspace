/**
 * @univerjs/workspace-agent — browser half.
 *
 * Harness browser code is deliberately limited to DSH integration that cannot
 * live in a Workspace capability package: stable session-hash routing and product onboarding.
 * Workspace UI, Space selection, Viewer
 * chrome, templates, settings and branding are supplied by the two plugins
 * composed by the Harness profile.
 */
import type { ClientContext } from "./dsh-runtime-types.ts";
import * as workspaceEvents from "./workspace-events.ts";
import * as productOnboarding from "./product-onboarding.tsx";
import * as sessionRoute from "./session-route.ts";

/** Required session service; slot adapters declare their own injection. */
export const inject = ["sessions"];

/** Compose generic DSH routing, events, and product onboarding. */
export function apply(ctx: ClientContext): void {
  ctx.plugin(productOnboarding);
  ctx.plugin(sessionRoute);
  ctx.plugin(workspaceEvents);
}
