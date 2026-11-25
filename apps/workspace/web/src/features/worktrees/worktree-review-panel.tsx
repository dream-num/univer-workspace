import type { ReactNode } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
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
import { sessionQueryOptions } from "../auth";
import { spaceQueryOptions } from "../spaces/spaces.queries";
import { ApiError } from "../../shared/api/errors";
import { useI18n, type MessageKey } from "../../shared/i18n";
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
  worktreeChecksQueryOptions,
  worktreeUnitComparisonQueryOptions,
  worktreeUnitMergeReviewQueryOptions,
} from "./worktrees.queries";
import { useToggleUnitRemoval, useWorktreeLifecycle } from "./worktrees.commands";
import { reviewActionFeedback } from "./worktree-action-feedback";
import {
  resolveReviewView,
  reviewModeForView,
  reviewViewForMode,
} from "./worktree-review-presentation";
import { DEFAULT_WORKTREE_REVIEW_VIEW, type WorktreeReviewView } from "./worktree-review-search";
import { WorktreeReviewHeader } from "./worktree-review-header";
import { RevertSection } from "./worktree-revert";
import { worktreeHtmlViewDraftsQueryOptions } from "../html-views/drafts/draft-queries";
import { useDraftMessages } from "../html-views/drafts/messages";
import { formatSkillFileSize } from "../skill-drafts/review-presentation";

type WorktreeDetailModel = components["schemas"]["WorktreeDetail"];
type WorktreeState = components["schemas"]["WorktreeState"];
type WorktreeUnit = components["schemas"]["WorktreeUnit"];
type UnitChange = WorktreeUnit["change"];
type ReviewAction = "markReady" | "reopen" | "merge" | "discard";
type BadgeVariant = "default" | "brand" | "success" | "warning" | "danger" | "violet" | "outline";

