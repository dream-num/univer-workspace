import { BookOpen, ExternalLink } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { sliceSeries, useRepositoryActivity, usePendingChanges, type DayKey } from "../../data";
import { ActivityChart } from "../../code/activity-chart";
import { RepositoryFileTable } from "../../code/repository-file-table";
import { BlobPreview } from "../../../../features/blobs";
import { useI18n } from "../../../../shared/i18n";
import { Button, Empty, buttonVariants } from "../../../../shared/ui";
import { cn } from "../../../../shared/utils/cn";
import type { SpaceView, RepositoryPage, RepositoryApp, RepositoryBlob } from "./types";
import { AboutRail } from "./about";
import { displayAppName } from "./display-app-name";

export function CodeTab({
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
  readonly page: RepositoryPage;
  readonly apps: readonly RepositoryApp[];
  readonly selectedApp: RepositoryApp | undefined;
  readonly resource: RepositoryBlob | undefined;
  readonly loading: boolean;
  readonly error: boolean;
  readonly onRetry: () => void;
  readonly onSelectApp: (nodeId: string) => void;
  readonly space: SpaceView;
  readonly spaceName: string | undefined;
}) {
  const { t } = useI18n();
  const showDefaultApp = loading || error || apps.length > 0;
  const [searchQuery, setSearchQuery] = useState("");
  const [range, setRange] = useState<7 | 14>(14);
  const [pickedDay, setPickedDay] = useState<DayKey | null>(null);
  const activity = useRepositoryActivity(space);
  const pending = usePendingChanges(space);
  return (
    <div className="rd-rgrid">
      <div className="rd-code-main">
        {activity.status === "success" ? (
          <ActivityChart
            series={sliceSeries(activity.data.series, range)}
            range={range}
            onRangeChange={(next) => {
              setRange(next);
              if (
                pickedDay &&
                !sliceSeries(activity.data.series, next).days.some((day) => day.day === pickedDay)
              )
                setPickedDay(null);
            }}
            pickedDay={pickedDay}
            onPickDay={setPickedDay}
          />
        ) : (
          <section className="rd-card rd-chart">
            <h2>{t("repositoryChangeActivity")}</h2>
            <p className="rd-data-note" role="status">
              {t(activity.status === "pending" ? "dashboardLoading" : "dashboardLoadFailed")}
            </p>
          </section>
        )}
        <RepositoryFileTable
          page={page}
          canCreateAtRoot={space.capabilities.createAtRoot}
          spaceName={spaceName}
          pending={pending.status === "success" ? pending.data : undefined}
          latest={activity.status === "success" ? activity.data.events[0] : undefined}
          pickedDay={pickedDay}
          onClearDay={() => setPickedDay(null)}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
        {pending.status === "error" ? (
          <p className="rd-data-note" role="status">
            {t("repositoryPendingFailed")}
          </p>
        ) : null}
        {showDefaultApp ? (
          <section className="rd-card rd-readme">
            <div className="rd-readme-head">
              <BookOpen aria-hidden="true" />
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
                          ? "border-[color:var(--color-repository-selected)] text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {displayAppName(app.node.name)}
                    </button>
                  ))}
                </div>
              ) : (
                <h2 className="m-0 min-w-0 truncate py-2.5 text-sm font-semibold">
                  {selectedApp ? displayAppName(selectedApp.node.name) : t("pages")}
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
                title={t("repositoryNoPages")}
                description={
                  <>
                    {t("pagesEmptyDescription")}
                    <br />
                    {t("pagesEmptyHint")}
                  </>
                }
              />
            )}
          </section>
        ) : null}
      </div>
      <AboutRail space={space} activity={activity} />
    </div>
  );
}
