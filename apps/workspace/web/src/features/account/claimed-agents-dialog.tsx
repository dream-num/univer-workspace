import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useI18n } from "../../shared/i18n";
import { Alert, Badge, Button, buttonVariants, ConfirmDialog, Dialog } from "../../shared/ui";
import { cn } from "../../shared/utils/cn";
import { claimedAgentsQueryOptions, stopAgent } from "./claimed-agents.queries";

export function ClaimedAgentsDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return open ? <ClaimedAgentsDialogContent onOpenChange={onOpenChange} /> : null;
}

function ClaimedAgentsDialogContent({ onOpenChange }: { readonly onOpenChange: (open: boolean) => void }) {
  const { t, language } = useI18n();
  const client = useQueryClient();
  const agents = useQuery(claimedAgentsQueryOptions);
  const stop = useMutation({
    mutationFn: stopAgent,
    onSettled: () => client.invalidateQueries({ queryKey: claimedAgentsQueryOptions.queryKey }),
  });

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={t("myAgents")}
      description={t("myAgentsDescription")}
      width="xl"
      footer={<Button onClick={() => onOpenChange(false)}>{t("close")}</Button>}
    >
      <div className="grid gap-4">
        {agents.isPending ? <p role="status">{t("dashboardLoading")}</p> : null}
        {agents.error ? <Alert variant="destructive">{agents.error.message}</Alert> : null}
        {stop.error ? <Alert variant="destructive">{stop.error.message}</Alert> : null}
        {agents.data?.agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("myAgentsEmpty")}</p>
        ) : null}
        <ul className="grid gap-3">
          {agents.data?.agents.map((agent) => (
            <li key={agent.id} className="grid gap-3 rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <span className="min-w-0 break-words">
                  <span className="font-medium">{agent.displayName}</span>
                  <span className="ml-2 text-sm text-muted-foreground">@{agent.username}</span>
                  {agent.stopped ? <Badge className="ml-2">{t("myAgentsStopped")}</Badge> : null}
                </span>
                <div className="flex gap-2">
                  <Link
                    to="/spaces/$spaceId"
                    params={{ spaceId: agent.spaceId }}
                    search={{}}
                    className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "no-underline")}
                    onClick={() => onOpenChange(false)}
                  >
                    {t("myAgentsOpenSpace")}
                  </Link>
                  {agent.stopped ? null : (
                    <ConfirmDialog
                      trigger={
                        <Button variant="secondary" size="sm" aria-label={t("myAgentsStopNamed", { name: agent.displayName })}>
                          {t("myAgentsStop")}
                        </Button>
                      }
                      title={t("myAgentsStopTitle")}
                      description={t("myAgentsStopDescription", { name: agent.displayName })}
                      confirmText={t("myAgentsStop")}
                      cancelText={t("cancel")}
                      danger
                      disabled={stop.isPending}
                      onConfirm={() => {
                        stop.reset();
                        stop.mutate(agent.id);
                      }}
                    />
                  )}
                </div>
              </div>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">{t("myAgentsFiles")}</dt>
                  <dd>{agent.files}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("myAgentsLastActive")}</dt>
                  <dd>{new Date(agent.lastActiveAt).toLocaleString(language)}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
