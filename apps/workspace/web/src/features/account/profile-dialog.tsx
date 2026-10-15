import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { sessionQueryKey, sessionQueryOptions } from "../auth";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { useI18n } from "../../shared/i18n";
import {
  Button,
  Dialog,
  DialogClose,
  DiscordIcon,
  Field,
  GitHubIcon,
  Input,
  Separator,
  toast,
} from "../../shared/ui";

export function ProfileDialog({
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
        session.data?.authenticated ? { ...session.data, user } : session.data,
      );
      onOpenChange(false);
      toast.success(t("profileUpdated"));
    },
    onError: (mutationError) => toast.error(mutationError.message),
  });

  if (!current) return null;
  const githubLinked = current.authenticationMethods.externalIdentities.some(
    (identity) => identity.provider === "github",
  );
  const discordLinked = current.authenticationMethods.externalIdentities.some(
    (identity) => identity.provider === "discord",
  );
  const canUnlinkExternalIdentity =
    (current.passwordAuthEnabled && current.authenticationMethods.password) ||
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
      <form onSubmit={submit} className="grid gap-4" id="profile-form">
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
              disabled={!canUnlinkExternalIdentity || unlinkGitHub.isPending}
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
            <p className="mt-2 text-[13px] text-muted-foreground">{t("githubOnlyMethod")}</p>
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
            <p className="mt-2 text-[13px] text-muted-foreground">{t("discordOnlyMethod")}</p>
          ) : null}
        </>
      ) : null}
    </Dialog>
  );
}
