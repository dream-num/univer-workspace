/**
 * The Turn-tail card: one review panel per Univer document this Turn touched,
 * ported from the dsh-univer-office PreviewCard/ReviewPanel pairing.
 * @module dsh-univer-workspace-plugin/client/components/preview-card
 */

import * as React from "react";
import type { PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import { isViewerDocKey, mergeFiles, outcomeOfTurnFile, latestUnitTurns, unitIdentityOfTurnFile, type UniverTurnFile, type UniverTurnMatch } from "../conversation/univer-turn-definition.ts";
import { useUniverStates } from "../hooks/use-univer-state.ts";
import { ReviewPanel, type ViewerRuntimeProps } from "./review-panel.tsx";

export type PreviewCardProps = PropsRuntime<"conversation.chat.turnTail">
  & PropsLocale<"univer">
  & ViewerRuntimeProps
  & { readonly matched: UniverTurnMatch };

/** Render one review panel for every document touched during the owning Turn. */
export function PreviewCard(props: PreviewCardProps): React.ReactElement {
  const session = props.useSession((snapshot) => snapshot);
  const files = React.useMemo(
    () => mergeFiles(props.matched.files).filter((entry) => isViewerDocKey(entry.docKey)),
    [props.matched.files],
  );
  const stateKeys = React.useMemo(() => files.map((entry) => entry.docKey), [files]);
  const { states, missingFiles } = useUniverStates(stateKeys);
  const latestTurns = React.useMemo(() => latestUnitTurns(session), [session]);

  return <>{files.map((target) => {
    // Another tool may remove a document after its structured operations.
    // The host's current state is authoritative, so no historical shell renders.
    if (missingFiles.has(target.docKey)) return null;
    const outcome = outcomeOfTurnFile(target);
    const resourceId = target.docKey.startsWith("res:") ? target.docKey.slice(4) : null;
    const state = states[target.docKey];
    const worktreeId = outcome.primaryWorktreeId ?? pendingWorktree(target);
    const historical = latestTurns.get(unitIdentityOfTurnFile(target, session)) !== props.matched.turn;
    return <ReviewPanel
      key={target.docKey}
      docKey={target.docKey}
      label={outcome.preferredLabel}
      unitType={outcome.preferredUnitType}
      state={state}
      worktreeId={worktreeId}
      preferredUnitId={outcome.preferredUnitId}
      preferredReadOnly={outcome.readOnly}
      historical={historical}
      t={props.t}
      loadViewerBootstrap={props.loadViewerBootstrap}
      getViewerLocale={props.getViewerLocale}
    />;
  })}</>;
}

function pendingWorktree(target: UniverTurnFile): string | null {
  for (let index = target.operations.length - 1; index >= 0; index -= 1) {
    const operation = target.operations[index];
    if (operation !== undefined && operation.worktreeId !== null) return operation.worktreeId;
  }
  return null;
}
