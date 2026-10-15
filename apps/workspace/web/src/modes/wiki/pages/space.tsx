import { Route } from "../../../routes/spaces.$spaceId";
import {
  ExternalLink,
  FileDiff,
  GitPullRequest,
  Search,
  X,
  Link as LinkIcon,
  Settings,
  Star,
  Users,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { NodeBrowser, spaceNodesQueryOptions } from "../../../features/nodes";
import { sessionQueryOptions } from "../../../features/auth";
import { BlobPreview } from "../../../features/blobs";
import { htmlViewsQueryOptions } from "../../../features/views/html-views.queries";
import { resourceOpenQueryOptions } from "../../../features/resources";
import { resourceShareUrl } from "../../../features/resource-view/resource-view";
import {
  RepositoryTabs,
  spaceDisplayName,
  spaceStarQueryOptions,
  spacesQueryOptions,
} from "../../../features/spaces";
import { WorkspaceLayout } from "../../../routes/-workspace-layout";
import { formatRelativeDate } from "../../../shared/format-relative-date";
import { useI18n } from "../../../shared/i18n";
import { useTheme } from "../../../shared/theme";
import { isOpenWorktree, worktreeBelongsToSpace, worktreeListQueryOptions } from "../../../features/worktrees";
import type { components } from "../../../../../generated/http/schema.js";
import { Button, Empty, Input, Skeleton, buttonVariants, toast } from "../../../shared/ui";
import { RepositoryPrState } from "../../../features/worktrees/repository-pr-state";
import { cn } from "../../../shared/utils/cn";

type SpaceView = components["schemas"]["SpaceView"];

type RepositoryPage = components["schemas"]["NodePage"];
type RepositoryApp = components["schemas"]["OwnedResourceItem"];
type RepositoryBlob = components["schemas"]["OpenBlobResource"];
type RepositoryView = "files" | "prs" | "apps";
type Worktree = components["schemas"]["WorktreeSummary"];

export function WikiSpacePage() {
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
  const spaceName = spaceDisplayName(
    space,
    t,
    session.data?.authenticated ? session.data.user.username : undefined,
  );
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
  ].filter((item) => space !== undefined && worktreeBelongsToSpace(item, space));
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
  // Wiki mode keeps its Space management entry points; repository mode reaches
  // the same pages through the repository tabs.
  const wikiPageActions =
    space?.type === "team" || space?.capabilities.renameSpace ? (
      <>
        {space?.type === "team" ? (
          <Button
            variant="secondary"
            onClick={() => void navigate({ to: "/spaces/$spaceId/members", params: { spaceId } })}
          >
            <Users />
            {t("members")}
          </Button>
        ) : null}
        {space?.capabilities.renameSpace ? (
          <Button
            variant="secondary"
            onClick={() => void navigate({ to: "/spaces/$spaceId/settings", params: { spaceId } })}
          >
            <Settings />
            {t("spaceSettings")}
          </Button>
        ) : null}
      </>
    ) : null;

  return (
    <WorkspaceLayout
      selectedSpaceId={spaceId}
      {...(repositoryTheme ? { repositoryTab: repositoryView } : {})}
    >
      {repositoryTheme ? (
        <>
          <RepositoryTabs spaceId={spaceId} active={repositoryView} />
          <RepositoryOverview
            spaceId={spaceId}
            space={space}
            spaceName={spaceName}
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
            onRetry={retryRepositoryPage}
            onSelectApp={setLandingApp}
            view={repositoryView}
            worktrees={spaceWorktrees}
            worktreesLoading={worktrees.isPending || processedWorktrees.isPending}
            worktreesError={worktrees.isError || processedWorktrees.isError}
            onRetryWorktrees={() => {
              void worktrees.refetch();
              void processedWorktrees.refetch();
            }}
            onOpenWorktrees={() => navigate({ to: "/worktrees", search: { spaceId } })}
          />
        </>
      ) : (
        <NodeBrowser
          page={query.data}
          canCreateAtRoot={space?.capabilities.createAtRoot ?? false}
          actions={wikiPageActions}
        />
      )}
    </WorkspaceLayout>
  );
}

