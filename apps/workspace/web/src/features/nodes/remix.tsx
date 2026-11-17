import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { Bot, CopyPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { createIdempotencyKey } from "../../shared/idempotency-key";
import { useI18n, type MessageKey } from "../../shared/i18n";
import { Button, buttonVariants, Dialog, toast } from "../../shared/ui";
import { cn } from "../../shared/utils/cn";
import { sessionQueryOptions } from "../auth";
import { copyToPersonalSpace } from "./copy";
import { copyHandToAgentPrompt, handToAgentPrompt } from "./hand-to-agent";
import { invalidateProductLists } from "./nodes.commands";

// Tab storage, not the return URL, so a link someone sends cannot make a copy in the reader's space.
const PENDING_COPY = "univer-workspace-pending-copy";

type PendingCopy = { readonly nodeId: string; readonly key: string; readonly done: MessageKey };

function rememberCopy(pending: PendingCopy) {
  try {
    window.sessionStorage.setItem(PENDING_COPY, JSON.stringify(pending));
  } catch {
    // Without tab storage the reader signs up and asks for the copy again.
  }
}

function takePendingCopy(nodeId: string): PendingCopy | undefined {
  try {
    const value = window.sessionStorage.getItem(PENDING_COPY);
    window.sessionStorage.removeItem(PENDING_COPY);
    const pending = value ? (JSON.parse(value) as PendingCopy) : undefined;
    return pending?.nodeId === nodeId ? pending : undefined;
  } catch {
    return undefined;
  }
}

function useCopyAndOpen() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (pending: PendingCopy) =>
      copyToPersonalSpace(pending.nodeId, pending.key, { failed: t("remixFailed"), continuing: t("remixContinuing") }),
    onSuccess: async (copyId, pending) => {
      await invalidateProductLists(client, { htmlViews: true });
      toast.success(t(pending.done));
      await navigate({ to: "/nodes/$nodeId", params: { nodeId: copyId } });
    },
    onError: (error) => toast.error(error.message),
  });
}

export function useFinishPendingCopy(nodeId: string, signedIn: boolean) {
  const copy = useCopyAndOpen();
  useEffect(() => {
    if (!signedIn) return;
    const pending = takePendingCopy(nodeId);
    if (pending) copy.mutate(pending);
  }, [nodeId, signedIn]);
}

function SignUpThenCopy({ nodeId, done, className, children }: {
  readonly nodeId: string;
  readonly done: MessageKey;
  readonly className: string;
  readonly children: string;
}) {
  const location = useLocation();
  return (
    <Link
      to="/login"
      search={{ mode: "register", oauthError: undefined, returnTo: location.href }}
      className={cn(className, "no-underline")}
      onClick={() => rememberCopy({ nodeId, key: createIdempotencyKey(), done })}
    >
      {children}
    </Link>
  );
}

export function RemixButton({ nodeId }: { readonly nodeId: string }) {
  const { t } = useI18n();
  const session = useQuery(sessionQueryOptions);
  const copy = useCopyAndOpen();
  const [guiding, setGuiding] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="max-sm:px-2"
        disabled={!session.data || copy.isPending}
        onClick={() =>
          session.data?.authenticated
            ? copy.mutate({ nodeId, key: createIdempotencyKey(), done: "remixDone" })
            : setGuiding(true)
        }
      >
        <CopyPlus aria-hidden="true" />
        <span className="max-sm:sr-only">{t(copy.isPending ? "remixCopying" : "remix")}</span>
      </Button>
      <Dialog
        open={guiding}
        onOpenChange={setGuiding}
        width="sm"
        title={t("remixTitle")}
        description={t("remixSignedOutDescription")}
        footer={
          <>
            <SignUpThenCopy nodeId={nodeId} done="remixDone" className={buttonVariants({ variant: "secondary" })}>
              {t("signUpFree")}
            </SignUpThenCopy>
            <Button onClick={() => copyHandToAgentPrompt(nodeId, t)}>
              <Bot aria-hidden="true" />
              {t("handToMyAgent")}
            </Button>
          </>
        }
      >
        {guiding ? (
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">
            {handToAgentPrompt(window.location.origin, nodeId)}
          </pre>
        ) : null}
      </Dialog>
    </>
  );
}

export function SaveMyVersionButton({ nodeId }: { readonly nodeId: string }) {
  const { t } = useI18n();
  const session = useQuery(sessionQueryOptions);
  const copy = useCopyAndOpen();
  if (!session.data?.authenticated) {
    return (
      <SignUpThenCopy nodeId={nodeId} done="saveMyVersionDone" className={buttonVariants({ size: "sm" })}>
        {t("saveMyVersion")}
      </SignUpThenCopy>
    );
  }
  return (
    <Button
      size="sm"
      disabled={copy.isPending}
      onClick={() => copy.mutate({ nodeId, key: createIdempotencyKey(), done: "saveMyVersionDone" })}
    >
      {t(copy.isPending ? "remixCopying" : "saveMyVersion")}
    </Button>
  );
}
