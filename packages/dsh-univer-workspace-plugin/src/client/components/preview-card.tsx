/**
 * The Turn-context card list: one Worktree turn card per `wt:` projection and
 * one Resource turn card per independent trunk `res:` projection. Trunk
 * projections already carried by a Worktree operation are absorbed by that
 * Worktree card — a presentation-layer dedup that never rewrites the
 * underlying Turn projection.
 * @module dsh-univer-workspace-plugin/client/components/preview-card
 */

import * as React from "react";
import { useSessionFiles } from "../hooks/use-session-files.ts";
import type { PropsLocale } from "@deepseek-ai/dsh-client-ui-slots";
import {
  isViewerDocKey,
  changesReviewState,
  latestUnitTurns,
  mergeFiles,
  mergeSessionFiles,
  sessionWithRestoredTurns,
  outcomeOfTurnFile,
  unitIdentityOfTurnFile,
  type UniverTurnMatch,
} from "../conversation/univer-turn-definition.ts";
import { useUniverStates } from "../hooks/use-univer-state.ts";
import type { WorkspaceNavigationStore } from "../navigation/workspace-navigation.ts";
import type { ViewerRuntimeProps } from "./review-panel.tsx";
import { TurnContextCard } from "./TurnContextCard.tsx";
import { absorbWorktreeCoveredTrunkFiles } from "./turn-context-card-model.ts";

export type PreviewCardProps = PropsLocale<"univer"> &
  ViewerRuntimeProps & {
    readonly matched: UniverTurnMatch;
    readonly sessionId: string;
    readonly session: unknown;
    readonly navigation: WorkspaceNavigationStore;
  };

/** Render one Turn-context card per Worktree/trunk aggregate of this Turn. */
export function PreviewCard(props: PreviewCardProps): React.ReactElement {
  const recovered = useSessionFiles(props.sessionId);
  const session = React.useMemo(() => sessionWithRestoredTurns(props.session, recovered.turns), [props.session, recovered.turns]);
  const restored = recovered.turns.find((turn) => turn.turn === props.matched.turn)?.files;
  const turnFiles = React.useMemo(() => mergeSessionFiles(restored ?? [], props.matched.files), [restored, props.matched.files]);
  const files = React.useMemo(
    () =>
      absorbWorktreeCoveredTrunkFiles(
        mergeFiles(turnFiles).filter((entry) => isViewerDocKey(entry.docKey) && entry.operations.some(changesReviewState)),
      ),
    [turnFiles],
  );
  const stateKeys = React.useMemo(() => files.map((entry) => entry.docKey), [files]);
  const { states, missingFiles, errors } = useUniverStates(stateKeys);
  const latestTurns = React.useMemo(() => latestUnitTurns(session), [session]);
  // The first Worktree card of a Turn starts expanded, historical or not; if
  // it turns out missing and is hidden, no second card is expanded in compensation.
  const firstWorktreeIndex = files.findIndex((entry) => entry.docKey.startsWith("wt:"));

  return (
    <>
      {files.map((target, index) => {
        // Another tool may remove a document after its structured operations.
        // The host's current state is authoritative, so no historical shell renders.
        if (missingFiles.has(target.docKey)) return null;
        const outcome = outcomeOfTurnFile(target);
        const worktreeId = target.docKey.startsWith("wt:") ? target.docKey.slice(3) : null;
        const resourceId = target.docKey.startsWith("res:") ? target.docKey.slice(4) : null;
        const historical =
          latestTurns.get(unitIdentityOfTurnFile(target, session)) !== props.matched.turn;
        return (
          <TurnContextCard
            key={target.docKey}
            docKey={target.docKey}
            worktreeId={worktreeId}
            resourceId={resourceId}
            operations={target.operations}
            label={outcome.preferredLabel}
            unitType={outcome.preferredUnitType}
            preferredUnitId={outcome.preferredUnitId}
            state={states[target.docKey]}
            stateError={errors[target.docKey]}
            historical={historical}
            initiallyExpanded={worktreeId !== null && index === firstWorktreeIndex}
            navigation={props.navigation}
            t={props.t}
            loadViewerBootstrap={props.loadViewerBootstrap}
            getViewerLocale={props.getViewerLocale}
          />
        );
      })}
    </>
  );
}
