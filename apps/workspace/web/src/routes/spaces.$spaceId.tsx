import {
  AppWindow,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  CreateNodeDropdown,
  NodeBrowser,
  ResourceUnavailablePage,
  isResourceUnavailableError,
  spaceNodesQueryOptions,
} from "../features/nodes";
import { sessionQueryOptions } from "../features/auth";
import { BlobPreview } from "../features/blobs";
import { htmlViewsQueryOptions } from "../features/views/html-views.queries";
import { resourceOpenQueryOptions } from "../features/resources";
import { RepositoryTabs, spacesQueryOptions } from "../features/spaces";
import { WorkspaceHeaderSearch, WorkspaceLayout } from "./-workspace-layout";
import { formatRelativeDate } from "../shared/format-relative-date";
import { useI18n, type MessageKey } from "../shared/i18n";
import { useTheme } from "../shared/theme";
import { worktreeListQueryOptions } from "../features/worktrees";
import type { components } from "../../../generated/http/schema.js";
import { Button, Empty, buttonVariants } from "../shared/ui";
import { cn } from "../shared/utils/cn";

type SpaceView = components["schemas"]["SpaceView"];

type RepositoryPage = components["schemas"]["NodePage"];
type RepositoryApp = components["schemas"]["OwnedResourceItem"];
type RepositoryBlob = components["schemas"]["OpenBlobResource"];
type RepositoryView = "files" | "prs" | "apps";
type Worktree = components["schemas"]["WorktreeSummary"];

const OPEN_WORKTREE_STATES: readonly Worktree["state"][] = ["draft", "ready", "merging"];

export const Route = createFileRoute("/spaces/$spaceId")({
  validateSearch: (search: Readonly<Record<string, unknown>>) => ({
    ...(isRepositoryView(search.view) ? { view: search.view } : {}),
  }),
  loader: async ({ context, params }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions);
    try {
      await Promise.all([
        session.authenticated ? context.queryClient.ensureQueryData(spacesQueryOptions) : undefined,
        context.queryClient.ensureQueryData(spaceNodesQueryOptions(params.spaceId)),
      ]);
    } catch (error) {
      if (isResourceUnavailableError(error)) throw notFound();
      throw error;
    }
  },
  notFoundComponent: ResourceUnavailablePage,
  component: SpaceNodePage,
});

