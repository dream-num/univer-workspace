/**
 * The unified Turn-tail review panel for trunk, worktree, loading, terminal,
 * and historical views — ported from the dsh-univer-office ReviewPanel with
 * the iframe viewer replaced by the in-process collaboration editor.
 * @module dsh-univer-workspace-plugin/client/components/review-panel
 */

import * as React from "react";
import { createPortal } from "react-dom";
import type { DocumentFileState } from "../../shared/state.ts";
import type { WorktreeAction, WorktreeStatus } from "../../shared/state.ts";
import type { UniverLocaleKey } from "../locales.ts";
import type { ViewerBootstrap } from "../viewer-bootstrap.ts";
import { ViewerMount } from "./viewer-mount.tsx";
import type { ViewerLocale } from "../viewer-locale.ts";
import type { ViewerScope, ViewerUnitType } from "../viewer-engine.ts";
import { postWorktreeAction } from "../api/univer-api.ts";
import { UnitChips } from "./unit-chips.tsx";
import { useExclusiveViewer } from "./use-exclusive-viewer.ts";

type CardStatus = WorktreeStatus | "trunk" | "loading" | "unavailable";
type ReviewWorktree = DocumentFileState["worktrees"][number];

/** Injected viewer runtime shared by every review surface. */
export interface ViewerRuntimeProps {
  readonly loadViewerBootstrap: () => Promise<ViewerBootstrap>;
  readonly getViewerLocale: () => ViewerLocale;
  readonly t: (key: UniverLocaleKey) => string;
}

