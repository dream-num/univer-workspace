import { ArrowRight, Copy, FileText, Settings, Users } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
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
import {
  WorkspaceHeaderSearch,
  WorkspaceLayout,
} from "./-workspace-layout";
import { api } from "../shared/api/client";
import { apiError } from "../shared/api/errors";
import { useI18n } from "../shared/i18n";
import { useTheme } from "../shared/theme";
import type { components } from "../../../generated/http/schema.js";
import {
  Button,
  Dialog,
  DialogClose,
  Field,
  Input,
  toast,
} from "../shared/ui";

type RepositoryPage = components["schemas"]["NodePage"];
type RepositoryApp = components["schemas"]["OwnedResourceItem"];
type RepositoryBlob = components["schemas"]["OpenBlobResource"];

export const Route = createFileRoute("/spaces/$spaceId")({
  loader: async ({ context, params }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions);
    try {
      await Promise.all([
        session.authenticated
          ? context.queryClient.ensureQueryData(spacesQueryOptions)
          : undefined,
        context.queryClient.ensureQueryData(
          spaceNodesQueryOptions(params.spaceId)
        ),
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
    ...htmlViewsQueryOptions,
    enabled: workspaceTheme === "repository" && space?.type === "team",
  });
  const spaceApps = (apps.data?.items ?? []).filter((item) => item.location.space.id === spaceId);
  const selectedApp = spaceApps.find((item) => item.node.id === landingNodeId) ?? spaceApps[0];
  const selectedResource = useQuery({
    ...resourceOpenQueryOptions(selectedApp?.resource.id ?? ""),
    enabled: selectedApp !== undefined,
  });
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
      headerTitle={query.data.space.name}
      headerContent={
        <WorkspaceHeaderSearch
          placeholder={t("searchNodes")}
          value={searchQuery}
          onChange={setSearchQuery}
        />
      }
    >
      {workspaceTheme === "repository" && space?.type === "team" ? (
        <RepositoryOverview
          spaceName={space.name}
          page={query.data}
          apps={spaceApps}
          selectedApp={selectedApp}
          resource={selectedResource.data?.resource.kind === "blob" ? selectedResource.data.resource : undefined}
          onSelectApp={setLandingApp}
          onOpenApps={() => navigate({ to: "/apps" })}
          onOpenWorktrees={() => navigate({ to: "/worktrees" })}
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
            <DialogClose
              render={<Button variant="secondary">{t("cancel")}</Button>}
            />
            <Button onClick={submit} disabled={rename.isPending}>
              {t("save")}
            </Button>
          </>
        }
      >
        <form className="grid gap-5" onSubmit={submit}>
          <Field
            label={t("spaceName")}
            htmlFor="space-name"
            error={error}
          >
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
              <span className="text-sm font-medium text-foreground">
                {t("publicRead")}
              </span>
              <span className="text-sm text-subtle-foreground">
                {t("publicReadDescription")}
              </span>
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
  onSelectApp,
  onOpenApps,
  onOpenWorktrees,
}: {
  readonly spaceName: string;
  readonly page: RepositoryPage;
  readonly apps: readonly RepositoryApp[];
  readonly selectedApp: RepositoryApp | undefined;
  readonly resource: RepositoryBlob | undefined;
  readonly onSelectApp: (nodeId: string) => void;
  readonly onOpenApps: () => void;
  readonly onOpenWorktrees: () => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-background">
      <div className="mx-auto grid max-w-6xl gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section className="min-w-0">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">Repository</p>
              <h2 className="mt-1 text-2xl font-bold">{spaceName}</h2>
              <p className="mt-1 text-sm text-muted-foreground">团队空间的数据、智能工作台和 Apps。</p>
            </div>
            <button type="button" className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium" onClick={onOpenApps}>
              Apps <ArrowRight className="size-4" />
            </button>
          </div>
          <section className="overflow-hidden rounded-lg border border-border bg-background">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-medium"><FileText className="size-4 text-primary" /> Repository Page</div>
              {apps.length > 1 ? <label className="flex items-center gap-2 text-xs text-muted-foreground">选择 Page
                <select className="rounded-md border border-border bg-background px-2 py-1 text-foreground" aria-label="选择 Repository Page" value={selectedApp?.node.id ?? ""} onChange={(event) => onSelectApp(event.target.value)}>
                  {apps.map((app) => <option key={app.node.id} value={app.node.id}>{app.node.name}</option>)}
                </select>
              </label> : null}
            </div>
            {resource?.kind === "blob" ? <div className="h-[min(70vh,720px)]"><BlobPreview resource={resource} actionsContainer={null} /></div> : <div className="grid min-h-64 place-items-center p-8 text-center text-sm text-muted-foreground">{apps.length ? "正在打开 Repository Page…" : "还没有 .univer.html。请先在 Apps 中创建一个页面。"}</div>}
          </section>
        </section>
        <aside className="space-y-4">
          <section className="rounded-lg border border-border bg-background p-4"><h3 className="font-semibold">Repository</h3><p className="mt-2 text-sm text-muted-foreground">{page.nodes.length} 个根目录项目</p><button type="button" className="mt-4 flex items-center gap-2 text-sm font-medium text-primary" onClick={onOpenWorktrees}>打开智能工作台 <ArrowRight className="size-4" /></button></section>
          <section className="rounded-lg border border-border bg-background p-4"><h3 className="font-semibold">Pages</h3><p className="mt-2 text-sm text-muted-foreground">{apps.length} 个 Apps，可选择一个作为默认页面。</p><button type="button" className="mt-4 flex items-center gap-2 text-sm font-medium text-primary" onClick={onOpenApps}>查看 Apps <ArrowRight className="size-4" /></button></section>
        </aside>
      </div>
    </div>
  );
}