function SpaceNodePage() {
  const { spaceId } = Route.useParams();
  const { view } = Route.useSearch();
  const repositoryView: RepositoryView = isRepositoryView(view) ? view : "files";
  const query = useQuery(spaceNodesQueryOptions(spaceId));
  const session = useQuery(sessionQueryOptions);
  const spaces = useQuery({
    ...spacesQueryOptions,
    enabled: session.data?.authenticated === true,
  });
  const navigate = useNavigate();
  const { language, t } = useI18n();
  const { workspaceTheme } = useTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [landingNodeId, setLandingNodeId] = useState<string | undefined>(() => {
    try {
      return window.localStorage.getItem(`univer-workspace-landing-app:${spaceId}`) ?? undefined;
    } catch {
      return undefined;
    }
  });
  const space = session.data?.authenticated
    ? spaces.data?.spaces.find((item) => item.id === spaceId)
    : undefined;
  const repositoryTheme = workspaceTheme === "repository" && space !== undefined;
  const apps = useQuery({
    ...htmlViewsQueryOptions(spaceId),
    enabled: repositoryTheme,
  });
  const worktrees = useQuery({
    ...worktreeListQueryOptions("active"),
    enabled: repositoryTheme,
  });
  const processedWorktrees = useQuery({
    ...worktreeListQueryOptions("processed"),
    enabled: repositoryTheme,
  });
  const spaceApps = (apps.data?.items ?? []).filter((item) => item.location.space.id === spaceId);
  const selectedApp = spaceApps.find((item) => item.node.id === landingNodeId) ?? spaceApps[0];
  const spaceWorktrees = [
    ...(worktrees.data?.items ?? []),
    ...(processedWorktrees.data?.items ?? []),
  ].filter((item) => item.teamSpace?.id === spaceId);
  const openWorktreeCount = spaceWorktrees.filter((item) =>
    OPEN_WORKTREE_STATES.includes(item.state),
  ).length;
  useEffect(() => {
    if (
      !landingNodeId ||
      !apps.isSuccess ||
      spaceApps.some((item) => item.node.id === landingNodeId)
    )
      return;
    setLandingNodeId(undefined);
    try {
      window.localStorage.removeItem(`univer-workspace-landing-app:${spaceId}`);
    } catch {
      // Local storage may be unavailable.
    }
  }, [apps.isSuccess, landingNodeId, spaceApps, spaceId]);
  const selectedResource = useQuery({
    ...resourceOpenQueryOptions(selectedApp?.resource.id ?? ""),
    enabled: selectedApp !== undefined,
  });
  const retryRepositoryPage = () => {
    void apps.refetch();
    if (selectedApp) void selectedResource.refetch();
  };
  const setLandingApp = (nodeId: string) => {
    setLandingNodeId(nodeId);
    try {
      window.localStorage.setItem(`univer-workspace-landing-app:${spaceId}`, nodeId);
    } catch {
      // The current selection remains usable without browser storage.
    }
  };
  if (!query.data) return null;

  return (
    <WorkspaceLayout
      selectedSpaceId={spaceId}
      {...(repositoryTheme ? { repositoryTab: repositoryView } : {})}
      headerActions={
        repositoryTheme && space.capabilities.createAtRoot ? (
          <CreateNodeDropdown spaceId={spaceId} />
        ) : undefined
      }
      headerContent={
        repositoryTheme ? (
          <WorkspaceHeaderSearch
            placeholder={t("repositoryGoToFile")}
            value={searchQuery}
            onChange={setSearchQuery}
          />
        ) : undefined
      }
    >
      {repositoryTheme ? (
        <>
          <RepositoryTabs spaceId={spaceId} active={repositoryView} />
          <RepositoryOverview
            spaceId={spaceId}
            space={space}
            page={query.data}
            apps={spaceApps}
            selectedApp={selectedApp}
            resource={
              selectedResource.data?.resource.kind === "blob"
                ? selectedResource.data.resource
                : undefined
            }
            loading={apps.isPending || (selectedApp !== undefined && selectedResource.isPending)}
            error={apps.isError || selectedResource.isError}
            searchQuery={searchQuery}
            onRetry={retryRepositoryPage}
            onSelectApp={setLandingApp}
            onOpenApps={() => navigate({ to: "/apps", search: { spaceId } })}
            view={repositoryView}
            openWorktreeCount={openWorktreeCount}
            worktrees={spaceWorktrees}
            onOpenWorktrees={() => navigate({ to: "/worktrees", search: { spaceId } })}
          />
        </>
      ) : (
        <NodeBrowser
          page={query.data}
          canCreateAtRoot={space?.capabilities.createAtRoot ?? false}
          searchQuery={searchQuery}
        />
      )}
    </WorkspaceLayout>
  );
}

function RepositoryOverview({
  spaceId,
  space,
  page,
  apps,
  selectedApp,
  resource,
  loading,
  error,
  searchQuery,
  onRetry,
  onSelectApp,
  onOpenApps,
  view,
  openWorktreeCount,
  worktrees,
  onOpenWorktrees,
}: {
  readonly spaceId: string;
  readonly space: SpaceView | undefined;
  readonly page: RepositoryPage;
  readonly apps: readonly RepositoryApp[];
  readonly selectedApp: RepositoryApp | undefined;
  readonly resource: RepositoryBlob | undefined;
  readonly loading: boolean;
  readonly error: boolean;
  readonly searchQuery: string;
  readonly onRetry: () => void;
  readonly onSelectApp: (nodeId: string) => void;
  readonly onOpenApps: () => void;
  readonly view: RepositoryView;
  readonly openWorktreeCount: number;
  readonly worktrees: readonly Worktree[];
  readonly onOpenWorktrees: () => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto max-w-6xl px-6 py-6 max-[720px]:px-4 max-[720px]:py-4">
        {view === "files" ? (
          <FilesView
            spaceId={spaceId}
            space={space}
            page={page}
            apps={apps}
            selectedApp={selectedApp}
            resource={resource}
            loading={loading}
            error={error}
            searchQuery={searchQuery}
            onRetry={onRetry}
            onSelectApp={onSelectApp}
            onOpenApps={onOpenApps}
            openWorktreeCount={openWorktreeCount}
            fileCount={page.nodes.length}
          />
        ) : view === "apps" ? (
          <AppsView
            spaceId={spaceId}
            apps={apps}
            selectedApp={selectedApp}
            onSelectApp={onSelectApp}
            onOpenApps={onOpenApps}
          />
        ) : (
          <PullRequestsView spaceId={spaceId} worktrees={worktrees} onOpenWorktrees={onOpenWorktrees} />
        )}
      </div>
    </div>
  );
}

