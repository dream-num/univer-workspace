import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useLocation, useNavigate } from "@tanstack/react-router";
import {
  Bot,
  CircleDot,
  House,
  LayoutGrid,
  Menu,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Trash2,
  User,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { sessionQueryKey, sessionQueryOptions } from "../../features/auth";
import { AppsSidebarSection } from "../../features/html-views/apps-sidebar";
import { IssuesSidebarSection } from "../../features/issues";
import { spacesQueryOptions } from "../../features/spaces";
import { WorkspaceNavigationTree } from "../../features/nodes";
import { isOpenWorktree, useWorktreeChangeFeed, worktreeListQueryOptions } from "../../features/worktrees";
import { api } from "../../shared/api/client";
import { workspaceHarnessOrigin } from "../../shared/app-links";
import { apiError } from "../../shared/api/errors";
import { useI18n, type MessageKey } from "../../shared/i18n";
import { ModeSettings } from "../mode-settings";
import { SidebarResizeHandle, useMediaQuery, useResizableSidebar } from "../../shared/resizable-sidebar";
import { Button, Drawer, LoadingScreen, Tooltip } from "../../shared/ui";
import { cn } from "../../shared/utils/cn";
import {
  AccountMenu,
  AppSettingsDialog,
  ProfileDialog,
  PasswordDialog,
  TrialNoticeDialog,
} from "../../features/account";
import { BrandMark, NavLink } from "../../features/shell";
import { CreateTeamDialog } from "../../features/spaces";
import type { WorkspaceShellProps, WorkspaceView } from "../shell.types";

export function WikiShell({
  children,
  selectedSpaceId,
  selectedView,
  contentMode = "default",
  immersive = false,
  headerTitle,
  headerContent,
  headerActions,
  selectedNodeId,
  selectedNodePath,
}: WorkspaceShellProps) {
  const session = useQuery(sessionQueryOptions);
  const spaces = useQuery(spacesQueryOptions);
  const activeWorktrees = useQuery({
    ...worktreeListQueryOptions("active"),
    enabled: session.data?.authenticated === true,
  });
  useWorktreeChangeFeed(session.data?.authenticated === true);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
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

  const allSpaces = spaces.data?.spaces ?? [];
  const selectedSpace = allSpaces.find((space) => space.id === selectedSpaceId);
  const spaceTitle = selectedSpace?.type === "personal" ? t("personalSpace") : selectedSpace?.name;
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
  const personalSpace = personalSpaces[0];
  const teamSpaces = allSpaces.filter((space) => space.type === "team");
  const trashSpaceId = selectedSpaceId ?? personalSpaces[0]?.id;
  const pageTitle = headerTitle ?? spaceTitle ?? workspaceViewTitle(selectedView, t);
  const activeTaskCount = activeWorktrees.data?.items.filter((worktree) => isOpenWorktree(worktree.state)).length ?? 0;

  const renderNavigation = (collapsed: boolean) => (
    <>
      <div className="grid gap-0.5">
        <NavLink
          to="/home"
          selected={selectedView === "home"}
          collapsed={collapsed}
          icon={<House />}
          label={t("home")}
        />
        <NavLink
          to="/worktrees"
          selected={selectedView === "worktrees"}
          collapsed={collapsed}
          icon={<Bot />}
          label={t("workbench")}
          badge={activeTaskCount}
          badgeTitle={t("activeTaskCount", {
            count: activeTaskCount,
          })}
        />
        {collapsed && personalSpace ? (
          <NavLink
            to="/spaces/$spaceId"
            params={{ spaceId: personalSpace.id }}
            selected={personalSpace.id === selectedSpaceId}
            collapsed={collapsed}
            icon={<User />}
            label={t("personalSpace")}
          />
        ) : null}
      </div>

      {collapsed ? (
        <div className="mt-5 grid gap-0.5">
          <div className="flex justify-center py-1">
            <Tooltip side="right" content={t("createTeamSpace")}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("createTeamSpace")}
                onClick={() => setTeamDialogOpen(true)}
              >
                <Plus />
              </Button>
            </Tooltip>
          </div>
          {teamSpaces.map((space) => (
            <NavLink
              key={space.id}
              to="/spaces/$spaceId"
              params={{ spaceId: space.id }}
              selected={space.id === selectedSpaceId}
              collapsed
              icon={<Users />}
              label={space.name}
            />
          ))}
          <NavLink to="/apps" selected={selectedView === "apps"} collapsed icon={<LayoutGrid />} label={t("apps")} />
          <NavLink
            to="/issues"
            selected={selectedView === "issues"}
            collapsed
            icon={<CircleDot />}
            label={t("issues")}
          />
        </div>
      ) : (
        <>
          <WorkspaceNavigationTree
            personalSpace={personalSpace}
            teamSpaces={teamSpaces}
            selectedSpaceId={selectedSpaceId}
            selectedNodeId={selectedNodeId}
            selectedNodePath={selectedNodePath}
            storageScope={currentSession.user.id}
          />
          <AppsSidebarSection storageScope={currentSession.user.id} />
          <IssuesSidebarSection storageScope={currentSession.user.id} />
        </>
      )}

      {trashSpaceId ? (
        <div className="mt-4 grid gap-0.5 border-t border-border pt-3.5">
          <NavLink
            to="/spaces/$spaceId/trash"
            params={{ spaceId: trashSpaceId }}
            selected={selectedView === "trash"}
            collapsed={collapsed}
            icon={<Trash2 />}
            label={t("trash")}
          />
        </div>
      ) : null}
    </>
  );

  return (
    <>
      <div className="workspace-shell flex h-dvh overflow-hidden bg-background">
        {/* ---------------------------------------------------------- */}
        {/* Sidebar                                                    */}
        {/* ---------------------------------------------------------- */}
        {compactViewport ? null : (
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

        {!immersive && !navigationCollapsed ? (
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
              "h-15",
            )}
          >
            <div className="flex min-w-0 flex-1 items-center gap-1">
              {compactViewport ? (
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
              <h1 className="m-0 min-w-0 truncate text-[18px] font-semibold tracking-tight max-[720px]:text-[15px]">
                {pageTitle}
              </h1>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {headerContent}
              {headerActions}
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
              <Tooltip content={t("appSettings")}>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("appSettings")}
                  onClick={() => setAppSettingsOpen(true)}
                >
                  <Settings />
                </Button>
              </Tooltip>
              <AccountMenu
                currentSession={currentSession}
                onProfile={() => setProfileDialogOpen(true)}
                onPassword={() => setPasswordDialogOpen(true)}
                logoutPending={logout.isPending}
                onLogout={() => logout.mutate()}
                extraItems={null}
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

      {compactViewport ? (
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

      <CreateTeamDialog
        open={teamDialogOpen}
        onOpenChange={setTeamDialogOpen}
        onCreated={async (space) => {
          await navigate({
            to: "/spaces/$spaceId",
            params: { spaceId: space.id },
          });
        }}
      />

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
