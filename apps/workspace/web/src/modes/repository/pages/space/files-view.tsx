import { ExternalLink } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { NodeBrowser } from "../../../../features/nodes";
import { BlobPreview } from "../../../../features/blobs";
import { useI18n } from "../../../../shared/i18n";
import { Button, Empty, buttonVariants } from "../../../../shared/ui";
import { cn } from "../../../../shared/utils/cn";
import type { SpaceView, RepositoryPage, RepositoryApp, RepositoryBlob } from "./types";
import { RepositoryAbout } from "./about";
import { displayAppName } from "./display-app-name";

export function FilesView({
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
