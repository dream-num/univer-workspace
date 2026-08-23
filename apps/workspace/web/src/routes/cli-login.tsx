import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ShieldCheck, Terminal } from "lucide-react";
import { useState, type FormEvent } from "react";
import { AuthCard, sessionQueryOptions } from "../features/auth";
import { api } from "../shared/api/client";
import { apiError, type ApiError } from "../shared/api/errors";
import { useI18n } from "../shared/i18n";
import { Alert, Button, Field, Input, Spinner } from "../shared/ui";

export const Route = createFileRoute("/cli-login")({
  validateSearch: (search: Record<string, unknown>) => ({
    userCode: typeof search.userCode === "string" ? search.userCode : undefined,
  }),
  component: CliLoginPage,
});

function CliLoginPage() {
  const { userCode: initialUserCode } = Route.useSearch();
  const [userCode, setUserCode] = useState(initialUserCode ?? "");
  const [approved, setApproved] = useState(false);
  const session = useQuery(sessionQueryOptions);
  const navigate = useNavigate();
  const { t } = useI18n();
  const mutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/api/auth/cli/authorizations/approve",
        { body: { userCode } }
      );
      if (error) throw apiError(error);
      return data;
    },
    onSuccess: () => setApproved(true),
  });
  const error = mutation.error as ApiError | null;

  if (session.isPending) {
    return (
      <main className="auth-backdrop grid min-h-dvh place-items-center">
        <Spinner aria-label={t("cliLoginLoading")} />
      </main>
    );
  }

  if (!session.data?.authenticated) {
    const returnTo = `/cli-login${
      initialUserCode ? `?userCode=${encodeURIComponent(initialUserCode)}` : ""
    }`;
    return (
      <main className="auth-backdrop grid min-h-dvh place-items-center px-5 py-8">
        <div className="flex w-full flex-col items-center gap-6">
          <Alert className="w-[min(420px,100%)]" title={t("cliLoginSignInFirst")}>
            {t("cliLoginSignInDescription")}
          </Alert>
          <AuthCard returnTo={returnTo} />
        </div>
      </main>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.reset();
    if (userCode.trim()) mutation.mutate();
  };

  return (
    <main className="auth-backdrop grid min-h-dvh place-items-center px-5 py-8">
      <div className="w-[min(440px,100%)] rounded-2xl border border-border bg-background p-8 shadow-lg max-[480px]:border-0 max-[480px]:bg-transparent max-[480px]:p-4 max-[480px]:shadow-none">
        <div className="mb-7 flex flex-col items-start gap-3.5">
          <span className="grid size-11 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm">
            {approved ? <ShieldCheck aria-hidden="true" /> : <Terminal aria-hidden="true" />}
          </span>
          <div>
            <h1 className="m-0 text-xl font-bold tracking-tight">
              {approved ? t("cliLoginApprovedTitle") : t("cliLoginTitle")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {approved
                ? t("cliLoginApprovedDescription")
                : t("cliLoginDescription")}
            </p>
          </div>
        </div>

        {approved ? (
          <>
            <Alert variant="success" className="mb-5">
              {t("cliLoginApprovedFor", {
                name: session.data.user.displayName,
              })}
            </Alert>
            <Button
              className="w-full"
              size="lg"
              onClick={() => void navigate({ to: "/home" })}
            >
              {t("backToHome")}
            </Button>
          </>
        ) : (
          <form className="grid gap-5" onSubmit={submit} noValidate>
            <Alert title={t("cliLoginAccount")}>
              {t("cliLoginAccountDescription", {
                name: session.data.user.displayName,
              })}
            </Alert>
            {error ? <Alert variant="destructive">{error.message}</Alert> : null}
            <Field label={t("cliLoginCode")} htmlFor="cli-login-code">
              <Input
                id="cli-login-code"
                autoCapitalize="characters"
                autoComplete="one-time-code"
                className="h-11 text-center font-mono text-lg tracking-[0.18em] uppercase"
                maxLength={9}
                placeholder="ABCD-EFGH"
                value={userCode}
                onChange={(event) => setUserCode(event.target.value.toUpperCase())}
              />
            </Field>
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={!userCode.trim() || mutation.isPending}
            >
              {t("cliLoginApprove")}
            </Button>
            <p className="text-center text-xs text-subtle-foreground">
              {t("cliLoginSafety")}
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
