/**
 * The floating viewer dock: a session-scoped dock that renders one floating
 * Univer collaboration editor window per opened document. Windows support
 * header drag, edge resize, and maximize, following the dsh-univer-office
 * worktree-window interaction model; open intent comes from projected
 * `univer_open` results plus the Turn-tail card's manual open requests.
 * @module dsh-univer-workspace-plugin/client/ViewerDock
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import { CollaborationViewer } from "./collaboration-viewer.tsx";
import { sheetViewerDefinition } from "./viewer-sheet.ts";
import type { ViewerDefinition } from "./collaboration-viewer.tsx";
import type { ViewerOpenIntent } from "./viewer-turn-definition.ts";
import { OPEN_VIEWER_EVENT } from "./viewer-turn-card.tsx";
import type { ViewerLocaleInjected } from "./viewer-locale.ts";
import type { UwhLocaleKey } from "./locales.ts";

/** The injected business face supplied by the client apply closure. */
export interface ViewerDockInjected {
  readonly loadViewerBootstrap: () => Promise<ViewerBootstrap>;
}

export interface ViewerBootstrap {
  readonly user: { readonly id: string; readonly displayName: string; readonly avatarUrl: string | null };
  readonly license: string;
}

export type ViewerDockProps = PropsRuntime<"conversation.input.dock">
  & PropsLocale<"uwh">
  & ViewerLocaleInjected
  & ViewerDockInjected;

const DEFINITIONS: Record<ViewerOpenIntent["unitType"], ViewerDefinition | undefined> = {
  sheet: sheetViewerDefinition,
  // doc/slide/board/base definitions arrive with their preset packages.
  doc: undefined,
  slide: undefined,
  board: undefined,
  base: undefined,
};

