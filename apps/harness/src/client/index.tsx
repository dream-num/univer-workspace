/**
 * @univerjs/univer-workspace-harness — browser half.
 *
 * Keeps the DSH WorkspaceBrowser as the sidebar owner.  The harness only
 * supplies authentication-aware routing for new sessions and the
 * workspace-origin preference row; it must not reimplement the browser's
 * grouping, search, rename, reorder, archive, and directory flows.
 */
import { createElement } from "react";
import type { ClientContext, ISessions, WorkspaceView } from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";
import type {} from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-modules/client";
import type {} from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import { asWorkspaceId, UWH_LOGIN_PATH, UWH_ME_PATH, type UwhMeView } from "../contract.ts";
import { OriginSetting, type WorkspaceAuthSettings } from "./OriginSetting.tsx";
import { fetchWorkspaceSpaces, renameWorkspaceSpace } from "./space-api.ts";
import { SpaceDirectoryFlow } from "./SpaceDirectoryFlow.tsx";
import { forkTemplate } from "./template-api.ts";
import { TemplateForkAction } from "./TemplateForkAction.tsx";
import * as sessionInputGuard from "./session-input-guard.ts";
import * as sessionRoute from "./session-route.ts";
import { installStyles } from "./styles.ts";
import { en, HARNESS_LOCALE_NAMESPACE, zh } from "./locales.ts";
import { WorkspaceFooterSwitch, WorkspaceHeaderSwitch } from "./WorkspaceSwitchButton.tsx";
import { HarnessDocumentTitle } from "./DocumentTitle.tsx";

/** Required services (cordis fiber inject). */
export const inject = ["slots", "connection", "sessions", "workspaces", "modules", "settingsScope", "locale"];

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

/** Keep rename failures safe and localized before they reach DSH's dialog. */
function spaceRenameMessage(reason: unknown, t: (key: keyof typeof zh) => string): string {
  const code = reason instanceof Error ? reason.message : "";
  if (code === "space_name_invalid") return t("spaceNameInvalid");
  if (code === "space_rename_forbidden") return t("spaceRenameForbidden");
  return t("spaceRenameFailed");
}

