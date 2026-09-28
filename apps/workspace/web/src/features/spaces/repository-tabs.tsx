import { AppWindow, FileText, GitPullRequest, Settings } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "../../shared/i18n";
import { worktreeListQueryOptions } from "../worktrees";
import { spacesQueryOptions } from "./spaces.queries";

export type RepositoryTab = "files" | "prs" | "apps" | "settings";

type RepositoryTabTarget =
  | { readonly tab: "files" }
  | { readonly tab: "prs"; readonly view: "prs" }
  | { readonly tab: "apps"; readonly view: "apps" };

const OPEN_WORKTREE_STATES = ["draft", "ready", "merging"];

/** GitHub-style repository tabs, shared by every repository page. */
export function RepositoryTabs({
  spaceId,
  active,
}: {
  readonly spaceId: string;
  readonly active: RepositoryTab;
}) {
  const { t } = useI18n();
  const spaces = useQuery(spacesQueryOptions);
  const activeWorktrees = useQuery(worktreeListQueryOptions("active"));
  const processedWorktrees = useQuery(worktreeListQueryOptions("processed"));
  const space = spaces.data?.spaces.find((item) => item.id === spaceId);
  const openWorktreeCount = [
    ...(activeWorktrees.data?.items ?? []),
    ...(processedWorktrees.data?.items ?? []),
  ].filter(
    (worktree) =>
      worktree.teamSpace?.id === spaceId && OPEN_WORKTREE_STATES.includes(worktree.state),
  ).length;
  const canOpenSettings =
    space?.capabilities.renameSpace ||
    space?.capabilities.manageMembers ||
    space?.capabilities.viewTrash;
  const items: readonly {
    readonly tab: Exclude<RepositoryTab, "settings">;
    readonly label: string;
    readonly icon: typeof FileText;
    readonly count?: number;
  }[] = [
    { tab: "files", label: t("repositoryFiles"), icon: FileText },
    { tab: "prs", label: t("repositoryPullRequests"), icon: GitPullRequest, ...(openWorktreeCount ? { count: openWorktreeCount } : {}) },
    { tab: "apps", label: t("apps"), icon: AppWindow },
  ];
  return (
    <div className="border-b border-border bg-surface">
      <nav
        aria-label={t("repository")}
        className="mx-auto flex max-w-6xl items-end gap-1 px-6 max-[720px]:gap-0 max-[720px]:px-4"
      >
        {items.map(({ tab, label, icon: Icon, count }) =>
          tab === "files" ? (
            <RepositoryTabLink
              key={tab}
              spaceId={spaceId}
              to={{ tab }}
              active={active === tab}
              icon={<Icon className="size-4" />}
              label={label}
            />
          ) : (
            <RepositoryTabLink
              key={tab}
              spaceId={spaceId}
              to={tab === "prs" ? { tab, view: "prs" } : { tab, view: "apps" }}
              active={active === tab}
              icon={<Icon className="size-4" />}
              label={label}
              {...(count === undefined ? {} : { count })}
            />
          ),
        )}
        {canOpenSettings ? (
          <Link
            to="/spaces/$spaceId/settings"
            params={{ spaceId }}
            aria-current={active === "settings" ? "page" : undefined}
            className={repositoryTabClass(active === "settings", "ml-auto")}
          >
            <Settings className="size-4" />
            <span className="max-[720px]:hidden">{t("spaceSettings")}</span>
          </Link>
        ) : null}
      </nav>
    </div>
  );
}

function RepositoryTabLink({
  spaceId,
  to,
  active,
  icon,
  label,
  count,
}: {
  readonly spaceId: string;
  readonly to: { readonly tab: "files" } | { readonly tab: "prs"; readonly view: "prs" } | { readonly tab: "apps"; readonly view: "apps" };
  readonly active: boolean;
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly count?: number;
}) {
  return (
    <Link
      to="/spaces/$spaceId"
      params={{ spaceId }}
      search={to.tab === "files" ? {} : { view: to.view }}
      aria-current={active ? "page" : undefined}
      className={repositoryTabClass(active)}
    >
      {icon}
      {label}
      {count ? (
        <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">{count}</span>
      ) : null}
    </Link>
  );
}

function repositoryTabClass(active: boolean, extra?: string): string {
  return [
    "flex min-h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium no-underline transition-colors max-[720px]:px-2.5",
    active
      ? "border-primary text-foreground"
      : "border-transparent text-muted-foreground hover:text-foreground",
    extra ?? "",
  ].join(" ");
}

/** Shared page container so every repository page lines up with the tabs above. */
export function RepositoryPage({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto max-w-6xl px-6 py-6 max-[720px]:px-4 max-[720px]:py-4">
        {children}
      </div>
    </div>
  );
}
