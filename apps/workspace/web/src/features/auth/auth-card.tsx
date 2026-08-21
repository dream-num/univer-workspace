import { Lock, User } from "lucide-react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { UniverCliIcon } from "@univerjs/icons";
import { useState, type FormEvent } from "react";
import { api } from "../../shared/api/client";
import { apiError, type ApiError } from "../../shared/api/errors";
import { useI18n } from "../../shared/i18n";
import {
  Alert,
  Button,
  DiscordIcon,
  Field,
  GitHubIcon,
  Input,
  PasswordInput,
  Segmented,
  Separator,
} from "../../shared/ui";
import {
  sessionQueryKey,
  sessionQueryOptions,
} from "./auth.queries";

interface AuthValues {
  readonly username: string;
  readonly displayName?: string;
  readonly password: string;
}

export function AuthCard(props: {
  readonly oauthError?: string;
  readonly returnTo?: string;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    username?: string;
    displayName?: string;
    password?: string;
  }>({});
  const queryClient = useQueryClient();
  const session = useQuery(sessionQueryOptions);
  const navigate = useNavigate();
  const { t } = useI18n();
  const mutation = useMutation({
    mutationFn: async (values: AuthValues) => {
      if (mode === "register") {
        const { data, error } = await api.POST(
          "/api/auth/password/register",
          {
            body: {
              username: values.username,
              displayName: values.displayName ?? values.username,
              password: values.password,
            },
          }
        );
        if (error) throw apiError(error);
        return data;
      }

      const { data, error } = await api.POST("/api/auth/password/login", {
        body: {
          username: values.username,
          password: values.password,
        },
      });
      if (error) throw apiError(error);
      return data;
    },
    onSuccess: async (nextSession) => {
      queryClient.setQueryData(sessionQueryKey, nextSession);
      if (props.returnTo) {
        window.location.assign(props.returnTo);
        return;
      }
      await navigate({ to: "/home" });
    },
  });
  const error = mutation.error as ApiError | null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: typeof fieldErrors = {};
    if (!username.trim()) nextErrors.username = t("enterUsername");
    if (mode === "register" && !displayName.trim())
      nextErrors.displayName = t("enterDisplayName");
    if (!password) nextErrors.password = t("enterPassword");
    else if (password.length < 8)
      nextErrors.password = t("passwordMinLength");
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    mutation.mutate({
      username: username.trim(),
      password,
      ...(mode === "register" ? { displayName: displayName.trim() } : {}),
    });
  };

  return (
    <div className="w-[min(420px,100%)] rounded-2xl border border-border bg-background p-8 shadow-lg max-[480px]:border-0 max-[480px]:bg-transparent max-[480px]:p-4 max-[480px]:shadow-none">
      <div className="mb-7 flex flex-col items-start gap-3.5">
        <UniverCliIcon
          aria-hidden="true"
          className="size-9 shrink-0 text-foreground"
        />
        <div>
          <h1 className="m-0 text-xl font-bold tracking-tight">
            Univer Workspace
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("authTagline")}
          </p>
        </div>
      </div>

      <Segmented
        aria-label={mode === "login" ? t("signIn") : t("createAccount")}
        className="mb-6 grid w-full grid-cols-2"
        value={mode}
        options={[
          { label: t("signIn"), value: "login" },
          { label: t("createAccount"), value: "register" },
        ]}
        onValueChange={(value) => {
          mutation.reset();
          setFieldErrors({});
          setMode(value);
        }}
      />

      {error || props.oauthError ? (
        <Alert variant="destructive" className="mb-5">
          {error?.message ?? props.oauthError}
        </Alert>
      ) : null}

      <form onSubmit={submit} className="grid gap-4" noValidate>
        <Field
          label={t("username")}
          htmlFor="auth-username"
          error={fieldErrors.username}
        >
          <div className="relative">
            <User
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle-foreground"
              aria-hidden="true"
            />
            <Input
              id="auth-username"
              autoComplete="username"
              className="h-10 pl-9"
              maxLength={64}
              value={username}
              invalid={Boolean(fieldErrors.username)}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
        </Field>

        {mode === "register" ? (
          <Field
            label={t("displayName")}
            htmlFor="auth-display-name"
            error={fieldErrors.displayName}
          >
            <Input
              id="auth-display-name"
              className="h-10"
              maxLength={100}
              value={displayName}
              invalid={Boolean(fieldErrors.displayName)}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </Field>
        ) : null}

        <Field
          label={t("password")}
          htmlFor="auth-password"
          error={fieldErrors.password}
        >
          <div className="relative [&_button]:top-1/2 [&_button]:-translate-y-1/2">
            <Lock
              className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-subtle-foreground"
              aria-hidden="true"
            />
            <PasswordInput
              id="auth-password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              className="h-10 pr-9 pl-9"
              maxLength={200}
              value={password}
              invalid={Boolean(fieldErrors.password)}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
        </Field>

        <Button
          type="submit"
          size="lg"
          className="mt-1.5 w-full"
          disabled={mutation.isPending}
        >
          {mode === "login" ? t("signIn") : t("createAccount")}
        </Button>
      </form>

      {session.data &&
      (session.data.githubOAuthEnabled || session.data.discordOAuthEnabled) ? (
        <>
          <div className="my-6 flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-subtle-foreground">
              {t("authDividerOr")}
            </span>
            <Separator className="flex-1" />
          </div>
          <div className="grid gap-3">
            {session.data.githubOAuthEnabled ? (
              <Button
                variant="secondary"
                size="lg"
                className="w-full"
                onClick={() => {
                  window.location.href = oauthLoginUrl(
                    "/api/auth/github/login",
                    props.returnTo
                  );
                }}
              >
                <GitHubIcon />
                {t("continueWithGitHub")}
              </Button>
            ) : null}
            {session.data.discordOAuthEnabled ? (
              <Button
                variant="secondary"
                size="lg"
                className="w-full"
                onClick={() => {
                  window.location.href = oauthLoginUrl(
                    "/api/auth/discord/login",
                    props.returnTo
                  );
                }}
              >
                <DiscordIcon />
                {t("continueWithDiscord")}
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function oauthLoginUrl(path: string, returnTo?: string) {
  if (!returnTo) return path;
  return `${path}?returnTo=${encodeURIComponent(returnTo)}`;
}
