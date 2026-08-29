/**
 * @dsh-univer-workspace-plugin — browser half.
 *
 * Mirrors the dsh-univer-office client surface for remote Workspace
 * documents: the native DSH workspace picker in the blank-session hero, the Turn-tail
 * review panels (one per touched document), and floating live-editor
 * windows in the input dock, backed by one locale namespace. All
 * collaboration traffic goes through the same-origin proxy (no iframe).
 */
import { createElement } from "react";
import type { ClientContext, ISessions, WorkspaceView } from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";
import type {} from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import { PreviewCard } from "./components/preview-card.tsx";
import { WORKSPACE_TOOL_NAMES, WorkspaceToolRow } from "./components/workspace-tool-row.tsx";
import { ViewerDock } from "./ViewerDock.tsx";
import { univerTurnDefinition } from "./conversation/univer-turn-definition.ts";
import { viewerLocaleOf, type ViewerLocale } from "./viewer-locale.ts";
import { loadViewerBootstrap } from "./viewer-bootstrap.ts";
import { en, UNIVER_LOCALE_NAMESPACE, zh } from "./locales.ts";
import { installStyles } from "./styles.ts";
import { SpaceDirectoryFlow } from "./SpaceDirectoryFlow.tsx";
import { TemplateForkAction } from "./TemplateForkAction.tsx";
import { WorkspaceFooterSwitch, WorkspaceHeaderSwitch } from "./WorkspaceSwitchButton.tsx";
import { OriginSetting, type WorkspaceAuthSettings } from "./OriginSetting.tsx";
import { HarnessDocumentTitle } from "./DocumentTitle.tsx";
import { fetchWorkspaceSpaces, renameWorkspaceSpace } from "./space-api.ts";
import { forkTemplate } from "./template-api.ts";
import { WORKSPACE_ME_PATH, WORKSPACE_LOGIN_PATH, type WorkspaceMeView } from "./workspace-contract.ts";

/** Required browser services. */
export const inject = ["slots", "conversationEvents", "locale", "settingsScope", "sessions", "workspaces"];

const WORKSPACE_SETTINGS_NAMESPACE = "univer-workspace-harness";