/** Render one review panel for one document. */
export function ReviewPanel(props: {
  readonly docKey: string;
  readonly label: string | null;
  readonly unitType: string | null;
  readonly state: DocumentFileState | undefined
  readonly worktreeId: string | null;
  readonly preferredUnitId: string | null;
  readonly preferredReadOnly: boolean;
  readonly historical: boolean;
  readonly t: (key: UniverLocaleKey) => string;
} & ViewerRuntimeProps): React.ReactElement {
  const [open, setOpen] = React.useState(!props.historical);
  const [fullscreen, setFullscreen] = React.useState(false);
  const [selected, setSelected] = React.useState<string | undefined>(props.preferredUnitId ?? undefined);
  const wasHistorical = React.useRef(props.historical);
  const worktree = props.worktreeId === null ? undefined : props.state?.worktrees.find((entry) => entry.worktreeId === props.worktreeId);
  const status: CardStatus = props.state === undefined
    ? "loading"
    : props.worktreeId === null
      ? "trunk"
      : worktree?.status ?? "unavailable";
  const units = worktree?.units ?? [];
  const selectedUnit = selected !== undefined && units.some((unit) => unit.unitId === selected)
    ? selected
    : props.preferredUnitId !== null && units.some((unit) => unit.unitId === props.preferredUnitId)
      ? props.preferredUnitId
      : units[0]?.unitId;
  const merged = status === "merged";
  const discarded = status === "discarded";
  const documentTitle = props.label ?? props.t("card.title");
  const viewer = viewerTarget({
    status,
    units,
    selectedUnit,
    state: props.state,
    worktree: worktree ?? undefined,
    fallbackUnitId: props.preferredUnitId,
    fallbackUnitType: props.unitType,
    worktreeId: props.worktreeId,
  });
  const title = worktree?.name || props.t("dock.currentVersion");

  useExclusiveViewer(viewer?.unitId, open, () => {
    setOpen(false);
    setFullscreen(false);
  });

  React.useEffect(() => {
    if (!wasHistorical.current && props.historical) setOpen(false);
    wasHistorical.current = props.historical;
  }, [props.historical]);

  React.useEffect(() => {
    if (props.preferredUnitId !== null) setSelected(props.preferredUnitId);
  }, [props.preferredUnitId]);

  React.useEffect(() => {
    if (!fullscreen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreen]);

  return <section
    className={`uvf_panel${fullscreen ? " uvf_panel_fullscreen" : ""}${props.historical ? " uvf_panel_history" : ""}`}
    data-status={status}
    aria-label={documentTitle}
  >
    <header className="uvf_panelHead">
      <span className="uvf_panelGlyph" aria-hidden="true"><UniverMark merged={merged} discarded={discarded} /></span>
      <span className="uvf_panelIdentity">
        <span className="uvf_panelTitleRow"><span className="uvf_panelTitle">{documentTitle}</span><span className="uvf_panelWorktree">{title}</span></span>
        <span className="uvf_panelMeta" title={props.docKey}>{props.docKey}</span>
      </span>
      <span className="uvf_panelChip" data-status={status}><span className="uvf_panelStatusDot" aria-hidden="true" />{statusLabel(status, props.t)}</span>
      <PanelControl action="fullscreen" label={props.t(fullscreen ? "dock.exitFullscreen" : "dock.fullscreen")} onClick={() => {
        setOpen(true);
        setFullscreen((value) => !value);
      }}>
        <FullscreenIcon restored={fullscreen} />
      </PanelControl>
      {fullscreen ? null : <PanelControl action="fold" label={props.t(open ? "dock.fold" : "dock.expand")} onClick={() => setOpen((value) => !value)}>
        <FoldIcon open={open} />
      </PanelControl>}
    </header>
    {open ? <div className="uvf_panelContent">
      <div className="uvf_panelBody">
        <UnitChips units={units} selected={selectedUnit} t={props.t} onSelect={setSelected} />
        {viewer === undefined
          ? <div className="uvf_panelUnavailable">{props.t(status === "loading" ? "dock.loading" : "dock.unavailable")}</div>
          : <div className="uvf_panelFrame uvf_panelViewer">
              <PanelViewer key={viewerKey(viewer)} viewer={viewer} runtime={props} worktreeId={props.worktreeId} status={status} worktreeName={title} units={units} />
            </div>}
      </div>
    </div> : null}
  </section>;
}

/** Mounts the embedded editor for one resolved target. */
export function PanelViewer(props: {
  readonly viewer: ViewerTarget;
  readonly runtime: ViewerRuntimeProps;
  readonly worktreeId?: string | null | undefined;
  readonly status?: CardStatus | undefined;
  readonly worktreeName?: string;
  readonly units?: readonly { readonly unitId: string; readonly name: string; readonly kind: string }[];
}): React.ReactElement {
  const [state, setState] = React.useState<
    | { readonly status: "loading"; readonly attempt: number }
    | { readonly status: "ready"; readonly bootstrap: ViewerBootstrap }
    | { readonly status: "error"; readonly error: string; readonly attempt: number }
  >({ status: "loading", attempt: 0 });
  const [attempt, setAttempt] = React.useState(0);
  const loadViewerBootstrap = props.runtime.loadViewerBootstrap;
  React.useEffect(() => {
    let live = true;
    setState({ status: "loading", attempt });
    void loadViewerBootstrap()
      .then((value) => { if (live) setState({ status: "ready", bootstrap: value }); })
      .catch((reason: unknown) => {
        if (live) setState({ status: "error", error: viewerBootstrapError(reason), attempt });
      });
    return () => { live = false; };
  }, [attempt, loadViewerBootstrap]);

  if (state.status === "loading") {
    return <ViewerStatus role="status" message={props.runtime.t("window.loading")} />;
  }
  if (state.status === "error") {
    return <ViewerStatus
      role="alert"
      message={`${props.runtime.t("window.loadFailed")}: ${state.error}`}
      action={{ label: props.runtime.t("window.retry"), onClick: () => setAttempt((value) => value + 1) }}
    />;
  }
  return <>
    <ViewerLifecycleBar
      worktreeId={props.worktreeId}
      status={props.status}
      worktreeName={props.worktreeName ?? props.runtime.t("card.title")}
      {...(props.units === undefined ? {} : { units: props.units })}
      t={props.runtime.t}
    />
    <ViewerMount
      unitId={props.viewer.unitId}
      unitType={props.viewer.unitType}
      editable={props.viewer.editable}
      scope={props.viewer.scope}
      bootstrap={state.bootstrap}
      viewerLocale={props.runtime.getViewerLocale()}
      t={props.runtime.t}
    />
  </>;
}

/** The office Viewer owns lifecycle actions; the outer review card does not. */
function ViewerLifecycleBar(props: {
  readonly worktreeId?: string | null | undefined;
  readonly status?: CardStatus | undefined;
  readonly worktreeName: string;
  readonly units?: readonly { readonly unitId: string; readonly name: string; readonly kind: string }[];
  readonly t: (key: UniverLocaleKey) => string;
}): React.ReactElement | null {
  const [busy, setBusy] = React.useState<WorktreeAction | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState<WorktreeAction | null>(null);
  if (props.worktreeId === null || props.worktreeId === undefined || (props.status !== "draft" && props.status !== "ready")) return null;
  const run = (action: WorktreeAction): void => {
    if (busy !== null) return;
    setConfirming(action);
  };
  const confirm = (): void => {
    const action = confirming;
    if (action === null || busy !== null || props.worktreeId === null || props.worktreeId === undefined) return;
    setConfirming(null);
    setBusy(action);
    setError(null);
    void postWorktreeAction(props.worktreeId, action).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => setBusy(null));
  };
  const confirmation = confirming === null || typeof document === "undefined" ? null : createPortal(<div className="uvf_viewerModalBackdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setConfirming(null); }}>
    <div className="uvf_viewerModal" role="dialog" aria-modal="true" aria-labelledby="uvf-viewer-confirm-title">
      <div className="uvf_viewerModalIcon" aria-hidden="true">{confirming === "discard" ? "!" : "✓"}</div>
      <div className="uvf_viewerConfirmBody"><strong id="uvf-viewer-confirm-title">{confirming === "merge" ? props.t("viewer.mergeTitle") : confirming === "discard" ? props.t("viewer.discardTitle") : props.t("viewer.readyTitle")}</strong><span>{props.worktreeName}</span><p>{confirming === "merge" ? props.t("viewer.mergeBody") : confirming === "discard" ? props.t("viewer.discardBody") : props.t("viewer.readyBody")}</p>{props.units === undefined || props.units.length === 0 ? null : <div className="uvf_viewerConfirmChips">{props.units.filter((unit) => unit.kind !== "unchanged").map((unit) => <span className="uvf_viewerConfirmChip" key={unit.unitId}>{unit.name}</span>)}</div>}</div>
      <div className="uvf_viewerConfirmActions"><button type="button" className="uvf_viewerButton" onClick={() => setConfirming(null)}>{props.t("viewer.cancel")}</button><button type="button" className={`uvf_viewerButton${confirming === "discard" ? " uvf_viewerButtonDestructive" : " uvf_viewerButtonPrimary"}`} onClick={confirm}>{confirming === "ready" ? props.t("viewer.readyConfirm") : confirming === "merge" ? props.t("viewer.mergeConfirm") : props.t("viewer.discardConfirm")}</button></div>
    </div>
  </div>, document.body);
  const topbar = <div className="uvf_viewerTopbar" onPointerDown={(event) => event.stopPropagation()}>
    <div className="uvf_viewerTopbarIdentity">
      <span className="uvf_viewerTopbarTitle">{props.worktreeName}</span>
      {props.status === "ready" ? <span className="uvf_viewerReadOnly">{props.t("viewer.readOnlyPreview")}</span> : null}
    </div>
    <div className="uvf_viewerTopbarActions">
      {props.status === "draft" ? <button type="button" className="uvf_viewerButton uvf_viewerButtonPrimary" disabled={busy !== null} onClick={() => run("ready")}><CheckIcon />{busy === "ready" ? props.t("window.loading") : props.t("viewer.submitForReview")}</button> : null}
      {props.status === "ready" ? <button type="button" className="uvf_viewerButton uvf_viewerButtonPrimary" disabled={busy !== null} onClick={() => run("merge")}><MergeIcon />{busy === "merge" ? props.t("window.loading") : props.t("viewer.mergeToCurrent")}</button> : null}
      <button type="button" className="uvf_viewerButton uvf_viewerButtonGhostDanger" disabled={busy !== null} onClick={() => run("discard")}><TrashIcon />{busy === "discard" ? props.t("window.loading") : props.t("viewer.discard")}</button>
    </div>
    {error === null ? null : <span className="uvf_viewerActionError" role="status">{error}</span>}
  </div>;
  return <>{topbar}{confirmation}</>;
}

