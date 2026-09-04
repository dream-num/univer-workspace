import { useQueries, useQuery } from "@tanstack/react-query";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { components } from "../../../../generated/http/schema.js";
import { useI18n } from "../../shared/i18n";
import {
  SidebarResizeHandle,
  useMediaQuery,
  useResizableSidebar,
} from "../../shared/resizable-sidebar";
import {
  Badge,
  Button,
  Empty,
  Segmented,
  Select,
  Skeleton,
  Tooltip,
} from "../../shared/ui";
import { cn } from "../../shared/utils/cn";
import {
  UnitChangeIcon,
  UnitTypeIcon,
  WorktreeReviewPanel,
  worktreeStateLabel,
  worktreeStateVariant,
} from "./worktree-review-panel";
import {
  worktreeListQueryOptions,
  worktreeQueryOptions,
} from "./worktrees.queries";
import type { WorktreeReviewView } from "./worktree-review-search";

type WorktreeSummary = components["schemas"]["WorktreeSummary"];
type WorktreeDetail = components["schemas"]["WorktreeDetail"];
type WorktreeUnit = components["schemas"]["WorktreeUnit"];
type StateFilter = "all" | "draft" | "ready" | "processed";
type ScopeFilter = "all" | "user" | "team";
type TaskGroupKey = "running" | "ready" | "processed";

interface ReviewDocument {
  readonly key: string;
  readonly worktree: WorktreeDetail;
  readonly unit: WorktreeUnit;
}

export interface WorktreeDashboardSelection {
  readonly worktreeId: string;
  readonly unitId: string;
  readonly view: WorktreeReviewView;
}

