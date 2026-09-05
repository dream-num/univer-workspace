import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { LocaleType } from "@univerjs/core";
import {
  UnitComparisonViewer,
  type UnitComparisonViewerValue,
} from "@univer/unit-comparison-viewer";
import {
  CheckCircle2,
  Database,
  FileText,
  Minus,
  Pencil,
  Plus,
  Presentation,
  Send,
  Shapes,
  Table2,
  Trash2,
} from "lucide-react";
import type { components } from "../../../../generated/http/schema.js";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { createIdempotencyKey } from "../../shared/idempotency-key";
import {
  useI18n,
  type MessageKey,
} from "../../shared/i18n";
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Empty,
  Segmented,
  Spinner,
  Tooltip,
  toast,
} from "../../shared/ui";
import { useTheme } from "../../shared/theme";
import { cn } from "../../shared/utils/cn";
import type { MergeReviewStatus } from "../editor/merge-review";
import { createComparisonUniver } from "../editor/comparison-univer";
import {
  worktreeUnitComparisonQueryOptions,
  worktreeUnitMergeReviewQueryOptions,
  worktreesQueryKey,
} from "./worktrees.queries";
import { reviewActionFeedback } from "./worktree-action-feedback";
import {
  resolveReviewView,
  reviewModeForView,
  reviewViewForMode,
} from "./worktree-review-presentation";
import {
  DEFAULT_WORKTREE_REVIEW_VIEW,
  type WorktreeReviewView,
} from "./worktree-review-search";
import { WorktreeReviewHeader } from "./worktree-review-header";

type WorktreeDetailModel = components["schemas"]["WorktreeDetail"];
type WorktreeState = components["schemas"]["WorktreeState"];
type WorktreeUnit = components["schemas"]["WorktreeUnit"];
type UnitChange = WorktreeUnit["change"];
type ReviewAction = "markReady" | "merge" | "discard";
type BadgeVariant =
  | "default"
  | "brand"
  | "success"
  | "warning"
  | "danger"
  | "violet"
  | "outline";

