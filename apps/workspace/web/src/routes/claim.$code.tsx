import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Bot, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { claimLanding, validClaimTarget } from "../features/account/claim-landing";
import { agentClaimQueryOptions, claimAgent } from "../features/account/claimed-agents.queries";
import { clearHandoffClaim, writeHandoffClaim } from "../features/account/handoff-session";
import { HandoffSpaces } from "../features/account/handoff-spaces";
import { sessionQueryOptions } from "../features/auth";
import { mySpacesQueryOptions } from "../features/spaces";
import { api } from "../shared/api/client";
import { ApiError, apiError } from "../shared/api/errors";
import { useI18n, type MessageKey } from "../shared/i18n";
import { Alert, Button, buttonVariants, Spinner } from "../shared/ui";
import { cn } from "../shared/utils/cn";

export const Route = createFileRoute("/claim/$code")({
  validateSearch: (search: Readonly<Record<string, unknown>>): { to?: string | undefined } => {
    const to = validClaimTarget(search.to);
    return to ? { to } : {};
  },
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
  const { to } = Route.useSearch();
  const claimPath = to ? `/claim/${encodeURIComponent(code)}?to=${encodeURIComponent(to)}` : `/claim/${encodeURIComponent(code)}`;
  const session = useQuery(sessionQueryOptions);
  const handoff = useQuery(agentClaimQueryOptions(code));
  const navigate = useNavigate();
  const { language, t } = useI18n();
  const [failedPreviewKey, setFailedPreviewKey] = useState<string | null>(null);
  const errorText = (error: Error | null) => {
    const key = claimErrorKey(error);
    return key ? t(key) : error?.message;
  };
  const queryClient = useQueryClient();
  // A claimed agent's repositories join the person's own list; without that list its Personal Space is still a valid landing.
  const openWork = async (agent: Parameters<typeof claimLanding>[0]) => {
    if (to) {
      window.location.assign(to);
      return;
    }
    const spaces = await queryClient.fetchQuery({ ...mySpacesQueryOptions, staleTime: 0 }).then(({ spaces }) => spaces, () => []);
    await navigate(claimLanding(agent, spaces));
  };
  const claim = useMutation({
    mutationFn: () => claimAgent(code),
    onSuccess: ({ agent }) => {
      clearHandoffClaim();
      return openWork(agent);
    },
  });
  // Staying on this page keeps the handoff link.
  const signOut = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST("/api/auth/logout");
      if (error) throw apiError(error);
    },
    onSuccess: () => queryClient.resetQueries(),
  });

  const user = session.data?.authenticated ? session.data.user : null;
  const view = handoff.data;
  const claimed = view?.claimed === true;
  const previewKey = !user && view && !claimed && to ? `${code}:${to}` : null;
  const checkingPreview = previewKey !== null && failedPreviewKey !== previewKey;

  useEffect(() => {
    if (claimed) {
      clearHandoffClaim();
      return;
    }
    if (!user && view) {
      writeHandoffClaim(code);
    }
  }, [claimed, code, user, view]);

  useEffect(() => {
    if (!previewKey || !to || !view) return;
    let cancelled = false;
    const targetUrl = new URL(to, "http://workspace.local");

    async function verifyAndRedirect() {
      if (to!.startsWith("/nodes/")) {
        const rawNodeId = targetUrl.pathname.slice("/nodes/".length).split("/")[0] ?? "";
        let nodeId = "";
        try {
          nodeId = decodeURIComponent(rawNodeId);
        } catch {
          nodeId = "";
        }
        if (!nodeId) {
          if (!cancelled) setFailedPreviewKey(previewKey);
          return;
        }
        try {
          const { error } = await api.GET("/api/nodes/{nodeId}", {
            params: { path: { nodeId } },
          });
          if (cancelled) return;
          if (!error) {
            window.location.replace(to!);
            return;
          }
        } catch {
          if (cancelled) return;
        }
        setFailedPreviewKey(previewKey);
        return;
      }

      if (to!.startsWith("/spaces/")) {
        const rawSpaceId = targetUrl.pathname.slice("/spaces/".length).split("/")[0] ?? "";
        let spaceId = "";
        try {
          spaceId = decodeURIComponent(rawSpaceId);
        } catch {
          spaceId = "";
        }
        if (spaceId && view!.spaces.some((space) => space.id === spaceId)) {
          window.location.replace(to!);
          return;
        }
        setFailedPreviewKey(previewKey);
        return;
      }

      setFailedPreviewKey(previewKey);
    }

    void verifyAndRedirect();
    return () => {
      cancelled = true;
    };
  }, [previewKey, to, view]);

  if (session.isPending || handoff.isPending || checkingPreview) {
    return (
      <main className="auth-backdrop grid min-h-dvh place-items-center">
        <Spinner aria-label={t("claimAgentLoading")} />
      </main>
    );
  }

  const signIn = (label: MessageKey) => (
    <Link
      to="/login"
      search={{ oauthError: undefined, returnTo: claimPath }}
      className={cn(buttonVariants({ size: "lg" }), "w-full no-underline")}
    >
      {t(label)}
    </Link>
  );
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
