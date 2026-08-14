import {
  useMutation,
  useQueries,
  useQueryClient,
} from "@tanstack/react-query";
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
  Tooltip,
  toast,
} from "../../shared/ui";
import { cn } from "../../shared/utils/cn";
import type { MergeReviewStatus } from "../editor/merge-review";
import {
  worktreeUnitMergeReviewQueryOptions,
  worktreesQueryKey,
} from "./worktrees.queries";
import { reviewActionFeedback } from "./worktree-action-feedback";
import type { WorktreeReviewView } from "./worktree-review-search";

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
  selectedView = "agent",
  onSelectedViewChange,
}: {
  readonly worktree: WorktreeDetailModel;
  readonly selectedUnitId?: string | null;
  readonly selectedView?: WorktreeReviewView;
  readonly onSelectedViewChange?: (view: WorktreeReviewView) => void;
}) {
  const { language, t } = useI18n();
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
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-4 max-[980px]:flex-col">
        <div className="min-w-0 max-w-3xl">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="m-0 truncate text-base font-semibold tracking-tight">
              {worktree.name}
            </h3>
            <Badge variant={worktreeStateVariant(worktree.state)}>
              {worktreeStateLabel(worktree.state, t)}
            </Badge>
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {worktree.kind === "team"
              ? worktree.teamSpace?.name
              : t("personalSpace")}
            {" · "}
            {worktree.creator.displayName}
            {" · "}
            {formatDateTime(worktree.updatedAt, language)}
          </p>
          {worktree.summary ? (
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              {worktree.summary}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
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
                <Button disabled={action.isPending}>
                  <Send />
                  {t("submitForReview")}
                </Button>
              }
            />
          ) : null}
          {worktree.capabilities.merge && hasMergeConflict ? (
            <Tooltip content={t("mergeConflictBlocksMerge")}>
              <span className="inline-flex">
                <Button disabled>
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
                <Button disabled={action.isPending || mergeReviewPending}>
                  <CheckCircle2 />
                  {t("confirmMerge")}
                </Button>
              }
            />
          ) : null}
        </div>
      </header>

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
          selectedView={selectedView}
          mergeReviewStatus={
            mergeReviewByUnitId.get(selectedUnit.unitId)?.data
          }
          mergeReviewPending={
            mergeReviewByUnitId.get(selectedUnit.unitId)?.isPending ??
            false
          }
          mergeReviewFailed={
            mergeReviewByUnitId.get(selectedUnit.unitId)?.isError ?? false
          }
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
  selectedView,
  mergeReviewStatus,
  mergeReviewPending,
  mergeReviewFailed,
  onSelectedViewChange,
}: {
  readonly worktree: WorktreeDetailModel;
  readonly unit: WorktreeUnit;
  readonly selectedView: WorktreeReviewView;
  readonly mergeReviewStatus: MergeReviewStatus | undefined;
  readonly mergeReviewPending: boolean;
  readonly mergeReviewFailed: boolean;
  readonly onSelectedViewChange?: (view: WorktreeReviewView) => void;
}) {
  const { t } = useI18n();
  const canViewTrunk =
    unit.source === "trunk" || unit.activationState === "completed";
  const canViewMergePreview =
    worktree.state === "ready" && mergeReviewStatus === "preview";
  const activeView: WorktreeReviewView =
    selectedView === "trunk" && canViewTrunk
      ? "trunk"
      : selectedView === "preview" && canViewMergePreview
        ? "preview"
        : "agent";
  const canPreview =
    activeView === "trunk" || unit.change !== "deleted";
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
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4.5 py-3 max-[980px]:flex-col max-[980px]:items-start">
        <div className="flex items-center gap-2">
          <UnitTypeIcon type={unit.unitType} />
          <UnitChangeIcon change={unit.change} />
          <span className="text-[13px] text-muted-foreground">
            {unitChangeLabel(unit.change, t)}
            {" · "}
            {unitTypeLabel(unit.unitType, t)}
          </span>
          {unit.mergeResult !== "pending" ? (
            <Badge
              variant={
                unit.mergeResult === "merged" ||
                unit.mergeResult === "unchanged"
                  ? "success"
                  : "danger"
              }
            >
              {t("mergeResultLabel", {
                value: t(unit.mergeResult),
              })}
            </Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Badge variant="outline">{t("readOnlyPreview")}</Badge>
          <Segmented
            size="sm"
            aria-label={t("readOnlyPreview")}
            value={activeView}
            onValueChange={(value) =>
              onSelectedViewChange?.(value as WorktreeReviewView)
            }
            options={[
              {
                label: t("officialVersion"),
                value: "trunk",
                disabled: !canViewTrunk,
              },
              {
                label: t("agentVersion"),
                value: "agent",
              },
              ...(canViewMergePreview
                ? [
                    {
                      label: t("mergePreview"),
                      value: "preview" as const,
                    },
                  ]
                : []),
            ]}
          />
        </div>
      </div>
      {mergeReviewStatus === "preview" ? (
        <Alert className="mx-4.5 mt-3" variant="info">
          {t("trunkAdvancedPreviewReady")}
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
      {!canPreview ? (
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
}: {
  readonly type: WorktreeUnit["unitType"];
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
  return (
    <Tooltip content={label}>
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
    </Tooltip>
  );
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

function formatDateTime(
  value: string,
  language: "zh-CN" | "en-US"
): string {
  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

type Translator = (
  key: MessageKey,
  values?: Readonly<Record<string, string | number>>
) => string;
