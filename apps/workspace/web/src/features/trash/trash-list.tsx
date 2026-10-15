import { useQuery } from "@tanstack/react-query";
import { RotateCcw, Trash2 } from "lucide-react";
import { trashQueryOptions } from "./trash.queries";
import { useRestoreTrashBatch, usePurgeTrashBatch } from "./trash.commands";
import { NodeIcon } from "../nodes";
import { formatRelativeDate } from "../../shared/format-relative-date";
import { useI18n } from "../../shared/i18n";
import { useTheme } from "../../shared/theme";
import { Button, ConfirmDialog, Empty, Tooltip, toast } from "../../shared/ui";
import { cn } from "../../shared/utils/cn";

const trashGrid =
  "grid items-center gap-5 grid-cols-[minmax(260px,1fr)_minmax(160px,240px)_180px_80px_116px] max-[980px]:grid-cols-[minmax(220px,1fr)_170px_108px] max-[720px]:grid-cols-[minmax(0,1fr)_96px] max-[720px]:gap-3";

export function TrashList({
  spaceId,
  searchQuery = "",
}: {
  readonly spaceId: string;
  readonly searchQuery?: string;
}) {
  const query = useQuery(trashQueryOptions(spaceId));
  const { language, t } = useI18n();
  const { workspaceTheme } = useTheme();
  const repository = workspaceTheme === "repository";
  const grid = repository
    ? "grid items-center gap-4 grid-cols-[minmax(0,1fr)_140px_80px] max-[1000px]:grid-cols-[minmax(0,1fr)_80px] [&>span:nth-child(2)]:hidden [&>span:nth-child(4)]:hidden max-[1000px]:[&>time]:hidden max-[1000px]:[&>span:nth-child(3)]:hidden"
    : trashGrid;
  const restore = useRestoreTrashBatch(spaceId);
  const remove = usePurgeTrashBatch(spaceId);

  function showError(error: Error) {
    toast.error(error.message || t("trashActionFailed"));
  }

  if (!query.data) return null;
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const visibleItems = query.data.items.filter((batch) => {
    if (!normalizedSearch) return true;
    return [batch.root.name, ...batch.originalLocation.breadcrumbs.map((item) => item.name)].some(
      (value) => value.toLocaleLowerCase().includes(normalizedSearch),
    );
  });
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col",
        repository ? "overflow-hidden rounded-[6px] border border-border" : "h-full",
      )}
    >
      {query.data.items.length === 0 ? (
        <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-6">
          <Empty title={t("trashEmpty")} />
        </div>
      ) : (
        <>
          <div className="shrink-0 border-b border-border px-6 py-2.5 text-[13px] text-muted-foreground max-[720px]:px-4">
            {t("trashDescription")}
          </div>
          <div
            className={cn(
              grid,
              "h-11 shrink-0 border-b border-border px-6 text-[13px] font-medium text-muted-foreground max-[720px]:px-4",
              repository && "bg-surface px-4",
            )}
          >
            <span>{t("name")}</span>
            <span className="max-[980px]:hidden">{t("originalLocation")}</span>
            <span className="max-[720px]:hidden">{t("deletedAt")}</span>
            <span className="max-[980px]:hidden">{t("itemCount")}</span>
            <span className="text-right">{t("actions")}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 max-[720px]:px-1.5">
            {visibleItems.length === 0 ? (
              <Empty className="mt-16" title={t("noMatchingNodes")} />
            ) : (
              visibleItems.map((batch) => {
                const location =
                  batch.originalLocation.breadcrumbs.map((item) => item.name).join(" / ") ||
                  t("spaceRoot");
                return (
                  <div
                    key={batch.id}
                    className={cn(
                      grid,
                      "group min-h-14 rounded-lg px-3 text-muted-foreground max-[720px]:px-2.5",
                      repository && "rounded-none border-b border-border last:border-0",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <NodeIcon
                        name={batch.root.name}
                        kind={batch.root.resource ? "resource" : "group"}
                        resourceKind={batch.root.resource?.kind}
                        unitType={
                          batch.root.resource?.kind === "univer"
                            ? batch.root.resource.unitType
                            : null
                        }
                        mediaType={
                          batch.root.resource?.kind === "blob"
                            ? batch.root.resource.mediaType
                            : null
                        }
                        variant="list"
                      />
                      <span className="grid min-w-0">
                        <span
                          className="truncate text-sm font-medium text-foreground"
                          title={batch.root.name}
                        >
                          {batch.root.name}
                        </span>
                        {repository ? (
                          <span className="truncate text-xs" title={location}>
                            {location} · {t("itemCount")}: {batch.nodeCount}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <span className="truncate text-sm max-[980px]:hidden" title={location}>
                      {location}
                    </span>
                    <time
                      className="truncate text-sm max-[720px]:hidden"
                      dateTime={batch.trashedAt}
                      title={new Date(batch.trashedAt).toLocaleString(language)}
                    >
                      {formatRelativeDate(batch.trashedAt, language)}
                    </time>
                    <span className="text-sm max-[980px]:hidden">{batch.nodeCount}</span>
                    <div
                      className={cn(
                        "flex items-center justify-end gap-0.5",
                        !repository &&
                          "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-[720px]:opacity-100",
                      )}
                    >
                      <Tooltip
                        content={batch.restoreBlockedBy ? t("restoreParentFirst") : t("restore")}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("restore")}
                          disabled={
                            !batch.capabilities.restore || restore.isPending || remove.isPending
                          }
                          onClick={() =>
                            restore.mutate(batch.id, {
                              onSuccess: () => toast.success(t("itemRestored")),
                              onError: showError,
                            })
                          }
                        >
                          <RotateCcw
                            className={cn(
                              restore.isPending && restore.variables === batch.id && "animate-spin",
                            )}
                          />
                        </Button>
                      </Tooltip>
                      <ConfirmDialog
                        title={t("removePermanently")}
                        description={t("cannotUndo")}
                        confirmText={t("remove")}
                        cancelText={t("cancel")}
                        danger
                        disabled={
                          !batch.capabilities.removePermanently ||
                          remove.isPending ||
                          restore.isPending
                        }
                        onConfirm={() =>
                          remove.mutate(batch.id, {
                            onSuccess: () => toast.success(t("itemRemoved")),
                            onError: showError,
                          })
                        }
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t("remove")}
                            title={
                              batch.removeBlockedBy
                                ? blockerText(batch.removeBlockedBy.code, t)
                                : t("remove")
                            }
                            disabled={
                              !batch.capabilities.removePermanently ||
                              remove.isPending ||
                              restore.isPending
                            }
                            className="hover:bg-destructive-soft hover:text-destructive"
                          >
                            <Trash2 />
                          </Button>
                        }
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}

function blockerText(code: string, t: ReturnType<typeof useI18n>["t"]): string {
  if (code === "NESTED_TRASH_BATCH") return t("nestedTrashBatch");
  if (code === "ACTIVE_WORKTREE_REFERENCE") {
    return t("activeWorktreeReference");
  }
  return code;
}