export function WorktreeReviewPanel({
  worktree,
  selectedUnitId,
  selectedView = DEFAULT_WORKTREE_REVIEW_VIEW,
  onSelectedViewChange,
  layout,
}: {
  readonly worktree: WorktreeDetailModel;
  readonly selectedUnitId?: string | null;
  readonly selectedView?: WorktreeReviewView;
  readonly onSelectedViewChange?: (view: WorktreeReviewView) => void;
  readonly layout?: (parts: { readonly review: ReactNode; readonly actions: ReactNode; readonly pages: ReactNode }) => ReactNode;
}) {
  const { t } = useI18n();
  const session = useQuery(sessionQueryOptions);
  const me = session.data?.authenticated ? session.data.user.id : undefined;
  const agent = session.data?.authenticated === true && session.data.user.kind === "agent";
  const space = useQuery({ ...spaceQueryOptions(worktree.teamSpace?.id), enabled: agent && worktree.teamSpace !== null });
  const landsByChecks = space.data?.landing === "checks" && (space.data.accessRole === "editor" || space.data.accessRole === "admin");
  const selectedUnit =
    selectedUnitId === undefined || selectedUnitId === null
      ? worktree.units[0]
      : worktree.units.find((unit) => unit.unitId === selectedUnitId);
  const selectedUnitMissing =
    selectedUnitId !== undefined && selectedUnitId !== null && !selectedUnit;
  const mergeReviewUnits =
    worktree.state === "ready" && worktree.capabilities.review
      ? worktree.units.filter((unit) => unit.source === "trunk" && unit.change === "modified" && !leftTrunk(unit))
      : [];
  const mergeReviewQueries = useQueries({
    queries: mergeReviewUnits.map((unit) =>
      worktreeUnitMergeReviewQueryOptions(worktree.id, unit.unitId),
    ),
  });
  const mergeReviewByUnitId = new Map(
    mergeReviewUnits.map((unit, index) => [unit.unitId, mergeReviewQueries[index]]),
  );
  const mergeReviewPending = mergeReviewQueries.some((query) => query.isPending);
  const hasMergeConflict = mergeReviewQueries.some((query) => query.data === "conflict");
  const selectedMergeReviewQuery = selectedUnit
    ? mergeReviewByUnitId.get(selectedUnit.unitId)
    : undefined;
  const activeView = selectedUnit
    ? resolveReviewView(worktree, selectedUnit, selectedView, selectedMergeReviewQuery?.data)
    : selectedView;
  const showReviewViewControl = worktree.capabilities.review && selectedUnit !== undefined && !leftTrunk(selectedUnit);

  const pageList = useQuery({ ...worktreeHtmlViewDraftsQueryOptions(worktree.id), enabled: worktree.capabilities.review });
  // The merge acts on every page listed pending or conflicted: it publishes the first and leaves the second conflicted.
  const mergePages = pageList.data?.filter((draft) => draft.state === "pending" || draft.state === "conflicted");
  const pagesToPublish = pageList.data?.filter((draft) => draft.state === "pending" && draft.page !== false).length ?? 0;
  const filesToReplace = pageList.data?.filter((draft) => draft.state === "pending" && draft.page === false).length ?? 0;
  const fileDraftIds = new Set(pageList.data?.filter((draft) => draft.page === false).map((draft) => draft.id));

  const removal = useToggleUnitRemoval(worktree.id);
  const action = useWorktreeLifecycle(worktree.id);
  const onError = (error: Error) =>
    toast.error(error instanceof ApiError && error.code === "PAGES_CHANGED" ? t("pagesChangedReviewAgain") : error.message);
  const runAction = (value: ReviewAction, pageDraftIds?: readonly string[]) =>
    action.mutate({ action: value, pageDraftIds }, {
      onSuccess: ({ action: value, state, publishedPages }) => {
        if (value === "reopen" && state === "draft") {
          onSelectedViewChange?.("agent");
        }
        const pages = publishedPages.filter((page) => !fileDraftIds.has(page.draftId));
        const files = publishedPages.length - pages.length;
        const feedback = reviewActionFeedback(value, state);
        if (feedback.kind === "success") {
          if (publishedPages.length) {
            toast.success(t(feedback.message), {
              description: <>
                {pages[0] ? <>{t(pages.length === 1 ? "pagePublished" : "pagesPublished", { count: pages.length })} <a className="underline" href={`/nodes/${encodeURIComponent(pages[0].nodeId)}`}>{t("openPublishedPage")}</a> </> : null}
                {files ? t(files === 1 ? "fileReplaced" : "filesReplaced", { count: files }) : null}
              </>,
            });
          } else toast.success(t(feedback.message));
        } else if (feedback.kind === "info") {
          toast.info(t(feedback.message));
        } else {
          toast.error(t(feedback.message));
        }
      },
      onError,
    });

  const authorSide = me === worktree.creator.id || me === worktree.claimer?.id;
  const mergeHint =
    worktree.state === "ready" && worktree.units.some((unit) => unit.change !== "deleted" && leftTrunk(unit))
      ? t("filesInTrashBlockMerge")
      : worktree.kind !== "team" || worktree.state !== "ready" || me === undefined
      ? null
      : agent && landsByChecks
        ? t("checksRequiredToMerge")
        : worktree.visibility === "space"
          ? t(authorSide ? "memberWithEditAccessMerges" : "mergeNeedsEditAccess")
          : authorSide
            ? null
            : worktree.claimer
              ? t("onlyAuthorOrClaimerMerges", {
                  name: worktree.creator.displayName,
                  claimer: worktree.claimer.displayName,
                })
              : t("onlyAuthorMerges", { name: worktree.creator.displayName });
  const lifecycleActions = (
    <>
      {worktree.capabilities.reopen ? (
        <Button size="sm" disabled={action.isPending} onClick={() => runAction("reopen")}>
          <Pencil />
          {t("continueEditing")}
        </Button>
      ) : null}
      {worktree.capabilities.markReady ? (
        <ConfirmDialog
          title={t("submitForReviewConfirm")}
          description={t("submitForReviewDescription")}
          confirmText={t("submitForReview")}
          cancelText={t("cancel")}
          onConfirm={() => runAction("markReady")}
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
          description={t("mergeDescription") + (pagesToPublish > 0 ? ` ${t(pagesToPublish === 1 ? "mergePublishesPage" : "mergePublishesPages", { count: pagesToPublish })}` : "")
            + (filesToReplace > 0 ? ` ${t(filesToReplace === 1 ? "mergeReplacesFile" : "mergeReplacesFiles", { count: filesToReplace })}` : "")}
          confirmText={t("confirmMerge")}
          cancelText={t("cancel")}
          onConfirm={() => runAction("merge", mergePages?.map((draft) => draft.id))}
          trigger={
            <Button size="sm" disabled={action.isPending || mergeReviewPending || mergePages === undefined}>
              <CheckCircle2 />
              {t("confirmMerge")}
            </Button>
          }
        />
      ) : mergeHint ? (
        <span className="text-sm text-muted-foreground">{mergeHint}</span>
      ) : null}
      {worktree.capabilities.discard ? (
        <ConfirmDialog
          title={t("discardChangesConfirm")}
          description={t("discardChangesDescription")}
          confirmText={t("discardChanges")}
          cancelText={t("cancel")}
          danger
          onConfirm={() => runAction("discard")}
          trigger={
            <Button variant="destructive-ghost" size="sm" disabled={action.isPending}>
              <Trash2 />
              {t("discardChanges")}
            </Button>
          }
        />
      ) : null}
    </>
  );
  const pages = worktree.capabilities.review
    ? <>
        <PullRequestChecks worktreeId={worktree.id} />
        <PageDrafts worktreeId={worktree.id} />
        {worktree.state === "merged" ? <div className="border-t border-border px-4 py-3"><RevertSection target={{ worktreeId: worktree.id }} /></div> : null}
      </>
    : null;
  const review = (
    <article className="flex h-full min-h-0 flex-col">
      <WorktreeReviewHeader
        documentName={selectedUnit?.name || selectedUnit?.unitId || t("noAgentDocuments")}
        icon={selectedUnit ? <UnitTypeIcon type={selectedUnit.unitType} /> : null}
        badge={<ReviewBadge state={worktree.state} unit={selectedUnit} />}
        resultBadge={selectedUnit ? <ReviewMergeResultBadge unit={selectedUnit} /> : null}
        view={
          showReviewViewControl
            ? {
                value: reviewModeForView(activeView),
                onChange: (value) => onSelectedViewChange?.(reviewViewForMode(value)),
              }
            : undefined
        }
        actions={
          <>
            {selectedUnit && worktree.state === "draft" && worktree.capabilities.editDraft ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={removal.isPending || action.isPending}
                onClick={() => removal.mutate(selectedUnit, { onError })}
              >
                {t(selectedUnit.change === "deleted" ? "undoUnitRemoval" : leftTrunk(selectedUnit) ? "leaveOutOfPullRequest" : "markUnitRemoved")}
              </Button>
            ) : null}
            {layout ? null : lifecycleActions}
          </>
        }
      />
      {layout ? null : pages}

      {!worktree.capabilities.review ? (
        <Empty className="my-auto" title={t("noReviewPermission")} />
      ) : selectedUnitMissing ? (
        <Empty className="my-auto" title={t("reviewDocumentNotFound")} />
      ) : !selectedUnit ? (
        <Empty className="my-auto" title={t("noAgentDocuments")} />
      ) : leftTrunk(selectedUnit) ? (
        <Empty
          className="my-auto"
          icon={Trash2}
          title={t(selectedUnit.fileState === "deleted" ? "issueAcceptanceDeleted" : "issueAcceptanceInTrash")}
        />
      ) : selectedUnit.change === "deleted" ? (
        <Empty className="my-auto" title={t("removedUnitPreview")} />
      ) : (
        <UnitReview
          key={`${worktree.id}:${selectedUnit.unitId}`}
          worktree={worktree}
          unit={selectedUnit}
          activeView={activeView}
          mergeReviewStatus={selectedMergeReviewQuery?.data}
          mergeReviewPending={selectedMergeReviewQuery?.isPending ?? false}
          mergeReviewFailed={selectedMergeReviewQuery?.isError ?? false}
          {...(onSelectedViewChange === undefined ? {} : { onSelectedViewChange })}
        />
      )}
    </article>
  );
  return layout ? layout({ review, actions: lifecycleActions, pages }) : review;
}

