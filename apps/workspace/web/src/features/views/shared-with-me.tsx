import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { sharedWithMeQueryOptions } from "./shared.queries";
import { NodeActionsMenu, NodeIcon } from "../nodes";
import { formatRelativeDate } from "../../shared/format-relative-date";
import { useI18n } from "../../shared/i18n";
import { Avatar, Empty } from "../../shared/ui";
import { cn } from "../../shared/utils/cn";

const sharedGrid =
  "grid items-center gap-6 grid-cols-[minmax(280px,1fr)_minmax(150px,220px)_180px_112px_40px] max-[980px]:grid-cols-[minmax(220px,1fr)_180px_112px_40px] max-[720px]:grid-cols-[minmax(0,1fr)_96px_40px] max-[720px]:gap-3";

export function SharedWithMe({
  searchQuery = "",
}: {
  readonly searchQuery?: string;
}) {
  const query = useQuery(sharedWithMeQueryOptions);
  const { language, t } = useI18n();
  if (!query.data) return null;
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const visibleItems = query.data.items.filter((item) => {
    if (!normalizedSearch) return true;
    return [
      item.node.name,
      item.sharedBy.displayName,
      item.sharedBy.username,
    ].some((value) =>
      value.toLocaleLowerCase().includes(normalizedSearch)
    );
  });
  return (
    <div className="flex h-full min-h-0 flex-col">
      {query.data.items.length === 0 ? (
        <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-6">
          <Empty title={t("sharedEmpty")} />
        </div>
      ) : (
        <>
          <div
            className={cn(
              sharedGrid,
              "h-10 shrink-0 border-b border-border bg-surface/45 px-6 text-[12px] font-medium text-muted-foreground max-[720px]:px-4"
            )}
          >
            <span>{t("name")}</span>
            <span className="max-[980px]:hidden">{t("sharedBy")}</span>
            <span className="max-[720px]:hidden">{t("sharedAt")}</span>
            <span>{t("access")}</span>
            <span aria-hidden="true" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 max-[720px]:px-1.5">
            {visibleItems.length === 0 ? (
              <Empty className="mt-16" title={t("noMatchingNodes")} />
            ) : (
              visibleItems.map((item) => (
                <NodeActionsMenu
                  key={item.node.id}
                  node={item.node}
                >
                  {(actions) => (
                    <div
                      className={cn(
                        sharedGrid,
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
                          kind={item.node.resource ? "resource" : "group"}
                          resourceKind={item.node.resource?.kind}
                          unitType={
                            item.node.resource?.kind === "univer"
                              ? item.node.resource.unitType
                              : null
                          }
                          mediaType={
                            item.node.resource?.kind === "blob"
                              ? item.node.resource.mediaType
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
                      <span className="flex min-w-0 items-center gap-2 max-[980px]:hidden">
                        <Avatar
                          size="xs"
                          src={item.sharedBy.avatarUrl}
                          name={item.sharedBy.displayName}
                        />
                        <span
                          className="truncate text-sm"
                          title={item.sharedBy.displayName}
                        >
                          {item.sharedBy.displayName}
                        </span>
                      </span>
                      <time
                        className="truncate text-sm max-[720px]:hidden"
                        dateTime={item.sharedAt}
                        title={new Date(item.sharedAt).toLocaleString(
                          language
                        )}
                      >
                        {formatRelativeDate(item.sharedAt, language)}
                      </time>
                      <span className="truncate text-sm">
                        {accessLabel(item.node.accessRole, t)}
                      </span>
                      <span
                        className="relative z-10 flex items-center justify-end opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-[720px]:opacity-100"
                      >
                        {actions}
                      </span>
                    </div>
                  )}
                </NodeActionsMenu>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function accessLabel(
  role: "owner" | "admin" | "editor" | "viewer",
  t: ReturnType<typeof useI18n>["t"]
): string {
  if (role === "owner") return t("accessOwner");
  if (role === "admin") return t("accessAdmin");
  if (role === "editor") return t("accessEditor");
  return t("accessViewer");
}
