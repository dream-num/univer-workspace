import { FileText, GitPullRequest, type LucideIcon } from "lucide-react";
import { useId, type ReactNode } from "react";
import { Badge } from "../../../shared/ui";

export function StepCard({ icon: Icon, title, lead, children, footer }: {
  icon: LucideIcon;
  title: string;
  lead?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  return <div className="flex min-h-full justify-center bg-surface px-6 pt-[9vh] pb-24 text-sm">
    <section aria-labelledby={titleId} className="h-fit w-full max-w-140 rounded-xl border border-border bg-background shadow-lg">
      <div className="flex flex-col gap-5 px-7 pt-7 pb-6">
        <div className="flex items-start gap-3.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-5" /></span>
          <div className="min-w-0">
            <h2 id={titleId} className="m-0 text-lg font-semibold tracking-tight">{title}</h2>
            {lead && <div className="mt-1.5 leading-relaxed text-muted-foreground">{lead}</div>}
          </div>
        </div>
        {children}
      </div>
      {footer && <div className="flex flex-wrap items-center gap-2.5 border-t border-border px-7 py-4">{footer}</div>}
    </section>
  </div>;
}

export function PullRequestChip({ repo, pr }: { repo: string; pr: number }) {
  return <Badge><GitPullRequest />{repo} #{pr}</Badge>;
}

export function PageBox({ name, source, pullRequest }: { name: string; source: string; pullRequest?: { repo: string; pr: number } | undefined }) {
  return <div className="flex items-center gap-3 rounded-md bg-muted px-3.5 py-3">
    <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-background text-muted-foreground"><FileText className="size-4" /></span>
    <div className="min-w-0">
      <div className="font-semibold break-all">{name}</div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-subtle-foreground">{source}{pullRequest && <PullRequestChip {...pullRequest} />}</div>
    </div>
  </div>;
}
