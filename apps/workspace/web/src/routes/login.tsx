import { createFileRoute } from "@tanstack/react-router";
import { AuthCard, validLoginReturnTo } from "../features/auth";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    ...(search.mode === "register" ? { mode: "register" as const } : {}),
    oauthError: typeof search.oauthError === "string" ? search.oauthError : undefined,
    returnTo: validLoginReturnTo(search.returnTo),
  }),
  component: LoginPage,
});

function LoginPage() {
  const { mode, oauthError, returnTo } = Route.useSearch();
  return (
    <main className="auth-backdrop grid min-h-dvh place-items-center px-5 py-8">
      <AuthCard {...(mode ? { initialMode: mode } : {})} {...(oauthError ? { oauthError } : {})} {...(returnTo ? { returnTo } : {})} />
    </main>
  );
}
