import {
  AppWindow,
  CircleDot,
  Copy,
  FileText,
  GitPullRequest,
  Settings,
  Trash2,
  Users,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  NodeBrowser,
  ResourceUnavailablePage,
  isResourceUnavailableError,
  spaceNodesQueryOptions,
} from "../features/nodes";
import { sessionQueryOptions } from "../features/auth";
import { BlobPreview } from "../features/blobs";
import { htmlViewsQueryOptions } from "../features/views/html-views.queries";
import { resourceOpenQueryOptions } from "../features/resources";
import { spacesQueryOptions } from "../features/spaces";
import { WorkspaceHeaderSearch, WorkspaceLayout } from "./-workspace-layout";
import { api } from "../shared/api/client";
import { apiError } from "../shared/api/errors";
import { useI18n } from "../shared/i18n";
import { useTheme } from "../shared/theme";
import { worktreeListQueryOptions } from "../features/worktrees";
import type { components } from "../../../generated/http/schema.js";
import { Button, Dialog, DialogClose, Empty, Field, Input, toast } from "../shared/ui";

type RepositoryPage = components["schemas"]["NodePage"];
type RepositoryApp = components["schemas"]["OwnedResourceItem"];
type RepositoryBlob = components["schemas"]["OpenBlobResource"];
type RepositoryView = "files" | "issues" | "prs" | "apps";

export const Route = createFileRoute("/spaces/$spaceId")({
  validateSearch: (search: Readonly<Record<string, unknown>>) => ({
    ...(search.view === "data" ? { view: "data" as const } : {}),
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
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { t } = useI18n();
  const { workspaceTheme } = useTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [spaceSettingsOpen, setSpaceSettingsOpen] = useState(false);
  const [name, setName] = useState("");
  const [publicRead, setPublicRead] = useState(false);
  const [error, setError] = useState<string>();
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
  const apps = useQuery({
    ...htmlViewsQueryOptions(spaceId),
    enabled: workspaceTheme === "repository" && space !== undefined,
  });
  const worktrees = useQuery({
    ...worktreeListQueryOptions("active"),
    enabled: workspaceTheme === "repository" && space !== undefined,
  });
  const processedWorktrees = useQuery({
    ...worktreeListQueryOptions("processed"),
    enabled: workspaceTheme === "repository" && space !== undefined,
  });
  const spaceApps = (apps.data?.items ?? []).filter((item) => item.location.space.id === spaceId);
  const selectedApp = spaceApps.find((item) => item.node.id === landingNodeId) ?? spaceApps[0];
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
  const rename = useMutation({
    mutationFn: async (values: { readonly name: string; readonly publicRead: boolean }) => {
      const { error: apiErr } = await api.PATCH("/api/spaces/{spaceId}", {
        params: { path: { spaceId } },
        body: values,
      });
      if (apiErr) throw apiError(apiErr);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: spacesQueryOptions.queryKey,
        }),
        queryClient.invalidateQueries({
          queryKey: spaceNodesQueryOptions(spaceId).queryKey,
        }),
      ]);
      setSpaceSettingsOpen(false);
      toast.success(t("spaceRenamed"));
    },
    onError: (mutationError) => toast.error(mutationError.message),
  });
  if (!query.data) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError(t("enterSpaceName"));
      return;
    }
    rename.mutate({ name: name.trim(), publicRead });
  };

  const copySpaceId = async () => {
    try {
      await navigator.clipboard.writeText(spaceId);
      toast.success(t("spaceIdCopied"));
    } catch {
      toast.error(t("copySpaceIdFailed"));
    }
  };

  const pageActions =
    space?.type === "team" || space?.capabilities.renameSpace ? (
      <>
        {space?.type === "team" ? (
          <Button
            variant="secondary"
            onClick={() =>
              navigate({
                to: "/spaces/$spaceId/members",
                params: { spaceId },
              })
            }
          >
            <Users />
            {t("members")}
          </Button>
        ) : null}
        {space?.capabilities.renameSpace ? (
          <Button
            variant="secondary"
            onClick={() => {
              setName(space.name);
              setPublicRead(space.publicRead);
              setError(undefined);
              setSpaceSettingsOpen(true);
            }}
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
      repositoryDataActive={view === "data"}
      headerTitle={query.data.space.name}
      headerContent={
        view === "data" ? (
          <WorkspaceHeaderSearch
            placeholder={t("searchNodes")}
            value={searchQuery}
            onChange={setSearchQuery}
          />
        ) : undefined
      }
    >
      {workspaceTheme === "repository" && space !== undefined && view !== "data" ? (
        <RepositoryOverview
          spaceName={space.name}
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
          onOpenApps={() => navigate({ to: "/apps", search: { spaceId } })}
          onOpenWorktrees={() => navigate({ to: "/worktrees", search: { spaceId } })}
          actions={pageActions}
          onOpenTrash={() => navigate({ to: "/spaces/$spaceId/trash", params: { spaceId } })}
          view={repositoryView}
          worktrees={[
            ...(worktrees.data?.items ?? []),
            ...(processedWorktrees.data?.items ?? []),
          ].filter((item) => item.teamSpace?.id === spaceId)}
          onViewChange={(nextView) =>
            void navigate({
              to: "/spaces/$spaceId",
              params: { spaceId },
              search: { view: nextView },
            })
          }
        />
      ) : (
        <NodeBrowser
          page={query.data}
          canCreateAtRoot={space?.capabilities.createAtRoot ?? false}
          actions={pageActions}
          searchQuery={searchQuery}
        />
      )}
      <Dialog
        open={spaceSettingsOpen}
        onOpenChange={setSpaceSettingsOpen}
        title={t("spaceSettings")}
        footer={
          <>
            <DialogClose render={<Button variant="secondary">{t("cancel")}</Button>} />
            <Button onClick={submit} disabled={rename.isPending}>
              {t("save")}
            </Button>
          </>
        }
      >
        <form className="grid gap-5" onSubmit={submit}>
          <Field label={t("spaceName")} htmlFor="space-name" error={error}>
            <Input
              id="space-name"
              maxLength={100}
              value={name}
              invalid={Boolean(error)}
              onChange={(event) => {
                setError(undefined);
                setName(event.target.value);
              }}
            />
            {space?.type === "team" ? (
              <div className="flex min-w-0 items-center gap-1 text-xs text-subtle-foreground">
                <span className="shrink-0">{t("teamSpaceId")}:</span>
                <code className="truncate text-foreground" title={spaceId}>
                  {spaceId}
                </code>
                <Button
                  aria-label={t("copySpaceId")}
                  title={t("copySpaceId")}
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => void copySpaceId()}
                >
                  <Copy />
                </Button>
              </div>
            ) : null}
          </Field>
          <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-border p-4">
            <span className="grid gap-1">
              <span className="text-sm font-medium text-foreground">{t("publicRead")}</span>
              <span className="text-sm text-subtle-foreground">{t("publicReadDescription")}</span>
            </span>
            <input
              className="mt-0.5 size-4 accent-primary"
              type="checkbox"
              checked={publicRead}
              onChange={(event) => setPublicRead(event.target.checked)}
            />
          </label>
        </form>
      </Dialog>
    </WorkspaceLayout>
  );
}

