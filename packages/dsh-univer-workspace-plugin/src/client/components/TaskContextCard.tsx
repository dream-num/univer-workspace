/** A session's compact Worktree list; previews live exclusively in Sidecar. */
import * as React from "react";
import { createPortal } from "react-dom";
import { Badge, Button, CloseIcon, ExternalLinkIcon } from "@univerjs/univer-workspace-ui";
import type { DocumentFileState } from "../../shared/state.ts";
import type { WorkspaceNavigationStore } from "../navigation/workspace-navigation.ts";
import type { ViewerRuntimeProps } from "./review-panel.tsx";
import type { SessionCardCandidates, SessionTaskFocusIntent } from "./session-task-card-model.ts";
import { statusLabel, statusVariant } from "./turn-context-card-model.ts";
import { clampTaskPosition, countWorktreeChanges } from "./task-list-model.ts";
import css from "./TaskContextCard.module.scss";

export interface TaskContextCardProps extends ViewerRuntimeProps {
  readonly sessionId?: string;
  readonly candidates: SessionCardCandidates;
  readonly states: Readonly<Record<string, DocumentFileState>>;
  readonly errors: Readonly<Record<string, string>>;
  readonly focusIntent: SessionTaskFocusIntent | null;
  readonly navigation: WorkspaceNavigationStore;
  readonly onDismiss: () => void;
}

export function TaskContextCard(props: TaskContextCardProps): React.ReactElement {
  const card = React.useRef<HTMLElement>(null);
  const [position, setPosition] = React.useState(() => ({ x: window.innerWidth - 356, y: window.innerHeight - 300 }));
  const [dragging, setDragging] = React.useState(false);
  const drag = React.useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const constrain = React.useCallback((point: { x: number; y: number }) => {
    const bounds = card.current?.getBoundingClientRect();
    return clampTaskPosition(point, { width: bounds?.width ?? 340, height: bounds?.height ?? 200 },
      { width: window.innerWidth, height: window.innerHeight });
  }, []);
  React.useEffect(() => {
    const resize = () => setPosition(value => constrain(value));
    resize();
    const observer = new ResizeObserver(resize);
    if (card.current) observer.observe(card.current);
    window.addEventListener("resize", resize);
    return () => { observer.disconnect(); window.removeEventListener("resize", resize); };
  }, [constrain]);
  const endDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const t = props.t;
  const fallback = props.candidates.fallback;
  // Portal to the document so Conversation transforms and clipping cannot
  // redefine the fixed-position window's containing block or drag range.
  return createPortal(<section ref={card} className={css.card} data-task-context-card
    data-dragging={dragging || undefined} style={{ left: position.x, top: position.y }} aria-label={t("task.listTitle")}>
    <header className={css.header} tabIndex={0} aria-label={t("task.drag")}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        const delta = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] }[event.key];
        if (!delta) return;
        event.preventDefault();
        setPosition(value => constrain({ x: value.x + delta[0]!, y: value.y + delta[1]! }));
      }}
      onPointerDown={event => {
        if (event.button !== 0 || (event.target as Element).closest("button")) return;
        const bounds = card.current!.getBoundingClientRect();
        drag.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top, pointerId: event.pointerId };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        event.preventDefault();
      }}
      onPointerMove={event => {
        const origin = drag.current;
        if (origin?.pointerId !== event.pointerId) return;
        setPosition(constrain({ x: event.clientX - origin.x, y: event.clientY - origin.y }));
      }}
      onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={() => { drag.current = null; setDragging(false); }}>
      <strong>{t("task.listTitle")}</strong>
      <Button variant="ghost" size="icon-sm" aria-label={t("dock.close")} onClick={props.onDismiss}><CloseIcon /></Button>
    </header>
    <ul className={css.list}>
      {props.candidates.worktrees.map(candidate => {
        const state = props.states[candidate.docKey];
        const worktree = state?.worktrees.find(item => item.worktreeId === candidate.worktreeId);
        const counts = worktree ? countWorktreeChanges(worktree.units) : undefined;
        const title = worktree?.name ?? candidate.label ?? t("card.title");
        const status = worktree?.status ?? (props.errors[candidate.docKey] ? "unavailable" : "loading");
        return <li key={candidate.worktreeId} data-worktree-id={candidate.worktreeId}>
          <button className={css.row} disabled={!state || !worktree?.capabilities.review}
            data-focused={props.focusIntent?.worktreeId === candidate.worktreeId || undefined}
            onClick={() => {
              if (!state || !worktree) return;
              props.navigation.dispatch({ type: "open-content", contentSurface: {
                kind: "worktree", workspaceOrigin: state.workspaceOrigin, worktreeId: worktree.worktreeId,
                name: worktree.name, unitId: null,
                ...(props.sessionId ? { sessionId: props.sessionId } : {}),
              } });
            }}>
            <span className={css.identity}><span className={css.title}>{title}</span>
              <Badge variant={statusVariant(status)}>{statusLabel(status, t)}</Badge></span>
            {counts ? <span className={css.counts}>
              <span>{t("turn.unit.added")} {counts.added}</span>
              <span>{t("turn.unit.modified")} {counts.modified}</span>
              <span>{t("turn.unit.deleted")} {counts.deleted}</span>
            </span> : <span className={css.counts}>{props.errors[candidate.docKey] ?? t("dock.loading")}</span>}
          </button>
        </li>;
      })}
      {fallback ? <li><button className={css.row} disabled={!props.states[fallback.docKey]} onClick={() => {
        const state = props.states[fallback.docKey];
        if (!state) return;
        props.navigation.dispatch({ type: "open-content", contentSurface: {
          kind: "resource", workspaceOrigin: state.workspaceOrigin, resourceId: fallback.resourceId,
          docKey: `res:${fallback.resourceId}`, name: fallback.label ?? t("card.title"), unitType: fallback.unitType,
        } });
      }}><span className={css.identity}><span className={css.title}>{fallback.label ?? t("card.title")}</span><ExternalLinkIcon /></span></button></li> : null}
    </ul>
  </section>, document.body);
}