function ViewerStatus(props: {
  readonly role: "status" | "alert";
  readonly message: string;
  readonly action?: { readonly label: string; readonly onClick: () => void };
}): React.ReactElement {
  return <div className="uvf_viewerStatus" role={props.role} aria-live={props.role === "status" ? "polite" : "assertive"}>
    <span>{props.message}</span>
    {props.action === undefined ? null : <button type="button" className="uvf_viewerRetry" onClick={props.action.onClick}>{props.action.label}</button>}
  </div>;
}

function viewerBootstrapError(reason: unknown): string {
  if (reason instanceof Error && reason.message !== "") return reason.message;
  if (typeof reason === "string" && reason !== "") return reason;
  return "unknown error";
}

export interface ViewerTarget {
  readonly unitId: string;
  readonly unitType: ViewerUnitType | "unsupported";
  readonly editable: boolean;
  readonly scope: ViewerScope;
  readonly unsupportedType?: string;
}

type ResolvedViewerUnitType = ViewerUnitType | "unsupported";

function viewerKey(viewer: ViewerTarget): string {
  return viewer.scope.kind === "trunk"
    ? `${viewer.unitId}:trunk`
    : `${viewer.unitId}:${viewer.scope.kind}:${viewer.scope.worktreeId}`;
}

/** Resolve what the embedded editor should mount — office cardTarget equivalent. */
function viewerTarget(input: {
  readonly status: CardStatus;
  readonly units: readonly { unitId: string; unitType: string }[];
  readonly selectedUnit: string | undefined;
  readonly state: DocumentFileState | undefined;
  readonly worktree: ReviewWorktree | undefined;
  readonly fallbackUnitId: string | null;
  readonly fallbackUnitType: string | null;
  readonly worktreeId: string | null;
}): ViewerTarget | undefined {
  const unitTypeOf = (unitId: string, hint: string | null): ResolvedViewerUnitType => {
    const fromUnit = input.units.find((unit) => unit.unitId === unitId)?.unitType;
    // A missing type is a contract error, not permission to mount a Sheet
    // viewer.  Office resolves the Unit type from its file registry; the
    // remote Workspace path must keep the same fail-closed behaviour rather
    // than silently rendering the wrong Unit.
    const raw = fromUnit ?? hint;
    if (raw === undefined || raw === "") return "unsupported";
    return raw === "sheet" || raw === "doc" || raw === "slide" || raw === "board" || raw === "base" ? raw : "unsupported";
  };
  if (input.state === undefined) return undefined;
  if (input.worktreeId === null || input.status === "merged" || input.status === "discarded") {
    const target = input.state.viewerTarget;
    if (target === null) return undefined;
    const unitId = input.selectedUnit ?? input.fallbackUnitId ?? target.unitId;
    const resolvedType = unitTypeOf(unitId, target.unitType);
    return {
      unitId,
      unitType: resolvedType,
      editable: !target.readOnly,
      scope: { kind: "trunk" },
      ...(resolvedType === "unsupported" ? { unsupportedType: rawUnitType(target.unitType) } : {}),
    };
  }
  const worktree = input.worktree;
  if (worktree === undefined) return undefined;
  const unitId = input.selectedUnit ?? input.fallbackUnitId ?? input.units[0]?.unitId;
  if (unitId === undefined) return undefined;
  if (input.status === "draft") {
    if (worktree.worktreeTarget === null) return undefined;
    const resolvedType = unitTypeOf(unitId, worktree.worktreeTarget.unitType);
    return {
      unitId,
      unitType: resolvedType,
      editable: true,
      scope: { kind: "worktree", worktreeId: input.worktreeId },
      ...(resolvedType === "unsupported" ? { unsupportedType: rawUnitType(input.fallbackUnitType) } : {}),
    };
  }
  // Workspace permits mergePreview only while a Worktree is ready.  A
  // merging Worktree has no stable snapshot and must not fall back to draft.
  if (input.status !== "ready" || worktree.mergeTarget === null) return undefined;
  const resolvedType = unitTypeOf(unitId, worktree.mergeTarget.unitType);
  return {
    unitId,
    unitType: resolvedType,
    editable: false,
    scope: { kind: "mergePreview", worktreeId: input.worktreeId },
    ...(resolvedType === "unsupported" ? { unsupportedType: rawUnitType(input.fallbackUnitType) } : {}),
  };
}