function RepositoryOverview({
  spaceName,
  page,
  apps,
  selectedApp,
  resource,
  loading,
  error,
  onRetry,
  onSelectApp,
  onOpenApps,
  onOpenWorktrees,
  actions,
  onOpenTrash,
  view,
  worktrees,
  onViewChange,
}: {
  readonly spaceName: string;
  readonly page: RepositoryPage;
  readonly apps: readonly RepositoryApp[];
  readonly selectedApp: RepositoryApp | undefined;
  readonly resource: RepositoryBlob | undefined;
  readonly loading: boolean;
  readonly error: boolean;
  readonly onRetry: () => void;
  readonly onSelectApp: (nodeId: string) => void;
  readonly onOpenApps: () => void;
  readonly onOpenWorktrees: () => void;
  readonly actions?: ReactNode;
  readonly onOpenTrash: () => void;
  readonly view: RepositoryView;
  readonly worktrees: readonly components["schemas"]["WorktreeSummary"][];
  readonly onViewChange: (view: RepositoryView) => void;
}) {
  const { t } = useI18n();
  const tabs = [
    { value: "files" as const, label: "Files", icon: FileText },
    { value: "issues" as const, label: "Issues", icon: CircleDot },
    { value: "prs" as const, label: "PRs", icon: GitPullRequest },
    { value: "apps" as const, label: "Apps", icon: AppWindow },
  ];
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-background">
      <div className="mx-auto max-w-6xl px-6 pt-6 max-[720px]:px-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border max-[720px]:border-b-0">
          <nav
            aria-label="Repository navigation"
            className="flex min-w-0 gap-1 overflow-x-auto max-[720px]:order-2 max-[720px]:w-full max-[720px]:border-b max-[720px]:border-border"
          >
            {tabs.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => onViewChange(value)}
                className={`relative flex min-h-11 shrink-0 items-center gap-2 border-b border-transparent px-3 text-sm font-medium transition-colors after:absolute after:right-2 after:bottom-[-1px] after:left-2 after:h-0.5 after:rounded-full ${view === value ? "text-foreground after:bg-primary" : "text-muted-foreground hover:text-foreground after:bg-transparent"}`}
                aria-current={view === value ? "page" : undefined}
              >
                <Icon className="size-4" />
                {label}
                {value === "prs" && worktrees.length ? (
                  <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">
                    {worktrees.length}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 max-[720px]:order-1 max-[720px]:w-full">
            {actions}
            <button
              type="button"
              className="flex min-h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-accent"
              onClick={onOpenTrash}
            >
              <Trash2 className="size-4" /> {t("trash")}
            </button>
          </div>
        </div>
        <div className="py-6">
          {view === "files" ? (
            <FilesView
              page={page}
              apps={apps}
              selectedApp={selectedApp}
              resource={resource}
              loading={loading}
              error={error}
              onRetry={onRetry}
              onSelectApp={onSelectApp}
              onOpenApps={onOpenApps}
            />
          ) : view === "apps" ? (
            <AppsView apps={apps} onOpenApps={onOpenApps} />
          ) : view === "prs" ? (
            <PullRequestsView
              spaceName={spaceName}
              worktrees={worktrees}
              onOpenWorktrees={onOpenWorktrees}
            />
          ) : (
            <IssuesView />
          )}
        </div>
      </div>
    </div>
  );
}

function FilesView({
  page,
  apps,
  selectedApp,
  resource,
  loading,
  error,
  onRetry,
  onSelectApp,
  onOpenApps,
}: Omit<
  Parameters<typeof RepositoryOverview>[0],
  "spaceName" | "onOpenWorktrees" | "onOpenTrash" | "view" | "worktrees" | "onViewChange"
>) {
  const { t } = useI18n();
  const showDefaultApp = loading || error || apps.length > 0;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="grid min-w-0 content-start gap-6">
        <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-background">
          <div className="border-b border-border px-4 py-3">
            <h3 className="font-semibold">Files</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {page.nodes.length} items in the repository root
            </p>
          </div>
          <div className="h-[min(48vh,520px)]">
            <NodeBrowser page={page} />
          </div>
        </section>
        {showDefaultApp ? (
          <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-background">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
              <h3 className="font-semibold">{selectedApp?.node.name ?? "Default App"}</h3>
              {apps.length > 1 ? (
                <select
                  className="min-h-8 rounded-md border border-border bg-background px-2 text-sm"
                  aria-label="Select default App"
                  value={selectedApp?.node.id ?? ""}
                  onChange={(event) => onSelectApp(event.target.value)}
                >
                  {apps.map((app) => (
                    <option key={app.node.id} value={app.node.id}>
                      {app.node.name}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
            {loading ? (
              <Empty title="Opening App…" className="min-h-64" />
            ) : error ? (
              <Empty title="Could not load App">
                <Button variant="secondary" onClick={onRetry}>
                  Retry
                </Button>
              </Empty>
            ) : resource?.kind === "blob" ? (
              <div className="h-[min(48vh,520px)]">
                <BlobPreview resource={resource} actionsContainer={null} />
              </div>
            ) : (
              <Empty title="No default App" description="Create an HTML App to show it here.">
                <Button variant="secondary" onClick={onOpenApps}>
                  View Apps
                </Button>
              </Empty>
            )}
          </section>
        ) : null}
      </div>
      <aside className="min-w-0 self-start overflow-hidden rounded-lg border border-border bg-background">
        <div className="border-b border-border px-4 py-3">
          <h3 className="font-semibold">About</h3>
        </div>
        <p className="px-4 py-3 text-sm text-muted-foreground">{t("repositoryDescription")}</p>
      </aside>
    </div>
  );
}

function AppsView({
  apps,
  onOpenApps,
}: {
  readonly apps: readonly RepositoryApp[];
  readonly onOpenApps: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <h3 className="font-semibold">Apps</h3>
        <p className="mt-1 text-sm text-muted-foreground">Apps connected to this repository.</p>
      </div>
      {apps.length ? (
        <ul className="divide-y divide-border">
          {apps.map((app) => (
            <li key={app.node.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <span className="flex items-center gap-2 font-medium">
                <AppWindow className="size-4 text-primary" />
                {app.node.name}
              </span>
              <span className="text-xs text-muted-foreground">HTML view</span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty
          title="No Apps yet"
          description="Create an HTML App to make this repository's landing page useful."
        >
          <Button variant="secondary" onClick={onOpenApps}>
            Open Apps
          </Button>
        </Empty>
      )}
    </section>
  );
}

function PullRequestsView({
  spaceName,
  worktrees,
  onOpenWorktrees,
}: {
  readonly spaceName: string;
  readonly worktrees: readonly components["schemas"]["WorktreeSummary"][];
  readonly onOpenWorktrees: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <h3 className="font-semibold">Pull requests</h3>
        <p className="mt-1 text-sm text-muted-foreground">Worktrees grouped under {spaceName}.</p>
      </div>
      {worktrees.length ? (
        <ul className="divide-y divide-border">
          {worktrees.map((worktree) => (
            <li key={worktree.id} className="flex items-start justify-between gap-4 px-4 py-4">
              <div>
                <p className="font-medium">{worktree.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {worktree.summary ?? "No summary provided."}
                </p>
              </div>
              <span className="rounded-full bg-muted px-2 py-1 text-xs capitalize text-muted-foreground">
                {worktree.state}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty
          title="No pull requests"
          description="Worktrees created for this repository will appear here."
        >
          <Button variant="secondary" onClick={onOpenWorktrees}>
            Open Workbench
          </Button>
        </Empty>
      )}
    </section>
  );
}

function IssuesView() {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <h3 className="font-semibold">Issues</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Track questions and follow-up work for this repository.
        </p>
      </div>
      <Empty
        title="No issues yet"
        description="When the team starts tracking work, issues will appear here."
      />
    </section>
  );
}

function isRepositoryView(value: unknown): value is RepositoryView {
  return value === "files" || value === "issues" || value === "prs" || value === "apps";
}
