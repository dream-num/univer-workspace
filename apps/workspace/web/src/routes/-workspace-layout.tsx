import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useNavigate } from "@tanstack/react-router";
import { UniverCliIcon } from "@univerjs/icons";
import {
  Bot,
  ChevronDown,
  House,
  Lock,
  LogOut,
  MessageCircle,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  Sun,
  Trash2,
  User,
  Users,
  X,
} from "lucide-react";
import {
  useEffect,
  useState,
  type FormEvent,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import { sessionQueryKey, sessionQueryOptions } from "../features/auth";
import { spacesQueryKey, spacesQueryOptions } from "../features/spaces";
import { WorkspaceNavigationTree } from "../features/nodes";
import {
  useWorktreeChangeFeed,
  worktreeListQueryOptions,
} from "../features/worktrees";
import { api } from "../shared/api/client";
import { workspaceHarnessOrigin } from "../shared/app-links";
import { apiError } from "../shared/api/errors";
import { useI18n, type MessageKey } from "../shared/i18n";
import { useTheme } from "../shared/theme";
import {
  SidebarResizeHandle,
  useMediaQuery,
  useResizableSidebar,
} from "../shared/resizable-sidebar";
import {
  Avatar,
  Button,
  Dialog,
  DialogClose,
  DiscordIcon,
  Field,
  GitHubIcon,
  Input,
  LoadingScreen,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
  PasswordInput,
  Segmented,
  Separator,
  Tooltip,
  toast,
} from "../shared/ui";
import { cn } from "../shared/utils/cn";

type WorkspaceView =
  | "home"
  | "trash"
  | "worktrees"
  | "members";

export function WorkspaceHeaderSearch({
  value,
  placeholder,
  onChange,
}: {
  readonly value: string;
  readonly placeholder: string;
  readonly onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Tooltip content={placeholder}>
        <Button
          variant="ghost"
          size="icon"
          aria-label={placeholder}
          onClick={() => setOpen(true)}
        >
          <Search />
        </Button>
      </Tooltip>
    );
  }
  return (
    <div className="flex w-[min(320px,45vw)] min-w-44 items-center gap-1 max-[720px]:w-[min(260px,calc(100vw-132px))]">
      <div className="relative min-w-0 flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle-foreground"
          aria-hidden="true"
        />
        <Input
          autoFocus
          aria-label={placeholder}
          className="h-9 rounded-full border-transparent bg-muted pl-9 shadow-none hover:bg-accent focus:border-ring focus:bg-background"
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
        />
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("close")}
        onClick={() => {
          onChange("");
          setOpen(false);
        }}
      >
        <X />
      </Button>
    </div>
  );
}

