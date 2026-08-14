import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { recentResourcesQueryOptions } from "./recent.queries";
import { NodeActionsMenu, NodeIcon } from "../nodes";
import { formatRelativeDate } from "../../shared/format-relative-date";
import { useI18n } from "../../shared/i18n";
import { Empty } from "../../shared/ui";
import { cn } from "../../shared/utils/cn";

const recentGrid =
  "grid items-center gap-6 grid-cols-[minmax(280px,1fr)_minmax(200px,320px)_180px_40px] max-[980px]:grid-cols-[minmax(220px,1fr)_170px_40px] max-[720px]:grid-cols-[minmax(0,1fr)_40px] max-[720px]:gap-3";

export function RecentResources({
  searchQuery = "",
}: {
  readonly searchQuery?: string;
}) {
  const query = useQuery(recentResourcesQueryOptions);
  const { language, t } = useI18n();
  if (!query.data) return null;
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const visibleItems = query.data.items.filter((item) => {
    if (!normalizedSearch) return true;
    return [
      item.node.name,
      item.location.space.name,
      ...item.location.breadcrumbs.map((breadcrumb) => breadcrumb.name),
    ].some((value) =>
      value.toLocaleLowerCase().includes(normalizedSearch)
    );
  });
  return (
    <div className="flex h-full min-h-0 flex-col">
      {query.data.items.length === 0 ? (
        <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-6">
          <Empty title={t("recentResourcesEmpty")} />
        </div>
      ) : (
        <>
          <div
            className={cn(
              recentGrid,
              "h-10 shrink-0 border-b border-border bg-surface/45 px-6 text-[12px] font-medium text-muted-foreground max-[720px]:px-4"
            )}
          >
            <span>{t("name")}</span>
            <span className="max-[980px]:hidden">{t("location")}</span>
            <span className="max-[720px]:hidden">{t("lastOpened")}</span>
            <span aria-hidden="true" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 max-[720px]:px-1.5">
            {visibleItems.length === 0 ? (
              <Empty
                className="mt-16"
                title={t("noMatchingResources")}
              />
            ) : (
              visibleItems.map((item) => {
                const location = [
                  item.location.space.name,
                  ...item.location.breadcrumbs.map(
                    (breadcrumb) => breadcrumb.name
                  ),
                ].join(" / ");
                return (
                  <NodeActionsMenu
                    key={item.resource.id}
                    node={item.node}
                  >
                    {(actions) => (
                      <div
                        className={cn(
                          recentGrid,
                          "group relative min-h-13 border-b border-border/70 px-3 text-muted-foreground transition-colors max-[720px]:px-2.5",
                          "hover:bg-surface data-popup-open:bg-surface focus-within:z-10"
                        )}
                      >
                        <Link
                          to="/nodes/$nodeId"
                          params={{ nodeId: item.node.id }}
                          aria-label={item.node.name}
                          className="absolute inset-0 cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                        />
                        <span className="flex min-w-0 items-center gap-3">
                          <NodeIcon
                            kind="resource"
                            resourceKind={item.resource.kind}
                            unitType={
                              item.resource.kind === "univer"
                                ? item.resource.unitType
                                : null
                            }
                            mediaType={
                              item.resource.kind === "blob"
                                ? item.resource.mediaType
                                : null
                            }
                            variant="list"
                          />
                          <span
                            className="truncate text-sm font-medium text-foreground"
                            title={item.node.name}
                          >
                            {item.node.name}
                          </span>
                        </span>
                        <span
                          className="truncate text-sm max-[980px]:hidden"
                          title={location}
                        >
                          {location}
                        </span>
                        <time
                          className="truncate text-sm max-[720px]:hidden"
                          dateTime={item.lastOpenedAt}
                          title={new Date(item.lastOpenedAt).toLocaleString(
                            language
                          )}
                        >
                          {formatRelativeDate(item.lastOpenedAt, language)}
                        </time>
                        <span
                          className="relative z-10 flex items-center justify-end opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-[720px]:opacity-100"
                        >
                          {actions}
                        </span>
                      </div>
                    )}
                  </NodeActionsMenu>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
