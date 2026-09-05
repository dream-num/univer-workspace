import {
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import type { SidebarRootComponentProps } from "@deepseek-ai/dsh-client-ui-sidebar/client";
import { WorkspaceToaster } from "@univerjs/univer-workspace-ui";
import type { WorkspaceFileLocale } from "@univerjs/univer-workspace-file-browser";
import {
  IconBranchOutline16,
  IconBrowseOutline16,
  IconNewChatOutline16,
  IconPanelLeftOutline16,
  Tooltip,
} from "@deepseek-ai/dsh-client-ui-primitives";
import { FileSidebar } from "./FileSidebar.tsx";
import { WorktreeSidebar } from "./WorktreeSidebar.tsx";
import type { WorkspaceNavigationStore } from "./navigation/workspace-navigation.ts";
import type { SessionListState } from "./dsh-runtime-types.ts";
import type { UniverLocaleKey } from "./locales.ts";
import type {
  WorkspaceResourceDescriptor,
  WorkspaceResourceReferenceInsertResult,
} from "./workspace-resource-reference.ts";
import type { ViewerSelection } from "./viewer/contracts.ts";
import css from "./WorkspaceSidebarRoot.module.scss";

const TAB_STORAGE_KEY = "dsh-univer-workspace/sidebar-tab";
const COLLAPSE_SETTLE_MS = 150;

function IconButton({
  label,
  children,
  onClick,
  selected,
}: {
  label: string;
  children: ReactElement;
  onClick: () => void;
  selected?: boolean;
}) {
  return (
    <Tooltip label={label} side="right">
      <button
        type="button"
        className={css.iconButton}
        aria-label={label}
        {...(selected === undefined ? {} : { "aria-pressed": selected })}
        data-selected={selected || undefined}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export interface WorkspaceSidebarRootProps extends SidebarRootComponentProps {
  readonly navigation: WorkspaceNavigationStore;
  readonly insertResourceReference: (
    sessionId: string | undefined,
    resource: Pick<WorkspaceResourceDescriptor, "resourceId" | "name">,
    selection?: ViewerSelection,
  ) => WorkspaceResourceReferenceInsertResult;
  readonly translate: (key: UniverLocaleKey) => string;
  readonly getWorkspaceFileLocale: () => WorkspaceFileLocale;
  readonly subscribeWorkspaceLocale: (listener: () => void) => () => void;
}

export function WorkspaceSidebarRoot(props: WorkspaceSidebarRootProps) {
  const navigationState = useSyncExternalStore(
    props.navigation.subscribe,
    props.navigation.getSnapshot,
    props.navigation.getSnapshot,
  );
  const { navigationMode: tab, contentSurface } = navigationState;
  const currentSessionId = props.useSessions((state: SessionListState) => state.current);
  const workspaceFileLocale = useSyncExternalStore(
    props.subscribeWorkspaceLocale,
    props.getWorkspaceFileLocale,
    props.getWorkspaceFileLocale,
  );
  const [settled, setSettled] = useState(props.collapsed);
  const [everWide, setEverWide] = useState(!props.collapsed);
  const [lastWideWidth, setLastWideWidth] = useState(props.width);
  useEffect(() => {
    try {
      window.localStorage.setItem(TAB_STORAGE_KEY, tab);
    } catch {
      /* optional preference */
    }
  }, [tab]);
  useEffect(() => {
    if (!props.collapsed) {
      setEverWide(true);
      setLastWideWidth(props.width);
    }
    setSettled(false);
    const timer = window.setTimeout(() => setSettled(props.collapsed), COLLAPSE_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [props.collapsed, props.width]);
  const width = props.collapsed ? 56 : lastWideWidth || props.width;
  const style = {
    width,
    "--uwh-sidebar-width": `${width}px`,
  } as CSSProperties & { "--uwh-sidebar-width": string };
  const fileMounted = everWide || tab === "files";
  const worktreeMounted = everWide || tab === "worktrees";
  const selectNavigation = (navigationMode: "sessions" | "files" | "worktrees") => {
    props.navigation.dispatch({ type: "select-navigation", navigationMode });
    if (props.collapsed) {
      props.toggleSidebar();
    }
  };
  const slot = (
    name: Parameters<typeof props.renderSlot>[0],
    params: Record<string, unknown>,
  ): ReactNode => props.renderSlot(name, params as never) as unknown as ReactNode;
  if (props.collapsed && settled) {
    return (
      <aside
        className={css.rail}
        style={style}
        data-plugin="dsh-univer-workspace"
        data-surface="sidebar"
      >
        <div className={css.railTop}>
          <IconButton label={props.t("toggle.open")} onClick={props.toggleSidebar}>
            {
              slot("sidebar.brand.mark", {
                size: 24,
              }) as ReactElement
            }
          </IconButton>
          <IconButton label={props.t("session.new.label")} onClick={() => props.startSession()}>
            <IconNewChatOutline16 />
          </IconButton>
          <IconButton
            label={props.translate("navigation.sessions")}
            selected={tab === "sessions"}
            onClick={() => selectNavigation("sessions")}
          >
            <IconNewChatOutline16 />
          </IconButton>
          <IconButton
            label={props.translate("navigation.files")}
            selected={tab === "files"}
            onClick={() => selectNavigation("files")}
          >
            <IconBrowseOutline16 />
          </IconButton>
          <IconButton
            label={props.translate("navigation.worktrees")}
            selected={tab === "worktrees"}
            onClick={() => selectNavigation("worktrees")}
          >
            <IconBranchOutline16 />
          </IconButton>
        </div>
        <div className={css.railFooter}>
          {slot("sidebar.footer.action", { wide: false })}
          {slot("sidebar.settings", { wide: false })}
        </div>
      </aside>
    );
  }
  return (
    <>
      <aside
        className={`${css.sidebar} ${props.collapsed ? css.collapsed : css.wide}`}
        style={style}
        data-plugin="dsh-univer-workspace"
        data-surface="sidebar"
      >
        <div className={css.brandRow}>
          <div className={css.brand}>
            {slot("sidebar.brand.mark", { size: 24 })}
            <span className={css.brandName}>{slot("sidebar.brand.name", {})}</span>
          </div>
          <div className={css.brandActions}>
            <button type="button" className={css.newSession} onClick={() => props.startSession()}>
              <IconNewChatOutline16 />
              <span>{props.t("session.new")}</span>
            </button>
            <IconButton label={props.t("toggle.collapse")} onClick={props.toggleSidebar}>
              <IconPanelLeftOutline16 />
            </IconButton>
          </div>
        </div>
        <div role="tablist" aria-label={props.translate("navigation.aria")} className={css.tabRow}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "sessions"}
            className={css.tabButton}
            onClick={() =>
              props.navigation.dispatch({ type: "select-navigation", navigationMode: "sessions" })
            }
          >
            <IconNewChatOutline16 />
            <span className={css.tabLabel}>{props.translate("navigation.sessions")}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "files"}
            className={css.tabButton}
            onClick={() =>
              props.navigation.dispatch({ type: "select-navigation", navigationMode: "files" })
            }
          >
            <IconBrowseOutline16 />
            <span className={css.tabLabel}>{props.translate("navigation.files")}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "worktrees"}
            className={css.tabButton}
            onClick={() =>
              props.navigation.dispatch({
                type: "select-navigation",
                navigationMode: "worktrees",
              })
            }
          >
            <IconBranchOutline16 />
            <span className={css.tabLabel}>{props.translate("navigation.worktrees")}</span>
          </button>
        </div>
        <div className={css.regionArea}>
          <div
            role="tabpanel"
            aria-hidden={tab !== "sessions"}
            className={`${css.regionPane} ${tab === "sessions" ? css.visible : css.hidden}`}
          >
            {slot("sidebar.workspaces", {
              wide: true,
              expandSidebar: props.toggleSidebar,
            })}
          </div>
          {fileMounted && (
            <div
              role="tabpanel"
              aria-hidden={tab !== "files"}
              className={`${css.regionPane} ${tab === "files" ? css.visible : css.hidden}`}
            >
              <FileSidebar
                onOpenResource={(contentSurface) =>
                  props.navigation.dispatch({ type: "open-content", contentSurface })
                }
                currentSessionId={currentSessionId}
                insertResourceReference={props.insertResourceReference}
                t={props.translate}
                locale={workspaceFileLocale}
              />
            </div>
          )}
          {worktreeMounted && (
            <div
              role="tabpanel"
              aria-hidden={tab !== "worktrees"}
              className={`${css.regionPane} ${tab === "worktrees" ? css.visible : css.hidden}`}
            >
              <WorktreeSidebar
                onOpenWorktree={(contentSurface) =>
                  props.navigation.dispatch({ type: "open-content", contentSurface })
                }
                activeWorktreeId={
                  contentSurface?.kind === "worktree" ? contentSurface.worktreeId : null
                }
                t={props.translate}
              />
            </div>
          )}
        </div>
        <div className={css.footer}>
          {slot("sidebar.footer.action", { wide: true })}
          {slot("sidebar.settings", { wide: true })}
        </div>
      </aside>
      <WorkspaceToaster />
    </>
  );
}
