/**
 * The floating viewer dock: owns deliberate live-window intent across Turns —
 * auto-opens on qualifying operations (open/new/worktree create/ready/writes),
 * keeps windows across Turns, closes on terminal worktree states or dismiss,
 * and honours manual open requests from the Turn-tail card. Ported from the
 * dsh-univer-office UniverDock.
 * @module dsh-univer-workspace-plugin/client/ViewerDock
 */

import * as React from "react";
import type { PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import {
  isViewerDocKey, opensFloatingWindow, outcomeOfTurnFile, turnFilesOfSession, type UniverTurnFile,
} from "./conversation/univer-turn-definition.ts";
import { useUniverStates } from "./hooks/use-univer-state.ts";
import type { ViewerRuntimeProps } from "./components/review-panel.tsx";
import { WorktreeWindow } from "./components/worktree-window.tsx";
import { loadViewerBootstrap, type ViewerBootstrap } from "./viewer-bootstrap.ts";
import { type ViewerLocaleInjected } from "./viewer-locale.ts";

export type { ViewerBootstrap };

export type ViewerDockProps = PropsRuntime<"conversation.input.dock">
  & PropsLocale<"univer">
  & ViewerLocaleInjected
  & ViewerRuntimeProps;

/** The window event the Turn-tail card dispatches for manual open requests. */
export const OPEN_VIEWER_EVENT = "uwh:open-viewer";

interface OpenWindow {
  readonly docKey: string
  readonly worktreeId: string | null
  readonly preferredUnitId: string | null
  readonly label: string | null
  readonly unitType: string | null
  readonly readOnly: boolean
}

/** Own deliberate live-window intent across Turns; clears on dismiss/terminal state. */
export function ViewerDock(props: ViewerDockProps): React.ReactElement {
  return <UniverSessionDock key={props.sessionId} {...props} />;
}

/** A keyed owner prevents open-window intent from crossing DSH session boundaries. */
function UniverSessionDock(props: ViewerDockProps): React.ReactElement {
  const cwd = props.useSessions((state) => state.byId[props.sessionId]?.cwd);
  const turnFiles = React.useMemo(() => turnFilesOfSession(props.session, cwd), [props.session, cwd]);
  const [open, setOpen] = React.useState<Record<string, OpenWindow>>({});
  const seen = React.useRef(new Set<string>());
  const running = props.session?.running === true;

  React.useEffect(() => {
    const additions: OpenWindow[] = [];
    for (const file of turnFiles) {
      // Legacy turn projections may contain only a unit/name key. The
      // file-state endpoint cannot resolve those keys, so do not create a
      // permanent Loading window for an identity that cannot be fetched.
      if (!isViewerDocKey(file.docKey)) continue;
      const outcome = outcomeOfTurnFile(file);
      for (const operation of file.operations) {
        if (!opensFloatingWindow(operation)) continue;
        if (seen.current.has(operation.callId)) continue;
        seen.current.add(operation.callId);
        additions.push({
          docKey: file.docKey,
          worktreeId: outcome.primaryWorktreeId,
          preferredUnitId: outcome.preferredUnitId,
          label: outcome.preferredLabel,
          unitType: outcome.preferredUnitType,
          readOnly: outcome.readOnly,
        });
      }
    }
    if (additions.length === 0) return;
    setOpen((previous) => {
      const next = { ...previous };
      for (const addition of additions) next[addition.docKey] = addition;
      return next;
    });
  }, [turnFiles]);

  React.useEffect(() => {
    const onOpen = (event: Event): void => {
      const detail = (event as CustomEvent<ManualOpen>).detail;
      if (detail === undefined || typeof detail.docKey !== "string") return;
      const docKey: string = detail.docKey;
      setOpen((previous) => ({ ...previous, [docKey]: { ...previous[docKey], ...detail, docKey } as OpenWindow }));
    };
    window.addEventListener(OPEN_VIEWER_EVENT, onOpen);
    return () => { window.removeEventListener(OPEN_VIEWER_EVENT, onOpen); };
  }, []);

  // Match dsh-univer-office: the floating dock is a live-session surface. It
  // may be restored while the session is running, but disappears when the
  // session reaches a terminal state; the turn-tail card remains in history.
  const watched = React.useMemo(() => running ? Object.values(open).map((target) => target.docKey) : [], [open, running]);
  const { states } = useUniverStates(watched, 1200);
  const byId = React.useMemo(() => {
    const map = new Map<string, { status: string }>();
    for (const state of Object.values(states)) {
      for (const worktree of state.worktrees) map.set(worktree.worktreeId, { status: worktree.status });
    }
    return map;
  }, [states]);
  void byId;

  // Terminal worktree states dismiss their window, mirroring office behaviour.
  React.useEffect(() => {
    setOpen((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const target of Object.values(previous)) {
        if (target.worktreeId === null) continue;
        const status = byId.get(target.worktreeId)?.status;
        if (status === "merged" || status === "discarded") {
          delete next[target.docKey];
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [byId]);

  if (!running) return <></>;
  const windows = Object.values(open);
  return <>{windows.length === 0 ? null : <div className="uvf_root">{windows.map((target, stackIndex) => {
    const state = states[target.docKey];
    return <WorktreeWindow
      key={target.docKey}
      docKey={target.docKey}
      label={target.label}
      unitType={target.unitType}
      state={state}
      worktreeId={target.worktreeId}
      preferredUnitId={target.preferredUnitId}
      preferredReadOnly={target.readOnly}
      stackIndex={stackIndex}
      t={props.t}
      loadViewerBootstrap={props.loadViewerBootstrap}
      getViewerLocale={props.getViewerLocale}
      onDismiss={() => setOpen((previous) => {
        const next = { ...previous };
        delete next[target.docKey];
        return next;
      })}
    />;
  })}</div>}</>;
}

interface ManualOpen {
  readonly docKey?: unknown;
  readonly worktreeId?: unknown;
  readonly preferredUnitId?: unknown;
  readonly label?: unknown;
  readonly unitType?: unknown;
  readonly readOnly?: unknown;
}
