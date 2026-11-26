import { useMutation, useQuery } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { api } from "../../shared/api/client";
import { apiError, type ApiError } from "../../shared/api/errors";
import { useI18n } from "../../shared/i18n";
import { Alert, Button } from "../../shared/ui";
import { isOAuthAuthorizeReturnTo, sessionQueryOptions } from "./auth.queries";

export function GuestAgentCard({ returnTo }: { readonly returnTo?: string }) {
  const { t } = useI18n();
  const session = useQuery(sessionQueryOptions);
  const guest = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST("/api/auth/authorize/guest", {
        body: { oauthAuthorization: new URL(returnTo ?? "", window.location.origin).search.slice(1) },
      });
      if (error) throw apiError(error);
      return data.redirectUrl;
    },
  });
  const error = guest.error as ApiError | null;
  const view = session.data;
  const signedOutWithGuests = view?.authenticated === false && view.guestAuthEnabled;
  const leftoverAgentCookie = view?.authenticated === true && view.user.kind === "agent";

  if (!returnTo || !isOAuthAuthorizeReturnTo(returnTo) || !(signedOutWithGuests || leftoverAgentCookie)) {
    return null;
  }

  return (
    <section
      aria-labelledby="guest-agent-title"
      className="w-[min(420px,100%)] rounded-2xl border border-primary bg-background p-8 shadow-lg max-[480px]:p-5"
    >
      <span className="mb-3.5 grid size-9 place-items-center rounded-full bg-info-soft text-brand-600">
        <Bot aria-hidden="true" className="size-5" />
      </span>
      <h2 id="guest-agent-title" className="m-0 text-xl font-bold tracking-tight">
        {t("guestAgentTitle")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("guestAgentDescription")}
      </p>
      <ul className="my-5 grid list-disc gap-1.5 pl-5 text-[13px] text-muted-foreground">
        <li>{t("guestAgentPrivate")}</li>
        <li>{t("guestAgentExpiry")}</li>
      </ul>

      {error ? (
        <Alert variant="destructive" className="mb-5">
          {error.code === "AGENT_CREATE_RATE_LIMITED"
            ? t("guestAgentRateLimited")
            : error.message}
        </Alert>
      ) : null}

      <Button
        size="lg"
        className="w-full"
        disabled={guest.isPending || guest.isSuccess}
        onClick={() =>
          guest.mutate(undefined, {
            onSuccess: (redirectUrl) => window.location.assign(redirectUrl),
          })
        }
      >
        {t("continueAsGuestAgent")}
      </Button>
    </section>
  );
}