function RepositoryOverview({
  spaceId,
  space,
  spaceName,
  page,
  apps,
  selectedApp,
  resource,
  loading,
  error,
  onRetry,
  onSelectApp,
  view,
  worktrees,
  worktreesLoading,
  worktreesError,
  onRetryWorktrees,
  onOpenWorktrees,
}: {
  readonly spaceId: string;
  readonly space: SpaceView | undefined;
  readonly spaceName: string | undefined;
  readonly page: RepositoryPage;
  readonly apps: readonly RepositoryApp[];
  readonly selectedApp: RepositoryApp | undefined;
  readonly resource: RepositoryBlob | undefined;
  readonly loading: boolean;
  readonly error: boolean;
  readonly onRetry: () => void;
  readonly onSelectApp: (nodeId: string) => void;
  readonly view: RepositoryView;
  readonly worktrees: readonly Worktree[];
  readonly worktreesLoading: boolean;
  readonly worktreesError: boolean;
  readonly onRetryWorktrees: () => void;
  readonly onOpenWorktrees: () => void;
}) {
  return (
    <div
      className={cn(
        "min-h-0 flex-1 overflow-y-auto bg-background",
        view === "prs" && "repository-chrome repository-pull-requests",
        view === "apps" && "repository-pages",
      )}
    >
      <div
        className={cn(
          "mx-auto px-6 py-6 max-[720px]:px-4 max-[720px]:py-4",
          view === "apps"
            ? "w-full max-w-[1012px] px-4 py-8 max-[720px]:py-8"
            : "max-w-7xl px-8 max-[720px]:px-4",
        )}
      >
        {view === "files" ? (
          <FilesView
            spaceId={spaceId}
            space={space}
            spaceName={spaceName}
            page={page}
            apps={apps}
            selectedApp={selectedApp}
            resource={resource}
            loading={loading}
            error={error}
            onRetry={onRetry}
            onSelectApp={onSelectApp}
          />
        ) : view === "apps" ? (
          <AppsView
            spaceId={spaceId}
            apps={apps}
            selectedApp={selectedApp}
            onSelectApp={onSelectApp}
          />
        ) : (
          <PullRequestsView
            spaceId={spaceId}
            worktrees={worktrees}
            loading={worktreesLoading}
            error={worktreesError}
            onRetry={onRetryWorktrees}
            onOpenWorktrees={onOpenWorktrees}
          />
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
  onRetry,
  onSelectApp,
  space,
  spaceName,
}: {
  readonly spaceId: string;
  readonly page: RepositoryPage;
  readonly apps: readonly RepositoryApp[];
  readonly selectedApp: RepositoryApp | undefined;
  readonly resource: RepositoryBlob | undefined;
  readonly loading: boolean;
  readonly error: boolean;
  readonly onRetry: () => void;
  readonly onSelectApp: (nodeId: string) => void;
  readonly space: SpaceView | undefined;
  readonly spaceName: string | undefined;
}) {
  const { t } = useI18n();
  const showDefaultApp = loading || error || apps.length > 0;
  const [searchQuery, setSearchQuery] = useState("");
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_296px]">
      <div className="grid min-w-0 content-start gap-4">
        <NodeBrowser
          page={page}
          canCreateAtRoot={space?.capabilities.createAtRoot ?? false}
          showParentRow={page.parentNode !== null}
          spaceName={spaceName}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder={t("repositoryGoToFile")}
          compact
        />
        {showDefaultApp ? (
          <section className="min-w-0 overflow-hidden rounded-md border border-border bg-background">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4">
              {apps.length > 1 ? (
                <div
                  role="tablist"
                  aria-label={t("repositoryAppPreview")}
                  className="flex min-w-0 gap-1"
                >
                  {apps.map((app) => (
                    <button
                      key={app.node.id}
                      type="button"
                      role="tab"
                      aria-selected={selectedApp?.node.id === app.node.id}
                      onClick={() => onSelectApp(app.node.id)}
                      className={cn(
                        "max-w-52 truncate border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                        selectedApp?.node.id === app.node.id
                          ? "border-repository-selected text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {displayAppName(app.node.name)}
                    </button>
                  ))}
                </div>
              ) : (
                <h2 className="m-0 min-w-0 truncate py-2.5 text-sm font-semibold">
                  {selectedApp ? displayAppName(selectedApp.node.name) : t("apps")}
                </h2>
              )}
              {selectedApp ? (
                <Link
                  to="/nodes/$nodeId"
                  params={{ nodeId: selectedApp.node.id }}
                  search={(previous) => ({ ...previous, view: "immersive" })}
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
              <div className="h-[calc(100dvh-8rem)] min-h-[640px] overflow-hidden">
                <BlobPreview resource={resource} actionsContainer={null} />
              </div>
            ) : (
              <Empty
                title={t("repositoryNoApps")}
                description={
                  <>
                    {t("appsEmptyDescription")}
                    <br />
                    {t("appsEmptyHint")}
                  </>
                }
              />
            )}
          </section>
        ) : null}
      </div>
      {space ? <RepositoryAbout spaceId={spaceId} space={space} selectedApp={selectedApp} /> : null}
    </div>
  );
}

/** Mirrors GitHub's About sidebar; only fields Workspace stores are shown. */
function RepositoryAbout({
  spaceId,
  space,
  selectedApp,
}: {
  readonly spaceId: string;
  readonly space: SpaceView;
  readonly selectedApp: RepositoryApp | undefined;
}) {
  const { t, language } = useI18n();
  const star = useQuery(spaceStarQueryOptions(spaceId));
  const description = space.description.trim();
  return (
    <aside aria-labelledby="repository-about-heading" className="min-w-0 self-start">
      <div className="flex items-center justify-between gap-2">
        <h2 id="repository-about-heading" className="m-0 text-base leading-6 font-semibold">
          {t("repositoryAbout")}
        </h2>
        {space.capabilities.renameSpace ? (
          <Link
            to="/spaces/$spaceId/settings"
            params={{ spaceId }}
            aria-label={t("repositoryAboutEditDescription")}
            title={t("repositoryAboutEditDescription")}
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon-sm" }),
              "shrink-0 text-muted-foreground no-underline",
            )}
          >
            <Settings className="size-4" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
      {description ? (
        <p className="mt-2 mb-0 text-sm leading-6 break-words text-foreground">{description}</p>
      ) : null}
      <ul className="m-0 mt-4 grid list-none gap-2 p-0 text-sm text-muted-foreground">
        {selectedApp ? (
          <li className="min-w-0">
            <Link
              to="/nodes/$nodeId"
              params={{ nodeId: selectedApp.node.id }}
              search={(previous) => ({ ...previous, view: "immersive" })}
              className="flex min-w-0 items-center gap-2 font-semibold text-brand-700 no-underline hover:underline dark:text-brand-400"
            >
              <LinkIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate">{t("repositoryDefaultPage")}</span>
            </Link>
          </li>
        ) : null}
        <li className="flex items-center gap-2">
          <Star className="size-4 shrink-0" aria-hidden="true" />
          <span aria-live="polite">
            <strong className="font-semibold text-foreground tabular-nums">
              {star.data ? star.data.starCount.toLocaleString(language) : "…"}
            </strong>{" "}
            {t(star.data?.starCount === 1 ? "repositoryAboutStar" : "repositoryAboutStars")}
          </span>
        </li>
      </ul>
    </aside>
  );
}

function displayAppName(name: string): string {
  return name.replace(/\.univer\.html$/iu, "");
}

function AppsView({
  spaceId,
  apps,
  selectedApp,
  onSelectApp,
}: {
  readonly spaceId: string;
  readonly apps: readonly RepositoryApp[];
  readonly selectedApp: RepositoryApp | undefined;
  readonly onSelectApp: (nodeId: string) => void;
}) {
  const { language, t } = useI18n();
  const defaultPageUrl = selectedApp
    ? resourceShareUrl(window.location.origin, selectedApp.node.id, "immersive")
    : undefined;
  const copyDefaultPageUrl = async () => {
    if (!defaultPageUrl) return;
    try {
      await navigator.clipboard.writeText(defaultPageUrl);
      toast.success(t("repositoryPageLinkCopied"));
    } catch {
      toast.error(t("repositoryCopyPageLinkFailed"));
    }
  };
  return (
    <section aria-labelledby="repository-pages-heading">
      <div>
        <h1
          id="repository-pages-heading"
          className="m-0 mb-4 border-b border-border pb-[0.3em] text-[2em] leading-[1.25] font-semibold"
        >
          <Link to="/spaces/$spaceId" params={{ spaceId }} search={{ view: "apps" }}>
            {t("apps")}
          </Link>
        </h1>
        <p className="m-0 mb-4">{t("repositoryAppsSummary", { count: apps.length })}</p>
      </div>
      {selectedApp ? (
        <div className="my-6">
          <div className="min-w-0">
            <h2 className="m-0 mb-4 border-b border-border pb-[0.3em] text-2xl leading-[1.25] font-semibold break-words">
              {t("repositoryDefaultPage")}:{" "}
              <Link to="/nodes/$nodeId" params={{ nodeId: selectedApp.node.id }}>
                {displayAppName(selectedApp.node.name)}
              </Link>
            </h2>
            <p className="m-0 mb-4 min-w-0">
              <code className="rounded-[3px] bg-surface px-[0.4em] py-[0.2em] text-[85%] break-all">
                {defaultPageUrl}
              </code>
            </p>
            <p className="m-0 mb-4 text-muted-foreground">{t("repositoryDefaultPageLocalOnly")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="button"
              className="repository-pages-action"
              onClick={() => void copyDefaultPageUrl()}
            >
              {t("repositoryCopyPageLink")}
            </button>
            <Link
              to="/nodes/$nodeId"
              params={{ nodeId: selectedApp.node.id }}
              search={(previous) => ({ ...previous, view: "immersive" })}
              className="inline-flex items-center gap-1"
            >
              {t("repositoryVisitPage")}
              <ExternalLink className="size-3.5" />
            </Link>
          </div>
        </div>
      ) : null}
      {apps.length ? (
        <ul className="m-0 mb-4 list-disc pl-8">
          {apps.map((app) => {
            const isDefault = selectedApp?.node.id === app.node.id;
            return (
              <li key={app.node.id} className="mt-4">
                <div className="flex flex-col items-start justify-between gap-x-4 gap-y-1 sm:flex-row">
                  <div className="min-w-0 flex-1">
                    <Link
                      to="/nodes/$nodeId"
                      params={{ nodeId: app.node.id }}
                      className="break-words"
                    >
                      {displayAppName(app.node.name)}
                    </Link>
                    <p className="m-0 mt-1 text-sm break-words text-muted-foreground">
                      {app.node.name} · {formatRelativeDate(app.node.updatedAt, language)}
                    </p>
                  </div>
                  {isDefault ? (
                    <span className="text-sm leading-6 text-muted-foreground">
                      {t("repositoryIsDefaultPage")}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="repository-pages-action"
                      onClick={() => onSelectApp(app.node.id)}
                    >
                      {t("repositorySetDefaultPage")}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div>
          <h2 className="mt-6 mb-4 border-b border-border pb-[0.3em] text-2xl leading-[1.25] font-semibold">
            {t("repositoryNoApps")}
          </h2>
          <p className="m-0 mb-4">{t("appsEmptyDescription")}</p>
          <p className="m-0 mb-4">{t("appsEmptyHint")}</p>
        </div>
      )}
    </section>
  );
}

function PullRequestsView({
  spaceId,
  worktrees,
  onOpenWorktrees,
  loading,
  error,
  onRetry,
}: {
  readonly spaceId: string;
  readonly worktrees: readonly Worktree[];
  readonly onOpenWorktrees: () => void;
  readonly loading: boolean;
  readonly error: boolean;
  readonly onRetry: () => void;
}) {
  const { language, t } = useI18n();
  const [stateFilter, setStateFilter] = useState<"open" | "closed">("open");
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const openCount = worktrees.filter((worktree) =>
    isOpenWorktree(worktree.state),
  ).length;
  const visible = worktrees.filter(
    (worktree) =>
      (stateFilter === "open"
        ? isOpenWorktree(worktree.state)
        : !isOpenWorktree(worktree.state)) &&
      [
        worktree.name,
        worktree.summary,
        worktree.creator.displayName,
        worktree.creator.username,
      ].some((value) => value?.toLocaleLowerCase().includes(normalizedSearch)),
  );
  return (
    <section className="repository-pull-requests grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-xl font-semibold">{t("repositoryAllPullRequests")}</h1>
        <Button size="sm" onClick={onOpenWorktrees}>
          {t("repositoryOpenWorkbench")}
        </Button>
      </div>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-2 left-3 size-4 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          aria-label={t("repositorySearchPullRequests")}
          placeholder={t("repositorySearchPullRequests")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="h-8 rounded-md pl-9 pr-9 shadow-none"
        />
        {search ? (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("clearSearch")}
            className="absolute top-0 right-0"
            onClick={() => setSearch("")}
          >
            <X />
          </Button>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-md border border-border bg-background">
        <div className="flex flex-wrap items-center gap-4 border-b border-border bg-surface px-4 py-3">
          <div className="flex items-center gap-4 text-sm">
            <button
              type="button"
              onClick={() => setStateFilter("open")}
              aria-pressed={stateFilter === "open"}
              className={cn(
                "flex cursor-pointer items-center gap-2 hover:text-foreground",
                stateFilter === "open" ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              {t("repositoryPullRequestsOpen")}
              <span className="rounded-full bg-repository-counter px-2 text-xs font-medium tabular-nums">
                {loading ? "…" : openCount}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setStateFilter("closed")}
              aria-pressed={stateFilter === "closed"}
              className={cn(
                "flex cursor-pointer items-center gap-2 hover:text-foreground",
                stateFilter === "closed"
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {t("repositoryPullRequestsClosed")}
              <span className="rounded-full bg-repository-counter px-2 text-xs font-medium tabular-nums">
                {loading ? "…" : worktrees.length - openCount}
              </span>
            </button>
          </div>
        </div>
        {error ? (
          <Empty title={t("repositoryPullRequestsFailed")}>
            <Button variant="secondary" onClick={onRetry}>
              {t("repositoryPageRetry")}
            </Button>
          </Empty>
        ) : loading ? (
          <div role="status" aria-label={t("onboardingLoading")} className="grid gap-4 p-4">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : visible.length ? (
          <ul className="m-0 list-none p-0">
            {visible.map((worktree) => (
              <li key={worktree.id} className="relative border-b border-border last:border-b-0">
                <div className="flex items-start gap-2 px-4 py-3 hover:bg-accent/60">
                  <RepositoryPrState state={worktree.state} />
                  <div className="min-w-0 flex-1">
                    <Link
                      to="/worktrees"
                      search={{ spaceId, worktree: worktree.id }}
                      className="text-base leading-5 font-semibold break-words text-foreground no-underline after:absolute after:inset-0 hover:text-brand-700 dark:hover:text-brand-400"
                    >
                      {worktree.name}
                    </Link>
                    <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <FileDiff className="size-3.5" aria-hidden="true" />
                      {worktree.unitCount === 1
                        ? t("repositoryWorktreeUnit")
                        : t("repositoryWorktreeUnits", { count: worktree.unitCount })}
                    </span>
                    <p className="mt-1 mb-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {t("repositoryWorktreeCreatedBy", {
                          name: worktree.creator.displayName,
                          date: formatRelativeDate(worktree.createdAt, language),
                        })}
                      </span>
                      {worktree.processedAt ? (
                        <span>
                          {t("repositoryWorktreeProcessedAt", {
                            state: t(
                              worktree.state === "merged"
                                ? "worktreeStateMerged"
                                : "worktreeStateDiscarded",
                            ),
                            date: formatRelativeDate(worktree.processedAt, language),
                          })}
                        </span>
                      ) : (
                        <span>
                          {t(
                            worktree.state === "draft"
                              ? "worktreeStateDraft"
                              : worktree.state === "merging"
                                ? "worktreeStateMerging"
                                : "worktreeStateReady",
                          )}
                        </span>
                      )}
                    </p>
                    {worktree.summary ? (
                      <p className="mt-1 mb-0 line-clamp-2 text-xs text-muted-foreground">
                        {worktree.summary}
                      </p>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty
            icon={GitPullRequest}
            title={t(
              normalizedSearch ? "repositoryNoMatchingPullRequests" : "repositoryNoPullRequests",
            )}
            description={t("repositoryNoPullRequestsDescription")}
          >
            <Button variant="secondary" onClick={onOpenWorktrees}>
              {t("repositoryOpenWorkbench")}
            </Button>
          </Empty>
        )}
      </div>
    </section>
  );
}

function isRepositoryView(value: unknown): value is RepositoryView {
  return value === "files" || value === "prs" || value === "apps";
}
