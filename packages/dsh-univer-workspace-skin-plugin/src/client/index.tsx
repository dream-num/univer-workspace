/**
 * @dsh-univer-workspace-skin-plugin — browser half.
 *
 * Applies the Univer Workspace look to the DSH shell: overrides the brand
 * alias tokens and replaces the sidebar brand mark and name. The host half
 * stays empty; the skin is pure presentation.
 */
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import { SKIN_CSS } from "./palette.ts";
import { WorkspaceBrandMark, WorkspaceBrandName } from "./Brand.tsx";

/** Required browser services. */
export const inject = ["slots"];

/** Install the token override stylesheet once (removed with the plugin). */
function installStyles(): () => void {
  if (typeof document === "undefined") return () => {};
  const tagId = "dsh-univer-workspace-skin/styles";
  if (document.querySelector(`style[data-plugin-css='${tagId}']`) === null) {
    const tag = document.createElement("style");
    tag.dataset.plugin = "dsh-univer-workspace-skin-plugin";
    tag.dataset.pluginCss = tagId;
    tag.textContent = SKIN_CSS;
    document.head.appendChild(tag);
  }
  return () => {
    document.querySelector(`style[data-plugin-css='${tagId}']`)?.remove();
  };
}

/** Apply the browser skin plugin. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => installStyles(), "univer-workspace-skin: token overrides");

  ctx.slots.inject("sidebar.brand.mark", () => ctx.slots.register({
    name: "sidebar.brand.mark",
    // Shadows the shell's fish fallback (priority 0) while leaving it live.
    priority: -1,
  }, WorkspaceBrandMark));

  ctx.slots.inject("sidebar.brand.name", () => ctx.slots.register({
    name: "sidebar.brand.name",
    // Shadows the shell's generic text fallback (priority 0).
    priority: -1,
  }, WorkspaceBrandName));
}
