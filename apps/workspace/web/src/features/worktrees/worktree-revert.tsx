import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArchiveRestore, Ban, RotateCcw, Trash2, Undo2, type LucideIcon } from "lucide-react";
import { useState } from "react";
import type { components } from "../../../../generated/http/schema.js";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { formatRelativeDate } from "../../shared/format-relative-date";
import { createIdempotencyKey } from "../../shared/idempotency-key";
import { useI18n, type MessageKey } from "../../shared/i18n";
import { Badge, Button, ConfirmDialog, Spinner, toast } from "../../shared/ui";
import { worktreesQueryKey } from "./worktrees.queries";

type Item = components["schemas"]["RevertItem"];
type Force = NonNullable<components["schemas"]["RevertRequest"]["force"]>;
export type RevertTarget = { readonly worktreeId: string } | { readonly spaceId: string; readonly number: number };

const ACTIONS: Readonly<Record<Item["action"], { readonly label: MessageKey; readonly icon: LucideIcon }>> = {
  restore: { label: "revertActionRestore", icon: RotateCcw },
  trash: { label: "revertActionTrash", icon: Trash2 },
  recover: { label: "revertActionRecover", icon: ArchiveRestore },
  none: { label: "revertActionNone", icon: Ban },
};
const STATES = {
  ready: { label: "revertStateReady", variant: "brand" },
  blocked: { label: "revertStateBlocked", variant: "warning" },
  done: { label: "revertStateDone", variant: "success" },
  unavailable: { label: "revertStateUnavailable", variant: "outline" },
  refused: { label: "revertStateRefused", variant: "danger" },
  failed: { label: "revertStateFailed", variant: "danger" },
} as const satisfies Record<Item["state"], { readonly label: MessageKey; readonly variant: string }>;
const LIMITS: readonly MessageKey[] = ["revertLimitWhole", "revertLimitOutside", "revertLimitBytes", "revertLimitHistory", "revertLimitConcurrent"];

function revertPlanQueryOptions(target: RevertTarget) {
  return queryOptions({
    queryKey: ["revert-plan", target],
    queryFn: async () => {
      const { data, error } = "worktreeId" in target
        ? await api.GET("/api/worktrees/{worktreeId}/revert", { params: { path: { worktreeId: target.worktreeId } } })
        : await api.GET("/api/spaces/{spaceId}/issues/{number}/revert", { params: { path: target } });
      if (error) throw apiError(error);
      return data;
    },
  });
}

function useRevert(target: RevertTarget) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (force: Force) => {
      const header = { "Idempotency-Key": createIdempotencyKey() };
      const body = force.length ? { force } : {};
      const { data, error } = "worktreeId" in target
        ? await api.POST("/api/worktrees/{worktreeId}/revert", { params: { path: { worktreeId: target.worktreeId }, header }, body })
        : await api.POST("/api/spaces/{spaceId}/issues/{number}/revert", { params: { path: target, header }, body });
      if (error) throw apiError(error);
      return data;
    },
    onSettled: () => Promise.all([worktreesQueryKey, ["issues"], ["nodes"], ["resources"], ["trash"]]
      .map((queryKey) => client.invalidateQueries({ queryKey }))),
  });
}

