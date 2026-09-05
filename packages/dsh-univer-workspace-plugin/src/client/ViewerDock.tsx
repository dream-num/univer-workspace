/**
 * The session-task dock: owns Conversation-level task-card visibility and
 * focus intent across Turns. It derives the candidate set from the public
 * Conversation snapshot, renders exactly one TaskContextCard per Conversation,
 * and honours manual open requests from the Turn-tail card. All selection
 * state (pinned Worktree, Unit, expansion) belongs to the card; dismissing
 * unmounts it while the Dock keeps its seen operations and candidates.
 * @module dsh-univer-workspace-plugin/client/ViewerDock
 */

import * as React from "react";
import type { ConversationSnapshot } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import {
  isViewerDocKey,
  opensFloatingWindow,
  turnFilesOfConversation,
} from "./conversation/univer-turn-definition.ts";
import { useUniverStates } from "./hooks/use-univer-state.ts";
import type { ViewerRuntimeProps } from "./components/review-panel.tsx";
import { TaskContextCard } from "./components/TaskContextCard.tsx";
import {
  sessionCardCandidates,
  type SessionTaskFocusIntent,
} from "./components/session-task-card-model.ts";
import taskCardCss from "./components/TaskContextCard.module.scss";
import type { ViewerBootstrap } from "./viewer-bootstrap.ts";
import { type ViewerLocaleInjected } from "./viewer-locale.ts";
import type { WorkspaceNavigationStore } from "./navigation/workspace-navigation.ts";

export type { ViewerBootstrap };

export type ViewerDockProps = PropsRuntime<"conversation.input.dock"> &
  PropsLocale<"univer"> &
  ViewerLocaleInjected &
  ViewerRuntimeProps & {
    readonly navigation: WorkspaceNavigationStore;
  };

/** The window event the Turn-tail card dispatches for manual open requests. */
export const OPEN_VIEWER_EVENT = "uwh:open-viewer";

/** Own task-card visibility across Turns; the card resurfaces on new intent. */
export function ViewerDock(props: ViewerDockProps): React.ReactElement {
  return <UniverSessionDock key={props.sessionId} {...props} />;
}

/** A keyed owner prevents task-card intent from crossing DSH session boundaries. */
function UniverSessionDock(props: ViewerDockProps): React.ReactElement {
  const conversation = props.useConversation((snapshot: ConversationSnapshot) => snapshot);
  const turnFiles = React.useMemo(() => turnFilesOfConversation(conversation), [conversation]);
  const candidates = React.useMemo(() => sessionCardCandidates(turnFiles), [turnFiles]);
  const [visible, setVisible] = React.useState(false);
  const [focusIntent, setFocusIntent] = React.useState<SessionTaskFocusIntent | null>(null);
  const seen = React.useRef(new Set<string>());
  const nonce = React.useRef(0);

  React.useEffect(() => {
    let focus: {
      docKey: string;
      worktreeId: string | null;
      preferredUnitId: string | null;
    } | null = null;
    for (const file of turnFiles) {
      for (const operation of file.operations) {
        if (!opensFloatingWindow(operation)) continue;
        if (seen.current.has(operation.callId)) continue;
        seen.current.add(operation.callId);
        // Only a resolvable wt:/res: target wakes the card; a qualifying
        // operation without either identity is marked seen so it is never
        // reprocessed, but it cannot focus or reveal anything.
        const target = normalizeOperationTarget(
          operation.worktreeId,
          operation.resourceId,
          file.docKey,
        );
        if (target === null) continue;
        focus = { ...target, preferredUnitId: operation.unitId };
      }
    }
    if (focus === null) return;
    const target = focus;
    setVisible(true);
    setFocusIntent({
      nonce: ++nonce.current,
      source: "operation",
      docKey: target.docKey,
      worktreeId: target.worktreeId,
      preferredUnitId: target.preferredUnitId,
    });
  }, [turnFiles]);

  React.useEffect(() => {
    const onOpen = (event: Event): void => {
      const detail = (event as CustomEvent<ManualOpen>).detail;
      if (detail === undefined || typeof detail.docKey !== "string") return;
      // Workspace file-tab opens are owned by the global file workspace
      // surface, not the session-scoped floating dock.
      if (detail.source === "workspace-file") return;
      const docKey: string = detail.docKey;
      if (!isViewerDocKey(docKey)) return;
      const worktreeId =
        typeof detail.worktreeId === "string"
          ? detail.worktreeId
          : docKey.startsWith("wt:")
            ? docKey.slice(3)
            : null;
      const preferredUnitId =
        typeof detail.preferredUnitId === "string" ? detail.preferredUnitId : null;
      setVisible(true);
      setFocusIntent({
        nonce: ++nonce.current,
        source: "manual",
        docKey,
        worktreeId,
        preferredUnitId,
      });
    };
    window.addEventListener(OPEN_VIEWER_EVENT, onOpen);
    return () => {
      window.removeEventListener(OPEN_VIEWER_EVENT, onOpen);
    };
  }, []);

  const watched = React.useMemo(() => {
    const keys = new Set<string>();
    for (const candidate of candidates.worktrees) keys.add(candidate.docKey);
    if (candidates.fallback !== null) keys.add(candidates.fallback.docKey);
    return [...keys];
  }, [candidates]);
  const { states, errors } = useUniverStates(watched);

  const empty = candidates.worktrees.length === 0 && candidates.fallback === null;
  if (empty || !visible) return <></>;
  return (
    <div className={taskCardCss.stack}>
      <TaskContextCard
        sessionId={props.sessionId}
        candidates={candidates}
        states={states}
        errors={errors}
        focusIntent={focusIntent}
        navigation={props.navigation}
        t={props.t}
        loadViewerBootstrap={props.loadViewerBootstrap}
        getViewerLocale={props.getViewerLocale}
        onDismiss={() => setVisible(false)}
      />
    </div>
  );
}

/** Normalize a qualifying operation to its canonical wt:/res: target. */
function normalizeOperationTarget(
  worktreeId: string | null,
  resourceId: string | null,
  fileDocKey: string,
): { docKey: string; worktreeId: string | null } | null {
  if (worktreeId !== null) return { docKey: `wt:${worktreeId}`, worktreeId };
  const resolvedResourceId =
    resourceId ?? (fileDocKey.startsWith("res:") ? fileDocKey.slice(4) : null);
  if (resolvedResourceId === null) return null;
  return { docKey: `res:${resolvedResourceId}`, worktreeId: null };
}

interface ManualOpen {
  readonly source?: unknown;
  readonly docKey?: unknown;
  readonly worktreeId?: unknown;
  readonly preferredUnitId?: unknown;
}
