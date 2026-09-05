/**
 * @dsh-univer-workspace-plugin — browser half.
 *
 * Mirrors the dsh-univer-office client surface for remote Workspace
 * documents: the native DSH workspace picker in the blank-session hero, the Turn-tail
 * review panels (one per touched document), and floating live-editor
 * windows in the input dock, backed by one locale namespace. All
 * collaboration traffic goes through the same-origin proxy (no iframe).
 */
import type { ClientContext, ISessions, WorkspaceView } from "./dsh-runtime-types.ts";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-chat/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";
import type {} from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type { IConversation } from "@deepseek-ai/dsh-client-ui-conversation/client";
import { WorkspaceUserMessageNodeView } from "./WorkspaceUserMessageNodeView.tsx";
import { toast } from "@univerjs/univer-workspace-ui";
import "./index.css";
import { PreviewCard } from "./components/preview-card.tsx";
import { WORKSPACE_TOOL_NAMES, WorkspaceToolRow } from "./components/workspace-tool-row.tsx";
import { ViewerDock } from "./ViewerDock.tsx";
import { selectUniverTurn, univerTurnDefinition } from "./conversation/univer-turn-definition.ts";
import { viewerLocaleOf, type ViewerLocale } from "./viewer-locale.ts";
import { loadViewerBootstrap } from "./viewer-bootstrap.ts";
import { en, UNIVER_LOCALE_NAMESPACE, zh } from "./locales.ts";
import { SpaceDirectoryFlow } from "./SpaceDirectoryFlow.tsx";
import { TemplateForkAction } from "./TemplateForkAction.tsx";
import { WorkspaceFooterSwitch, WorkspaceHeaderSwitch } from "./WorkspaceSwitchButton.tsx";
import { OriginSetting, type WorkspaceAuthSettings } from "./OriginSetting.tsx";
import { HarnessDocumentTitle } from "./DocumentTitle.tsx";
import { FileWorkspaceOverlay } from "./FileWorkspaceOverlay.tsx";
import { fetchWorkspaceSpaces, renameWorkspaceSpace } from "./space-api.ts";
import { WorkspaceSidebarRoot } from "./WorkspaceSidebarRoot.tsx";
import {
  createWorkspaceNavigationStore,
  workspaceNavigationModeOf,
} from "./navigation/workspace-navigation.ts";
import { forkTemplate } from "./template-api.ts";
import { WORKSPACE_ME_PATH, type WorkspaceMeView } from "./workspace-contract.ts";
import {
  createWorkspaceResourceInputSource,
  fetchWorkspaceResourceDescriptor,
  insertWorkspaceResourceReference,
  type WorkspaceResourceDescriptor,
  type WorkspaceResourceReferenceInsertResult,
} from "./workspace-resource-reference.ts";

/** Required browser services. */
export const inject = [
  "slots",
  "uiConversation",
  "conversation",
  "inputTriggers",
  "locale",
  "settingsScope",
  "sessions",
  "workspaces",
  "uiWorkspace",
  "layout",
];

const WORKSPACE_SETTINGS_NAMESPACE = "univer-workspace-harness";