export function WorkspaceLayout({
  children,
  selectedSpaceId,
  selectedView,
  contentMode = "default",
  headerTitle,
  headerContent,
  headerActions,
  selectedNodeId,
  selectedNodePath,
}: PropsWithChildren<{
  readonly selectedSpaceId?: string;
  readonly selectedNodeId?: string;
  readonly selectedNodePath?: readonly string[];
  readonly selectedView?: WorkspaceView;
  readonly contentMode?: "default" | "editor";
  readonly headerTitle?: ReactNode;
  readonly headerContent?: ReactNode;
  readonly headerActions?: ReactNode;
}>) {
  const session = useQuery(sessionQueryOptions);
  const spaces = useQuery(spacesQueryOptions);
  const activeWorktrees = useQuery({
    ...worktreeListQueryOptions("active"),
    enabled: session.data?.authenticated === true,
  });
  useWorktreeChangeFeed(session.data?.authenticated === true);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { language, setLanguage, t } = useI18n();
  const { theme, setTheme } = useTheme();
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

  const logout = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST("/api/auth/logout");
      if (error) throw apiError(error);
    },
    onSuccess: async () => {
      queryClient.setQueryData(sessionQueryKey, {
        authenticated: false,
        githubOAuthEnabled: currentSession.githubOAuthEnabled,
        discordOAuthEnabled: currentSession.discordOAuthEnabled,
      });
      queryClient.removeQueries({ queryKey: spacesQueryKey });
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
    return (
      <Navigate
        to="/login"
        search={{ oauthError: undefined, returnTo: undefined }}
        replace
      />
    );
  }
  if (session.error) throw session.error;
  if (spaces.error) throw spaces.error;

  const currentSession = session.data;
  const allSpaces = spaces.data?.spaces ?? [];
  const selectedSpace = allSpaces.find(
    (space) => space.id === selectedSpaceId
  );
  const personalSpaces = allSpaces.filter(
    (space) => space.type === "personal" && space.accessRole === "owner"
  );
  const personalSpace = personalSpaces[0];
  const teamSpaces = allSpaces.filter((space) => space.type === "team");
  const trashSpaceId = selectedSpaceId ?? personalSpaces[0]?.id;
  const pageTitle =
    headerTitle ??
    (selectedSpace?.type === "personal"
      ? t("personalSpace")
      : selectedSpace?.name) ??
    workspaceViewTitle(selectedView, t);
  const activeTaskCount =
    activeWorktrees.data?.items.filter((worktree) =>
      ["draft", "ready", "merging"].includes(worktree.state)
    ).length ?? 0;

  return (
    <>
      <div className="flex h-dvh overflow-hidden bg-background">
        {/* ---------------------------------------------------------- */}
        {/* Sidebar                                                    */}
        {/* ---------------------------------------------------------- */}
        <aside
          style={{ width: navigationCollapsed ? 64 : navigationSidebar.width }}
          className="flex min-w-0 shrink-0 flex-col overflow-hidden border-r border-border bg-surface transition-[width] duration-150"
        >
          <div
            className={cn(
              "flex h-16 shrink-0 items-center",
              navigationCollapsed
                ? "justify-center px-2"
                : "justify-between pr-2 pl-4.5"
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
            {!compactViewport ? (
              <Tooltip
                side="right"
                content={
                  navigationSidebar.collapsed
                    ? t("expandNavigation")
                    : t("collapseNavigation")
                }
              >
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={
                    navigationSidebar.collapsed
                      ? t("expandNavigation")
                      : t("collapseNavigation")
                  }
                  onClick={navigationSidebar.toggleCollapsed}
                >
                  {navigationSidebar.collapsed ? (
                    <PanelLeftOpen />
                  ) : (
                    <PanelLeftClose />
                  )}
                </Button>
              </Tooltip>
            ) : null}
          </div>

          <nav
            aria-label={language === "zh-CN" ? "主导航" : "Main navigation"}
            className={cn(
              "mt-3 min-w-0 flex-1 overflow-x-hidden overflow-y-auto",
              navigationCollapsed ? "px-2.5" : "px-3"
            )}
          >
            <div className="grid gap-0.5">
              <NavLink
                to="/home"
                selected={selectedView === "home"}
                collapsed={navigationCollapsed}
                icon={<House />}
                label={t("home")}
              />
              <NavLink
                to="/worktrees"
                selected={selectedView === "worktrees"}
                collapsed={navigationCollapsed}
                icon={<Bot />}
                label={t("workbench")}
                badge={activeTaskCount}
                badgeTitle={t("activeTaskCount", {
                  count: activeTaskCount,
                })}
              />
              {navigationCollapsed && personalSpace ? (
                <NavLink
                  to="/spaces/$spaceId"
                  params={{ spaceId: personalSpace.id }}
                  selected={personalSpace.id === selectedSpaceId}
                  collapsed={navigationCollapsed}
                  icon={<User />}
                  label={t("personalSpace")}
                />
              ) : null}
            </div>

            {navigationCollapsed ? (
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
              </div>
            ) : (
              <WorkspaceNavigationTree
                personalSpace={personalSpace}
                teamSpaces={teamSpaces}
                selectedSpaceId={selectedSpaceId}
                selectedNodeId={selectedNodeId}
                selectedNodePath={selectedNodePath}
                storageScope={currentSession.user.id}
                onCreateTeamSpace={() => setTeamDialogOpen(true)}
              />
            )}

            {trashSpaceId ? (
              <div className="mt-4 grid gap-0.5 border-t border-border pt-3.5">
                <NavLink
                  to="/spaces/$spaceId/trash"
                  params={{ spaceId: trashSpaceId }}
                  selected={selectedView === "trash"}
                  collapsed={navigationCollapsed}
                  icon={<Trash2 />}
                  label={t("trash")}
                />
              </div>
            ) : null}
          </nav>

          {navigationCollapsed ? null : (
            <footer className="shrink-0 border-t border-border px-4.5 py-3.5 text-xs text-subtle-foreground">
              {t("collaborationExample")}
            </footer>
          )}
        </aside>

        {!navigationCollapsed ? (
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
          <header className="flex h-15 shrink-0 items-center justify-between gap-4 border-b border-border pr-4.5 pl-6 max-[720px]:px-3">
            <div className="min-w-0 flex-1">
              <h1 className="m-0 truncate text-[18px] font-semibold tracking-tight max-[720px]:hidden">
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
              <MenuRoot>
                <MenuTrigger
                  aria-label={t("account")}
                  render={
                    <button
                      type="button"
                      className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full py-1 pr-2 pl-1 transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40"
                    >
                      <Avatar
                        src={currentSession.user.avatarUrl}
                        name={currentSession.user.displayName}
                      />
                      <ChevronDown className="size-3 text-subtle-foreground" />
                    </button>
                  }
                />
                <MenuContent align="end" className="w-56">
                  <div className="grid gap-0.5 px-2.5 py-2">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {currentSession.user.displayName}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      @{currentSession.user.username}
                    </span>
                  </div>
                  <MenuSeparator />
                  <MenuGroup>
                    <MenuItem onClick={() => setProfileDialogOpen(true)}>
                      <User />
                      {t("profile")}
                    </MenuItem>
                    {currentSession.authenticationMethods.password ? (
                      <MenuItem onClick={() => setPasswordDialogOpen(true)}>
                        <Lock />
                        {t("changePassword")}
                      </MenuItem>
                    ) : null}
                  </MenuGroup>
                  <MenuSeparator />
                  <MenuItem
                    className="text-destructive data-highlighted:bg-destructive-soft data-highlighted:text-destructive [&_svg]:text-destructive"
                    disabled={logout.isPending}
                    onClick={() => logout.mutate()}
                  >
                    <LogOut />
                    {t("signOut")}
                  </MenuItem>
                </MenuContent>
              </MenuRoot>
            </div>
          </header>
          <main
            className={cn(
              "flex min-h-0 flex-1 flex-col overflow-hidden",
              contentMode === "editor" && "bg-background"
            )}
          >
            {children}
          </main>
        </div>
      </div>

      <CreateTeamDialog
        open={teamDialogOpen}
        onOpenChange={setTeamDialogOpen}
        onCreated={async (space) => {
          await queryClient.invalidateQueries({ queryKey: spacesQueryKey });
          await navigate({
            to: "/spaces/$spaceId",
            params: { spaceId: space.id },
          });
        }}
      />

      <ProfileDialog
        open={profileDialogOpen}
        onOpenChange={setProfileDialogOpen}
      />

      <PasswordDialog
        open={passwordDialogOpen}
        onOpenChange={setPasswordDialogOpen}
      />

      <Dialog
        open={appSettingsOpen}
        onOpenChange={setAppSettingsOpen}
        title={t("appSettings")}
        width="sm"
      >
        <div className="-my-1 divide-y divide-border">
          <div className="flex items-center justify-between gap-4 py-3.5 max-[440px]:flex-col max-[440px]:items-start max-[440px]:gap-2.5">
            <span className="text-sm font-medium">{t("language")}</span>
            <Segmented
              aria-label={t("language")}
              size="sm"
              value={language}
              onValueChange={setLanguage}
              options={[
                { label: t("chinese"), value: "zh-CN" },
                { label: t("english"), value: "en-US" },
              ]}
            />
          </div>
          <div className="flex items-center justify-between gap-4 py-3.5 max-[440px]:flex-col max-[440px]:items-start max-[440px]:gap-2.5">
            <span className="text-sm font-medium">{t("theme")}</span>
            <Segmented
              aria-label={t("theme")}
              size="sm"
              value={theme}
              onValueChange={setTheme}
              options={[
                {
                  label: (
                    <>
                      <Sun />
                      {t("themeLight")}
                    </>
                  ),
                  value: "light",
                },
                {
                  label: (
                    <>
                      <Moon />
                      {t("themeDark")}
                    </>
                  ),
                  value: "dark",
                },
                {
                  label: (
                    <>
                      <Monitor />
                      {t("themeSystem")}
                    </>
                  ),
                  value: "system",
                },
              ]}
            />
          </div>
        </div>
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Brand                                                               */
/* ------------------------------------------------------------------ */

function BrandMark() {
  return (
    <UniverCliIcon
      aria-hidden="true"
      className="size-6 shrink-0 text-foreground"
    />
  );
}

/* ------------------------------------------------------------------ */
/* Navigation link                                                     */
/* ------------------------------------------------------------------ */

function NavLink({
  to,
  params,
  selected,
  collapsed,
  icon,
  label,
  badge,
  badgeTitle,
}: {
  readonly to: string;
  readonly params?: Record<string, string>;
  readonly selected: boolean;
  readonly collapsed: boolean;
  readonly icon: ReactNode;
  readonly label: string;
  readonly badge?: number;
  readonly badgeTitle?: string;
}) {
  const link = (
    <Link
      to={to}
      {...(params ? { params } : {})}
      title={collapsed ? label : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-md text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        collapsed ? "h-10 justify-center px-0" : "h-9 px-2.5",
        selected
          ? "bg-brand-50 font-medium text-brand-700"
          : "text-secondary-foreground hover:bg-accent hover:text-accent-foreground",
        "[&_svg]:size-4 [&_svg]:shrink-0",
        selected ? "[&_svg]:text-brand-600" : "[&_svg]:text-muted-foreground"
      )}
    >
      {icon}
      {collapsed ? null : (
        <span className="min-w-0 flex-1 truncate">{label}</span>
      )}
      {!collapsed && badge !== undefined && badge > 0 ? (
        <span
          title={badgeTitle}
          className="grid h-4.5 min-w-4.5 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold text-white"
        >
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </Link>
  );
  if (collapsed) {
    return (
      <Tooltip side="right" content={label}>
        {link}
      </Tooltip>
    );
  }
  return link;
}

/* ------------------------------------------------------------------ */
/* Dialogs                                                             */
/* ------------------------------------------------------------------ */

function CreateTeamDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreated: (space: { readonly id: string }) => Promise<void>;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [publicRead, setPublicRead] = useState(false);
  const [error, setError] = useState<string>();
  const createTeam = useMutation({
    mutationFn: async (values: {
      readonly name: string;
      readonly publicRead: boolean;
    }) => {
      const { data, error: apiErr } = await api.POST("/api/team-spaces", {
        body: values,
      });
      if (apiErr) throw apiError(apiErr);
      return data;
    },
    onSuccess: async (space) => {
      onOpenChange(false);
      setName("");
      setPublicRead(false);
      await onCreated(space);
    },
    onError: (mutationError) => {
      toast.error(
        mutationError instanceof Error
          ? mutationError.message
          : "Space creation failed."
      );
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError(t("enterSpaceName"));
      return;
    }
    createTeam.mutate({ name: name.trim(), publicRead });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setError(undefined);
        onOpenChange(next);
      }}
      title={t("createTeamSpace")}
      footer={
        <>
          <DialogClose render={<Button variant="secondary">{t("cancel")}</Button>} />
          <Button onClick={submit} disabled={createTeam.isPending}>
            {createTeam.isPending ? "…" : t("create")}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} id="create-team-form">
        <Field label={t("spaceName")} htmlFor="team-space-name" error={error}>
          <Input
            id="team-space-name"
            autoFocus
            maxLength={100}
            value={name}
            invalid={Boolean(error)}
            onChange={(event) => {
              setError(undefined);
              setName(event.target.value);
            }}
          />
        </Field>
        <label className="mt-4 flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-border p-4">
          <span className="grid gap-1">
            <span className="text-sm font-medium text-foreground">
              {t("publicRead")}
            </span>
            <span className="text-sm text-subtle-foreground">
              {t("publicReadDescription")}
            </span>
          </span>
          <input
            className="mt-0.5 size-4 accent-primary"
            type="checkbox"
            checked={publicRead}
            onChange={(event) => setPublicRead(event.target.checked)}
          />
        </label>
      </form>
    </Dialog>
  );
}

function ProfileDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const session = useQuery(sessionQueryOptions);
  const current = session.data?.authenticated ? session.data : null;
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");

  useEffect(() => {
    if (!open || !current) return;
    setUsername(current.user.username);
    setDisplayName(current.user.displayName);
    setAvatarUrl(current.user.avatarUrl ?? "");
  }, [current, open]);

  const unlinkGitHub = useMutation({
    mutationFn: async () => {
      const { data, error: apiErr } = await api.DELETE("/api/auth/github");
      if (apiErr) throw apiError(apiErr);
      return data;
    },
    onSuccess: (updatedSession) => {
      queryClient.setQueryData(sessionQueryKey, updatedSession);
      toast.success(t("githubUnlinked"));
    },
    onError: (mutationError) => toast.error(mutationError.message),
  });
  const unlinkDiscord = useMutation({
    mutationFn: async () => {
      const { data, error: apiErr } = await api.DELETE("/api/auth/discord");
      if (apiErr) throw apiError(apiErr);
      return data;
    },
    onSuccess: (updatedSession) => {
      queryClient.setQueryData(sessionQueryKey, updatedSession);
      toast.success(t("discordUnlinked"));
    },
    onError: (mutationError) => toast.error(mutationError.message),
  });
  const updateProfile = useMutation({
    mutationFn: async (values: {
      readonly username: string;
      readonly displayName: string;
      readonly avatarUrl?: string;
    }) => {
      const { data, error: apiErr } = await api.PATCH("/api/users/me", {
        body: {
          username: values.username,
          displayName: values.displayName,
          avatarUrl: values.avatarUrl || null,
        },
      });
      if (apiErr) throw apiError(apiErr);
      return data;
    },
    onSuccess: async (user) => {
      queryClient.setQueryData(
        sessionQueryKey,
        session.data?.authenticated
          ? { ...session.data, user }
          : session.data
      );
      onOpenChange(false);
      toast.success(t("profileUpdated"));
    },
    onError: (mutationError) => toast.error(mutationError.message),
  });

  if (!current) return null;
  const githubLinked =
    current.authenticationMethods.externalIdentities.some(
      (identity) => identity.provider === "github"
    );
  const discordLinked =
    current.authenticationMethods.externalIdentities.some(
      (identity) => identity.provider === "discord"
    );
  const canUnlinkExternalIdentity =
    current.authenticationMethods.password ||
    current.authenticationMethods.externalIdentities.length > 1;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !displayName.trim()) return;
    updateProfile.mutate({
      username: username.trim(),
      displayName: displayName.trim(),
      ...(avatarUrl.trim() ? { avatarUrl: avatarUrl.trim() } : {}),
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("profileAndSignIn")}
      width="lg"
      footer={
        <>
          <DialogClose render={<Button variant="secondary">{t("cancel")}</Button>} />
          <Button onClick={submit} disabled={updateProfile.isPending}>
            {t("save")}
          </Button>
        </>
      }
    >
      <form
        onSubmit={submit}
        className="grid gap-4"
        id="profile-form"
      >
        <Field label={t("username")} htmlFor="profile-username" required>
          <Input
            id="profile-username"
            maxLength={64}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </Field>
        <Field label={t("displayName")} htmlFor="profile-display-name" required>
          <Input
            id="profile-display-name"
            maxLength={100}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </Field>
        <Field label={t("avatarUrl")} htmlFor="profile-avatar-url">
          <Input
            id="profile-avatar-url"
            type="url"
            value={avatarUrl}
            onChange={(event) => setAvatarUrl(event.target.value)}
          />
        </Field>
      </form>
      {current.githubOAuthEnabled ? (
        <>
          <Separator className="my-5" />
          <h3 className="m-0 mb-3 flex items-center gap-2 text-sm font-semibold">
            <GitHubIcon className="size-4" />
            GitHub
          </h3>
          {githubLinked ? (
            <Button
              variant="destructive-ghost"
              className="border border-destructive/30"
              disabled={
                !canUnlinkExternalIdentity || unlinkGitHub.isPending
              }
              onClick={() => unlinkGitHub.mutate()}
            >
              <GitHubIcon />
              {t("unlinkGitHub")}
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={() => {
                window.location.href = "/api/auth/github/link?returnTo=/";
              }}
            >
              <GitHubIcon />
              {t("linkGitHub")}
            </Button>
          )}
          {!canUnlinkExternalIdentity && githubLinked ? (
            <p className="mt-2 text-[13px] text-muted-foreground">
              {t("githubOnlyMethod")}
            </p>
          ) : null}
        </>
      ) : null}
      {current.discordOAuthEnabled ? (
        <>
          <Separator className="my-5" />
          <h3 className="m-0 mb-3 flex items-center gap-2 text-sm font-semibold">
            <DiscordIcon className="size-4" />
            Discord
          </h3>
          {discordLinked ? (
            <Button
              variant="destructive-ghost"
              className="border border-destructive/30"
              disabled={!canUnlinkExternalIdentity || unlinkDiscord.isPending}
              onClick={() => unlinkDiscord.mutate()}
            >
              <DiscordIcon />
              {t("unlinkDiscord")}
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={() => {
                window.location.href = "/api/auth/discord/link?returnTo=/";
              }}
            >
              <DiscordIcon />
              {t("linkDiscord")}
            </Button>
          )}
          {!canUnlinkExternalIdentity && discordLinked ? (
            <p className="mt-2 text-[13px] text-muted-foreground">
              {t("discordOnlyMethod")}
            </p>
          ) : null}
        </>
      ) : null}
    </Dialog>
  );
}

function PasswordDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<{
    current?: string;
    next?: string;
    confirm?: string;
  }>({});
  const changePassword = useMutation({
    mutationFn: async (values: {
      readonly currentPassword: string;
      readonly newPassword: string;
    }) => {
      const { error: apiErr } = await api.PUT("/api/auth/password", {
        body: values,
      });
      if (apiErr) throw apiError(apiErr);
    },
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      onOpenChange(false);
      toast.success(t("passwordChanged"));
    },
    onError: (mutationError) => toast.error(mutationError.message),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: typeof errors = {};
    if (!currentPassword) nextErrors.current = t("enterCurrentPassword");
    if (!newPassword) nextErrors.next = t("enterNewPassword");
    else if (newPassword.length < 8) nextErrors.next = t("passwordMinLength");
    if (confirmPassword !== newPassword)
      nextErrors.confirm = t("passwordsDoNotMatch");
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    changePassword.mutate({ currentPassword, newPassword });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setErrors({});
        onOpenChange(next);
      }}
      title={t("changePassword")}
      footer={
        <>
          <DialogClose render={<Button variant="secondary">{t("cancel")}</Button>} />
          <Button onClick={submit} disabled={changePassword.isPending}>
            {t("changePassword")}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4" id="password-form">
        <Field
          label={t("currentPassword")}
          htmlFor="current-password"
          error={errors.current}
        >
          <PasswordInput
            id="current-password"
            autoComplete="current-password"
            value={currentPassword}
            invalid={Boolean(errors.current)}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </Field>
        <Field
          label={t("newPassword")}
          htmlFor="new-password"
          error={errors.next}
        >
          <PasswordInput
            id="new-password"
            autoComplete="new-password"
            value={newPassword}
            invalid={Boolean(errors.next)}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </Field>
        <Field
          label={t("confirmPassword")}
          htmlFor="confirm-password"
          error={errors.confirm}
        >
          <PasswordInput
            id="confirm-password"
            autoComplete="new-password"
            value={confirmPassword}
            invalid={Boolean(errors.confirm)}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  );
}

function workspaceViewTitle(
  view: WorkspaceView | undefined,
  t: (key: MessageKey) => string
): string {
  if (view === "home") return t("home");
  if (view === "worktrees") return t("workbench");
  if (view === "trash") return t("trash");
  if (view === "members") return t("members");
  return t("home");
}
