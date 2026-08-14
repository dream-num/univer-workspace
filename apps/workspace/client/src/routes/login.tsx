import { createFileRoute } from "@tanstack/react-router";
import { AuthCard, validLoginReturnTo } from "../features/auth";
import { useI18n } from "../shared/i18n";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    oauthError:
      typeof search.oauthError === "string" ? search.oauthError : undefined,
    returnTo: validLoginReturnTo(search.returnTo),
  }),
  component: LoginPage,
});

function LoginPage() {
  const { oauthError, returnTo } = Route.useSearch();
  const { t } = useI18n();
  return (
    <main className="auth-backdrop grid min-h-dvh place-items-center px-5 py-8">
      <div className="flex w-full flex-col items-center gap-6">
        <AuthCard
          {...(oauthError ? { oauthError } : {})}
          {...(returnTo ? { returnTo } : {})}
        />
        <p className="text-xs text-subtle-foreground">
          {t("collaborationExample")}
        </p>
      </div>
    </main>
  );
}