export function WorktreeReviewPanel({
  worktree,
  selectedUnitId,
  selectedView = DEFAULT_WORKTREE_REVIEW_VIEW,
  onSelectedViewChange,
}: {
  readonly worktree: WorktreeDetailModel;
  readonly selectedUnitId?: string | null;
  readonly selectedView?: WorktreeReviewView;
  readonly onSelectedViewChange?: (view: WorktreeReviewView) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const selectedUnit =
    selectedUnitId === undefined || selectedUnitId === null
      ? worktree.units[0]
      : worktree.units.find((unit) => unit.unitId === selectedUnitId);
  const selectedUnitMissing =
    selectedUnitId !== undefined &&
    selectedUnitId !== null &&
    !selectedUnit;
  const mergeReviewUnits =
    worktree.state === "ready" && worktree.capabilities.review
      ? worktree.units.filter(
          (unit) =>
            unit.source === "trunk" && unit.change === "modified"
        )
      : [];
  const mergeReviewQueries = useQueries({
    queries: mergeReviewUnits.map((unit) =>
      worktreeUnitMergeReviewQueryOptions(worktree.id, unit.unitId)
    ),
  });
  const mergeReviewByUnitId = new Map(
    mergeReviewUnits.map((unit, index) => [
      unit.unitId,
      mergeReviewQueries[index],
    ])
  );
  const mergeReviewPending = mergeReviewQueries.some(
    (query) => query.isPending
  );
  const hasMergeConflict = mergeReviewQueries.some(
    (query) => query.data === "conflict"
  );
  const selectedMergeReviewQuery = selectedUnit
    ? mergeReviewByUnitId.get(selectedUnit.unitId)
    : undefined;
  const activeView = selectedUnit
    ? resolveReviewView(
        worktree,
        selectedUnit,
        selectedView,
        selectedMergeReviewQuery?.data
      )
    : selectedView;
  const showReviewViewControl =
    worktree.capabilities.review && selectedUnit !== undefined;

  const action = useMutation({
    mutationFn: async (value: ReviewAction) => {
      const result =
        value === "markReady"
          ? await api.POST("/api/worktrees/{worktreeId}/ready", {
              params: { path: { worktreeId: worktree.id } },
            })
          : value === "merge"
            ? await api.POST("/api/worktrees/{worktreeId}/merge", {
                params: {
                  path: { worktreeId: worktree.id },
                  header: {
                    "Idempotency-Key": createIdempotencyKey(),
                  },
                },
              })
            : await api.POST("/api/worktrees/{worktreeId}/discard", {
                params: {
                  path: { worktreeId: worktree.id },
                  header: {
                    "Idempotency-Key": createIdempotencyKey(),
                  },
                },
              });
      if (result.error) throw apiError(result.error);
      return {
        action: value,
        state:
          "worktree" in result.data ? result.data.worktree.state : null,
      };
    },
    onSuccess: async ({ action: value, state }) => {
      await queryClient.invalidateQueries({ queryKey: worktreesQueryKey });
      const feedback = reviewActionFeedback(value, state);
      if (feedback.kind === "success") {
        toast.success(t(feedback.message));
      } else if (feedback.kind === "info") {
        toast.info(t(feedback.message));
      } else {
        toast.error(t(feedback.message));
      }
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <article className="flex h-full min-h-0 flex-col">
      <WorktreeReviewHeader
        documentName={
          selectedUnit?.name || selectedUnit?.unitId || t("noAgentDocuments")
        }
        icon={selectedUnit ? <UnitTypeIcon type={selectedUnit.unitType} /> : null}
        badge={<ReviewBadge state={worktree.state} unit={selectedUnit} />}
        resultBadge={
          selectedUnit ? <ReviewMergeResultBadge unit={selectedUnit} /> : null
        }
        view={
          showReviewViewControl
            ? {
                value: reviewModeForView(activeView),
                onChange: (value) =>
                  onSelectedViewChange?.(reviewViewForMode(value)),
              }
            : undefined
        }
        actions={
          <>
            {worktree.capabilities.discard ? (
              <ConfirmDialog
                title={t("discardChangesConfirm")}
                description={t("discardChangesDescription")}
                confirmText={t("discardChanges")}
                cancelText={t("cancel")}
                danger
                onConfirm={() => action.mutate("discard")}
                trigger={
                  <Button
                    variant="destructive-ghost"
                    size="sm"
                    disabled={action.isPending}
                  >
                    <Trash2 />
                    {t("discardChanges")}
                  </Button>
                }
              />
            ) : null}
            {worktree.capabilities.markReady ? (
              <ConfirmDialog
                title={t("submitForReviewConfirm")}
                description={t("submitForReviewDescription")}
                confirmText={t("submitForReview")}
                cancelText={t("cancel")}
                onConfirm={() => action.mutate("markReady")}
                trigger={
                  <Button size="sm" disabled={action.isPending}>
                    <Send />
                    {t("submitForReview")}
                  </Button>
                }
              />
            ) : null}
            {worktree.capabilities.merge && hasMergeConflict ? (
              <Tooltip content={t("mergeConflictBlocksMerge")}>
                <span className="inline-flex max-w-full">
                  <Button size="sm" disabled>
                    <CheckCircle2 />
                    {t("confirmMerge")}
                  </Button>
                </span>
              </Tooltip>
            ) : worktree.capabilities.merge ? (
              <ConfirmDialog
                title={t("mergeConfirm")}
                description={t("mergeDescription")}
                confirmText={t("confirmMerge")}
                cancelText={t("cancel")}
                onConfirm={() => action.mutate("merge")}
                trigger={
                  <Button
                    size="sm"
                    disabled={action.isPending || mergeReviewPending}
                  >
                    <CheckCircle2 />
                    {t("confirmMerge")}
                  </Button>
                }
              />
            ) : null}
          </>
        }
      />

      {!worktree.capabilities.review ? (
        <Empty className="my-auto" title={t("noReviewPermission")} />
      ) : selectedUnitMissing ? (
        <Empty className="my-auto" title={t("reviewDocumentNotFound")} />
      ) : !selectedUnit ? (
        <Empty className="my-auto" title={t("noAgentDocuments")} />
      ) : (
        <UnitReview
          key={`${worktree.id}:${selectedUnit.unitId}`}
          worktree={worktree}
          unit={selectedUnit}
          activeView={activeView}
          mergeReviewStatus={selectedMergeReviewQuery?.data}
          mergeReviewPending={selectedMergeReviewQuery?.isPending ?? false}
          mergeReviewFailed={selectedMergeReviewQuery?.isError ?? false}
          {...(onSelectedViewChange === undefined
            ? {}
            : { onSelectedViewChange })}
        />
      )}
    </article>
  );
}

function UnitReview({
  worktree,
  unit,
  activeView,
  mergeReviewStatus,
  mergeReviewPending,
  mergeReviewFailed,
  onSelectedViewChange,
}: {
  readonly worktree: WorktreeDetailModel;
  readonly unit: WorktreeUnit;
  readonly activeView: WorktreeReviewView;
  readonly mergeReviewStatus: MergeReviewStatus | undefined;
  readonly mergeReviewPending: boolean;
  readonly mergeReviewFailed: boolean;
  readonly onSelectedViewChange?: (view: WorktreeReviewView) => void;
}) {
  const { language, t } = useI18n();
  const { resolvedTheme } = useTheme();
  const comparisonQuery = useQuery({
    ...worktreeUnitComparisonQueryOptions(worktree.id, unit.unitId),
    enabled: activeView === "comparison",
  });
  const comparison = comparisonQuery.data
    ? ({
        result: comparisonQuery.data.result,
        left: {
          label: t("officialVersion"),
          ...comparisonQuery.data.left,
        },
        right: {
          label: t("agentVersion"),
          ...comparisonQuery.data.right,
        },
      } as UnitComparisonViewerValue)
    : null;
  const canPreview =
    activeView === "comparison" ||
    activeView === "trunk" ||
    unit.change !== "deleted";
  const previewMode =
    activeView === "trunk"
      ? "trunk"
      : activeView === "preview"
        ? "mergePreview"
        : "draft";
  const previewUrl = `/worktrees/${encodeURIComponent(
    worktree.id
  )}/units/${encodeURIComponent(unit.unitId)}/${previewMode}?embedded=true`;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      {mergeReviewStatus === "preview" ? (
        <Alert className="mx-4.5 mt-3" variant="info">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 flex-1">
              {t("trunkAdvancedPreviewReady")}
            </span>
            {activeView !== "comparison" ? (
              <div className="min-w-0 max-w-full" data-testid="merge-preview-control">
                <Segmented<"preview" | "agent">
                  size="sm"
                  aria-label={t("mergePreview")}
                  className="grid max-w-full grid-cols-2"
                  itemClassName="h-auto min-h-7 min-w-0 whitespace-normal [overflow-wrap:anywhere] py-1"
                  value={activeView === "preview" ? "preview" : "agent"}
                  onValueChange={(value) => onSelectedViewChange?.(value)}
                  options={[
                    {
                      label: t("mergePreview"),
                      value: "preview",
                    },
                    {
                      label: t("agentVersion"),
                      value: "agent",
                    },
                  ]}
                />
              </div>
            ) : null}
          </div>
        </Alert>
      ) : mergeReviewStatus === "conflict" ? (
        <Alert className="mx-4.5 mt-3" variant="warning">
          {t("mergeConflictTip")}
        </Alert>
      ) : mergeReviewFailed ? (
        <Alert className="mx-4.5 mt-3" variant="warning">
          {t("mergePreviewCheckFailed")}
        </Alert>
      ) : mergeReviewPending ? (
        <Alert className="mx-4.5 mt-3" variant="info">
          {t("checkingMergePreview")}
        </Alert>
      ) : null}
      {activeView === "comparison" ? (
        <div className="flex min-h-[480px] flex-1 flex-col overflow-hidden">
          {comparisonQuery.isPending ? (
            <div className="grid h-full place-items-center">
              <Spinner />
            </div>
          ) : comparisonQuery.isError || comparison === null ? (
            <Empty
              className="my-auto"
              title={t("comparisonFailed")}
            />
          ) : (
            <UnitComparisonViewer
              key={`${comparison.result.comparisonId}:${unit.unitId}`}
              comparison={comparison}
              createUniver={createComparisonUniver}
              locale={
                language === "zh-CN"
                  ? LocaleType.ZH_CN
                  : LocaleType.EN_US
              }
              darkMode={resolvedTheme === "dark"}
            />
          )}
        </div>
      ) : !canPreview ? (
        <Empty
          className="mt-[min(18vh,160px)]"
          icon={Trash2}
          title={t("deletedDocumentPreview")}
        />
      ) : (
        <div className="flex min-h-[480px] flex-1 flex-col overflow-hidden">
          <iframe
            key={previewUrl}
            className="h-full w-full flex-1 border-0 bg-background"
            src={previewUrl}
            title={t("documentPreviewTitle", {
              name: unit.name,
            })}
          />
        </div>
      )}
    </section>
  );
}

function ReviewBadge({
  state,
  unit,
}: {
  readonly state: WorktreeState;
  readonly unit: WorktreeUnit | undefined;
}) {
  const { t } = useI18n();
  return unit ? (
    <Badge
      className="min-w-0 shrink whitespace-normal [overflow-wrap:anywhere]"
      variant={unitChangeVariant(unit.change)}
    >
      {unitChangeLabel(unit.change, t)}
    </Badge>
  ) : (
    <Badge variant={worktreeStateVariant(state)}>
      {worktreeStateLabel(state, t)}
    </Badge>
  );
}

function ReviewMergeResultBadge({ unit }: { readonly unit: WorktreeUnit }) {
  const { t } = useI18n();
  return unit.mergeResult !== "pending" ? (
    <Badge
      variant={
        unit.mergeResult === "merged" || unit.mergeResult === "unchanged"
          ? "success"
          : "danger"
      }
    >
      {t("mergeResultLabel", { value: t(unit.mergeResult) })}
    </Badge>
  ) : null;
}

export function UnitChangeIcon({
  change,
}: {
  readonly change: UnitChange;
}) {
  const { t } = useI18n();
  const label = unitChangeLabel(change, t);
  const Icon =
    change === "modified"
      ? Pencil
      : change === "added"
        ? Plus
        : change === "deleted"
          ? Trash2
          : Minus;
  return (
    <Tooltip content={label}>
      <span
        aria-label={label}
        className={cn(
          "inline-flex size-5 items-center justify-center rounded-md [&_svg]:size-3",
          change === "modified" && "bg-info-soft text-info-soft-foreground",
          change === "added" &&
            "bg-success-soft text-success-soft-foreground",
          change === "deleted" &&
            "bg-destructive-soft text-destructive-soft-foreground",
          change === "unchanged" && "bg-muted text-muted-foreground"
        )}
      >
        <Icon />
      </span>
    </Tooltip>
  );
}

export function UnitTypeIcon({
  type,
  showTooltip = true,
}: {
  readonly type: WorktreeUnit["unitType"];
  readonly showTooltip?: boolean;
}) {
  const { t } = useI18n();
  const label = unitTypeLabel(type, t);
  const Icon =
    type === "sheet"
      ? Table2
      : type === "doc"
        ? FileText
        : type === "slide"
          ? Presentation
          : type === "board"
            ? Shapes
            : Database;
  const icon = (
    <span
      aria-label={label}
      className={cn(
        "inline-flex size-5 items-center justify-center rounded-md [&_svg]:size-3",
        type === "sheet" && "bg-sheet-soft text-sheet",
        type === "doc" && "bg-doc-soft text-doc",
        type === "slide" && "bg-slide-soft text-slide",
        type === "board" && "bg-board-soft text-board",
        type === "base" && "bg-baseunit-soft text-baseunit"
      )}
    >
      <Icon />
    </span>
  );
  return showTooltip ? <Tooltip content={label}>{icon}</Tooltip> : icon;
}

export function worktreeStateLabel(
  state: WorktreeState,
  t: Translator
): string {
  if (state === "draft") return t("stateDraft");
  if (state === "ready") return t("stateReady");
  if (state === "merging") return t("stateMerging");
  if (state === "merged") return t("stateMerged");
  return t("stateDiscarded");
}

export function worktreeStateVariant(state: WorktreeState): BadgeVariant {
  if (state === "draft") return "brand";
  if (state === "ready") return "warning";
  if (state === "merged") return "success";
  if (state === "merging") return "violet";
  return "default";
}

function unitChangeVariant(change: UnitChange): BadgeVariant {
  if (change === "modified") return "brand";
  if (change === "added") return "success";
  if (change === "deleted") return "danger";
  return "default";
}

function unitChangeLabel(change: UnitChange, t: Translator): string {
  if (change === "modified") return t("documentModified");
  if (change === "added") return t("documentAdded");
  if (change === "deleted") return t("documentDeleted");
  return t("documentUnchanged");
}

function unitTypeLabel(
  type: WorktreeUnit["unitType"],
  t: Translator
): string {
  return t(type);
}

type Translator = (
  key: MessageKey,
  values?: Readonly<Record<string, string | number>>
) => string;
