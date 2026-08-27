/**
 * @univerjs/univer-workspace-harness — browser half.
 *
 * Shadows the sidebar shell's `sidebar.workspaces` hole with the harness
 * session/template list, routes native session creation and prompt calls
 * through the harness-owned endpoints, and registers the workspace-origin
 * preference row.
 */
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type { ConnectionHandle, IApiClient, SessionId } from "@deepseek-ai/dsh-client-connection/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";
import type {} from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-modules/client";
import type {} from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import {
  UWH_LOGIN_PATH, UWH_ME_PATH, UWH_TEMPLATE_FORK_PATH,
  type UwhMeView, type UwhTemplate,
} from "../contract.ts";
import { Workspaces } from "./Workspaces.tsx";
import { OriginSetting, type WorkspaceAuthSettings } from "./OriginSetting.tsx";
import * as sessionInputGuard from "./session-input-guard.ts";
import * as sessionRoute from "./session-route.ts";
import { installStyles } from "./styles.ts";
import { en, HARNESS_LOCALE_NAMESPACE, zh } from "./locales.ts";

export type { UwhWorkspacesProps } from "./workspaces-props.ts";

/** Registrant business face the sidebar component receives. */
export interface UwhInjected {
  /** Fetch the identity/workspace/template route once. */
  loadMe: () => Promise<UwhMeView>;
  /** Fork a configured template; resolves the child session id. */
  forkTemplate: (template: UwhTemplate) => Promise<string>;
  /** Open a session (navigate). */
  open: (sessionId: string) => void;
}

/** Required services (cordis fiber inject). */
export const inject = ["slots", "connection", "sessions", "modules", "settingsScope", "locale"];

/** The settings namespace name, mirrored from the host side. */
const UWH_SETTINGS_NAMESPACE = "univer-workspace-harness";

/** Fetch and parse the identity route over the browser's own origin. */
async function fetchMe(): Promise<UwhMeView> {
  const response = await fetch(UWH_ME_PATH, { headers: { accept: "application/json" } });
  if (response.status === 401) {
    window.location.assign(UWH_LOGIN_PATH);
    throw new Error("univer-workspace-harness: not authenticated, redirecting to login");
  }
  if (!response.ok) {
    throw new Error(`univer-workspace-harness: identity route answered ${response.status}`);
  }
  const body = (await response.json()) as Partial<UwhMeView>;
  if (typeof body?.identity?.userId !== "string" || body.workspace === undefined) {
    throw new Error("univer-workspace-harness: identity route returned an unexpected payload");
  }
  return body as UwhMeView;
}

/** Build the injected face over a wire client + the sessions service. */
function injected(
  api: IApiClient,
  openSession: (sessionId: SessionId) => void,
  loadMe: () => Promise<UwhMeView>,
): UwhInjected {
  return {
    loadMe,
    forkTemplate: async (template) => {
      const response = await fetch(UWH_TEMPLATE_FORK_PATH, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ key: template.key }),
      });
      if (!response.ok) {
        throw new Error(`univer-workspace-harness: template fork answered ${response.status}`);
      }
      const body = (await response.json()) as { sessionId?: unknown };
      if (typeof body.sessionId !== "string") throw new Error("univer-workspace-harness: template fork returned an unexpected payload");
      return body.sessionId;
    },
    open: sessionId => openSession(sessionId as SessionId),
  };
}

/** Apply the browser plugin. */
export function apply(ctx: ClientContext): void {
  ctx.plugin(sessionInputGuard);
  ctx.plugin(sessionRoute);
  ctx.effect(() => installStyles(), "uwh: client styles");
  ctx.effect(() => ctx.locale.register(HARNESS_LOCALE_NAMESPACE, { zh, en }), "uwh: dictionaries");

  const { api } = ctx.get("connection") as ConnectionHandle;
  const openSession = (sessionId: SessionId): void => {
    window.location.hash = `#/s/${encodeURIComponent(sessionId)}`;
  };

  // Both the workspaces occupant and the origin row may read the bootstrap;
  // memoize success so they share one request.
  let mePromise: Promise<UwhMeView> | undefined;
  const loadMe = (): Promise<UwhMeView> => {
    if (mePromise === undefined) {
      mePromise = fetchMe().catch((error: unknown) => {
        mePromise = undefined;
        throw error;
      });
    }
    return mePromise;
  };

  ctx.slots.inject("sidebar.workspaces", () => ctx.slots.register({
    name: "sidebar.workspaces",
    // Shadows the official WorkspaceBrowser (priority 0) while leaving it live.
    priority: -1,
    locale: HARNESS_LOCALE_NAMESPACE,
    inject: () => injected(api, openSession, loadMe),
  }, Workspaces));

  const originScope = ctx.settingsScope.bind<WorkspaceAuthSettings>({ namespace: UWH_SETTINGS_NAMESPACE });
  ctx.slots.inject("settings.general.item", () => ctx.slots.register({
    name: "settings.general.item",
    id: "univer-workspace-harness-origin",
    order: 100,
    inject: () => ({ scope: originScope }),
  }, OriginSetting));
}