export function WorktreeDashboard({
  searchQuery = "",
  selectedWorktreeId,
  selectedUnitId,
  selectedView = "comparison",
  onSelectionChange,
}: {
  readonly searchQuery?: string;
  readonly selectedWorktreeId?: string;
  readonly selectedUnitId?: string;
  readonly selectedView?: WorktreeReviewView;
  readonly onSelectionChange?: (
    selection: WorktreeDashboardSelection | null
  ) => void;
}) {
  const { t } = useI18n();
  const active = useQuery(worktreeListQueryOptions("active"));
  const processed = useQuery(worktreeListQueryOptions("processed"));
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [expandedTasks, setExpandedTasks] = useState<
    Readonly<Record<string, boolean>>
  >({});
  const [expandedGroups, setExpandedGroups] = useState<
    Readonly<Record<TaskGroupKey, boolean>>
  >({
    running: true,
    ready: true,
    processed: false,
  });
  const taskSidebar = useResizableSidebar({
    storageKey: "workbench-task-sidebar",
    defaultWidth: 300,
    minWidth: 220,
    maxWidth: 420,
  });
  const compactViewport = useMediaQuery("(max-width: 720px)");
  const taskSidebarCollapsed = taskSidebar.collapsed || compactViewport;

  const tasks = useMemo(
    () => [...(active.data?.items ?? []), ...(processed.data?.items ?? [])],
    [active.data?.items, processed.data?.items]
  );
  const scopedTasks = tasks.filter(
    (task) =>
      matchesState(task, stateFilter) &&
      (scopeFilter === "all" || task.kind === scopeFilter)
  );
  const detailQueries = useQueries({
    queries: scopedTasks.map((task) => worktreeQueryOptions(task.id)),
  });
  const detailByWorktreeId = new Map(
    detailQueries.flatMap((query) =>
      query.data
        ? [[query.data.worktree.id, query.data.worktree] as const]
        : []
    )
  );
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const visibleTasks = scopedTasks.filter((task) => {
    if (!normalizedSearch) return true;
    const worktree = detailByWorktreeId.get(task.id);
    return [
      task.name,
      task.summary,
      task.creator.displayName,
      task.creator.username,
      task.teamSpace?.name,
      ...(worktree?.units.map((unit) => unit.name) ?? []),
    ].some((value) =>
      value?.toLocaleLowerCase().includes(normalizedSearch)
    );
  });
  const documents = visibleTasks.flatMap((task) => {
    const worktree = detailByWorktreeId.get(task.id);
    return worktree
      ? worktree.units.map((unit) => ({
          key: documentKey(worktree.id, unit.unitId),
          worktree,
          unit,
        }))
      : [];
  });
  const selectionRequested =
    selectedWorktreeId !== undefined || selectedUnitId !== undefined;
  const requestedDocument = selectionRequested
    ? (documents.find(
        (document) =>
          (selectedWorktreeId === undefined ||
            document.worktree.id === selectedWorktreeId) &&
          (selectedUnitId === undefined ||
            document.unit.unitId === selectedUnitId)
      ) ?? null)
    : null;
  const requestedGroup =
    requestedDocument === null
      ? null
      : taskGroupKeyForState(requestedDocument.worktree.state);
  const isGroupOpen = (key: TaskGroupKey) =>
    expandedGroups[key] || requestedGroup === key;
  const selectableDocuments = documents.filter((document) =>
    isGroupOpen(taskGroupKeyForState(document.worktree.state))
  );
  const defaultDocument =
    selectableDocuments.find(
      (document) => document.worktree.state === "ready"
    ) ??
    selectableDocuments.find(
      (document) =>
        document.worktree.state === "draft" ||
        document.worktree.state === "merging"
    ) ??
    selectableDocuments[0] ??
    null;
  const selectedDocument = selectionRequested
    ? requestedDocument
    : defaultDocument;
  const detailError = detailQueries.find((query) => query.error)?.error;
  const loadingDetails = detailQueries.some((query) => query.isPending);

  if (active.error) throw active.error;
  if (processed.error) throw processed.error;
  if (detailError) throw detailError;

  const selectDocument = (
    document: ReviewDocument,
    view: WorktreeReviewView = "comparison"
  ) =>
    onSelectionChange?.({
      worktreeId: document.worktree.id,
      unitId: document.unit.unitId,
      view,
    });
  const resetSelection = () => onSelectionChange?.(null);
  const unitChangeStatus = (unit: WorktreeUnit) => {
    if (unit.change === "modified") return t("documentModified");
    if (unit.change === "added") return t("documentAdded");
    if (unit.change === "deleted") return t("documentDeleted");
    return t("documentUnchanged");
  };

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-4 max-[720px]:flex-col max-[720px]:items-start max-[720px]:px-4.5">
        <p className="m-0 max-w-2xl text-[13px] leading-5 text-muted-foreground">
          {t("workbenchDescription")}
        </p>
        <div className="flex flex-wrap items-center gap-2.5">
          <Segmented
            size="sm"
            aria-label={t("workbench")}
            value={stateFilter}
            onValueChange={(value) => {
              setStateFilter(value as StateFilter);
              resetSelection();
            }}
            options={[
              { label: t("all"), value: "all" },
              { label: t("inProgress"), value: "draft" },
              { label: t("awaitingReview"), value: "ready" },
              { label: t("processed"), value: "processed" },
            ]}
          />
          <Select<ScopeFilter>
            size="sm"
            className="w-32"
            aria-label={t("belongingSpace")}
            value={scopeFilter}
            onValueChange={(value) => {
              setScopeFilter(value);
              resetSelection();
            }}
            options={[
              { label: t("allSpaces"), value: "all" },
              { label: t("personalSpace"), value: "user" },
              { label: t("teamSpace"), value: "team" },
            ]}
          />
        </div>
      </header>

      <div
        className="grid min-h-0 flex-1"
        style={{
          gridTemplateColumns: taskSidebarCollapsed
            ? "48px minmax(0, 1fr)"
            : `${taskSidebar.width}px 7px minmax(0, 1fr)`,
        }}
      >
        <aside
          className={cn(
            "min-w-0 bg-surface",
            taskSidebarCollapsed
              ? "overflow-hidden"
              : "overflow-y-auto px-3 py-3.5"
          )}
        >
          {taskSidebarCollapsed ? (
            <div className="flex h-full min-h-60 flex-col items-center bg-surface py-3">
              <Tooltip
                side="right"
                content={!compactViewport ? t("expandTaskSidebar") : null}
              >
                <button
                  type="button"
                  aria-expanded="false"
                  aria-label={t("expandTaskSidebar")}
                  disabled={compactViewport}
                  className={cn(
                    "group grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors outline-none",
                    "hover:bg-brand-50 hover:text-brand-600",
                    "focus-visible:ring-2 focus-visible:ring-ring/40",
                    "disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                  )}
                  onClick={taskSidebar.toggleCollapsed}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    taskSidebar.toggleCollapsed();
                  }}
                >
                  <PanelLeftOpen className="size-4" />
                </button>
              </Tooltip>

              {selectedDocument ? (
                <div className="mt-2 flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto border-t border-border px-1.5 pt-2">
                  {selectedDocument.worktree.units.map((unit) => {
                    const key = documentKey(
                      selectedDocument.worktree.id,
                      unit.unitId
                    );
                    const selected = key === selectedDocument.key;
                    const changeStatus = unitChangeStatus(unit);
                    const taskStatus = worktreeStateLabel(
                      selectedDocument.worktree.state,
                      t
                    );
                    const accessibleLabel = `${unit.name}，${changeStatus}，${taskStatus}`;
                    return (
                      <Tooltip
                        key={unit.unitId}
                        side="right"
                        align="start"
                        content={
                          <span className="grid max-w-52 gap-0.5">
                            <strong className="truncate font-medium">
                              {unit.name}
                            </strong>
                            <small className="font-normal opacity-75">
                              {changeStatus} · {taskStatus}
                            </small>
                          </span>
                        }
                      >
                        <button
                          type="button"
                          aria-label={accessibleLabel}
                          aria-pressed={selected}
                          className={cn(
                            "grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg transition-colors outline-none",
                            selected
                              ? "bg-brand-50 ring-1 ring-brand-200"
                              : "hover:bg-accent",
                            "focus-visible:ring-2 focus-visible:ring-ring/40",
                            unit.change === "deleted" && "opacity-60"
                          )}
                          onClick={() =>
                            selectDocument(
                              {
                                key,
                                worktree: selectedDocument.worktree,
                                unit,
                              },
                              selectedView
                            )
                          }
                          onKeyDown={(event) => {
                            if (
                              event.key !== "Enter" &&
                              event.key !== " "
                            ) {
                              return;
                            }
                            event.preventDefault();
                            selectDocument(
                              {
                                key,
                                worktree: selectedDocument.worktree,
                                unit,
                              },
                              selectedView
                            );
                          }}
                        >
                          <UnitTypeIcon
                            type={unit.unitType}
                            showTooltip={false}
                          />
                        </button>
                      </Tooltip>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-end px-1.5 pb-2">
                <Tooltip content={t("collapseTaskSidebar")}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("collapseTaskSidebar")}
                    onClick={taskSidebar.toggleCollapsed}
                  >
                    <PanelLeftClose />
                  </Button>
                </Tooltip>
              </div>
              {active.isPending || processed.isPending || loadingDetails ? (
                <div className="grid gap-2.5 px-1.5 pt-1">
                  {Array.from({ length: 7 }, (_, index) => (
                    <div key={index} className="flex items-center gap-2.5">
                      <Skeleton className="size-5 rounded-md" />
                      <Skeleton className="h-4 flex-1" />
                    </div>
                  ))}
                </div>
              ) : visibleTasks.length ? (
                <div className="grid gap-4">
                  {taskGroups(visibleTasks, t).map((group) => (
                    <section key={group.key} className="grid gap-0.5">
                      <button
                        type="button"
                        aria-expanded={isGroupOpen(group.key)}
                        aria-label={
                          isGroupOpen(group.key)
                            ? t("collapseGroup")
                            : t("expandGroup")
                        }
                        className="flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-semibold text-subtle-foreground transition-colors outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40 [&_svg]:size-3"
                        onClick={() => {
                          const open = isGroupOpen(group.key);
                          if (
                            open &&
                            selectedDocument &&
                            taskGroupKeyForState(
                              selectedDocument.worktree.state
                            ) === group.key
                          ) {
                            resetSelection();
                          }
                          setExpandedGroups((current) => ({
                            ...current,
                            [group.key]: !open,
                          }));
                        }}
                      >
                        {isGroupOpen(group.key) ? (
                          <ChevronDown />
                        ) : (
                          <ChevronRight />
                        )}
                        <span className="flex-1 text-left">
                          {group.label}
                        </span>
                        <span className="text-right tnum">
                          {group.tasks.length}
                        </span>
                      </button>
                      {isGroupOpen(group.key)
                        ? group.tasks.map((task) => {
                            const worktree = detailByWorktreeId.get(task.id);
                            const taskExpanded =
                              expandedTasks[task.id] ??
                              (!isProcessed(task) &&
                                task.id === selectedDocument?.worktree.id);
                            return (
                              <div key={task.id} className="py-0.5">
                                <button
                                  type="button"
                                  aria-expanded={taskExpanded}
                                  aria-label={
                                    taskExpanded
                                      ? t("collapseTask")
                                      : t("expandTask")
                                  }
                                  className={cn(
                                    "grid w-full cursor-pointer grid-cols-[12px_18px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 py-2 text-left text-secondary-foreground transition-colors outline-none",
                                    "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40",
                                    "[&>svg:first-child]:size-2.5 [&>svg:first-child]:text-subtle-foreground"
                                  )}
                                  onClick={() => {
                                    const nextExpanded = !taskExpanded;
                                    setExpandedTasks((current) => ({
                                      ...current,
                                      [task.id]: nextExpanded,
                                    }));
                                    const firstUnit = worktree?.units[0];
                                    if (nextExpanded && firstUnit) {
                                      selectDocument({
                                        key: documentKey(
                                          worktree.id,
                                          firstUnit.unitId
                                        ),
                                        worktree,
                                        unit: firstUnit,
                                      });
                                    }
                                  }}
                                >
                                  {taskExpanded ? (
                                    <ChevronDown />
                                  ) : (
                                    <ChevronRight />
                                  )}
                                  <Bot className="size-4 text-muted-foreground" />
                                  <span className="grid min-w-0 gap-0.5">
                                    <strong className="truncate text-[13px] font-medium text-foreground">
                                      {task.name}
                                    </strong>
                                    <small className="truncate text-xs text-subtle-foreground">
                                      {task.kind === "team"
                                        ? task.teamSpace?.name
                                        : t("personalSpace")}
                                    </small>
                                  </span>
                                  <Badge
                                    variant={worktreeStateVariant(
                                      task.state
                                    )}
                                    className="max-w-16 truncate"
                                  >
                                    {worktreeStateLabel(task.state, t)}
                                  </Badge>
                                </button>
                                {taskExpanded && worktree?.units.length ? (
                                  <div className="mt-0.5 grid gap-0.5">
                                    {worktree.units.map((unit) => {
                                      const key = documentKey(
                                        worktree.id,
                                        unit.unitId
                                      );
                                      const selected =
                                        key === selectedDocument?.key;
                                      return (
                                        <button
                                          key={unit.unitId}
                                          type="button"
                                          className={cn(
                                            "grid w-full cursor-pointer grid-cols-[20px_minmax(0,1fr)_20px] items-center gap-2 rounded-md py-1.5 pr-2 pl-8 text-left text-[13px] transition-colors outline-none",
                                            selected
                                              ? "bg-brand-50 font-medium text-brand-700"
                                              : "text-secondary-foreground hover:bg-accent",
                                            "focus-visible:ring-2 focus-visible:ring-ring/40",
                                            unit.change === "deleted" &&
                                              "[&>span]:line-through [&>span]:opacity-60"
                                          )}
                                          onClick={() => {
                                            selectDocument({
                                              key,
                                              worktree,
                                              unit,
                                            });
                                            setExpandedTasks((current) => ({
                                              ...current,
                                              [task.id]: true,
                                            }));
                                          }}
                                        >
                                          <UnitTypeIcon
                                            type={unit.unitType}
                                          />
                                          <span className="truncate">
                                            {unit.name}
                                          </span>
                                          <UnitChangeIcon
                                            change={unit.change}
                                          />
                                        </button>
                                      );
                                    })}
                                  </div>
                                ) : taskExpanded ? (
                                  <span className="block py-1.5 pr-2 pl-8 text-xs text-muted-foreground">
                                    {t("noAgentDocuments")}
                                  </span>
                                ) : null}
                              </div>
                            );
                          })
                        : null}
                    </section>
                  ))}
                </div>
              ) : (
                <Empty title={t("noMatchingTasks")} className="py-10" />
              )}
            </>
          )}
        </aside>

        {!taskSidebarCollapsed ? (
          <SidebarResizeHandle
            value={taskSidebar.width}
            min={220}
            max={420}
            label={t("resizeTaskSidebar")}
            onChange={taskSidebar.setWidth}
          />
        ) : null}

        <main className="min-w-0 overflow-hidden">
          {!selectedDocument ? (
            <Empty
              className="mt-[min(22vh,200px)]"
              icon={Bot}
              title={t("noTasks")}
              description={t("tasksCreatedByAgents")}
            />
          ) : (
            <WorktreeReviewPanel
              worktree={selectedDocument.worktree}
              selectedUnitId={selectedDocument.unit.unitId}
              selectedView={selectedView}
              onSelectedViewChange={(view) =>
                selectDocument(selectedDocument, view)
              }
            />
          )}
        </main>
      </div>
    </section>
  );
}

function documentKey(worktreeId: string, unitId: string): string {
  return `${worktreeId}:${unitId}`;
}

function isProcessed(task: {
  readonly state: WorktreeSummary["state"];
}): boolean {
  return task.state === "merged" || task.state === "discarded";
}

function matchesState(
  task: WorktreeSummary,
  filter: StateFilter
): boolean {
  if (filter === "all") return true;
  if (filter === "draft") {
    return task.state === "draft" || task.state === "merging";
  }
  if (filter === "ready") return task.state === "ready";
  return task.state === "merged" || task.state === "discarded";
}

function taskGroupKeyForState(
  state: WorktreeSummary["state"]
): TaskGroupKey {
  if (state === "ready") return "ready";
  if (state === "merged" || state === "discarded") {
    return "processed";
  }
  return "running";
}

function taskGroups(
  tasks: WorktreeSummary[],
  t: ReturnType<typeof useI18n>["t"]
) {
  const definitions = [
    {
      key: "running",
      label: t("inProgress"),
      states: ["draft", "merging"],
    },
    { key: "ready", label: t("awaitingReview"), states: ["ready"] },
    {
      key: "processed",
      label: t("processed"),
      states: ["merged", "discarded"],
    },
  ] as const;
  return definitions
    .map((definition) => ({
      ...definition,
      tasks: tasks.filter((task) =>
        definition.states.some((state) => state === task.state)
      ),
    }))
    .filter((group) => group.tasks.length > 0);
}