/** Apply the browser plugin. */
export function apply(ctx: ClientContext): void {
  ctx.plugin(sessionInputGuard);
  ctx.plugin(sessionRoute);
  ctx.effect(() => installStyles(), "uwh: client styles");
  ctx.effect(() => ctx.locale.register(HARNESS_LOCALE_NAMESPACE, { zh, en }), "uwh: dictionaries");

  const workspaces = ctx.workspaces;
  // This package typechecks its Host and browser halves together, so Cordis's
  // declaration merging also sees the Host `dsh-session` service named
  // `sessions`. The browser runtime still provides the published ISessions
  // contract; narrow that known composition boundary once and keep the title
  // component on its observable list feed.
  const clientSessions = ctx.sessions as unknown as ISessions;

  // One catalogue feeds both the directory-flow replacement and the linked
  // Workspace rename seam.  A failed request is not cached, so a retry always
  // observes the current authenticated Space list.
  let spacesPromise: Promise<Awaited<ReturnType<typeof fetchWorkspaceSpaces>>> | undefined;
  const loadSpaces = (): Promise<Awaited<ReturnType<typeof fetchWorkspaceSpaces>>> => {
    if (spacesPromise === undefined) {
      spacesPromise = fetchWorkspaceSpaces().catch((reason: unknown) => {
        spacesPromise = undefined;
        throw reason;
      });
    }
    return spacesPromise;
  };
  const translate = ctx.locale.bind(HARNESS_LOCALE_NAMESPACE);

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

  // DSH's WorkspaceBrowser remains the owner of the row/menu interaction. For
  // a product-linked Space, route its rename through Workspace's capability
  // checked API, then mirror the accepted title into the mechanical DSH row.
  // Unlinked account-local DSH workspaces retain the native rename operation.
  const nativeRenameWorkspace = workspaces.rename.bind(workspaces);
  workspaces.rename = async (workspaceId, title): Promise<WorkspaceView> => {
    let spaces;
    try {
      spaces = await loadSpaces();
      const linked = spaces.find(space => String(space.dshWorkspaceId) === String(workspaceId));
      if (linked === undefined) {
        return await nativeRenameWorkspace(workspaceId, title);
      }
      const result = await renameWorkspaceSpace(linked.spaceId, title);
      // The product name is now authoritative; force the next picker open to
      // read it again even when the DSH list stays mounted.
      spacesPromise = undefined;
      return await nativeRenameWorkspace(workspaceId, result.space.name);
    } catch (reason: unknown) {
      console.warn("univer-workspace-harness: Space rename failed", reason);
      throw new Error(spaceRenameMessage(reason, translate));
    }
  };
  ctx.effect(() => () => {
    workspaces.rename = nativeRenameWorkspace;
  }, "uwh: route linked Space renames through Workspace");

  // The stock DSH picker packages drive a local filesystem path through these
  // two child slots.  A lower-priority occupant wins the single-slot contract;
  // this component presents product Spaces and starts the selected mechanical
  // session directly, so no path is ever produced or adopted.
  const spaceFlowInjected = () => ({
    loadSpaces,
    selectSpace: (dshWorkspaceId: string) => {
      workspaces.startSession(asWorkspaceId(dshWorkspaceId));
    },
    t: translate,
  });
  ctx.slots.inject("conversation.hero.workspace.directoryFlow", () =>
    ctx.slots.inject("sidebar.workspaces.directoryFlow", function* () {
      yield ctx.slots.register({
        name: "conversation.hero.workspace.directoryFlow",
        priority: -100,
        inject: spaceFlowInjected,
      }, SpaceDirectoryFlow);
      yield ctx.slots.register({
        name: "sidebar.workspaces.directoryFlow",
        priority: -100,
        inject: spaceFlowInjected,
      }, SpaceDirectoryFlow);
    }));

  const originScope = ctx.settingsScope.bind<WorkspaceAuthSettings>({ namespace: UWH_SETTINGS_NAMESPACE });
  ctx.slots.inject("settings.general.item", () => ctx.slots.register({
    name: "settings.general.item",
    id: "univer-workspace-harness-origin",
    order: 100,
    inject: () => ({ scope: originScope }),
  }, OriginSetting));

  // Configured templates remain a Harness concern, while the official DSH
  // WorkspaceBrowser continues to own all Workspace/session rows.  Put the
  // fork action in the shell's additive footer slot and open the resulting
  // session through the existing hash route.
  const openSession = (sessionId: string): void => {
    window.location.hash = sessionRoute.sessionHashForId(sessionId);
  };
  ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
    name: "sidebar.footer.action",
    id: "univer-workspace-harness-template-fork",
    order: 5,
    locale: HARNESS_LOCALE_NAMESPACE,
    inject: () => ({ loadMe, forkTemplate, openSession }),
  }, TemplateForkAction));

  // Cross-application navigation is additive: the native DSH conversation
  // header remains the owner, while this utility opens the authenticated
  // Workspace origin in a new window.  The sidebar footer covers the blank
  // hero, whose session header is intentionally hidden by ui-conversation.
  const loadWorkspaceOrigin = async (): Promise<string | undefined> => {
    const me = await loadMe();
    return me.workspaceOrigin;
  };
  ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
    name: "conversation.session.header.utilities",
    id: "univer-workspace-harness-open-workspace",
    order: 10,
    locale: HARNESS_LOCALE_NAMESPACE,
    inject: () => ({ loadWorkspaceOrigin }),
  }, WorkspaceHeaderSwitch));
  ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
    name: "sidebar.footer.action",
    id: "univer-workspace-harness-open-workspace-footer",
    order: 10,
    locale: HARNESS_LOCALE_NAMESPACE,
    inject: () => ({ loadWorkspaceOrigin }),
  }, WorkspaceFooterSwitch));

  // The published DSH web bundle owns a DeepSeek-branded DocumentTitle
  // component. Keep its session-title behavior but shadow only the product
  // suffix from an additive, frame-wide slot; no DSH source or client bundle
  // is modified.
  ctx.slots.inject("shell.overlay", () => ctx.slots.register({
    name: "shell.overlay",
    id: "univer-workspace-harness-document-title",
    order: -1000,
  }, () => createElement(HarnessDocumentTitle, { sessionList: clientSessions.list })));
}
