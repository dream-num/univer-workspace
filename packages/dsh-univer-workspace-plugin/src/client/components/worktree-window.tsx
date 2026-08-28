/**
 * Live floating viewer window for one active worktree — ported from the
 * dsh-univer-office WorktreeWindow with the iframe replaced by the
 * in-process collaboration editor.
 * @module dsh-univer-workspace-plugin/client/components/worktree-window
 */

import * as React from "react";
import type { DocumentFileState } from "../../shared/state.ts";
import type { WorktreeStatus } from "../../shared/state.ts";
import type { UniverLocaleKey } from "../locales.ts";
import type { ViewerRuntimeProps, ViewerTarget } from "./review-panel.tsx";
import { PanelViewer } from "./review-panel.tsx";
import type { ViewerScope, ViewerUnitType } from "../viewer-engine.ts";
import { UnitChips } from "./unit-chips.tsx";
import { useExclusiveViewer } from "./use-exclusive-viewer.ts";

interface ViewportSize { readonly width: number; readonly height: number }
interface WindowRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
type ResizeDirection = typeof RESIZE_DIRECTIONS[number]
type Interaction = "move" | ResizeDirection

const RESIZE_DIRECTIONS = ["nw", "n", "ne", "w", "e", "sw", "s", "se"] as const
const VIEWPORT_GUTTER = 12
const DEFAULT_WIDTH = 560
const DEFAULT_HEIGHT = 420
const MIN_WIDTH = 360
const MIN_HEIGHT = 260
const CASCADE_OFFSET = 24

export interface WorktreeWindowProps extends ViewerRuntimeProps {
  readonly docKey: string
  readonly label: string | null
  readonly unitType: string | null
  readonly state: DocumentFileState | undefined
  readonly worktreeId: string | null
  readonly preferredUnitId: string | null
  readonly preferredReadOnly: boolean
  readonly stackIndex: number
  readonly t: (key: UniverLocaleKey) => string
  readonly onDismiss: () => void
}

