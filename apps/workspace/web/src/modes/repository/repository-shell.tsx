import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { sessionQueryKey, sessionQueryOptions } from "../../features/auth";
import { spaceQueryOptions } from "../../features/spaces";
import { useWorktreeChangeFeed } from "../../features/worktrees";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { useI18n } from "../../shared/i18n";
import { LoadingScreen, MenuItem } from "../../shared/ui";
import {
  AccountMenu,
  AccessTokensDialog,
  AppSettingsDialog,
  ProfileDialog,
  PasswordDialog,
  TrialNoticeDialog,
} from "../../features/account";
import { ModeSettings } from "../mode-settings";
import type { WorkspaceShellProps } from "../shell.types";
import { BRAND } from "./brand";
import { spaceDisplayName } from "./space-name";
import { resolveFrame } from "./shell/frame";
import { TopBar } from "./shell/top-bar";
import { RepositoryMasthead } from "./shell/repository-masthead";

export function RepositoryShell(props: WorkspaceShellProps) {
  const session = useQuery(sessionQueryOptions);
  const selected = useQuery(spaceQueryOptions(props.selectedSpaceId));
  useWorktreeChangeFeed(session.data?.authenticated === true);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [accessTokensOpen, setAccessTokensOpen] = useState(false);
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const frame = resolveFrame(props);
  const name = spaceDisplayName(selected.data, t);
  useEffect(() => {
    const previous = document.title;
    document.title = `${typeof props.headerTitle === "string" ? props.headerTitle : (name ?? t("repositories"))} · ${BRAND}`;
    return () => {
      document.title = previous;
    };
  }, [name, props.headerTitle, t]);
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
        googleOAuthEnabled: currentSession.googleOAuthEnabled,
        discordOAuthEnabled: currentSession.discordOAuthEnabled,
        passwordAuthEnabled: currentSession.passwordAuthEnabled,
        emailAuthEnabled: currentSession.emailAuthEnabled,
      });
      await navigate({
        to: "/login",
        search: { oauthError: undefined, returnTo: undefined },
        replace: true,
      });
    },
  });

  if (session.isPending || (props.selectedSpaceId !== undefined && selected.isPending))
    return <LoadingScreen />;
  if (session.error) throw session.error;
  if (!session.data?.authenticated)
    return <Navigate to="/login" search={{ oauthError: undefined, returnTo: undefined }} replace />;
  const currentSession = session.data;
  const account = (
    <AccountMenu
      currentSession={currentSession}
      onProfile={() => setProfileDialogOpen(true)}
      onPassword={() => setPasswordDialogOpen(true)}
      onAccessTokens={() => setAccessTokensOpen(true)}
      logoutPending={logout.isPending}
      onLogout={() => logout.mutate()}
      extraItems={
        <MenuItem onClick={() => setAppSettingsOpen(true)}>
          <Settings />
          {t("appSettings")}
        </MenuItem>
      }
    />
  );
  return (
    <>
      <div className="workspace-shell rd-app" data-frame={frame.kind}>
        {frame.kind !== "immersive" ? <TopBar {...props} frame={frame} account={account} /> : null}
        <div className="rd-viewport">
          {frame.kind === "repository" ? (
            <RepositoryMasthead spaceId={frame.spaceId} tab={frame.tab} />
          ) : null}
          <main className={`rd-frame-${frame.kind}`}>{props.children}</main>
        </div>
      </div>
      <ProfileDialog open={profileDialogOpen} onOpenChange={setProfileDialogOpen} />

      <PasswordDialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen} />

      <AccessTokensDialog open={accessTokensOpen} onOpenChange={setAccessTokensOpen} />

      {currentSession.trialDeployment ? (
        <TrialNoticeDialog userId={currentSession.user.id} />
      ) : null}

      <AppSettingsDialog
        open={appSettingsOpen}
        onOpenChange={setAppSettingsOpen}
        layoutSettings={<ModeSettings />}
      />
    </>
  );
}