/** Apply the browser plugin. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => installStyles(), "univer-workspace: client styles");
  ctx.effect(() => ctx.locale.register(UNIVER_LOCALE_NAMESPACE, { zh, en }), "univer-workspace: dictionaries");

  const workspaces = ctx.workspaces as unknown as {
    rename: (workspaceId: string, title: string) => Promise<WorkspaceView>;
    startSession: (workspaceId?: string) => void;
    list: { getSnapshot: () => { items: readonly { workspaceId: string; sessionIds: readonly string[] }[] } };
  };
  const nativeRenameWorkspace = workspaces.rename.bind(workspaces);
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
  const nativeStartSession = workspaces.startSession.bind(workspaces);
  // The stock DSH action falls back to the most-recent mechanical workspace.
  // That workspace may be an unlinked local session, which would make every
  // Univer tool fail with SESSION_SCOPE_UNAVAILABLE. Resolve the fallback from
  // the product Space catalogue first; explicit Workspace selections retain
  // the native action unchanged.
  workspaces.startSession = (workspaceId?: string): void => {
    if (workspaceId !== undefined) {
      nativeStartSession(workspaceId);
      return;
    }
    void loadSpaces().then((spaces) => {
      const linked = new Set(spaces.map(space => String(space.dshWorkspaceId)));
      const current = (ctx.sessions as unknown as { list: { getSnapshot: () => { current?: string } } }).list.getSnapshot().current;
      const currentWorkspace = current === undefined
        ? undefined
        : workspaces.list.getSnapshot().items.find(item => item.sessionIds.includes(current))?.workspaceId;
      const target = currentWorkspace !== undefined && linked.has(String(currentWorkspace))
        ? undefined
        : spaces[0]?.dshWorkspaceId;
      nativeStartSession(target);
    }).catch(() => {
      // Preserve the native DSH fallback when Workspace is temporarily
      // unavailable; the resulting scope error remains actionable to the user.
      nativeStartSession();
    });
  };
  workspaces.rename = async (workspaceId, title): Promise<WorkspaceView> => {
    const spaces = await loadSpaces();
    const linked = spaces.find(space => String(space.dshWorkspaceId) === String(workspaceId));
    if (linked === undefined) return nativeRenameWorkspace(workspaceId, title);
    const result = await renameWorkspaceSpace(linked.spaceId, title);
    spacesPromise = undefined;
    return nativeRenameWorkspace(workspaceId, result.space.name);
  };
  ctx.effect(() => () => {
    workspaces.rename = nativeRenameWorkspace;
    workspaces.startSession = nativeStartSession;
  }, "univer-workspace: linked Space rename");

  let mePromise: Promise<WorkspaceMeView> | undefined;
  const loadMe = (): Promise<WorkspaceMeView> => {
    if (mePromise === undefined) {
      mePromise = fetch(WORKSPACE_ME_PATH, { headers: { accept: "application/json" } }).then(async response => {
        if (response.status === 401) {
          window.location.assign(WORKSPACE_LOGIN_PATH);
          throw new Error("authentication_required");
        }
        if (!response.ok) throw new Error("identity_failed");
        const value = await response.json() as Partial<WorkspaceMeView>;
        if (typeof value.workspaceOrigin !== "string" || !Array.isArray(value.templates)) {
          throw new Error("identity_failed");
        }
        return value as WorkspaceMeView;
      }).catch((reason: unknown) => {
        mePromise = undefined;
        throw reason;
      });
    }
    return mePromise;
  };

  const translate = ctx.locale.bind(UNIVER_LOCALE_NAMESPACE);
  const sessionHashForId = (sessionId: string): string => `#/s/${encodeURIComponent(sessionId)}`;
  const openSession = (sessionId: string): void => {
    window.location.hash = sessionHashForId(sessionId);
  };

  const spaceFlowInjected = () => ({
    loadSpaces,
    selectSpace: (dshWorkspaceId: string) => {
      workspaces.startSession(dshWorkspaceId);
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

  const originScope = ctx.settingsScope.bind<WorkspaceAuthSettings>({ namespace: WORKSPACE_SETTINGS_NAMESPACE });
  ctx.slots.inject("settings.general.item", () => ctx.slots.register({
    name: "settings.general.item",
    id: "univer-workspace-origin",
    order: 100,
    inject: () => ({ scope: originScope }),
  }, OriginSetting));

  ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
    name: "sidebar.footer.action",
    id: "univer-workspace-template-fork",
    order: 5,
    locale: UNIVER_LOCALE_NAMESPACE,
    inject: () => ({ loadMe, forkTemplate, openSession }),
  }, TemplateForkAction));

  const loadWorkspaceOrigin = async (): Promise<string | undefined> => (await loadMe()).workspaceOrigin;
  ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
    name: "conversation.session.header.utilities",
    id: "univer-workspace-open-workspace",
    order: 10,
    locale: UNIVER_LOCALE_NAMESPACE,
    inject: () => ({ loadWorkspaceOrigin }),
  }, WorkspaceHeaderSwitch));
  ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
    name: "sidebar.footer.action",
    id: "univer-workspace-open-workspace-footer",
    order: 10,
    locale: UNIVER_LOCALE_NAMESPACE,
    inject: () => ({ loadWorkspaceOrigin }),
  }, WorkspaceFooterSwitch));

  const clientSessions = ctx.sessions as unknown as ISessions;
  ctx.slots.inject("shell.overlay", () => ctx.slots.register({
    name: "shell.overlay",
    id: "univer-workspace-document-title",
    order: -1000,
  }, () => createElement(HarnessDocumentTitle, { sessionList: clientSessions.list })));

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
