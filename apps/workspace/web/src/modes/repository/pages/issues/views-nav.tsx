import { Link } from "@tanstack/react-router";
import { CircleDot, Clock, PanelLeftClose, Tag, User, Users } from "lucide-react";
import type { IssueFilters } from "../../../../features/issues/issues.queries";
import { useI18n } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui";
import { cn } from "../../../../shared/utils/cn";

export function IssueViewsNav({
  spaceId,
  filters,
  onCollapse,
}: {
  readonly spaceId: string;
  readonly filters: IssueFilters;
  readonly onCollapse: () => void;
}) {
  const { t } = useI18n();
  return (
    <nav aria-label={t("issueViews")} className="w-64 shrink-0 border-r border-border p-4 max-[900px]:hidden">
      {[
        {
          label: t("issues"),
          icon: CircleDot,
          search: {},
          active: !filters.assignee && !filters.author && filters.sort === "created",
        },
        {
          label: t("issueFilterAssigneeMe"),
          icon: Users,
          search: { assignee: "me" },
          active: filters.assignee === "me" && !filters.author,
        },
        {
          label: t("issueFilterAuthorMe"),
          icon: User,
          search: { author: "me" },
          active: filters.author === "me" && !filters.assignee,
        },
        {
          label: t("issueRecentActivity"),
          icon: Clock,
          search: { sort: "updated" as const },
          active: !filters.assignee && !filters.author && filters.sort === "updated",
        },
      ].map(({ label, icon: Icon, search: view, active }) => (
        <Link
          key={label}
          to="/spaces/$spaceId/issues"
          params={{ spaceId }}
          search={view}
          aria-current={active ? "page" : undefined}
          className={cn(
            "relative flex min-h-8 items-center gap-2 rounded-sm px-2 text-sm text-foreground no-underline hover:bg-accent",
            active &&
              "bg-accent font-semibold before:absolute before:-left-2 before:h-6 before:w-1 before:rounded-full before:bg-info-soft-foreground",
          )}
        >
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          {label}
        </Link>
      ))}
      <div className="my-5 border-t border-border" />
      <Link
        to="/spaces/$spaceId/issues/labels"
        params={{ spaceId }}
        className="flex min-h-8 items-center gap-2 rounded-sm px-2 text-foreground no-underline hover:bg-accent"
      >
        <Tag className="size-4 text-muted-foreground" />
        {t("issueLabels")}
      </Link>
      <Button variant="ghost" className="mt-6 w-full justify-start px-2" onClick={onCollapse} aria-expanded={true}>
        <PanelLeftClose />
        {t("issueCollapseSidebar")}
      </Button>
    </nav>
  );
}
