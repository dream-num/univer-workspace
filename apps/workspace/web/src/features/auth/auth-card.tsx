import { Lock, Mail, User } from "lucide-react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { UniverCliIcon } from "@univerjs/icons";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../shared/api/client";
import { apiError, type ApiError } from "../../shared/api/errors";
import { useI18n } from "../../shared/i18n";
import {
  Alert,
  Button,
  DiscordIcon,
  Field,
  GitHubIcon,
  GoogleIcon,
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

type AuthMode = "email" | "login" | "register";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const CODE_PATTERN = /^[0-9]{6}$/u;

export function AuthCard(props: {
  readonly oauthError?: string;
  readonly returnTo?: string;
}) {
  const [mode, setMode] = useState<AuthMode>("email");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    username?: string;
    displayName?: string;
    password?: string;
  }>({});
  const [email, setEmail] = useState("");
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [emailCode, setEmailCode] = useState("");
  const [emailFieldError, setEmailFieldError] = useState<string>();
  const [codeFieldError, setCodeFieldError] = useState<string>();
  const [resendIn, setResendIn] = useState(0);
  const queryClient = useQueryClient();
  const session = useQuery(sessionQueryOptions);
  const navigate = useNavigate();
  const { t } = useI18n();

  const sessionView = session.data;
  const emailAuthEnabled = sessionView?.emailAuthEnabled === true;
  const passwordAuthEnabled = sessionView?.passwordAuthEnabled === true;
  const showGitHub = sessionView?.githubOAuthEnabled === true;
  const showGoogle = sessionView?.googleOAuthEnabled === true;
  const showDiscord = sessionView?.discordOAuthEnabled === true;
  const oauthEnabled = showGitHub || showGoogle || showDiscord;
  const activeMode: AuthMode =
    mode === "email" && !emailAuthEnabled
      ? "login"
      : mode !== "email" && !passwordAuthEnabled
        ? "email"
        : mode;

  const finishSignIn = async (nextSession: unknown) => {
    queryClient.setQueryData(sessionQueryKey, nextSession);
    if (props.returnTo) {
      window.location.assign(props.returnTo);
      return;
    }
    await navigate({ to: "/home" });
  };

  const passwordMutation = useMutation({
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
    onSuccess: finishSignIn,
  });

  const requestCode = useMutation({
    mutationFn: async (address: string) => {
      const { data, error } = await api.POST("/api/auth/email/code", {
        body: { email: address },
      });
      if (error) throw apiError(error);
      return data;
    },
    onSuccess: (issued, address) => {
      setPendingEmail(address);
      setEmailCode("");
      setCodeFieldError(undefined);
      setResendIn(issued.resendAfter);
    },
  });

  const emailLogin = useMutation({
    mutationFn: async (input: { email: string; code: string }) => {
      const { data, error } = await api.POST("/api/auth/email/login", {
        body: input,
      });
      if (error) throw apiError(error);
      return data;
    },
    onSuccess: finishSignIn,
  });

  const countingDown = resendIn > 0;
  useEffect(() => {
    if (!countingDown) return;
    const timer = setInterval(
      () => setResendIn((value) => Math.max(0, value - 1)),
      1_000
    );
    return () => clearInterval(timer);
  }, [countingDown]);

  const resetEmailFlow = () => {
    requestCode.reset();
    emailLogin.reset();
    setPendingEmail(null);
    setEmailCode("");
    setResendIn(0);
    setEmailFieldError(undefined);
    setCodeFieldError(undefined);
  };

  const error =
    activeMode === "email"
      ? ((requestCode.error ?? emailLogin.error) as ApiError | null)
      : (passwordMutation.error as ApiError | null);

  const submitPassword = (event: FormEvent) => {
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
    passwordMutation.mutate({
      username: username.trim(),
      password,
      ...(mode === "register" ? { displayName: displayName.trim() } : {}),
    });
  };

  const submitEmail = (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    if (!EMAIL_PATTERN.test(address)) {
      setEmailFieldError(t("invalidEmail"));
      return;
    }
    setEmailFieldError(undefined);
    requestCode.mutate(address);
  };

  const submitEmailCode = (event: FormEvent) => {
    event.preventDefault();
    if (pendingEmail === null) return;
    const code = emailCode.trim();
    if (!CODE_PATTERN.test(code)) {
      setCodeFieldError(t("enterEmailCode"));
      return;
    }
    setCodeFieldError(undefined);
    emailLogin.mutate({ email: pendingEmail, code });
  };

  const modeOptions: { label: string; value: AuthMode }[] = [
    ...(emailAuthEnabled
      ? [{ label: t("emailSignIn"), value: "email" as const }]
      : []),
    ...(passwordAuthEnabled
      ? [
          { label: t("passwordSignIn"), value: "login" as const },
          { label: t("createAccount"), value: "register" as const },
        ]
      : []),
  ];

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

      {modeOptions.length > 1 ? (
        <Segmented
          aria-label={t("signInMethod")}
          className={
            modeOptions.length === 3
              ? "mb-6 grid w-full grid-cols-3"
              : "mb-6 grid w-full grid-cols-2"
          }
          value={activeMode}
          options={modeOptions}
          onValueChange={(value) => {
            passwordMutation.reset();
            requestCode.reset();
            emailLogin.reset();
            setFieldErrors({});
            setEmailFieldError(undefined);
            setCodeFieldError(undefined);
            setMode(value);
          }}
        />
      ) : null}

      {error || props.oauthError ? (
        <Alert variant="destructive" className="mb-5">
          {error?.message ?? props.oauthError}
        </Alert>
      ) : null}

      {activeMode === "email" ? (
        pendingEmail === null ? (
          <form onSubmit={submitEmail} className="grid gap-4" noValidate>
            <Field
              label={t("email")}
              htmlFor="auth-email"
              error={emailFieldError}
              hint={t("emailSignInHint")}
            >
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle-foreground"
                  aria-hidden="true"
                />
                <Input
                  id="auth-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  className="h-10 pl-9"
                  maxLength={254}
                  placeholder={t("emailPlaceholder")}
                  value={email}
                  invalid={Boolean(emailFieldError)}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
            </Field>

            <Button
              type="submit"
              size="lg"
              className="mt-1.5 w-full"
              disabled={requestCode.isPending}
            >
              {t("sendSignInCode")}
            </Button>
          </form>
        ) : (
          <form onSubmit={submitEmailCode} className="grid gap-4" noValidate>
            <p className="m-0 text-[13px] leading-relaxed text-muted-foreground">
              {t("emailCodeSent", { email: pendingEmail })}
            </p>

            <Field
              label={t("emailCode")}
              htmlFor="auth-email-code"
              error={codeFieldError}
            >
              <Input
                id="auth-email-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                className="h-10 font-mono tracking-[0.4em]"
                maxLength={6}
                placeholder={t("emailCodePlaceholder")}
                value={emailCode}
                invalid={Boolean(codeFieldError)}
                onChange={(event) => setEmailCode(event.target.value)}
              />
            </Field>

            <Button
              type="submit"
              size="lg"
              className="mt-1.5 w-full"
              disabled={emailLogin.isPending}
            >
              {t("signInWithCode")}
            </Button>

            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={resetEmailFlow}
              >
                {t("changeEmail")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={countingDown || requestCode.isPending}
                onClick={() => {
                  if (pendingEmail !== null) requestCode.mutate(pendingEmail);
                }}
              >
                {countingDown
                  ? t("resendSignInCodeIn", { seconds: resendIn })
                  : t("resendSignInCode")}
              </Button>
            </div>
          </form>
        )
      ) : null}

      {passwordAuthEnabled && activeMode !== "email" ? (
        <form onSubmit={submitPassword} className="grid gap-4" noValidate>
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

          {activeMode === "register" ? (
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
                  activeMode === "login" ? "current-password" : "new-password"
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
            disabled={passwordMutation.isPending}
          >
            {activeMode === "login" ? t("signIn") : t("createAccount")}
          </Button>
        </form>
      ) : null}

      {oauthEnabled ? (
        <>
          {modeOptions.length > 0 ? (
            <div className="my-6 flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-xs text-subtle-foreground">
                {t("authDividerOr")}
              </span>
              <Separator className="flex-1" />
            </div>
          ) : null}
          <div className="grid gap-3">
            {showGitHub ? (
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
            {showGoogle ? (
              <Button
                variant="secondary"
                size="lg"
                className="w-full"
                onClick={() => {
                  window.location.href = oauthLoginUrl(
                    "/api/auth/google/login",
                    props.returnTo
                  );
                }}
              >
                <GoogleIcon />
                {t("continueWithGoogle")}
              </Button>
            ) : null}
            {showDiscord ? (
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
