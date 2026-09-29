import { CircleCheck, CircleDot, CircleSlash } from "lucide-react";
import { useI18n } from "../../shared/i18n";
import { cn } from "../../shared/utils/cn";

interface IssueStateValue {
  readonly state: "open" | "closed";
  readonly stateReason: "completed" | "not_planned" | null;
}

export function IssueStateIcon({
  issue,
  className,
}: {
  readonly issue: IssueStateValue;
  readonly className?: string;
}) {
  const { t } = useI18n();
  if (issue.state === "open") {
    return <CircleDot aria-label={t("issueStateOpen")} className={cn("size-4 text-state-open", className)} />;
  }
  return issue.stateReason === "not_planned" ? (
    <CircleSlash aria-label={t("issueStateNotPlanned")} className={cn("size-4 text-muted-foreground", className)} />
  ) : (
    <CircleCheck aria-label={t("issueStateCompleted")} className={cn("size-4 text-state-merged", className)} />
  );
}

export function IssueStateBadge({ issue }: { readonly issue: IssueStateValue }) {
  const { t } = useI18n();
  const tone =
    issue.state === "open"
      ? "bg-state-open-soft text-state-open"
      : issue.stateReason === "not_planned"
        ? "bg-muted text-muted-foreground"
        : "bg-state-merged-soft text-state-merged";
  const label =
    issue.state === "open"
      ? t("issueStateOpen")
      : issue.stateReason === "not_planned"
        ? t("issueStateNotPlanned")
        : t("issueStateCompleted");
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium", tone)}>
      <IssueStateIcon issue={issue} className="size-4 text-current" />
      {label}
    </span>
  );
}
