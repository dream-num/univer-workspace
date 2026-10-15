import { AppWindow, CircleDot, CodeXml, GitPullRequest, Settings } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useI18n } from "../../shared/i18n";
import { worktreeBelongsToSpace, worktreeListQueryOptions } from "../worktrees";
import { issueCountsQueryOptions } from "../issues/issues.queries";
import { spacesQueryOptions } from "./spaces.queries";
import { RepositoryHeader } from "./repository-header";

export type RepositoryTab = "files" | "issues" | "prs" | "apps" | "settings";

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
  const navigation = useRef<HTMLElement>(null);
  const hasIssues = space?.type === "team";
  const issueCounts = useQuery({ ...issueCountsQueryOptions(spaceId), enabled: hasIssues });
  const openWorktreeCount = space
    ? [...(activeWorktrees.data?.items ?? []), ...(processedWorktrees.data?.items ?? [])].filter(
        (worktree) =>
          worktreeBelongsToSpace(worktree, space) && OPEN_WORKTREE_STATES.includes(worktree.state),
      ).length
    : 0;
  const canOpenSettings =
    space?.capabilities.renameSpace ||
    space?.capabilities.manageMembers ||
    space?.capabilities.viewTrash;
  useEffect(() => {
    navigation.current?.querySelector('[aria-current="page"]')?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [active, space?.id, issueCounts.data?.open, openWorktreeCount, t]);
  const items: readonly {
    readonly tab: Exclude<RepositoryTab, "settings">;
    readonly label: string;
    readonly icon: typeof CodeXml;
    readonly count?: number;
  }[] = [
    { tab: "files", label: t("repositoryCode"), icon: CodeXml },
    ...(hasIssues
      ? [
          {
            tab: "issues" as const,
            label: t("issues"),
            icon: CircleDot,
            ...(issueCounts.data?.open ? { count: issueCounts.data.open } : {}),
          },
        ]
      : []),
    {
      tab: "prs",
      label: t("repositoryPullRequests"),
      icon: GitPullRequest,
      ...(openWorktreeCount ? { count: openWorktreeCount } : {}),
    },
    { tab: "apps", label: t("apps"), icon: AppWindow },
  ];
  return (
    <>
      <div className="repository-chrome shrink-0 border-b border-border bg-surface">
        <nav
          ref={navigation}
          aria-label={t("repository")}
          className="flex h-11 items-start gap-2 overflow-x-auto px-4 pt-1"
        >
          {items.map(({ tab, label, icon: Icon, count }) =>
            tab === "issues" ? (
              <Link
                key={tab}
                to="/spaces/$spaceId/issues"
                params={{ spaceId }}
                search={{}}
                aria-current={active === "issues" ? "page" : undefined}
                className={repositoryTabClass(active === "issues")}
              >
                <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
                {label}
                {count ? (
                  <span className="min-w-5 rounded-full bg-repository-counter px-1.5 text-center text-xs leading-5 tabular-nums">
                    {count}
                  </span>
                ) : null}
              </Link>
            ) : tab === "files" ? (
              <RepositoryTabLink
                key={tab}
                spaceId={spaceId}
                to={{ tab }}
                active={active === tab}
                icon={<Icon aria-hidden="true" className="size-4 text-muted-foreground" />}
                label={label}
              />
            ) : (
              <RepositoryTabLink
                key={tab}
                spaceId={spaceId}
                to={tab === "prs" ? { tab, view: "prs" } : { tab, view: "apps" }}
                active={active === tab}
                icon={<Icon aria-hidden="true" className="size-4 text-muted-foreground" />}
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
              className={repositoryTabClass(active === "settings")}
            >
              <Settings aria-hidden="true" className="size-4 text-muted-foreground" />
              {t("spaceSettings")}
            </Link>
          ) : null}
        </nav>
      </div>
      {space ? <RepositoryHeader key={space.id} space={space} /> : null}
    </>
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
  readonly to:
    | { readonly tab: "files" }
    | { readonly tab: "prs"; readonly view: "prs" }
    | { readonly tab: "apps"; readonly view: "apps" };
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
      activeOptions={{ exact: true, includeSearch: true }}
      aria-current={active ? "page" : undefined}
      className={repositoryTabClass(active)}
    >
      {icon}
      {label}
      {count ? (
        <span className="min-w-5 rounded-full bg-repository-counter px-1.5 text-center text-xs leading-5 tabular-nums">
          {count}
        </span>
      ) : null}
    </Link>
  );
}

function repositoryTabClass(active: boolean): string {
  return [
    "relative flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-sm leading-5 text-foreground no-underline hover:bg-accent after:absolute after:-bottom-2 after:inset-x-0 after:h-0.5 after:rounded-full",
    active ? "font-semibold after:bg-repository-selected" : "font-normal",
  ].join(" ");
}

/** Existing tab content keeps its own page container. */
export function RepositoryPage({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto max-w-6xl px-6 py-6 max-[720px]:px-4 max-[720px]:py-4">
        {children}
      </div>
    </div>
  );
}
