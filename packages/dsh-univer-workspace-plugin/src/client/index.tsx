/**
 * @dsh-univer-workspace-plugin — browser half.
 *
 * Registers the Space picker in the blank-session hero. The picker reads the
 * harness browser API and picks a Space's backing dsh workspace; the sidebar
 * session/template list stays with the harness core in stage 5, and the
 * turn-preview cards and floating viewer arrive with later stages.
 */
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import { SpacePicker } from "./SpacePicker.tsx";
import { installStyles } from "./styles.ts";

/** Required browser services. */
export const inject = ["slots"];

/** Apply the browser plugin. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => installStyles(), "univer-workspace: client styles");

  ctx.slots.inject("conversation.hero.workspace", () => ctx.slots.register({
    name: "conversation.hero.workspace",
    // Shadows the official picker (priority 0) while leaving it live.
    priority: -1,
  }, SpacePicker));
}