function rawUnitType(value: string | null): string {
  return value === null || value === "" ? "unknown" : value;
}

function statusLabel(status: CardStatus, t: (key: UniverLocaleKey) => string): string {
  if (status === "draft") return t("dock.draft");
  if (status === "ready") return t("dock.mergeReady");
  if (status === "merging") return t("dock.merging");
  if (status === "merged") return t("dock.merged");
  if (status === "discarded") return t("dock.discarded");
  if (status === "trunk") return t("dock.currentVersion");
  if (status === "loading") return t("dock.loading");
  return t("dock.unavailable");
}

function PanelControl(props: { readonly action: string; readonly label: string; readonly onClick: () => void; readonly children: React.ReactNode }): React.ReactElement {
  return <button type="button" className="uvf_btn" data-panel-action={props.action} title={props.label} aria-label={props.label} onClick={props.onClick}>{props.children}</button>;
}

function CheckIcon(): React.ReactElement {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg>;
}

function MergeIcon(): React.ReactElement {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3v4c0 2 2 3 4 3h4M10 7l2 3-2 3" /></svg>;
}

function TrashIcon(): React.ReactElement {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4h10M6 4V2h4v2m-6 0 .7 10h6.6L12 4M7 7v4m2-4v4" /></svg>;
}

function FoldIcon(props: { readonly open: boolean }): React.ReactElement {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d={props.open ? "m4 10 4-4 4 4" : "m4 6 4 4 4-4"} /></svg>;
}

function UniverMark(props: { readonly merged: boolean; readonly discarded: boolean }): React.ReactElement {
  if (props.merged) return <svg viewBox="0 0 20 20"><path d="m5 10 3 3 7-7" /></svg>;
  if (props.discarded) return <svg viewBox="0 0 20 20"><path d="M6 10h8" /></svg>;
  return <svg viewBox="0 0 20 20"><rect x="4" y="4" width="12" height="12" rx="2" /><path d="M4 8h12M8 4v12" /></svg>;
}

function FullscreenIcon(props: { readonly restored: boolean }): React.ReactElement {
  return <svg viewBox="0 0 16 16" aria-hidden="true">{props.restored
    ? <path d="M6 3v3H3m10 0h-3V3m0 10v-3h3M3 10h3v3" />
    : <path d="M6 3H3v3m10 0V3h-3m0 10h3v-3M3 10v3h3" />}</svg>;
}