/** Live floating viewer window for one active worktree. */
export function WorktreeWindow(props: WorktreeWindowProps): React.ReactElement {
  const [folded, setFolded] = React.useState(false)
  const [maximized, setMaximized] = React.useState(false)
  const [interaction, setInteraction] = React.useState<Interaction | null>(null)
  const [rect, setRect] = React.useState<WindowRect>(() => initialRect(props.stackIndex, viewportSize()))
  const [selected, setSelected] = React.useState<string | undefined>(props.preferredUnitId ?? undefined)
  const rectRef = React.useRef(rect)
  const cancelPointerSessionRef = React.useRef<() => void>(() => undefined)

  React.useLayoutEffect(() => {
    rectRef.current = rect
  }, [rect])

  React.useEffect(() => {
    if (props.preferredUnitId !== null) setSelected(props.preferredUnitId)
  }, [props.preferredUnitId])

  React.useEffect(() => {
    const onViewportResize = (): void => setRect((current) => fitRect(current, viewportSize()))
    window.addEventListener("resize", onViewportResize)
    return () => window.removeEventListener("resize", onViewportResize)
  }, [])

  React.useEffect(() => () => cancelPointerSessionRef.current(), [])

  const worktree = props.worktreeId === null ? undefined : props.state?.worktrees.find((entry) => entry.worktreeId === props.worktreeId)
  const status: WorktreeStateViewAliases | "trunk" | "loading" = props.state === undefined
    ? "loading"
    : props.worktreeId === null
      ? "trunk"
      : worktree?.status ?? "unavailable"
  const units = worktree?.units ?? []
  const selectedUnit = selected !== undefined && units.some((unit) => unit.unitId === selected) ? selected : units[0]?.unitId
  const viewer = viewerTarget({ status, units, selectedUnit, state: props.state, worktree: worktree ?? undefined, fallbackUnitId: props.preferredUnitId, fallbackUnitType: props.unitType, worktreeId: props.worktreeId })
  const title = worktree?.name || props.t("dock.currentVersion")
  const documentTitle = props.label ?? props.t("card.title")

  useExclusiveViewer(viewer?.unitId, !folded, () => {
    setFolded(true)
    setMaximized(false)
  })

  const beginPointerSession = (event: React.PointerEvent<HTMLElement>, kind: Interaction): void => {
    if (event.button !== 0 || maximized) return
    event.preventDefault()
    event.stopPropagation()
    cancelPointerSessionRef.current()
    const view = event.currentTarget.ownerDocument.defaultView
    if (view === null) return
    const pointerId = event.pointerId
    const origin = { x: event.clientX, y: event.clientY }
    const start = rectRef.current
    const element = event.currentTarget
    setInteraction(kind)
    try { element.setPointerCapture(pointerId) } catch { /* Pointer capture is optional. */ }

    const move = (next: PointerEvent): void => {
      if (next.pointerId !== pointerId) return
      const dx = next.clientX - origin.x
      const dy = next.clientY - origin.y
      setRect(kind === "move"
        ? moveRect(start, dx, dy, viewportSize())
        : resizeRect(start, kind, dx, dy, viewportSize()))
    }
    const cleanup = (): void => {
      view.removeEventListener("pointermove", move)
      view.removeEventListener("pointerup", finish)
      view.removeEventListener("pointercancel", finish)
      cancelPointerSessionRef.current = () => undefined
      try { element.releasePointerCapture(pointerId) } catch { /* May already be released. */ }
    }
    const finish = (next: PointerEvent): void => {
      if (next.pointerId !== pointerId) return
      cleanup()
      setInteraction(null)
    }
    cancelPointerSessionRef.current = cleanup
    view.addEventListener("pointermove", move)
    view.addEventListener("pointerup", finish)
    view.addEventListener("pointercancel", finish)
  }

  const toggleMaximized = (): void => {
    setFolded(false)
    setMaximized((current) => !current)
  }
  const onHeaderPointerDown = (event: React.PointerEvent<HTMLElement>): void => {
    if ((event.target as Element).closest("[data-window-control]") !== null) return
    beginPointerSession(event, "move")
  }
  const onHeaderDoubleClick = (event: React.MouseEvent<HTMLElement>): void => {
    if ((event.target as Element).closest("[data-window-control]") === null) toggleMaximized()
  }

  const className = [
    "uvf_win",
    folded ? "uvf_win_folded" : "",
    maximized ? "uvf_win_max" : "",
  ].filter(Boolean).join(" ")
  const style: React.CSSProperties = {
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
  }

  return <section className={className} style={style} data-interaction={interaction ?? undefined} aria-label={documentTitle}>
    <header className="uvf_windowHeader" onPointerDown={onHeaderPointerDown} onDoubleClick={onHeaderDoubleClick}>
      <span className="uvf_windowGlyph" aria-hidden="true"><GridIcon /></span>
      <span className="uvf_windowIdentity">
        <span className="uvf_windowTitle">{title}</span>
        <span className="uvf_windowFile">{documentTitle}</span>
      </span>
      <span className="uvf_chip" data-status={status}>
        <span className="uvf_pulse" aria-hidden="true" />
        {status === "loading" ? props.t("dock.loading")
          : status === "trunk" ? props.t("dock.currentVersion")
          : status === "draft" ? props.t("dock.draft")
          : status === "ready" ? props.t("dock.ready")
          : status === "merging" ? props.t("dock.merging")
          : status === "merged" ? props.t("dock.merged")
          : status === "discarded" ? props.t("dock.discarded")
          : props.t("dock.unavailable")}
      </span>
      <span className="uvf_windowControls">
        <WindowControl action="fold" label={props.t(folded ? "dock.expand" : "dock.fold")} onClick={() => { setMaximized(false); setFolded((current) => !current) }}>
          <FoldIcon expanded={folded} />
        </WindowControl>
        <WindowControl action="maximize" label={props.t(maximized ? "dock.restore" : "dock.maximize")} onClick={toggleMaximized}>
          <MaximizeIcon restored={maximized} />
        </WindowControl>
        <WindowControl action="close" label={props.t("dock.close")} onClick={props.onDismiss} danger>
          <CloseIcon />
        </WindowControl>
      </span>
    </header>
    {!folded ? <div className="uvf_windowBody">
      <UnitChips units={units} selected={selectedUnit} t={props.t} onSelect={setSelected} />
      <div className="uvf_viewerShell">
        {viewer === undefined
          ? <div className="uvf_note"><span>{status === "loading" ? props.t("dock.loading") : props.t("dock.unavailable")}</span></div>
          : <PanelViewer key={viewerKey(viewer)} viewer={viewer} runtime={props} worktreeId={props.worktreeId} status={status} worktreeName={title} />}
      </div>
    </div> : null}
    {!folded && !maximized ? RESIZE_DIRECTIONS.map((direction) => <span
      key={direction}
      className={`uvf_resizeHandle uvf_resize_${direction}`}
      data-direction={direction}
      onPointerDown={(event) => beginPointerSession(event, direction)}
    />) : null}
  </section>
}