const MIN_WIDTH = 360;
const MIN_HEIGHT = 260;
const GUTTER = 8;
const DEFAULT_WIDTH = 560;
const DEFAULT_HEIGHT = 420;

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const RESIZE_DIRECTIONS: readonly ResizeDirection[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

/** Read the viewer open intents projected for this session's completed Turns. */
function openIntentsOf(session: unknown): readonly ViewerOpenIntent[] {
  if (session === null || typeof session !== "object") return [];
  const snapshot = session as { chat?: { timeline?: { turns?: ReadonlyMap<number, { data: ReadonlyMap<string, unknown> }> } } };
  const turns = snapshot.chat?.timeline?.turns;
  if (turns === undefined) return [];
  const intents: ViewerOpenIntent[] = [];
  for (const turn of turns.values()) {
    const data = turn.data.get("univerViewer") as { intents?: readonly ViewerOpenIntent[] } | undefined;
    if (data === undefined || data.intents === undefined) continue;
    for (const intent of data.intents) {
      if (!intents.some((entry) => entry.unitId === intent.unitId)) intents.push(intent);
    }
  }
  return intents;
}

function viewportSize(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

function defaultRect(stackIndex: number): Rect {
  const { width, height } = viewportSize();
  const w = Math.min(DEFAULT_WIDTH, width - GUTTER * 2);
  const h = Math.min(DEFAULT_HEIGHT, height - GUTTER * 2);
  return {
    x: clamp(width - w - 24 - stackIndex * 28, GUTTER, Math.max(GUTTER, width - w - GUTTER)),
    y: clamp(height - h - 96 - stackIndex * 24, GUTTER, Math.max(GUTTER, height - h - GUTTER)),
    width: w,
    height: h,
  };
}

function moveRect(start: Rect, dx: number, dy: number): Rect {
  const { width, height } = viewportSize();
  return {
    ...start,
    x: clamp(start.x + dx, GUTTER - start.width + 80, Math.max(GUTTER, width - GUTTER - 80)),
    y: clamp(start.y + dy, GUTTER, Math.max(GUTTER, height - GUTTER - 48)),
  };
}

function resizeRect(start: Rect, direction: ResizeDirection, dx: number, dy: number): Rect {
  const { width, height } = viewportSize();
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (direction.includes("w")) left = clamp(start.x + dx, GUTTER, right - MIN_WIDTH);
  if (direction.includes("e")) right = clamp(right + dx, left + MIN_WIDTH, width - GUTTER);
  if (direction.includes("n")) top = clamp(start.y + dy, GUTTER, bottom - MIN_HEIGHT);
  if (direction.includes("s")) bottom = clamp(bottom + dy, top + MIN_HEIGHT, height - GUTTER);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The floating viewer dock. */
export function ViewerDock(props: ViewerDockProps) {
  // `session` arrives through the input-region owner share as a point-in-time
  // ConversationSnapshot; the skeleton re-renders dock entries on every store
  // change, so the intents derivation needs no separate subscription.
  const session = props.session;
  const projected = useMemo(() => openIntentsOf(session), [session]);
  const [manual, setManual] = useState<readonly ViewerOpenIntent[]>([]);
  const [dismissed, setDismissed] = useState<readonly string[]>([]);
  const [bootstrap, setBootstrap] = useState<ViewerBootstrap | null>(null);

  useEffect(() => {
    let live = true;
    void props.loadViewerBootstrap()
      .then((value) => {
        if (live) setBootstrap(value);
      })
      .catch((reason: unknown) => {
        console.error("univer-workspace viewer bootstrap failed", reason);
      });
    return () => { live = false; };
  }, [props.loadViewerBootstrap]);

  useEffect(() => {
    const onOpen = (event: Event): void => {
      const detail = (event as CustomEvent<ViewerOpenIntent>).detail;
      if (detail === undefined || typeof detail.unitId !== "string") return;
      setManual((previous) => previous.some((entry) => entry.unitId === detail.unitId) ? previous : [...previous, detail]);
      setDismissed((previous) => previous.filter((unitId) => unitId !== detail.unitId));
    };
    window.addEventListener(OPEN_VIEWER_EVENT, onOpen);
    return () => { window.removeEventListener(OPEN_VIEWER_EVENT, onOpen); };
  }, []);

  const visible = useMemo(() => {
    const merged: ViewerOpenIntent[] = [];
    for (const intent of [...projected, ...manual]) {
      if (dismissed.includes(intent.unitId)) continue;
      if (!merged.some((entry) => entry.unitId === intent.unitId)) merged.push(intent);
    }
    return merged;
  }, [projected, manual, dismissed]);

  if (bootstrap === null || visible.length === 0) return null;

  return (
    <div className="uws-viewer-dock">
      {visible.map((intent, index) => {
        const definition = DEFINITIONS[intent.unitType];
        if (definition === undefined) return null;
        return (
          <ViewerWindow
            key={intent.unitId}
            intent={intent}
            stackIndex={index}
            bootstrap={bootstrap}
            definition={definition}
            t={props.t}
            getViewerLocale={props.getViewerLocale}
            onDismiss={() => setDismissed((previous) => [...previous, intent.unitId])}
          />
        );
      })}
    </div>
  );
}

function ViewerWindow(props: {
  readonly intent: ViewerOpenIntent;
  readonly stackIndex: number;
  readonly bootstrap: ViewerBootstrap;
  readonly definition: ViewerDefinition;
  readonly t: (key: UwhLocaleKey) => string;
  readonly getViewerLocale: ViewerLocaleInjected["getViewerLocale"];
  readonly onDismiss: () => void;
}) {
  const { intent, t } = props;
  const [rect, setRect] = useState<Rect>(() => defaultRect(props.stackIndex));
  const [maximized, setMaximized] = useState(false);
  const [interaction, setInteraction] = useState<string | null>(null);
  const rectRef = useRef(rect);
  rectRef.current = rect;

  const beginPointerSession = (event: React.PointerEvent<HTMLElement>, kind: "move" | ResizeDirection): void => {
    if (event.button !== 0 || maximized) return;
    event.preventDefault();
    event.stopPropagation();
    const view = event.currentTarget.ownerDocument.defaultView;
    if (view === null) return;
    const pointerId = event.pointerId;
    const origin = { x: event.clientX, y: event.clientY };
    const start = rectRef.current;
    const element = event.currentTarget;
    setInteraction(kind);
    try { element.setPointerCapture(pointerId); } catch { /* Pointer capture is optional. */ }
    const move = (next: PointerEvent): void => {
      if (next.pointerId !== pointerId) return;
      const dx = next.clientX - origin.x;
      const dy = next.clientY - origin.y;
      setRect(kind === "move" ? moveRect(start, dx, dy) : resizeRect(start, kind, dx, dy));
    };
    const finish = (next: PointerEvent): void => {
      if (next.pointerId !== pointerId) return;
      view.removeEventListener("pointermove", move);
      view.removeEventListener("pointerup", finish);
      view.removeEventListener("pointercancel", finish);
      try { element.releasePointerCapture(pointerId); } catch { /* May already be released. */ }
      setInteraction(null);
    };
    view.addEventListener("pointermove", move);
    view.addEventListener("pointerup", finish);
    view.addEventListener("pointercancel", finish);
  };

  const onHeaderPointerDown = (event: React.PointerEvent<HTMLElement>): void => {
    if ((event.target as Element).closest("[data-window-control]") !== null) return;
    beginPointerSession(event, "move");
  };
  const onHeaderDoubleClick = (event: React.MouseEvent<HTMLElement>): void => {
    if ((event.target as Element).closest("[data-window-control]") === null) setMaximized((current) => !current);
  };

  const maximizedRect = (): Rect => {
    const { width, height } = viewportSize();
    return { x: GUTTER, y: GUTTER, width: width - GUTTER * 2, height: height - GUTTER * 2 };
  };
  const style: React.CSSProperties = maximized
    ? toStyle(maximizedRect())
    : toStyle(rect);

  return (
    <section
      className={`uws-viewer-window${maximized ? " uws-viewer-window-max" : ""}`}
      style={style}
      data-interaction={interaction ?? undefined}
      aria-label={intent.name}
    >
      <header className="uws-viewer-header" onPointerDown={onHeaderPointerDown} onDoubleClick={onHeaderDoubleClick}>
        <span className="uws-viewer-title">{intent.name}</span>
        <span className="uws-viewer-meta">{intent.unitType}{intent.readOnly ? ` · ${t("card.readonly")}` : ""}</span>
        <span className="uws-viewer-controls">
          <button
            type="button"
            className="uws-viewer-control"
            data-window-control=""
            aria-label={t(maximized ? "window.restore" : "window.maximize")}
            title={t(maximized ? "window.restore" : "window.maximize")}
            onClick={() => setMaximized((current) => !current)}
          >
            {maximized ? "❐" : "□"}
          </button>
          <button
            type="button"
            className="uws-viewer-control uws-viewer-controlDanger"
            data-window-control=""
            aria-label={t("window.close")}
            title={t("window.close")}
            onClick={props.onDismiss}
          >
            ×
          </button>
        </span>
      </header>
      <div className="uws-viewer-body">
        <CollaborationViewer
          unitId={intent.unitId}
          unitType={intent.unitType}
          readOnly={intent.readOnly}
          user={props.bootstrap.user}
          license={props.bootstrap.license}
          locale={props.getViewerLocale()}
          definition={props.definition}
        />
      </div>
      {!maximized ? RESIZE_DIRECTIONS.map((direction) => (
        <span
          key={direction}
          className={`uws-resizeHandle uws-resize_${direction}`}
          data-direction={direction}
          onPointerDown={(event) => beginPointerSession(event, direction)}
        />
      )) : null}
    </section>
  );
}

function toStyle(rect: Rect): React.CSSProperties {
  return { left: rect.x, top: rect.y, width: rect.width, height: rect.height };
}
