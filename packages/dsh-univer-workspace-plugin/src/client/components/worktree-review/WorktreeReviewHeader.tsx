/**
 * Header of the middle Worktree review surface: title, status, description,
 * real metadata (creator, updatedAt, and the bound Team Space only when the
 * Worktree is a team one — never a "个人空间" label or a bare user/team kind)
 * plus lifecycle actions driven solely by server capabilities. Actions confirm
 * through the shared ConfirmDialog; the surface refetches after a transition.
 * @module dsh-univer-workspace-plugin/client/components/worktree-review/WorktreeReviewHeader
 */

import { useState, type ReactElement } from "react";
import {
  Badge,
  Button,
  CheckIcon,
  CloseIcon,
  ConfirmDialog,
  ListTreeIcon,
  RefreshIcon,
  SendIcon,
  TrashIcon,
} from "@univerjs/univer-workspace-ui";
import type { DocumentWorktreeState, WorktreeAction } from "../../../shared/state.ts";
import { postWorktreeAction } from "../../api/univer-api.ts";
import type { UniverLocaleKey } from "../../locales.ts";
import {
  actionDialogCopy,
  formatOptionalDateTime,
  statusLabel,
  statusVariant,
} from "../turn-context-card-model.ts";
import css from "./WorktreeReviewHeader.module.scss";

export interface WorktreeReviewHeaderProps {
  readonly worktree: DocumentWorktreeState | undefined;
  readonly workspaceOrigin: string;
  readonly fallbackName: string;
  readonly t: (key: UniverLocaleKey) => string;
  readonly onClose: () => void;
  readonly onActionSettled: () => void;
}

export function WorktreeReviewHeader(props: WorktreeReviewHeaderProps): ReactElement {
  const { worktree, t } = props;
  const [pendingAction, setPendingAction] = useState<WorktreeAction | null>(null);
  const [busyAction, setBusyAction] = useState<WorktreeAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const metaParts: string[] = [];
  if (worktree !== undefined) {
    if (worktree.kind === "team" && worktree.teamSpace !== null)
      metaParts.push(worktree.teamSpace.name);
    metaParts.push(worktree.creator.displayName);
    const updatedAt = formatOptionalDateTime(worktree.updatedAt);
    if (updatedAt !== null) metaParts.push(updatedAt);
  }

  const dialog = pendingAction === null ? null : actionDialogCopy(pendingAction, t);
  const confirm = (): void => {
    const action = pendingAction;
    if (action === null || busyAction !== null || worktree === undefined) return;
    setBusyAction(action);
    setActionError(null);
    void postWorktreeAction(worktree.worktreeId, action)
      .then(() => {
        setPendingAction(null);
        props.onActionSettled();
      })
      .catch((reason: unknown) => {
        setActionError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setBusyAction(null));
  };

  return (
    <header className={css.header}>
      <div className={css.identity}>
        <span className={css.glyph} aria-hidden="true">
          <ListTreeIcon />
        </span>
        <div className={css.titleBlock}>
          <div className={css.titleRow}>
            {worktree === undefined ? null : (
              <Badge variant={statusVariant(worktree.status)}>
                {statusLabel(worktree.status, t)}
              </Badge>
            )}
            <strong className={css.name}>{worktree?.name ?? props.fallbackName}</strong>
          </div>
          {metaParts.length > 0 ? <p className={css.meta}>{metaParts.join(" · ")}</p> : null}
          <p className={css.summary} data-empty={worktree?.summary?.trim() ? undefined : true}>
            {worktree?.summary?.trim() || t("worktree.noDescription")}
          </p>
        </div>
      </div>
      <div className={css.actions}>
        {worktree !== undefined &&
        worktree.capabilities.discard &&
        (worktree.status === "draft" || worktree.status === "ready") ? (
          <Button
            variant="destructive-ghost"
            size="sm"
            disabled={busyAction !== null}
            onClick={() => setPendingAction("discard")}
          >
            <TrashIcon />
            {t("viewer.discard")}
          </Button>
        ) : null}
        {worktree !== undefined &&
        worktree.capabilities.reopen &&
        (worktree.status === "merged" || worktree.status === "discarded") ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={busyAction !== null}
            onClick={() => setPendingAction("reopen")}
          >
            <RefreshIcon />
            {t("turn.reopen")}
          </Button>
        ) : null}
        {worktree !== undefined && worktree.capabilities.markReady ? (
          <Button
            size="sm"
            className={css.mergeAction}
            disabled={busyAction !== null}
            onClick={() => setPendingAction("ready")}
          >
            <SendIcon />
            {t("viewer.submitForReview")}
          </Button>
        ) : null}
        {worktree !== undefined && worktree.capabilities.merge && worktree.status === "ready" ? (
          <Button
            size="sm"
            className={css.mergeAction}
            disabled={busyAction !== null}
            onClick={() => setPendingAction("merge")}
          >
            <CheckIcon />
            {t("viewer.mergeToCurrent")}
          </Button>
        ) : null}
        {actionError === null ? null : (
          <span className={css.actionError} role="status">
            {actionError}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("dock.close")}
          title={t("dock.close")}
          onClick={props.onClose}
        >
          <CloseIcon />
        </Button>
      </div>
      {dialog === null ? null : (
        <ConfirmDialog
          open={pendingAction !== null}
          onOpenChange={(open) => {
            if (!open) setPendingAction(null);
          }}
          title={dialog.title}
          description={dialog.description}
          confirmText={dialog.confirmText}
          cancelText={t("viewer.cancel")}
          danger={dialog.danger}
          disabled={busyAction !== null}
          onConfirm={confirm}
        />
      )}
    </header>
  );
}
