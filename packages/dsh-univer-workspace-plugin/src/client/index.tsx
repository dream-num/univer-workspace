/**
 * @dsh-univer-workspace-plugin — browser half.
 *
 * Registers the Space picker in the blank-session hero, the Turn-tail
 * document card, and the floating Univer document viewer in the input dock,
 * following the dsh-univer-office interaction model: one locale namespace
 * backing all surfaces, additive chain contribution on the Turn tail, and a
 * draggable live-editor window. The viewer reaches the Workspace through the
 * same-origin collaboration proxy (no iframe).
 */
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import { SpacePicker } from "./SpacePicker.tsx";
import { ViewerDock, type ViewerDockInjected } from "./ViewerDock.tsx";
import { ViewerTurnCard, selectViewerTurnCard } from "./viewer-turn-card.tsx";
import { viewerTurnDefinition } from "./viewer-turn-definition.ts";
import { viewerLocaleOf, type ViewerLocale, type ViewerLocaleInjected } from "./viewer-locale.ts";
import { en, UWH_LOCALE_NAMESPACE, zh } from "./locales.ts";
import { installStyles } from "./styles.ts";

/** Required browser services. */
export const inject = ["slots", "conversationEvents", "locale"];

/** The viewer bootstrap data resolved from the harness identity route. */
interface ViewerBootstrap {
  readonly user: { readonly id: string; readonly displayName: string; readonly avatarUrl: string | null };
  readonly license: string;
}

let bootstrapPromise: Promise<ViewerBootstrap> | undefined;

/** Fetch the viewer bootstrap (identity + license) from the harness host. */
async function loadViewerBootstrap(): Promise<ViewerBootstrap> {
  if (bootstrapPromise === undefined) {
    bootstrapPromise = fetch("/univer-workspace/api/viewer-bootstrap", { headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`viewer bootstrap answered ${response.status}`);
        const body = (await response.json()) as {
          user?: { id?: unknown; displayName?: unknown; avatarUrl?: unknown };
          license?: unknown;
        };
        if (
          typeof body.user?.id !== "string" ||
          typeof body.user.displayName !== "string" ||
          typeof body.license !== "string"
        ) {
          throw new Error("viewer bootstrap returned an unexpected payload");
        }
        return {
          user: {
            id: body.user.id,
            displayName: body.user.displayName,
            avatarUrl: typeof body.user.avatarUrl === "string" ? body.user.avatarUrl : null,
          },
          license: body.license,
        };
      })
      .catch((error: unknown) => {
        bootstrapPromise = undefined;
        throw error;
      });
  }
  return bootstrapPromise;
}

/** Apply the browser plugin. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => installStyles(), "univer-workspace: client styles");
  ctx.effect(() => ctx.locale.register(UWH_LOCALE_NAMESPACE, { zh, en }), "univer-workspace: dictionaries");

  const getViewerLocale = (): ViewerLocale => viewerLocaleOf(ctx.locale.getSnapshot().active);

  ctx.conversationEvents.register(viewerTurnDefinition);

  ctx.slots.inject("conversation.hero.workspace", () => ctx.slots.register({
    name: "conversation.hero.workspace",
    // Shadows the official picker (priority 0) while leaving it live.
    priority: -1,
  }, SpacePicker));

  ctx.slots.inject("conversation.chat.turnTail", () => ctx.slots.register({
    name: "conversation.chat.turnTail",
    priority: -10,
    locale: UWH_LOCALE_NAMESPACE,
    select: selectViewerTurnCard,
  }, ViewerTurnCard));

  ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
    name: "conversation.input.dock",
    id: "univer-workspace-viewer",
    order: 400,
    locale: UWH_LOCALE_NAMESPACE,
    inject: (): ViewerDockInjected & ViewerLocaleInjected => ({ loadViewerBootstrap, getViewerLocale }),
  }, ViewerDock));
}