/** Apply the browser plugin. */
export function apply(ctx: ClientContext): void {
  let storedNavigationMode: string | null = null;
  try {
    storedNavigationMode = window.localStorage.getItem("dsh-univer-workspace/sidebar-tab");
  } catch {
    /* optional preference */
  }
  const navigation = createWorkspaceNavigationStore({
    navigationMode: workspaceNavigationModeOf(storedNavigationMode),
    contentSurface: null,
  });

  ctx.effect(
    () => ctx.locale.register(UNIVER_LOCALE_NAMESPACE, { zh, en }),
    "univer-workspace: dictionaries",
  );
  const translate = ctx.locale.bind(UNIVER_LOCALE_NAMESPACE);
  const clientSessions = ctx.sessions as unknown as ISessions;
  const services = ctx as unknown as { get: (name: string) => unknown };
  const conversation = services.get("conversation") as IConversation;
  let linkedSpaces: Awaited<ReturnType<typeof fetchWorkspaceSpaces>> = [];
  let currentSpaceIdForSession: ((sessionId: string) => string | undefined) | undefined;
  const inputTriggers = services.get("inputTriggers") as {
    registerSource: (source: ReturnType<typeof createWorkspaceResourceInputSource>) => () => void;
  };
  ctx.effect(
    () =>
      inputTriggers.registerSource(
        createWorkspaceResourceInputSource(
          undefined,
          {
            workspace: translate("workspace.workspace"),
            browseWorkspace: translate("resource.browseWorkspace"),
            personalSpace: translate("workspace.personalSpace"),
            teamSpace: translate("workspace.teamSpace"),
            retry: translate("resource.retry"),
          },
          (sessionId) => currentSpaceIdForSession?.(sessionId),
        ),
      ),
    "univer-workspace: Resource @ source",
  );

  const openMessageResource = async (resourceId: string): Promise<void> => {
    try {
      const [resource, me] = await Promise.all([
        fetchWorkspaceResourceDescriptor(resourceId, new AbortController().signal),
        loadMe(),
      ]);
      navigation.dispatch({
        type: "open-content",
        contentSurface: {
          kind: "resource",
          workspaceOrigin: me.workspaceOrigin,
          resourceId: resource.resourceId,
          docKey: `res:${resource.resourceId}`,
          name: resource.name,
          unitType: resource.unitType,
        },
      });
    } catch (error) {
      toast.error(translate("window.loadFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // Keep DSH's native message chrome, but project Workspace Resource wire
  // objects to readable file chips in the transcript. The underlying node and
  // model payload remain unchanged; this is a display-only seat replacement.
  ctx.slots.inject("conversation.chat.node", () =>
    ctx.slots.register(
      {
        name: "conversation.chat.node",
        key: "user",
        priority: -100,
        inject: () => ({ onOpenResource: openMessageResource }),
      },
      WorkspaceUserMessageNodeView,
    ),
  );
  ctx.slots.inject("conversation.chat.node", () =>
    ctx.slots.register(
      {
        name: "conversation.chat.node",
        key: "steering",
        priority: -100,
        inject: () => ({ onOpenResource: openMessageResource }),
      },
      WorkspaceUserMessageNodeView,
    ),
  );

  const insertResourceReference = (
    sessionId: string | undefined,
    resource: Pick<WorkspaceResourceDescriptor, "resourceId" | "name">,
    selection?: import("./viewer/contracts.ts").ViewerSelection,
  ): WorkspaceResourceReferenceInsertResult => {
    const result = insertWorkspaceResourceReference(
      { sessions: clientSessions, conversation },
      sessionId ?? "",
      resource,
      selection,
    );
    switch (result.kind) {
      case "inserted":
        toast.success(translate("resource.addedToMessage"));
        break;
      case "input-busy":
        toast.error(translate("resource.inputBusy"));
        break;
      case "session-unavailable":
        toast.error(translate("resource.sessionUnavailable"));
        break;
      case "input-changed":
        toast.error(translate("resource.inputChanged"));
        break;
    }
    return result;
  };

  const workspaceNavigation = ctx.uiWorkspace as unknown as {
    startSession: (workspaceId?: string) => void;
  };

  // Replace only the shell root; native DSH session browser and settings stay
  // behind their existing slots while the Workspace file tree gets a second tab.
  ctx.slots.inject("sidebar", () =>
    ctx.slots.register(
      {
        name: "sidebar",
        priority: -1,
        locale: UNIVER_LOCALE_NAMESPACE,
        children: {
          "sidebar.brand.mark": { kind: "single", scope: "root" },
          "sidebar.brand.name": { kind: "single", scope: "root" },
          "sidebar.workspaces": { kind: "single", scope: "root" },
          "sidebar.settings": { kind: "single", scope: "root" },
          "sidebar.footer.action": { kind: "list", scope: "root" },
        },
        inject: () => ({
          startSession: (workspaceId?: string) => {
            workspaceNavigation.startSession(workspaceId);
          },
          toggleSidebar: () => {
            ctx.layout.toggleSidebar();
          },
          navigation,
          insertResourceReference,
          translate,
          getWorkspaceFileLocale: () => viewerLocaleOf(ctx.locale.getSnapshot().active),
          subscribeWorkspaceLocale: (listener: () => void) => ctx.locale.subscribe(listener),
        }),
      },
      WorkspaceSidebarRoot,
    ),
  );

  const workspaces = ctx.workspaces as unknown as {
    rename: (workspaceId: string, title: string) => Promise<WorkspaceView>;
    list: {
      getSnapshot: () => {
        items: readonly { workspaceId: string; sessionIds: readonly string[] }[];
      };
    };
  };
  const nativeRenameWorkspace = workspaces.rename.bind(workspaces);
  let spacesPromise: Promise<Awaited<ReturnType<typeof fetchWorkspaceSpaces>>> | undefined;
  const loadSpaces = (): Promise<Awaited<ReturnType<typeof fetchWorkspaceSpaces>>> => {
    if (spacesPromise === undefined) {
      spacesPromise = fetchWorkspaceSpaces()
        .then((spaces) => {
          linkedSpaces = spaces;
          return spaces;
        })
        .catch((reason: unknown) => {
          spacesPromise = undefined;
          throw reason;
        });
    }
    return spacesPromise;
  };
  currentSpaceIdForSession = (sessionId: string): string | undefined => {
    const workspaceId = workspaces.list
      .getSnapshot()
      .items.find((item) => item.sessionIds.includes(sessionId))?.workspaceId;
    return linkedSpaces.find((space) => String(space.dshWorkspaceId) === String(workspaceId))
      ?.spaceId;
  };
  // The product Space registry is the source of the mechanical DSH Workspace
  // rows.  It is rebuilt from the persisted Workspace session headers after a
  // pod restart, so reconcile it once when this capability mounts; otherwise
  // the stock sidebar starts with an ungrouped list and only gains titles
  // after the user opens the picker.  The initial probe is intentionally
  // quiet for an unconnected shell; opening the picker keeps the normal
  // connection-required state visible through loadSpaces().
  ctx.effect(() => {
    let active = true;
    void fetchWorkspaceSpaces()
      .then((spaces) => {
        linkedSpaces = spaces;
        if (!active) return;
        const refresh = (ctx.workspaces as unknown as { refresh?: () => Promise<void> }).refresh;
        if (typeof refresh === "function") void refresh();
      })
      .catch(() => {
        // Connection and transient Workspace failures remain visible when
        // the user explicitly opens the Space picker; startup must not replace
        // the DSH shell with a redirect or a permanent error state.
      });
    return () => {
      active = false;
    };
  }, "univer-workspace: initial Space reconciliation");
  const nativeStartSession = workspaceNavigation.startSession.bind(workspaceNavigation);
  // The stock DSH action falls back to the most-recent mechanical workspace.
  // That workspace may be an unlinked local session, which would make every
  // Univer tool fail with SESSION_SCOPE_UNAVAILABLE. Resolve the fallback from
  // the product Space catalogue first; explicit Workspace selections retain
  // the native action unchanged.
  workspaceNavigation.startSession = (workspaceId?: string): void => {
    if (workspaceId !== undefined) {
      nativeStartSession(workspaceId);
      return;
    }
    void loadSpaces()
      .then((spaces) => {
        const linked = new Set(spaces.map((space) => String(space.dshWorkspaceId)));
        const current = (
          ctx.sessions as unknown as { list: { getSnapshot: () => { current?: string } } }
        ).list.getSnapshot().current;
        const currentWorkspace =
          current === undefined
            ? undefined
            : workspaces.list.getSnapshot().items.find((item) => item.sessionIds.includes(current))
                ?.workspaceId;
        const target =
          currentWorkspace !== undefined && linked.has(String(currentWorkspace))
            ? undefined
            : spaces[0]?.dshWorkspaceId;
        nativeStartSession(target);
      })
      .catch(() => {
        // Preserve the native DSH fallback when Workspace is temporarily
        // unavailable; the resulting scope error remains actionable to the user.
        nativeStartSession();
      });
  };
  workspaces.rename = async (workspaceId, title): Promise<WorkspaceView> => {
    const spaces = await loadSpaces();
    const linked = spaces.find((space) => String(space.dshWorkspaceId) === String(workspaceId));
    if (linked === undefined) return nativeRenameWorkspace(workspaceId, title);
    const result = await renameWorkspaceSpace(linked.spaceId, title);
    spacesPromise = undefined;
    return nativeRenameWorkspace(workspaceId, result.space.name);
  };
  ctx.effect(
    () => () => {
      workspaces.rename = nativeRenameWorkspace;
      workspaceNavigation.startSession = nativeStartSession;
    },
    "univer-workspace: linked Space rename",
  );

  let mePromise: Promise<WorkspaceMeView> | undefined;
  const loadMe = (): Promise<WorkspaceMeView> => {
    if (mePromise === undefined) {
      mePromise = fetch(WORKSPACE_ME_PATH, { headers: { accept: "application/json" } })
        .then(async (response) => {
          if (response.status === 401) {
            throw new Error("workspace_connection_required");
          }
          if (!response.ok) throw new Error("identity_failed");
          const value = (await response.json()) as Partial<WorkspaceMeView>;
          if (
            typeof value.workspaceOrigin !== "string" ||
            !Array.isArray(value.templates) ||
            typeof value.connected !== "boolean" ||
            typeof value.restartRequired !== "boolean"
          ) {
            throw new Error("identity_failed");
          }
          return value as WorkspaceMeView;
        })
        .catch((reason: unknown) => {
          mePromise = undefined;
          throw reason;
        });
    }
    return mePromise;
  };

  const getViewerLocale = (): ViewerLocale => viewerLocaleOf(ctx.locale.getSnapshot().active);
  const sessionHashForId = (sessionId: string): string => `#/s/${encodeURIComponent(sessionId)}`;
  const openSession = (sessionId: string): void => {
    window.location.hash = sessionHashForId(sessionId);
  };

  const spaceFlowInjected = () => ({
    loadSpaces,
    selectSpace: (dshWorkspaceId: string) => {
      workspaceNavigation.startSession(dshWorkspaceId);
    },
    t: translate,
  });
  ctx.slots.inject("conversation.hero.workspace.directoryFlow", () =>
    ctx.slots.inject("sidebar.workspaces.directoryFlow", function* () {
      yield ctx.slots.register(
        {
          name: "conversation.hero.workspace.directoryFlow",
          priority: -100,
          inject: spaceFlowInjected,
        },
        SpaceDirectoryFlow,
      );
      yield ctx.slots.register(
        {
          name: "sidebar.workspaces.directoryFlow",
          priority: -100,
          inject: spaceFlowInjected,
        },
        SpaceDirectoryFlow,
      );
    }),
  );

  const originScope = ctx.settingsScope.bind<WorkspaceAuthSettings>({
    namespace: WORKSPACE_SETTINGS_NAMESPACE,
  });
  ctx.slots.inject("settings.general.item", () =>
    ctx.slots.register(
      {
        name: "settings.general.item",
        id: "univer-workspace-origin",
        order: 100,
        locale: UNIVER_LOCALE_NAMESPACE,
        inject: () => ({ scope: originScope }),
      },
      OriginSetting,
    ),
  );

  ctx.slots.inject("sidebar.footer.action", () =>
    ctx.slots.register(
      {
        name: "sidebar.footer.action",
        id: "univer-workspace-template-fork",
        order: 5,
        locale: UNIVER_LOCALE_NAMESPACE,
        inject: () => ({ loadMe, forkTemplate, openSession }),
      },
      TemplateForkAction,
    ),
  );

  const loadWorkspaceOrigin = async (): Promise<string | undefined> =>
    (await loadMe()).workspaceOrigin;
  ctx.slots.inject("conversation.session.header.utilities", () =>
    ctx.slots.register(
      {
        name: "conversation.session.header.utilities",
        id: "univer-workspace-open-workspace",
        order: 10,
        locale: UNIVER_LOCALE_NAMESPACE,
        inject: () => ({ loadWorkspaceOrigin }),
      },
      WorkspaceHeaderSwitch,
    ),
  );
  ctx.slots.inject("sidebar.footer.action", () =>
    ctx.slots.register(
      {
        name: "sidebar.footer.action",
        id: "univer-workspace-open-workspace-footer",
        order: 10,
        locale: UNIVER_LOCALE_NAMESPACE,
        inject: () => ({ loadWorkspaceOrigin }),
      },
      WorkspaceFooterSwitch,
    ),
  );

  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register(
      {
        name: "shell.overlay",
        id: "univer-workspace-document-title",
        order: -1000,
      },
      () => <HarnessDocumentTitle sessionList={clientSessions.list} />,
    ),
  );

  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register(
      {
        name: "shell.overlay",
        id: "univer-workspace-file-workspace",
        order: 20,
        inject: () => ({
          loadViewerBootstrap,
          getViewerLocale,
          t: translate,
          navigation,
          insertResourceReference,
        }),
      },
      FileWorkspaceOverlay,
    ),
  );

  ctx.uiConversation.events.register(univerTurnDefinition);

  // Own the transcript row for every Univer tool.  The stock generic row
  // derives its summary from raw arguments, which exposes opaque Workspace
  // UUIDs even when the Host supplies a human presentCall title.
  ctx.slots.inject("tool.call.toolview", function* () {
    for (const key of WORKSPACE_TOOL_NAMES) {
      yield ctx.slots.register(
        {
          name: "tool.call.toolview",
          key,
          locale: UNIVER_LOCALE_NAMESPACE,
        },
        WorkspaceToolRow,
      );
    }
  });

  ctx.slots.inject("conversation.chat.turnTail", () =>
    ctx.slots.register(
      {
        name: "conversation.chat.turnTail",
        priority: -10,
        locale: UNIVER_LOCALE_NAMESPACE,
        select: selectUniverTurn,
        inject: () => ({ loadViewerBootstrap, getViewerLocale, navigation }),
      },
      PreviewCard,
    ),
  );

  ctx.slots.inject("conversation.input.dock", () =>
    ctx.slots.register(
      {
        name: "conversation.input.dock",
        id: "univer-workspace-viewer",
        order: 400,
        locale: UNIVER_LOCALE_NAMESPACE,
        inject: () => ({ loadViewerBootstrap, getViewerLocale, navigation }),
      },
      ViewerDock,
    ),
  );
}
