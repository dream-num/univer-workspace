/**
 * @dsh-univer-workspace-plugin — browser half.
 *
 * Mirrors the dsh-univer-office client surface for remote Workspace
 * documents: the native DSH workspace picker in the blank-session hero, the Turn-tail
 * review panels (one per touched document), and floating live-editor
 * windows in the input dock, backed by one locale namespace. All
 * collaboration traffic goes through the same-origin proxy (no iframe).
 */
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import { PreviewCard } from "./components/preview-card.tsx";
import { WORKSPACE_TOOL_NAMES, WorkspaceToolRow } from "./components/workspace-tool-row.tsx";
import { ViewerDock } from "./ViewerDock.tsx";
import { univerTurnDefinition } from "./conversation/univer-turn-definition.ts";
import { viewerLocaleOf, type ViewerLocale } from "./viewer-locale.ts";
import { loadViewerBootstrap } from "./viewer-bootstrap.ts";
import { en, UNIVER_LOCALE_NAMESPACE, zh } from "./locales.ts";
import { installStyles } from "./styles.ts";

/** Required browser services. */
export const inject = ["slots", "conversationEvents", "locale"];

/** Apply the browser plugin. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => installStyles(), "univer-workspace: client styles");
  ctx.effect(() => ctx.locale.register(UNIVER_LOCALE_NAMESPACE, { zh, en }), "univer-workspace: dictionaries");

  const getViewerLocale = (): ViewerLocale => viewerLocaleOf(ctx.locale.getSnapshot().active);

  ctx.conversationEvents.register(univerTurnDefinition);

  // Own the transcript row for every Univer tool.  The stock generic row
  // derives its summary from raw arguments, which exposes opaque Workspace
  // UUIDs even when the Host supplies a human presentCall title.
  ctx.slots.inject("tool.call.toolview", function* () {
    for (const key of WORKSPACE_TOOL_NAMES) {
      yield ctx.slots.register({
        name: "tool.call.toolview",
        key,
        locale: UNIVER_LOCALE_NAMESPACE,
      }, WorkspaceToolRow);
    }
  });

  ctx.slots.inject("conversation.chat.turnTail", () => ctx.slots.register({
    name: "conversation.chat.turnTail",
    priority: -10,
    locale: UNIVER_LOCALE_NAMESPACE,
    select: (owner) => {
      const data = owner.turn.data.get("univerTurn");
      if (data === undefined || data.files.length === 0) return null;
      return { turn: owner.turn.turn, files: data.files };
    },
    inject: () => ({ loadViewerBootstrap, getViewerLocale }),
  }, PreviewCard));

  ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
    name: "conversation.input.dock",
    id: "univer-workspace-viewer",
    order: 400,
    locale: UNIVER_LOCALE_NAMESPACE,
    inject: () => ({ loadViewerBootstrap, getViewerLocale }),
  }, ViewerDock));
}