function FilesView({
  spaceId,
  page,
  apps,
  selectedApp,
  resource,
  loading,
  error,
  searchQuery,
  onRetry,
  onSelectApp,
  onOpenApps,
  openWorktreeCount,
  fileCount,
  space,
}: {
  readonly spaceId: string;
  readonly page: RepositoryPage;
  readonly apps: readonly RepositoryApp[];
  readonly selectedApp: RepositoryApp | undefined;
  readonly resource: RepositoryBlob | undefined;
  readonly loading: boolean;
  readonly error: boolean;
  readonly searchQuery: string;
  readonly onRetry: () => void;
  readonly onSelectApp: (nodeId: string) => void;
  readonly onOpenApps: () => void;
  readonly openWorktreeCount: number;
  readonly fileCount: number;
  readonly space: SpaceView | undefined;
}) {
  const { t } = useI18n();
  const showDefaultApp = loading || error || apps.length > 0;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="grid min-w-0 content-start gap-6">
        <section className="min-w-0 rounded-lg border border-border bg-background">
          <NodeBrowser
            page={page}
            canCreateAtRoot={false}
            showParentRow={page.parentNode !== null}
            searchQuery={searchQuery}
            className="[&>div]:h-auto [&>div]:overflow-visible [&>div>div:last-child]:overflow-visible"
          />
        </section>
        {showDefaultApp ? (
          <section className="min-w-0 rounded-lg border border-border bg-background">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2">
              {apps.length > 1 ? (
                <div role="tablist" aria-label={t("repositoryAppPreview")} className="flex min-w-0 gap-1">
                  {apps.map((app) => (
                    <button
                      key={app.node.id}
                      type="button"
                      role="tab"
                      aria-selected={selectedApp?.node.id === app.node.id}
                      onClick={() => onSelectApp(app.node.id)}
                      className={cn(
                        "max-w-52 truncate rounded-t-sm border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                        selectedApp?.node.id === app.node.id
                          ? "border-primary text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {displayAppName(app.node.name)}
                    </button>
                  ))}
                </div>
              ) : (
                <h2 className="m-0 min-w-0 truncate py-1 text-base font-semibold">
                  {selectedApp ? displayAppName(selectedApp.node.name) : t("apps")}
                </h2>
              )}
              {selectedApp ? (
                <Link
                  to="/nodes/$nodeId"
                  params={{ nodeId: selectedApp.node.id }}
                  aria-label={t("repositoryOpenPage")}
                  title={t("repositoryOpenPage")}
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "icon-sm" }),
                    "shrink-0 text-muted-foreground no-underline",
                  )}
                >
                  <ExternalLink className="size-4" />
                </Link>
              ) : null}
            </div>
            {loading ? (
              <Empty title={t("repositoryPageLoading")} className="min-h-64" />
            ) : error ? (
              <Empty title={t("repositoryPageError")}>
                <Button variant="secondary" onClick={onRetry}>
                  {t("repositoryPageRetry")}
                </Button>
              </Empty>
            ) : resource?.kind === "blob" ? (
              <div className="h-[calc(100dvh-8rem)] min-h-[640px] overflow-hidden rounded-b-lg">
                <BlobPreview resource={resource} actionsContainer={null} />
              </div>
            ) : (
              <Empty title={t("repositoryNoApps")} description={t("repositoryNoAppsDescription")}>
                <Button variant="secondary" onClick={onOpenApps}>
                  {t("viewApps")}
                </Button>
              </Empty>
            )}
          </section>
        ) : null}
      </div>
      <aside className="min-w-0 self-start rounded-lg border border-border bg-background">
        <div className="border-b border-border px-4 py-3">
          <h2 className="m-0 text-base font-semibold">{t("repositoryAbout")}</h2>
        </div>
        {space ? (
          <div className="grid gap-2 px-4 py-3 text-sm text-muted-foreground">
            <p className="m-0">
              {space.type === "personal"
                ? t("repositoryVisibilityPersonal")
                : space.publicRead
                  ? t("repositoryVisibilityPublic")
                  : t("repositoryVisibilityPrivate")}
            </p>
            <dl className="m-0 grid gap-1.5">
              <AboutRow label={t("repositoryAboutRole")} value={t(accessRoleKey(space.accessRole))} />
              <AboutRow
                label={t("repositoryAboutFiles")}
                value={String(fileCount)}
              />
              <AboutRow label={t("repositoryAboutApps")} value={String(apps.length)} />
              <AboutRow
                label={t("repositoryAboutOpenPrs")}
                value={String(openWorktreeCount)}
              />
            </dl>
            {space.type === "team" ? (
              <div className="flex min-w-0 items-center gap-1 text-xs text-subtle-foreground">
                <span className="shrink-0">{t("teamSpaceId")}:</span>
                <code className="truncate text-foreground" title={spaceId}>
                  {spaceId}
                </code>
              </div>
            ) : null}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function AboutRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="m-0">{label}</dt>
      <dd className="m-0 font-medium text-foreground">{value}</dd>
    </div>
  );
}

