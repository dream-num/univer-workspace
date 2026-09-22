import { createFileRoute } from "@tanstack/react-router";
import { AuthCard, validLoginReturnTo } from "../features/auth";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    oauthError: typeof search.oauthError === "string" ? search.oauthError : undefined,
    returnTo: validLoginReturnTo(search.returnTo),
  }),
  component: LoginPage,
});

function LoginPage() {
  const { oauthError, returnTo } = Route.useSearch();
  return (
    <main className="auth-backdrop grid min-h-dvh place-items-center px-5 py-8">
      <AuthCard {...(oauthError ? { oauthError } : {})} {...(returnTo ? { returnTo } : {})} />
    </main>
  );
}
