import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useLocation, useNavigate } from "@tanstack/react-router";
import { CircleDot, House, Menu, MessageCircle, PanelLeftClose, PanelLeftOpen, Settings, Users, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { sessionQueryKey, sessionQueryOptions } from "../../features/auth";
import { spacesQueryOptions } from "../../features/spaces";
import { spaceDisplayName } from "./space-name";
import { useWorktreeChangeFeed, worktreeListQueryOptions } from "../../features/worktrees";
import { api } from "../../shared/api/client";
import { workspaceHarnessOrigin } from "../../shared/app-links";
import { apiError } from "../../shared/api/errors";
import { useI18n, type MessageKey } from "../../shared/i18n";
import { ModeSettings } from "../mode-settings";
import { SidebarResizeHandle, useMediaQuery, useResizableSidebar } from "../../shared/resizable-sidebar";
import { Button, buttonVariants, Drawer, LoadingScreen, MenuItem, Tooltip } from "../../shared/ui";
import { cn } from "../../shared/utils/cn";
import type { components } from "../../../../generated/http/schema.js";
import {
  AccountMenu,
  AppSettingsDialog,
  ProfileDialog,
  PasswordDialog,
  TrialNoticeDialog,
} from "../../features/account";
import { BrandMark, NavLink, BreadcrumbSeparator } from "../../features/shell";
import type { RepositoryBreadcrumb } from "./repository-tabs";
import type { WorkspaceShellProps, WorkspaceView } from "../shell.types";

type SpaceView = components["schemas"]["SpaceView"];

function RepositoryBreadcrumbs({
  spaceId,
  spaceName,
  space,
  breadcrumbs,
  current,
}: {
  readonly spaceId: string | undefined;
  readonly spaceName: string;
  readonly space: SpaceView | undefined;
  readonly breadcrumbs: readonly RepositoryBreadcrumb[] | undefined;
  readonly current: ReactNode | undefined;
}) {
  const trail = [...(breadcrumbs ?? [])];
  const CurrentHeading = spaceId === undefined ? "h1" : "span";
  // The current page is rendered from `current`; a matching last crumb would only repeat it.
  if (typeof current === "string" && trail[trail.length - 1]?.label === current) trail.pop();
  const ancestorItems: ReactNode[] = [];
  if (spaceId !== undefined) {
    ancestorItems.push(
      <li key={`space-${spaceId}`} className="flex min-w-0 items-center gap-2">
        {space?.owner ? <span className="max-w-24 truncate sm:max-w-40">{space.owner.username}</span> : null}
        <BreadcrumbSeparator className={undefined} />
        <Link
          to="/spaces/$spaceId"
          params={{ spaceId }}
          search={{}}
          activeOptions={{ exact: true }}
          className={cn(
            breadcrumbLinkClass,
            "max-w-40 shrink sm:max-w-52",
            current === undefined ? "truncate" : undefined,
          )}
        >
          {spaceName}
        </Link>
      </li>,
    );
  }
  for (const [index, item] of trail.entries()) {
    const isLastAncestor = index === trail.length - 1 && current === undefined;
    ancestorItems.push(
      <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-2">
        <BreadcrumbSeparator className={isLastAncestor ? undefined : "hidden sm:inline"} />
        {item.nodeId === undefined && item.settingsSpaceId === undefined && item.issuesSpaceId === undefined ? (
          <span
            className={cn(
              "max-w-40 truncate text-muted-foreground sm:max-w-52",
              isLastAncestor ? undefined : "hidden sm:inline",
            )}
          >
            {item.label}
          </span>
        ) : (
          <Link
            {...(item.issuesSpaceId !== undefined
              ? {
                  to: "/spaces/$spaceId/issues" as const,
                  params: { spaceId: item.issuesSpaceId },
                }
              : item.nodeId === undefined
                ? {
                    to: "/spaces/$spaceId/settings" as const,
                    params: { spaceId: item.settingsSpaceId! },
                  }
                : { to: "/nodes/$nodeId" as const, params: { nodeId: item.nodeId } })}
            search={{}}
            className={cn(
              breadcrumbLinkClass,
              "max-w-40 truncate sm:max-w-52",
              isLastAncestor ? undefined : "hidden sm:inline",
            )}
          >
            {item.label}
          </Link>
        )}
      </li>,
    );
  }
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="m-0 flex min-w-0 list-none items-center gap-2 p-0">
        <li className="flex min-w-0 items-center gap-2">
          <Link
            to="/home"
            aria-label="OfficeLab"
            className="flex min-w-0 shrink-0 items-center gap-2.5 rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <BrandMark />
            {spaceId === undefined ? (
              <span className="hidden font-semibold tracking-tight sm:inline">OfficeLab</span>
            ) : null}
          </Link>
        </li>
        {ancestorItems}
        {current !== undefined ? (
          <li className="flex min-w-0 items-center gap-2">
            <BreadcrumbSeparator className={undefined} />
            <CurrentHeading className="m-0 min-w-0 truncate text-sm font-semibold">{current}</CurrentHeading>
          </li>
        ) : null}
      </ol>
    </nav>
  );
}

