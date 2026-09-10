/**
 * Header of the middle Worktree review surface: title, status, description,
 * real metadata (creator, updatedAt, and resolved Space context)
 * plus lifecycle actions driven solely by server capabilities. Actions confirm
 * through the shared ConfirmDialog; the surface refetches after a transition.
 * @module dsh-univer-workspace-plugin/client/components/worktree-review/WorktreeReviewHeader
 */

import type { ReactElement } from "react";
import { Badge } from "@univerjs/univer-workspace-ui";
import type { DocumentWorktreeState } from "../../../shared/state.ts";
import type { UniverLocaleKey } from "../../locales.ts";
import { statusLabel, statusVariant } from "../turn-context-card-model.ts";
import { WorktreeBranchIcon } from "./WorktreeBranchIcon.tsx";
import { WorktreeMetadata } from "./WorktreeMetadata.tsx";
import { WorktreeActions } from "./WorktreeActions.tsx";
import css from "./WorktreeReviewHeader.module.scss";

export interface WorktreeReviewHeaderProps {
  readonly worktree: DocumentWorktreeState | undefined;
  readonly spaceNames: readonly string[];
  readonly fallbackName: string;
  readonly t: (key: UniverLocaleKey) => string;
  readonly onActionSettled: () => void;
}

export function WorktreeReviewHeader(props: WorktreeReviewHeaderProps): ReactElement {
  const { worktree, t } = props;
  return (
    <header className={css.header}>
      <div className={css.identity}>
        <span className={css.glyph} aria-hidden="true">
          <WorktreeBranchIcon status={worktree?.status ?? "draft"} />
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

        </div>
      </div>
      {worktree ? <WorktreeActions worktree={worktree} t={t} onActionSettled={props.onActionSettled} /> : null}
      {worktree ? <div className={css.metadata}><WorktreeMetadata worktree={worktree} spaceNames={props.spaceNames}
        emptyDescription={t("worktree.noDescription")} /></div> : null}
    </header>
  );
}