type WorktreeStateViewAliases = WorktreeStatus | "unavailable"
type ReviewWorktree = DocumentFileState["worktrees"][number]

function viewerKey(viewer: ViewerTarget): string {
  return viewer.scope.kind === "trunk"
    ? `${viewer.unitId}:trunk`
    : `${viewer.unitId}:${viewer.scope.kind}:${viewer.scope.worktreeId}`
}

/** office cardTarget equivalent: draft → worktree (editable), ready → merge preview, else trunk. */
function viewerTarget(input: {
  readonly status: WorktreeStateViewAliases | "trunk" | "loading"
  readonly units: readonly { unitId: string; unitType: string }[]
  readonly selectedUnit: string | undefined
  readonly state: DocumentFileState | undefined
  readonly worktree: ReviewWorktree | undefined
  readonly fallbackUnitId: string | null
  readonly fallbackUnitType: string | null
  readonly worktreeId: string | null
}): ViewerTarget | undefined {
  const unitTypeOf = (unitId: string, hint: string | null): ViewerUnitType | "unsupported" => {
    const fromUnit = input.units.find((unit) => unit.unitId === unitId)?.unitType
    // Never infer Sheet when the remote Worktree descriptor omitted a type.
    // Mounting a different Unit is worse than an explicit unsupported state.
    const raw = fromUnit ?? hint
    if (raw === undefined || raw === "") return "unsupported"
    return raw === "sheet" || raw === "doc" || raw === "slide" || raw === "board" || raw === "base" ? raw : "unsupported"
  }
  if (input.status === "loading" || input.status === "unavailable" || input.state === undefined) return undefined
  if (input.worktreeId === null || input.status === "merged" || input.status === "discarded") {
    const target = input.state.viewerTarget
    if (target === null) return undefined
    return {
      unitId: input.selectedUnit ?? input.fallbackUnitId ?? target.unitId,
      unitType: unitTypeOf(input.selectedUnit ?? input.fallbackUnitId ?? target.unitId, target.unitType),
      editable: !target.readOnly,
      scope: { kind: "trunk" },
    }
  }
  const worktree = input.worktree
  if (worktree === undefined) return undefined
  const unitId = input.selectedUnit ?? input.fallbackUnitId ?? input.units[0]?.unitId
  if (unitId === undefined) return undefined
  if (input.status === "draft") {
    if (worktree.worktreeTarget === null) return undefined
    const unitType = unitTypeOf(unitId, worktree.worktreeTarget.unitType)
    return {
      unitId,
      unitType,
      editable: true,
      scope: { kind: "worktree", worktreeId: input.worktreeId } satisfies ViewerScope,
    }
  }
  // The Workspace API only exposes a stable merge preview for ready
  // Worktrees.  Keep a merging Worktree unavailable instead of opening its
  // mutable draft snapshot.
  if (input.status !== "ready" || worktree.mergeTarget === null) return undefined
  const unitType = unitTypeOf(unitId, worktree.mergeTarget.unitType)
  return {
    unitId,
    unitType,
    editable: false,
    scope: { kind: "mergePreview", worktreeId: input.worktreeId } satisfies ViewerScope,
  }
}

function WindowControl(props: { readonly action: string; readonly label: string; readonly danger?: boolean; readonly onClick: () => void; readonly children: React.ReactNode }): React.ReactElement {
  return <button
    type="button"
    className={`uvf_windowControl${props.danger === true ? " uvf_windowControl_danger" : ""}`}
    data-window-control=""
    data-window-action={props.action}
    title={props.label}
    aria-label={props.label}
    onClick={props.onClick}
  >{props.children}</button>
}

