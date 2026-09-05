/**
 * @dsh-univer-workspace-skin-plugin — browser half.
 *
 * Applies the Univer Workspace look to the DSH shell: overrides the brand
 * alias tokens and replaces the sidebar brand mark and name. The host half
 * stays empty; the skin is pure presentation.
 */
import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import "./skin.css";
import { WorkspaceBrandMark, WorkspaceBrandName } from "./Brand.tsx";
import { installWorkspaceFavicon } from "./favicon.ts";

/** Required browser services. */
export const inject = ["slots"];

/** Apply the browser skin plugin. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => installWorkspaceFavicon(), "univer-workspace-skin: favicon");

  ctx.slots.inject("sidebar.brand.mark", () =>
    ctx.slots.register(
      {
        name: "sidebar.brand.mark",
        // Shadows the shell's fish fallback (priority 0) while leaving it live.
        priority: -1,
      },
      WorkspaceBrandMark,
    ),
  );

  ctx.slots.inject("sidebar.brand.name", () =>
    ctx.slots.register(
      {
        name: "sidebar.brand.name",
        // Shadows the shell's generic text fallback (priority 0).
        priority: -1,
      },
      WorkspaceBrandName,
    ),
  );

  // The blank-session hero owns a separate root-scoped brand seat.  Register
  // the same mark there so the first frame never shows the DSH fish before a
  // session is created.
  ctx.slots.inject("conversation.hero.brand.mark", () =>
    ctx.slots.register(
      {
        name: "conversation.hero.brand.mark",
        priority: -1,
      },
      WorkspaceBrandMark,
    ),
  );
}