function accessRoleKey(role: SpaceView["accessRole"]): MessageKey {
  if (role === "owner") return "accessOwner";
  if (role === "admin") return "accessAdmin";
  if (role === "editor") return "accessEditor";
  return "accessViewer";
}

function displayAppName(name: string): string {
  return name.replace(/\.univer\.html$/iu, "");
}

function AppsView({
  spaceId,
  apps,
  selectedApp,
  onSelectApp,
  onOpenApps,
}: {
  readonly spaceId: string;
  readonly apps: readonly RepositoryApp[];
  readonly selectedApp: RepositoryApp | undefined;
  readonly onSelectApp: (nodeId: string) => void;
  readonly onOpenApps: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="rounded-lg border border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <h2 className="m-0 text-base font-semibold">{t("apps")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("repositoryAppsSummary", { count: apps.length })}
        </p>
      </div>
      {apps.length ? (
        <ul className="m-0 list-none divide-y divide-border p-0">
          {apps.map((app) => (
            <li key={app.node.id} className="flex items-center gap-3 px-4 py-3">
              <AppWindow className="size-4 shrink-0 text-muted-foreground" />
              <Link
                to="/nodes/$nodeId"
                params={{ nodeId: app.node.id }}
                className="min-w-0 flex-1 truncate font-medium text-foreground no-underline hover:underline"
              >
                {displayAppName(app.node.name)}
              </Link>
              <span className="shrink-0 text-xs text-muted-foreground">
                {t("repositoryHtmlView")}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={selectedApp?.node.id === app.node.id}
                onClick={() => onSelectApp(app.node.id)}
              >
                {selectedApp?.node.id === app.node.id
                  ? t("repositoryLandingApp")
                  : t("repositorySetLandingApp")}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title={t("repositoryNoApps")} description={t("repositoryNoAppsDescription")}>
          <Button variant="secondary" onClick={onOpenApps}>
            {t("viewApps")}
          </Button>
        </Empty>
      )}
    </section>
  );
}

function PullRequestsView({
  spaceId,
  worktrees,
  onOpenWorktrees,
}: {
  readonly spaceId: string;
  readonly worktrees: readonly Worktree[];
  readonly onOpenWorktrees: () => void;
}) {
  const { language, t } = useI18n();
  const [stateFilter, setStateFilter] = useState<"open" | "closed">(() =>
    worktrees.some((worktree) => OPEN_WORKTREE_STATES.includes(worktree.state))
      ? "open"
      : "closed",
  );
  const openCount = worktrees.filter((worktree) =>
    OPEN_WORKTREE_STATES.includes(worktree.state),
  ).length;
  const visible = worktrees.filter((worktree) =>
    stateFilter === "open"
      ? OPEN_WORKTREE_STATES.includes(worktree.state)
      : !OPEN_WORKTREE_STATES.includes(worktree.state),
  );
  return (
    <section className="rounded-lg border border-border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="m-0 text-base font-semibold">{t("repositoryPullRequests")}</h2>
        <div className="flex items-center gap-4 text-sm">
          <button
            type="button"
            onClick={() => setStateFilter("open")}
            aria-pressed={stateFilter === "open"}
            className={cn(
              "flex items-center gap-1.5 font-medium",
              stateFilter === "open" ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <GitPullRequest className="size-4" />
            {t("repositoryPullRequestsOpen")}
            <span className="tabular-nums">{openCount}</span>
          </button>
          <button
            type="button"
            onClick={() => setStateFilter("closed")}
            aria-pressed={stateFilter === "closed"}
            className={cn(
              "flex items-center gap-1.5 font-medium",
              stateFilter === "closed" ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {t("repositoryPullRequestsClosed")}
            <span className="tabular-nums">{worktrees.length - openCount}</span>
          </button>
        </div>
      </div>
      {visible.length ? (
        <ul className="m-0 list-none p-0">
          {visible.map((worktree) => (
            <li key={worktree.id} className="border-b border-border last:border-b-0">
              <Link
                to="/worktrees"
                search={{ spaceId, worktree: worktree.id }}
                className="flex items-start gap-3 px-4 py-4 no-underline hover:bg-accent/60"
              >
                <WorktreeStateIcon state={worktree.state} />
                <div className="min-w-0 flex-1">
                  <p className="m-0 flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-foreground">{worktree.name}</span>
                    <span className="shrink-0 text-sm text-muted-foreground">
                      {t("repositoryWorktreeUnits", { count: worktree.unitCount })}
                    </span>
                  </p>
                  <p className="mt-1 mb-0 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                    <span>
                      {t("repositoryWorktreeCreatedBy", {
                        name: worktree.creator.displayName,
                        date: formatRelativeDate(worktree.createdAt, language),
                      })}
                    </span>
                    <WorktreeStateLabel state={worktree.state} />
                  </p>
                  {worktree.summary ? (
                    <p className="mt-1.5 mb-0 line-clamp-2 text-sm text-muted-foreground">
                      {worktree.summary}
                    </p>
                  ) : null}
                </div>
                <ExternalLink className="mt-1 size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Empty
          title={t("repositoryNoPullRequests")}
          description={t("repositoryNoPullRequestsDescription")}
        >
          <Button variant="secondary" onClick={onOpenWorktrees}>
            {t("repositoryOpenWorkbench")}
          </Button>
        </Empty>
      )}
    </section>
  );
}

function WorktreeStateIcon({ state }: { readonly state: Worktree["state"] }) {
  if (state === "merged") return <GitMerge className="mt-1 size-4 shrink-0 text-violet-600" />;
  if (state === "discarded")
    return <GitPullRequestClosed className="mt-1 size-4 shrink-0 text-destructive" />;
  if (state === "draft")
    return <GitPullRequestDraft className="mt-1 size-4 shrink-0 text-muted-foreground" />;
  return <GitPullRequest className="mt-1 size-4 shrink-0 text-emerald-600" />;
}

const WORKTREE_STATE_LABELS: Record<Worktree["state"], MessageKey> = {
  draft: "worktreeStateDraft",
  ready: "worktreeStateReady",
  merging: "worktreeStateMerging",
  merged: "worktreeStateMerged",
  discarded: "worktreeStateDiscarded",
};

function WorktreeStateLabel({ state }: { readonly state: Worktree["state"] }) {
  const { t } = useI18n();
  const open = OPEN_WORKTREE_STATES.includes(state);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        open
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : state === "merged"
            ? "bg-violet-500/10 text-violet-700 dark:text-violet-400"
            : "bg-destructive/10 text-destructive",
      )}
    >
      {t(WORKTREE_STATE_LABELS[state])}
    </span>
  );
}

function isRepositoryView(value: unknown): value is RepositoryView {
  return value === "files" || value === "prs" || value === "apps";
}