const breadcrumbLinkClass =
  "min-w-0 shrink-0 truncate text-muted-foreground no-underline outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/40 rounded-sm";

export function RepositoryShell({
  children,
  selectedSpaceId,
  repositoryTab,
  repositoryHome = false,
  repositoryBreadcrumbs,
  selectedView,
  contentMode = "default",
  immersive = false,
  headerTitle,
  headerContent,
  headerActions,
}: WorkspaceShellProps) {
  const session = useQuery(sessionQueryOptions);
  const spaces = useQuery(spacesQueryOptions);
  // 保留现有后台查询与变更订阅，避免外壳拆分改变请求行为。
  useQuery({
    ...worktreeListQueryOptions("active"),
    enabled: session.data?.authenticated === true,
  });
  useWorktreeChangeFeed(session.data?.authenticated === true);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const navigationSidebar = useResizableSidebar({
    storageKey: "workspace-navigation-sidebar",
    defaultWidth: 248,
    minWidth: 192,
    maxWidth: 340,
  });
  const compactViewport = useMediaQuery("(max-width: 720px)");
  const navigationCollapsed = navigationSidebar.collapsed || compactViewport;
  const location = useLocation();
  const [navDrawerOpen, setNavDrawerOpen] = useState(false);
  // Close the compact navigation drawer after every navigation.
  useEffect(() => {
    setNavDrawerOpen(false);
  }, [location.href]);

  // Derived before the loading guards below so the document title effect runs on
  // every render rather than after a conditional return.
  const username = session.data?.authenticated ? session.data.user.username : undefined;
  const allSpaces = spaces.data?.spaces ?? [];
  const selectedSpace = allSpaces.find((space) => space.id === selectedSpaceId);
  const spaceTitle = selectedSpace?.type === "personal" ? t("personalSpace") : selectedSpace?.name;
  const repositorySpaceName = spaceDisplayName(selectedSpace, t, username) ?? spaceTitle;
  // 保留 R7 半外壳：apps、无空间的 worktrees 和文件编辑器沿用现有外壳。
  const repositoryShell =
    !immersive &&
    (repositoryHome || repositoryTab !== undefined || (selectedSpaceId !== undefined && selectedView === undefined));
  useEffect(() => {
    if (!repositoryShell) return;
    const previous = document.title;
    document.title = `${repositorySpaceName ?? t("repositories")} · OfficeLab`;
    return () => {
      document.title = previous;
    };
  }, [repositoryShell, repositorySpaceName, t]);

  const logout = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST("/api/auth/logout");
      if (error) throw apiError(error);
    },
    onSuccess: async () => {
      // Permissions and content cached for this User must not become visitor data.
      queryClient.clear();
      queryClient.setQueryData(sessionQueryKey, {
        authenticated: false,
        githubOAuthEnabled: currentSession.githubOAuthEnabled,
        discordOAuthEnabled: currentSession.discordOAuthEnabled,
        passwordAuthEnabled: currentSession.passwordAuthEnabled,
      });
      await navigate({
        to: "/login",
        search: { oauthError: undefined, returnTo: undefined },
        replace: true,
      });
    },
  });

  if (session.isPending || spaces.isPending) {
    return <LoadingScreen />;
  }
  if (!session.data?.authenticated) {
    return <Navigate to="/login" search={{ oauthError: undefined, returnTo: undefined }} replace />;
  }
  if (session.error) throw session.error;
  if (spaces.error) throw spaces.error;

  const currentSession = session.data;
  const personalSpaces = allSpaces.filter((space) => space.type === "personal" && space.accessRole === "owner");
  const teamSpaces = allSpaces.filter((space) => space.type === "team");
  const pageTitle = repositoryShell
    ? typeof headerTitle === "string"
      ? `${spaceTitle ?? t("repositories")} · ${headerTitle}`
      : (spaceTitle ?? t("repositories"))
    : (headerTitle ?? spaceTitle ?? workspaceViewTitle(selectedView, t));
  const renderNavigation = (collapsed: boolean) => (
    <>
      <NavLink
        to="/home"
        selected={selectedView === "home"}
        collapsed={collapsed}
        icon={<House />}
        label={t("repositories")}
      />
      {!collapsed && <p className="px-3 py-2 text-xs text-muted-foreground">{t("repositoryTheme")}</p>}
      {[...personalSpaces, ...teamSpaces].map((space) => (
        <NavLink
          key={space.id}
          to="/spaces/$spaceId"
          params={{ spaceId: space.id }}
          selected={space.id === selectedSpaceId}
          collapsed={collapsed}
          icon={<Users />}
          label={spaceDisplayName(space, t, username) ?? space.name}
        />
      ))}
    </>
  );

  return (
    <>
      <div className="workspace-shell flex h-dvh overflow-hidden bg-background">
        {/* ---------------------------------------------------------- */}
        {/* Sidebar                                                    */}
        {/* ---------------------------------------------------------- */}
        {compactViewport || repositoryShell ? null : (
          <aside
            style={{
              width: navigationCollapsed ? 64 : navigationSidebar.width,
              display: immersive ? "none" : undefined,
            }}
            className="flex min-w-0 shrink-0 flex-col overflow-hidden border-r border-border bg-surface transition-[width] duration-150"
          >
            <div
              className={cn(
                "flex h-16 shrink-0 items-center",
                navigationCollapsed ? "justify-center px-2" : "justify-between pr-2 pl-4.5",
              )}
            >
              {navigationCollapsed ? null : (
                <Link
                  to="/home"
                  className="flex min-w-0 items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <BrandMark />
                  <span className="truncate text-[15px] font-bold tracking-tight text-foreground">
                    Univer Workspace
                  </span>
                </Link>
              )}
              <Tooltip
                side="right"
                content={navigationSidebar.collapsed ? t("expandNavigation") : t("collapseNavigation")}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={navigationSidebar.collapsed ? t("expandNavigation") : t("collapseNavigation")}
                  onClick={navigationSidebar.toggleCollapsed}
                >
                  {navigationSidebar.collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
                </Button>
              </Tooltip>
            </div>

            <nav
              aria-label={t("mainNavigation")}
              className={cn(
                "mt-3 min-w-0 flex-1 overflow-x-hidden overflow-y-auto",
                navigationCollapsed ? "px-2.5" : "px-3",
              )}
            >
              {renderNavigation(navigationCollapsed)}
            </nav>
          </aside>
        )}

        {!immersive && !repositoryShell && !navigationCollapsed ? (
          <SidebarResizeHandle
            value={navigationSidebar.width}
            min={192}
            max={340}
            label={t("resizeNavigation")}
            onChange={navigationSidebar.setWidth}
          />
        ) : null}

        {/* ---------------------------------------------------------- */}
        {/* Main                                                       */}
        {/* ---------------------------------------------------------- */}
        <div className="flex min-w-0 flex-1 flex-col bg-background">
          <header
            style={{ display: immersive ? "none" : undefined }}
            className={cn(
              "flex shrink-0 items-center justify-between gap-4 border-b border-border pr-4.5 pl-6 max-[720px]:px-3",
              repositoryShell ? "repository-chrome h-14 border-b-0 bg-surface px-4" : "h-15",
            )}
          >
            <div className="flex min-w-0 flex-1 items-center gap-1">
              {compactViewport && !repositoryShell ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  aria-label={t("openNavigation")}
                  onClick={() => setNavDrawerOpen(true)}
                >
                  <Menu />
                </Button>
              ) : null}
              {repositoryShell ? (
                <RepositoryBreadcrumbs
                  spaceId={selectedSpaceId}
                  spaceName={repositorySpaceName ?? t("repositories")}
                  space={selectedSpace}
                  breadcrumbs={repositoryBreadcrumbs}
                  current={headerTitle}
                />
              ) : (
                <h1 className="m-0 min-w-0 truncate text-[18px] font-semibold tracking-tight max-[720px]:text-[15px]">
                  {pageTitle}
                </h1>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {headerContent}
              {headerActions}
              <Tooltip content={t("issues")}>
                <Link
                  to="/issues"
                  search={{}}
                  aria-label={t("issues")}
                  className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "no-underline")}
                >
                  <CircleDot />
                </Link>
              </Tooltip>
              {workspaceHarnessOrigin() ? (
                <Tooltip content={t("openChat")}>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("openChat")}
                    onClick={() => {
                      const origin = workspaceHarnessOrigin();
                      if (origin !== undefined) window.open(origin, "_blank", "noopener,noreferrer");
                    }}
                  >
                    <MessageCircle />
                  </Button>
                </Tooltip>
              ) : null}
              <AccountMenu
                currentSession={currentSession}
                onProfile={() => setProfileDialogOpen(true)}
                onPassword={() => setPasswordDialogOpen(true)}
                logoutPending={logout.isPending}
                onLogout={() => logout.mutate()}
                extraItems={
                  <MenuItem onClick={() => setAppSettingsOpen(true)}>
                    <Settings />
                    {t("appSettings")}
                  </MenuItem>
                }
              />
            </div>
          </header>
          <main
            className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", contentMode === "editor" && "bg-background")}
          >
            {children}
          </main>
        </div>
      </div>

      {compactViewport && !repositoryShell ? (
        <Drawer open={navDrawerOpen} onOpenChange={setNavDrawerOpen} label={t("mainNavigation")}>
          <div className="flex h-16 shrink-0 items-center justify-between pr-2 pl-4.5">
            <Link
              to="/home"
              className="flex min-w-0 items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <BrandMark />
              <span className="truncate text-[15px] font-bold tracking-tight text-foreground">Univer Workspace</span>
            </Link>
            <Button variant="ghost" size="icon" aria-label={t("close")} onClick={() => setNavDrawerOpen(false)}>
              <X />
            </Button>
          </div>
          <nav aria-label={t("mainNavigation")} className="mt-3 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3">
            {renderNavigation(false)}
          </nav>
        </Drawer>
      ) : null}

      <ProfileDialog open={profileDialogOpen} onOpenChange={setProfileDialogOpen} />

      <PasswordDialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen} />

      {currentSession.trialDeployment ? <TrialNoticeDialog userId={currentSession.user.id} /> : null}

      <AppSettingsDialog open={appSettingsOpen} onOpenChange={setAppSettingsOpen} layoutSettings={<ModeSettings />} />
    </>
  );
}

function workspaceViewTitle(view: WorkspaceView | undefined, t: (key: MessageKey) => string): string {
  if (view === "home") return t("home");
  if (view === "apps") return t("apps");
  if (view === "worktrees") return t("workbench");
  if (view === "trash") return t("trash");
  if (view === "members") return t("members");
  if (view === "issues") return t("issues");
  return t("home");
}