/** No one opens a file in Trash or permanently deleted, so it has no view or comparison. */
function leftTrunk(unit: WorktreeUnit): boolean {
  return unit.fileState === "inTrash" || unit.fileState === "deleted";
}

const CHECK_STATES = {
  passed: { label: "checkPassed", variant: "success" },
  failed: { label: "checkFailed", variant: "danger" },
  missing: { label: "checkMissing", variant: "outline" },
} as const;

export function PullRequestChecks({ worktreeId, explainNone = false }: {
  readonly worktreeId: string;
  readonly explainNone?: boolean;
}) {
  const { t } = useI18n();
  const checks = useQuery(worktreeChecksQueryOptions(worktreeId));
  if (checks.isError) return <p role="alert" className="m-0 border-t border-border px-4 py-3 text-sm text-destructive">{checks.error.message}</p>;
  const noneDeclared = explainNone && checks.data !== undefined && !checks.data.some((check) => check.declared);
  if (!checks.data?.length && !noneDeclared) return null;
  const atMerge = checks.data[0]?.atMerge ?? null;
  const heading = t(atMerge === null ? "checks" : atMerge ? "checksAtMerge" : "checksNow");
  return (
    <section aria-label={heading} className="border-t border-border px-4 py-3">
      <h2 className="m-0 mb-2 text-xs font-semibold text-muted-foreground">{heading}</h2>
      {atMerge === false ? <p className="m-0 mb-2 text-sm text-muted-foreground">{t("checksNotRecordedAtMerge")}</p> : null}
      {noneDeclared ? <p className="m-0 mb-2 text-sm text-muted-foreground">{t("checksNoneDeclared")}</p> : null}
      <ul className="m-0 grid list-none gap-2 p-0">
        {checks.data.map((check) => (
          <li key={check.name} className="grid gap-1 text-sm">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <span className="min-w-0 flex-1 break-words font-mono font-medium">{check.name}</span>
              {check.declared ? null : <span className="text-muted-foreground">{t("checkNotDeclared")}</span>}
              <Badge variant={CHECK_STATES[check.state].variant}>{t(CHECK_STATES[check.state].label)}</Badge>
            </div>
            {check.results.length ? (
              <ul className="m-0 grid list-none gap-1 p-0 pl-3 text-xs text-muted-foreground">
                {check.results.map((result) => (
                  <li key={`${result.reporter.id}-${result.reportedAt}`} className={cn("break-words", !result.current && "line-through")}>
                    {result.reporter.displayName} · {t(CHECK_STATES[result.state].label)}
                    {result.counts ? null : ` · ${t(result.current ? "checkDoesNotCount" : "checkOutOfDate")}`}
                    {result.summary ? ` · ${result.summary}` : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function PageDrafts({ worktreeId }: { readonly worktreeId: string }) {
  const m = useDraftMessages();
  const drafts = useQuery(worktreeHtmlViewDraftsQueryOptions(worktreeId));
  if (drafts.isError) return <p role="alert" className="m-0 border-t border-border px-4 py-3 text-sm text-destructive">{drafts.error.message}</p>;
  if (!drafts.data?.length) return null;
  const heading = drafts.data.some((draft) => draft.page === false) ? m.pagesAndFiles : m.pages;
  return (
    <section aria-label={heading} className="border-t border-border px-4 py-3">
      <h2 className="m-0 mb-2 text-xs font-semibold text-muted-foreground">{heading}</h2>
      <ul className="m-0 grid list-none gap-2 p-0">
        {drafts.data.map((draft) => (
          <li key={draft.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="min-w-0 flex-1 break-words font-medium">{draft.name}</span>
            <span className="text-muted-foreground">{m.byAuthor(draft.author.displayName)}</span>
            <Badge variant="outline">{draft.state === "conflicted" ? m.conflictedState : m[draft.state]}</Badge>
            {draft.page === false ? <>
              <span className="text-muted-foreground">{formatSkillFileSize(draft.byteSize)}</span>
              <a className="text-primary underline" href={`/api/html-view-drafts/${encodeURIComponent(draft.id)}/content`} download={draft.name}>{m.download}</a>
            </> : <a className="text-primary underline" href={`/drafts/${encodeURIComponent(draft.id)}`}>{m.previewPage}</a>}
          </li>
        ))}
      </ul>
    </section>
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
    activeView === "comparison" || activeView === "trunk" || unit.change !== "deleted";
  const previewMode =
    activeView === "trunk" ? "trunk" : activeView === "preview" ? "mergePreview" : "draft";
  const previewUrl = `/worktrees/${encodeURIComponent(
    worktree.id,
  )}/units/${encodeURIComponent(unit.unitId)}/${previewMode}?embedded=true`;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      {mergeReviewStatus === "preview" ? (
        <Alert className="mx-4.5 mt-3" variant="info">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 flex-1">{t("trunkAdvancedPreviewReady")}</span>
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
            <Empty className="my-auto" title={t("comparisonFailed")} />
          ) : (
            <UnitComparisonViewer
              key={`${comparison.result.comparisonId}:${unit.unitId}`}
              comparison={comparison}
              createUniver={createComparisonUniver}
              locale={language === "zh-CN" ? LocaleType.ZH_CN : LocaleType.EN_US}
              darkMode={resolvedTheme === "dark"}
            />
          )}
        </div>
      ) : !canPreview ? (
        <Empty className="mt-[min(18vh,160px)]" icon={Trash2} title={t("deletedDocumentPreview")} />
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
    <Badge variant={worktreeStateVariant(state)}>{worktreeStateLabel(state, t)}</Badge>
  );
}

function ReviewMergeResultBadge({ unit }: { readonly unit: WorktreeUnit }) {
  const { t } = useI18n();
  return unit.mergeResult !== "pending" ? (
    <Badge
      variant={
        unit.mergeResult === "merged" ||
        unit.mergeResult === "unchanged" ||
        unit.mergeResult === "removed"
          ? "success"
          : "danger"
      }
    >
      {t("mergeResultLabel", { value: t(unit.mergeResult) })}
    </Badge>
  ) : null;
}

export function UnitChangeIcon({ change }: { readonly change: UnitChange }) {
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
          change === "added" && "bg-success-soft text-success-soft-foreground",
          change === "deleted" && "bg-destructive-soft text-destructive-soft-foreground",
          change === "unchanged" && "bg-muted text-muted-foreground",
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
        type === "base" && "bg-baseunit-soft text-baseunit",
      )}
    >
      <Icon />
    </span>
  );
  return showTooltip ? <Tooltip content={label}>{icon}</Tooltip> : icon;
}

export function worktreeStateLabel(state: WorktreeState, t: Translator): string {
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

function unitTypeLabel(type: WorktreeUnit["unitType"], t: Translator): string {
  return t(type);
}

type Translator = (key: MessageKey, values?: Readonly<Record<string, string | number>>) => string;
