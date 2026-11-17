import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Bot, ShieldCheck } from "lucide-react";
import { agentClaimQueryOptions, claimAgent } from "../features/account/claimed-agents.queries";
import { AuthCard, sessionQueryOptions } from "../features/auth";
import { ApiError } from "../shared/api/errors";
import { useI18n, type MessageKey } from "../shared/i18n";
import { Alert, Button, Spinner } from "../shared/ui";

export const Route = createFileRoute("/claim/$code")({
  component: ClaimAgentPage,
});

const CLAIM_ERRORS: Readonly<Record<string, MessageKey>> = {
  AGENT_CLAIM_INVALID: "claimAgentInvalid",
  AGENT_CLAIM_EXPIRED: "claimAgentExpired",
  AGENT_ALREADY_CLAIMED: "claimAgentAlreadyClaimed",
  FORBIDDEN: "claimAgentNotHuman",
};

function claimErrorKey(error: Error | null): MessageKey | undefined {
  return error instanceof ApiError ? CLAIM_ERRORS[error.code] : undefined;
}

function ClaimAgentPage() {
  const { code } = Route.useParams();
  const session = useQuery(sessionQueryOptions);
  const signedIn = session.data?.authenticated === true;
  const preview = useQuery({ ...agentClaimQueryOptions(code), enabled: signedIn });
  const navigate = useNavigate();
  const { t } = useI18n();
  const errorText = (error: Error | null) => {
    const key = claimErrorKey(error);
    return key ? t(key) : error?.message;
  };
  const openSpace = (spaceId: string) => void navigate({ to: "/spaces/$spaceId", params: { spaceId }, search: {} });
  const claim = useMutation({
    mutationFn: () => claimAgent(code),
    onSuccess: ({ agent }) => openSpace(agent.spaceId),
  });

  if (session.isPending || (signedIn && preview.isPending)) {
    return (
      <main className="auth-backdrop grid min-h-dvh place-items-center">
        <Spinner aria-label={t("claimAgentLoading")} />
      </main>
    );
  }

  if (!session.data?.authenticated) {
    return (
      <main className="auth-backdrop grid min-h-dvh place-items-center px-5 py-8">
        <div className="flex w-full flex-col items-center gap-6">
          <Alert className="w-[min(420px,100%)]" title={t("claimAgentSignInFirst")}>
            {t("claimAgentSignInDescription")}
          </Alert>
          <AuthCard returnTo={`/claim/${encodeURIComponent(code)}`} />
        </div>
      </main>
    );
  }

  const agent = preview.data?.agent;
  const claimed = preview.data?.claimed === true;
  return (
    <main className="auth-backdrop grid min-h-dvh place-items-center px-5 py-8">
      <div className="w-[min(440px,100%)] rounded-2xl border border-border bg-background p-8 shadow-lg max-[480px]:border-0 max-[480px]:bg-transparent max-[480px]:p-4 max-[480px]:shadow-none">
        <div className="mb-7 flex flex-col items-start gap-3.5">
          <span className="grid size-11 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm">
            {claimed ? <ShieldCheck aria-hidden="true" /> : <Bot aria-hidden="true" />}
          </span>
          <div>
            <h1 className="m-0 text-xl font-bold tracking-tight break-words">
              {!agent
                ? t("claimAgentUnavailableTitle")
                : claimed
                  ? t("claimAgentClaimedTitle", { name: agent.displayName })
                  : t("claimAgentTitle", { name: agent.displayName })}
            </h1>
            {agent ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {claimed ? t("claimAgentClaimedDescription") : t("claimAgentDescription")}
              </p>
            ) : null}
          </div>
        </div>

        {!agent ? (
          <div className="grid gap-5">
            <Alert variant="destructive">{errorText(preview.error)}</Alert>
            <Button className="w-full" size="lg" variant="secondary" onClick={() => void navigate({ to: "/home" })}>
              {t("backToHome")}
            </Button>
          </div>
        ) : (
          <div className="grid gap-5">
            <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border p-4 text-sm">
              <div className="min-w-0">
                <dt className="text-muted-foreground">{t("claimAgentName")}</dt>
                <dd className="font-medium break-words">@{agent.username}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("myAgentsFiles")}</dt>
                <dd className="font-medium">{t("claimAgentFiles", { count: agent.files })}</dd>
              </div>
            </dl>
            {claimed ? null : (
              <Alert title={t("claimAgentAccount")}>
                {t("claimAgentAccountDescription", { name: session.data.user.displayName })}
              </Alert>
            )}
            {claim.error ? <Alert variant="destructive">{errorText(claim.error)}</Alert> : null}
            {claimed ? (
              <Button className="w-full" size="lg" onClick={() => openSpace(agent.spaceId)}>
                {t("claimAgentOpenSpace")}
              </Button>
            ) : (
              <Button className="w-full" size="lg" disabled={claim.isPending} onClick={() => claim.mutate()}>
                {t("claimAgentConfirm")}
              </Button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