function GridIcon(): React.ReactElement {
  return <svg viewBox="0 0 18 18" aria-hidden="true"><rect x="3" y="3" width="12" height="12" rx="2" /><path d="M3 7h12M7 3v12" /></svg>
}

function FoldIcon(props: { readonly expanded: boolean }): React.ReactElement {
  return <svg viewBox="0 0 16 16" aria-hidden="true">{props.expanded
    ? <path d="m4 10 4-4 4 4" />
    : <path d="M4 9h8" />}</svg>
}

function MaximizeIcon(props: { readonly restored: boolean }): React.ReactElement {
  return <svg viewBox="0 0 16 16" aria-hidden="true">{props.restored
    ? <><rect x="3" y="5" width="8" height="8" rx="1" /><path d="M5 5V3h8v8h-2" /></>
    : <rect x="3" y="3" width="10" height="10" rx="1.5" />}</svg>
}

function CloseIcon(): React.ReactElement {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg>
}

function viewportSize(): ViewportSize {
  return {
    width: Math.max(1, window.innerWidth),
    height: Math.max(1, window.innerHeight),
  }
}

function initialRect(stackIndex: number, viewport: ViewportSize): WindowRect {
  const availableWidth = Math.max(1, viewport.width - VIEWPORT_GUTTER * 2)
  const availableHeight = Math.max(1, viewport.height - VIEWPORT_GUTTER * 2)
  const width = Math.min(DEFAULT_WIDTH, availableWidth)
  const height = Math.min(DEFAULT_HEIGHT, availableHeight)
  return fitRect({
    x: viewport.width - VIEWPORT_GUTTER - width - stackIndex * CASCADE_OFFSET,
    y: VIEWPORT_GUTTER + stackIndex * CASCADE_OFFSET,
    width,
    height,
  }, viewport)
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high))
}

function fitRect(rect: WindowRect, viewport: ViewportSize): WindowRect {
  const availableWidth = Math.max(1, viewport.width - VIEWPORT_GUTTER * 2)
  const availableHeight = Math.max(1, viewport.height - VIEWPORT_GUTTER * 2)
  const width = clamp(rect.width, Math.min(MIN_WIDTH, availableWidth), availableWidth)
  const height = clamp(rect.height, Math.min(MIN_HEIGHT, availableHeight), availableHeight)
  return {
    x: clamp(rect.x, VIEWPORT_GUTTER, Math.max(VIEWPORT_GUTTER, viewport.width - VIEWPORT_GUTTER - width)),
    y: clamp(rect.y, VIEWPORT_GUTTER, Math.max(VIEWPORT_GUTTER, viewport.height - VIEWPORT_GUTTER - height)),
    width,
    height,
  }
}

function moveRect(start: WindowRect, dx: number, dy: number, viewport: ViewportSize): WindowRect {
  return fitRect({ ...start, x: start.x + dx, y: start.y + dy }, viewport)
}

function resizeRect(start: WindowRect, direction: ResizeDirection, dx: number, dy: number, viewport: ViewportSize): WindowRect {
  const fitted = fitRect(start, viewport)
  const minWidth = Math.min(MIN_WIDTH, Math.max(1, viewport.width - VIEWPORT_GUTTER * 2))
  const minHeight = Math.min(MIN_HEIGHT, Math.max(1, viewport.height - VIEWPORT_GUTTER * 2))
  let left = fitted.x
  let top = fitted.y
  let right = fitted.x + fitted.width
  let bottom = fitted.y + fitted.height
  if (direction.includes("w")) left = clamp(fitted.x + dx, VIEWPORT_GUTTER, right - minWidth)
  if (direction.includes("e")) right = clamp(right + dx, left + minWidth, viewport.width - VIEWPORT_GUTTER)
  if (direction.includes("n")) top = clamp(fitted.y + dy, VIEWPORT_GUTTER, bottom - minHeight)
  if (direction.includes("s")) bottom = clamp(bottom + dy, top + minHeight, viewport.height - VIEWPORT_GUTTER)
  return { x: left, y: top, width: right - left, height: bottom - top }
}