export function RevertSection({ target }: { readonly target: RevertTarget }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [forced, setForced] = useState<ReadonlySet<string>>(new Set());
  const plan = useQuery({ ...revertPlanQueryOptions(target), enabled: open });
  const revert = useRevert(target);
  const result = revert.data && "items" in revert.data ? revert.data.items : null;
  const items = result ?? plan.data?.items ?? [];
  const force = items.filter((item) => item.state === "blocked" && item.unitId !== null && forced.has(item.unitId))
    .map((item) => ({ unitId: item.unitId!, headRevision: item.headRevision! }));
  const run = () => revert.mutate(force, {
    onSuccess: (data) => {
      if (!("items" in data)) toast.info(t("revertRunning"));
      else if (data.items.some((item) => item.state === "blocked" || item.state === "failed")) toast.info(t("revertPartly"));
      else toast.success(t("revertDone"));
    },
    onError: (error) => toast.error(error.message),
  });
  const toggle = (unitId: string) => setForced((current) => {
    const next = new Set(current);
    if (!next.delete(unitId)) next.add(unitId);
    return next;
  });
  return (
    <section aria-label={t("revertTitle")} className="grid min-w-0 gap-3" data-revert-panel="">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-sm font-semibold">{t("revertTitle")}</h2>
        {open ? null : (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            <Undo2 />
            {t("revertReview")}
          </Button>
        )}
      </div>
      {!open ? null : plan.isPending ? (
        <Spinner />
      ) : plan.isError ? (
        <p role="alert" className="m-0 text-sm text-destructive">{plan.error.message}</p>
      ) : (
        <>
          {plan.data.refusal && !result ? <p className="m-0 text-sm text-muted-foreground">{plan.data.refusal}</p> : null}
          <ul className="m-0 grid list-none gap-2 p-0">
            {items.map((item, index) => (
              <RevertRow
                key={`${item.action}:${item.unitId ?? item.nodeId ?? index}`}
                item={item}
                force={!result && plan.data.capabilities.force && item.state === "blocked" && item.unitId !== null
                  ? { checked: forced.has(item.unitId), onChange: () => toggle(item.unitId!) }
                  : null}
              />
            ))}
          </ul>
          <div className="grid gap-1">
            <h3 className="m-0 text-xs font-semibold text-muted-foreground">{t("revertLimitsTitle")}</h3>
            <ul className="m-0 grid list-disc gap-1 pl-5 text-xs text-muted-foreground">
              {LIMITS.map((key) => <li key={key}>{t(key)}</li>)}
            </ul>
          </div>
          {result || !plan.data.capabilities.revert ? null : (
            <div className="flex justify-end">
              <ConfirmDialog
                title={t("revertConfirmTitle")}
                description={t("revertConfirmDescription") + (force.length ? ` ${t("revertConfirmForce", { count: force.length })}` : "")}
                confirmText={t("revertConfirm")}
                cancelText={t("cancel")}
                danger
                onConfirm={run}
                trigger={
                  <Button size="sm" variant="destructive" disabled={revert.isPending}>
                    <Undo2 />
                    {t("revertConfirm")}
                  </Button>
                }
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}

function RevertRow({ item, force }: {
  readonly item: Item;
  readonly force: { readonly checked: boolean; readonly onChange: () => void } | null;
}) {
  const { language, t } = useI18n();
  const { icon: Icon, label } = ACTIONS[item.action];
  const state = STATES[item.state];
  return (
    <li className="grid min-w-0 gap-1 text-sm" data-revert-item={item.state}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">{item.name}</span>
        <span className="text-muted-foreground">{t(label)}</span>
        <Badge variant={state.variant}>{t(state.label)}</Badge>
      </div>
      {item.reason ? <p className="m-0 pl-6 text-xs text-muted-foreground">{item.reason}</p> : null}
      {item.laterEdits.length ? (
        <ul className="m-0 grid list-none gap-0.5 p-0 pl-6 text-xs text-muted-foreground">
          {item.laterEdits.map((edit, index) => (
            <li key={edit.user?.id ?? index}>
              {t("revertLaterEdit", {
                name: edit.user?.displayName ?? t("revertRemovedUser"),
                count: edit.revisions,
                date: edit.lastEditedAt ? formatRelativeDate(edit.lastEditedAt, language) : "",
              })}
            </li>
          ))}
        </ul>
      ) : null}
      {force ? (
        <label className="flex cursor-pointer items-center gap-2 pl-6 text-xs">
          <input type="checkbox" className="size-4 shrink-0 accent-destructive" checked={force.checked} onChange={force.onChange} />
          {t("revertForce")}
        </label>
      ) : null}
    </li>
  );
}
