import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { Bot } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createIdempotencyKey } from "../../shared/idempotency-key";
import { useI18n, type MessageKey } from "../../shared/i18n";
import { Button, buttonVariants, Dialog, toast } from "../../shared/ui";
import { cn } from "../../shared/utils/cn";
import { sessionQueryOptions } from "../auth";
import { copyToPersonalSpace } from "./copy";
import { copyHandToAgentPrompt, HAND_OFFS, HandToAgentChoice, type HandOff } from "./hand-to-agent";
import { invalidateProductLists } from "./nodes.commands";
import { nodeQueryOptions } from "./nodes.queries";

// Tab storage, not the return URL, so a link someone sends cannot make a copy in the reader's space.
const PENDING_COPY = "univer-workspace-pending-copy";
const PENDING_COPY_TTL_MS = 15 * 60 * 1000;
const AGENT_COPYABLE_TYPES: readonly string[] = ["sheet", "doc", "slide"];

type PendingCopy = { readonly nodeId: string; readonly key: string; readonly done: MessageKey };

function rememberCopy(pending: PendingCopy) {
  try {
    window.sessionStorage.setItem(PENDING_COPY, JSON.stringify({ ...pending, expiresAt: Date.now() + PENDING_COPY_TTL_MS }));
  } catch {
    // Without tab storage the reader signs up and asks for the copy again.
  }
}

/** Only the sign-up return that carries the copy's key takes it, and only before it expires. */
function takePendingCopy(nodeId: string, returnKey: string): PendingCopy | undefined {
  try {
    const value = window.sessionStorage.getItem(PENDING_COPY);
    const pending = value ? (JSON.parse(value) as PendingCopy & { readonly expiresAt: number }) : undefined;
    if (pending?.key !== returnKey) return undefined;
    window.sessionStorage.removeItem(PENDING_COPY);
    return pending.nodeId === nodeId && pending.expiresAt > Date.now() ? pending : undefined;
  } catch {
    return undefined;
  }
}

function useCopyAndOpen() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const client = useQueryClient();
  // Clicks that land before the trigger re-renders as disabled belong to the copy already running.
  const running = useRef(false);
  const mutation = useMutation({
    mutationFn: (pending: PendingCopy) =>
      copyToPersonalSpace(pending.nodeId, pending.key, {
        failed: t("remixFailed"),
        continuing: t("remixContinuing"),
        sheetUnreadable: t("remixSheetUnreadable"),
      }),
    onSuccess: async (copyId, pending) => {
      await invalidateProductLists(client, { htmlViews: true });
      toast.success(t(pending.done));
      await navigate({ to: "/nodes/$nodeId", params: { nodeId: copyId } });
    },
    onError: (error) => toast.error(error.message),
    onSettled: () => {
      running.current = false;
    },
  });
  return {
    isPending: mutation.isPending,
    start(pending: PendingCopy) {
      if (running.current) return;
      running.current = true;
      mutation.mutate(pending);
    },
  };
}

export function useFinishPendingCopy(nodeId: string, signedIn: boolean, returnKey: string | undefined) {
  const copy = useCopyAndOpen();
  useEffect(() => {
    if (!signedIn || !returnKey) return;
    const pending = takePendingCopy(nodeId, returnKey);
    if (pending) copy.start(pending);
  }, [nodeId, signedIn, returnKey]);
}

function SignUpThenCopy({ nodeId, done, className, children }: {
  readonly nodeId: string;
  readonly done: MessageKey;
  readonly className: string;
  readonly children: string;
}) {
  const location = useLocation();
  const [key] = useState(createIdempotencyKey);
  const returnTo = new URL(location.href, window.location.origin);
  returnTo.searchParams.set("copy", key);
  return (
    <Link
      to="/login"
      search={{ mode: "register", oauthError: undefined, returnTo: `${returnTo.pathname}${returnTo.search}${returnTo.hash}` }}
      className={cn(className, "no-underline")}
      onClick={() => rememberCopy({ nodeId, key, done })}
    >
      {children}
    </Link>
  );
}

export function useRemix(nodeId: string | undefined, onSignedOut: () => void) {
  const session = useQuery(sessionQueryOptions);
  const copy = useCopyAndOpen();
  return {
    disabled: !nodeId || !session.data || copy.isPending,
    isPending: copy.isPending,
    remix() {
      if (!nodeId || !session.data || copy.isPending) return;
      if (session.data.authenticated) {
        copy.start({ nodeId, key: createIdempotencyKey(), done: "remixDone" });
      } else {
        onSignedOut();
      }
    },
  };
}

export function RemixDialog({ nodeId, open, onOpenChange }: {
  readonly nodeId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const resource = useQuery(nodeQueryOptions(nodeId)).data?.node.resource;
  const agentCopies = resource?.kind === "univer" && AGENT_COPYABLE_TYPES.includes(resource.unitType);
  const [way, setWay] = useState<HandOff>(HAND_OFFS[0]);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width="sm"
      title={t("remixTitle")}
      description={t(agentCopies ? "remixSignedOutDescription" : "remixSignedOutSignUpDescription")}
      footer={
        <>
          <SignUpThenCopy nodeId={nodeId} done="remixDone" className={buttonVariants({ variant: agentCopies ? "secondary" : "primary" })}>
            {t("signUpFree")}
          </SignUpThenCopy>
          {agentCopies ? (
            <Button onClick={() => copyHandToAgentPrompt(nodeId, t, "copy", way)}>
              <Bot aria-hidden="true" />
              {t("handToMyAgent")}
            </Button>
          ) : null}
        </>
      }
    >
      {agentCopies ? <HandToAgentChoice nodeId={nodeId} task="copy" way={way} onWayChange={setWay} /> : null}
    </Dialog>
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
      onClick={() => copy.start({ nodeId, key: createIdempotencyKey(), done: "saveMyVersionDone" })}
    >
      {t(copy.isPending ? "remixCopying" : "saveMyVersion")}
    </Button>
  );
}
