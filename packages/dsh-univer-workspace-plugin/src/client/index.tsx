/**
 * @dsh-univer-workspace-plugin — browser half.
 *
 * Registers the Space picker in the blank-session hero and the floating
 * document viewer in the conversation input dock. The viewer renders a Univer
 * collaboration editor directly in the DSH page (no iframe), reaching the
 * Workspace through the same-origin collaboration proxy.
 */
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import { SpacePicker } from "./SpacePicker.tsx";
import { ViewerDock, type ViewerDockInjected } from "./ViewerDock.tsx";
import { viewerTurnDefinition } from "./viewer-turn-definition.ts";
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

  ctx.conversationEvents.register(viewerTurnDefinition);

  ctx.slots.inject("conversation.hero.workspace", () => ctx.slots.register({
    name: "conversation.hero.workspace",
    // Shadows the official picker (priority 0) while leaving it live.
    priority: -1,
  }, SpacePicker));

  ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
    name: "conversation.input.dock",
    id: "univer-workspace-viewer",
    order: 400,
    inject: (): ViewerDockInjected => ({ loadViewerBootstrap }),
  }, ViewerDock));
}
