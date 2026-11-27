import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Bot, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { claimLanding } from "../features/account/claim-landing";
import { agentClaimQueryOptions, claimAgent } from "../features/account/claimed-agents.queries";
import { HandoffSpaces } from "../features/account/handoff-spaces";
import { sessionQueryOptions } from "../features/auth";
import { mySpacesQueryOptions } from "../features/spaces";
import { api } from "../shared/api/client";
import { ApiError, apiError } from "../shared/api/errors";
import { useI18n, type MessageKey } from "../shared/i18n";
import { Alert, Button, buttonVariants, Spinner } from "../shared/ui";
import { cn } from "../shared/utils/cn";

export const Route = createFileRoute("/claim/$code")({
  component: ClaimAgentPage,
});

const CLAIM_ERRORS: Readonly<Record<string, MessageKey>> = {
  AGENT_CLAIM_INVALID: "claimAgentInvalid",
  AGENT_CLAIM_EXPIRED: "claimAgentExpired",
  AGENT_ALREADY_CLAIMED: "claimAgentAlreadyClaimed",
  INTERACTIVE_SESSION_REQUIRED: "claimAgentNotHuman",
};

function claimErrorKey(error: Error | null): MessageKey | undefined {
  return error instanceof ApiError ? CLAIM_ERRORS[error.code] : undefined;
}

function ClaimAgentPage() {
  const { code } = Route.useParams();
  const session = useQuery(sessionQueryOptions);
  const handoff = useQuery(agentClaimQueryOptions(code));
  const navigate = useNavigate();
  const { language, t } = useI18n();
  const errorText = (error: Error | null) => {
    const key = claimErrorKey(error);
    return key ? t(key) : error?.message;
  };
  const queryClient = useQueryClient();
  // A claimed agent's repositories join the person's own list; without that list its Personal Space is still a valid landing.
  const openWork = async (agent: Parameters<typeof claimLanding>[0]) => {
    const spaces = await queryClient.fetchQuery({ ...mySpacesQueryOptions, staleTime: 0 }).then(({ spaces }) => spaces, () => []);
    await navigate(claimLanding(agent, spaces));
  };
  const [keepFileLinks, setKeepFileLinks] = useState(true);
  const claim = useMutation({
    mutationFn: () => claimAgent(code, keepFileLinks),
    onSuccess: ({ agent }) => openWork(agent),
  });
  // Staying on this page keeps the handoff link.
  const signOut = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST("/api/auth/logout");
      if (error) throw apiError(error);
    },
    onSuccess: () => queryClient.resetQueries(),
  });

  if (session.isPending || handoff.isPending) {
    return (
      <main className="auth-backdrop grid min-h-dvh place-items-center">
        <Spinner aria-label={t("claimAgentLoading")} />
      </main>
    );
  }

  const user = session.data?.authenticated ? session.data.user : null;
  const signIn = (label: MessageKey) => (
    <Link
      to="/login"
      search={{ oauthError: undefined, returnTo: `/claim/${encodeURIComponent(code)}` }}
      className={cn(buttonVariants({ size: "lg" }), "w-full no-underline")}
    >
      {t(label)}
    </Link>
  );
  const view = handoff.data;
  const claimed = view?.claimed === true;
  // A Team Space has no Link Sharing, so nothing keeps the links of its files.
  const teamSpaces = view?.spaces.filter((space) => space.type === "team" && space.files > 0).map((space) => space.name) ?? [];
  // The server takes an agent only for a person signed in to Workspace in a browser, and says so when the take is refused.
  const notPerson = user?.kind === "agent" || claimErrorKey(claim.error) === "claimAgentNotHuman";
  return (
    <main className="auth-backdrop grid min-h-dvh place-items-center px-5 py-8">
      <div className="w-[min(480px,100%)] rounded-2xl border border-border bg-background p-8 shadow-lg max-[480px]:border-0 max-[480px]:bg-transparent max-[480px]:p-4 max-[480px]:shadow-none">
        <div className="mb-7 flex flex-col items-start gap-3.5">
          <span className="grid size-11 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm">
            {claimed ? <ShieldCheck aria-hidden="true" /> : <Bot aria-hidden="true" />}
          </span>
          <div>
            <h1 className="m-0 text-xl font-bold tracking-tight break-words">
              {!view
                ? t("claimAgentUnavailableTitle")
                : claimed
                  ? t("claimAgentClaimedTitle", { name: view.agent.displayName })
                  : t("claimAgentTitle", { name: view.agent.displayName })}
            </h1>
            {view ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {claimed ? t("claimAgentClaimedDescription") : t("claimAgentDescription")}
              </p>
            ) : null}
          </div>
        </div>

        {!view ? (
          <div className="grid gap-5">
            <Alert variant="destructive">{errorText(handoff.error)}</Alert>
            {!user && claimErrorKey(handoff.error) === "claimAgentAlreadyClaimed" ? (
              <>
                <p className="m-0 text-sm text-muted-foreground">{t("claimAgentOwnerSignIn")}</p>
                {signIn("signIn")}
              </>
            ) : null}
            <Button className="w-full" size="lg" variant="secondary" onClick={() => void navigate({ to: "/home" })}>
              {t("backToHome")}
            </Button>
          </div>
        ) : (
          <div className="grid gap-5">
            <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border p-4 text-sm">
              <div className="min-w-0">
                <dt className="text-muted-foreground">{t("claimAgentName")}</dt>
                <dd className="font-medium break-words">@{view.agent.username}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("claimAgentLinkExpires")}</dt>
                <dd className="font-medium">{new Date(view.expiresAt).toLocaleDateString(language)}</dd>
              </div>
            </dl>
            <HandoffSpaces spaces={view.spaces} readable={!user} />
            {claim.error && !notPerson ? <Alert variant="destructive">{errorText(claim.error)}</Alert> : null}
            {signOut.error ? <Alert variant="destructive">{signOut.error.message}</Alert> : null}
            {claimed ? (
              <Button className="w-full" size="lg" onClick={() => void openWork(view.agent)}>
                {t("claimAgentOpenSpace")}
              </Button>
            ) : !user ? (
              signIn("claimAgentSignIn")
            ) : notPerson ? (
              <>
                <Alert variant="destructive">{t("claimAgentNotHuman")}</Alert>
                <Button className="w-full" size="lg" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
                  {t("claimAgentSignOut")}
                </Button>
              </>
            ) : (
              <>
                <Alert title={t("claimAgentAccount")}>{t("claimAgentAccountDescription", { name: user.displayName })}</Alert>
                <label className="flex items-start gap-2.5 text-sm">
                  <input
                    className="mt-0.5 size-4 accent-primary"
                    type="checkbox"
                    checked={keepFileLinks}
                    onChange={(event) => setKeepFileLinks(event.target.checked)}
                  />
                  <span>
                    {t("claimAgentKeepFileLinks")}
                    <span className="mt-0.5 block text-muted-foreground">{t("claimAgentKeepFileLinksDescription")}</span>
                    {teamSpaces.length > 0 ? (
                      <span className="mt-0.5 block text-muted-foreground">
                        {t("claimAgentTeamFileLinks", { names: new Intl.ListFormat(language).format(teamSpaces) })}
                      </span>
                    ) : null}
                  </span>
                </label>
                <Button className="w-full" size="lg" disabled={claim.isPending} onClick={() => claim.mutate()}>
                  {t("claimAgentConfirm")}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
