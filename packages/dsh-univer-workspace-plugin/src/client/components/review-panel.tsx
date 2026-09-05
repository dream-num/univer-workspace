/**
 * The unified Turn-tail review panel for trunk, worktree, loading, terminal,
 * and historical views — ported from the dsh-univer-office ReviewPanel with
 * the iframe viewer replaced by the in-process collaboration editor.
 * @module dsh-univer-workspace-plugin/client/components/review-panel
 */

import * as React from "react";
import { createPortal } from "react-dom";
import { Button, MessageSquareIcon } from "@univerjs/univer-workspace-ui";
import type { DocumentFileState } from "../../shared/state.ts";
import type { WorktreeAction, WorktreeStatus } from "../../shared/state.ts";
import type { UniverLocaleKey } from "../locales.ts";
import type { ViewerBootstrap } from "../viewer-bootstrap.ts";
import { ViewerMount } from "./viewer-mount.tsx";
import type { ViewerLocale } from "../viewer-locale.ts";
import type { ViewerScope, ViewerSelection, ViewerUnitType } from "../viewer/contracts.ts";
import type { WorkspaceResourceReferenceInsertResult } from "../workspace-resource-reference.ts";
import { postWorktreeAction } from "../api/univer-api.ts";
import css from "./review-panel.module.scss";

type CardStatus = WorktreeStatus | "trunk" | "loading" | "unavailable";
type ReviewWorktree = DocumentFileState["worktrees"][number];

/** Injected viewer runtime shared by every review surface. */
export interface ViewerRuntimeProps {
  readonly loadViewerBootstrap: () => Promise<ViewerBootstrap>;
  readonly getViewerLocale: () => ViewerLocale;
  readonly t: (key: UniverLocaleKey) => string;
}

/** Mounts the embedded editor for one resolved target. */
export function PanelViewer(props: {
  readonly viewer: ViewerTarget;
  readonly runtime: ViewerRuntimeProps;
  readonly worktreeId?: string | null | undefined;
  readonly status?: CardStatus | undefined;
  readonly worktreeName?: string;
  readonly units?: readonly {
    readonly unitId: string;
    readonly name: string;
    readonly kind: string;
  }[];
  readonly resource?: { readonly resourceId: string; readonly name: string };
  readonly insertResourceReference?: (
    resource: { readonly resourceId: string; readonly name: string },
    selection?: ViewerSelection,
  ) => WorkspaceResourceReferenceInsertResult;
}): React.ReactElement {
  const [state, setState] = React.useState<
    | { readonly status: "loading"; readonly attempt: number }
    | { readonly status: "ready"; readonly bootstrap: ViewerBootstrap }
    | { readonly status: "error"; readonly error: string; readonly attempt: number }
  >({ status: "loading", attempt: 0 });
  const [attempt, setAttempt] = React.useState(0);
  const [selection, setSelection] = React.useState<ViewerSelection | null>(null);
  const loadViewerBootstrap = props.runtime.loadViewerBootstrap;
  React.useEffect(() => setSelection(null), [props.viewer.unitId, props.viewer.scope]);
  React.useEffect(() => {
    let live = true;
    setState({ status: "loading", attempt });
    void loadViewerBootstrap()
      .then((value) => {
        if (live) setState({ status: "ready", bootstrap: value });
      })
      .catch((reason: unknown) => {
        if (live) setState({ status: "error", error: viewerBootstrapError(reason), attempt });
      });
    return () => {
      live = false;
    };
  }, [attempt, loadViewerBootstrap]);

  if (state.status === "loading") {
    return <ViewerStatus role="status" message={props.runtime.t("window.loading")} />;
  }
  if (state.status === "error") {
    return (
      <ViewerStatus
        role="alert"
        message={`${props.runtime.t("window.loadFailed")}: ${state.error}`}
        action={{
          label: props.runtime.t("window.retry"),
          onClick: () => setAttempt((value) => value + 1),
        }}
      />
    );
  }
  return (
    <>
      <ViewerLifecycleBar
        worktreeId={props.worktreeId}
        status={props.status}
        worktreeName={props.worktreeName ?? props.runtime.t("card.title")}
        {...(props.units === undefined ? {} : { units: props.units })}
        t={props.runtime.t}
      />
      {props.resource !== undefined &&
      props.insertResourceReference !== undefined &&
      selection !== null ? (
        <div className={css.viewerSelectionContext} role="status">
          <span>
            {props.runtime.t("selection.current")}: {selectionLabel(selection)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => props.insertResourceReference?.(props.resource!, selection)}
          >
            <MessageSquareIcon />
            {props.runtime.t("selection.addToMessage")}
          </Button>
        </div>
      ) : null}
      <ViewerMount
        unitId={props.viewer.unitId}
        unitType={props.viewer.unitType}
        editable={props.viewer.editable}
        scope={props.viewer.scope}
        bootstrap={state.bootstrap}
        viewerLocale={props.runtime.getViewerLocale()}
        t={props.runtime.t}
        {...(props.resource === undefined || props.insertResourceReference === undefined
          ? {}
          : { onSelectionChange: setSelection })}
      />
    </>
  );
}

function selectionLabel(selection: ViewerSelection): string {
  return selection.kind === "sheet-range"
    ? `${selection.sheetName}!${selection.a1Notation}`
    : selection.text.length > 120
      ? `${selection.text.slice(0, 120)}…`
      : selection.text;
}

/** The office Viewer owns lifecycle actions; the outer review card does not. */
function ViewerLifecycleBar(props: {
  readonly worktreeId?: string | null | undefined;
  readonly status?: CardStatus | undefined;
  readonly worktreeName: string;
  readonly units?: readonly {
    readonly unitId: string;
    readonly name: string;
    readonly kind: string;
  }[];
  readonly t: (key: UniverLocaleKey) => string;
}): React.ReactElement | null {
  const [busy, setBusy] = React.useState<WorktreeAction | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState<WorktreeAction | null>(null);
  if (
    props.worktreeId === null ||
    props.worktreeId === undefined ||
    (props.status !== "draft" && props.status !== "ready")
  )
    return null;
  const run = (action: WorktreeAction): void => {
    if (busy !== null) return;
    setConfirming(action);
  };
  const confirm = (): void => {
    const action = confirming;
    if (
      action === null ||
      busy !== null ||
      props.worktreeId === null ||
      props.worktreeId === undefined
    )
      return;
    setConfirming(null);
    setBusy(action);
    setError(null);
    void postWorktreeAction(props.worktreeId, action)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setBusy(null));
  };
  const confirmation =
    confirming === null || typeof document === "undefined"
      ? null
      : createPortal(
          <div
            className={css.viewerModalBackdrop}
            role="presentation"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) setConfirming(null);
            }}
          >
            <div
              className={css.viewerModal}
              role="dialog"
              aria-modal="true"
              aria-labelledby="uvf-viewer-confirm-title"
            >
              <div className={css.viewerModalIcon} aria-hidden="true">
                {confirming === "discard" ? "!" : "✓"}
              </div>
              <div className={css.viewerConfirmBody}>
                <strong id="uvf-viewer-confirm-title">
                  {confirming === "merge"
                    ? props.t("viewer.mergeTitle")
                    : confirming === "discard"
                      ? props.t("viewer.discardTitle")
                      : props.t("viewer.readyTitle")}
                </strong>
                <span>{props.worktreeName}</span>
                <p>
                  {confirming === "merge"
                    ? props.t("viewer.mergeBody")
                    : confirming === "discard"
                      ? props.t("viewer.discardBody")
                      : props.t("viewer.readyBody")}
                </p>
                {props.units === undefined || props.units.length === 0 ? null : (
                  <div className={css.viewerConfirmChips}>
                    {props.units
                      .filter((unit) => unit.kind !== "unchanged")
                      .map((unit) => (
                        <span className={css.viewerConfirmChip} key={unit.unitId}>
                          {unit.name}
                        </span>
                      ))}
                  </div>
                )}
              </div>
              <div className={css.viewerConfirmActions}>
                <button
                  type="button"
                  className={css.viewerButton}
                  onClick={() => setConfirming(null)}
                >
                  {props.t("viewer.cancel")}
                </button>
                <button
                  type="button"
                  className={`${css.viewerButton} ${confirming === "discard" ? css.viewerButtonDestructive : css.viewerButtonPrimary}`}
                  onClick={confirm}
                >
                  {confirming === "ready"
                    ? props.t("viewer.readyConfirm")
                    : confirming === "merge"
                      ? props.t("viewer.mergeConfirm")
                      : props.t("viewer.discardConfirm")}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        );
  const topbar = (
    <div className={css.viewerTopbar} onPointerDown={(event) => event.stopPropagation()}>
      <div className={css.viewerTopbarIdentity}>
        <span className={css.viewerTopbarTitle}>{props.worktreeName}</span>
        {props.status === "ready" ? (
          <span className={css.viewerReadOnly}>{props.t("viewer.readOnlyPreview")}</span>
        ) : null}
      </div>
      <div className={css.viewerTopbarActions}>
        {props.status === "draft" ? (
          <button
            type="button"
            className={`${css.viewerButton} ${css.viewerButtonPrimary}`}
            disabled={busy !== null}
            onClick={() => run("ready")}
          >
            <CheckIcon />
            {busy === "ready" ? props.t("window.loading") : props.t("viewer.submitForReview")}
          </button>
        ) : null}
        {props.status === "ready" ? (
          <button
            type="button"
            className={`${css.viewerButton} ${css.viewerButtonPrimary}`}
            disabled={busy !== null}
            onClick={() => run("merge")}
          >
            <MergeIcon />
            {busy === "merge" ? props.t("window.loading") : props.t("viewer.mergeToCurrent")}
          </button>
        ) : null}
        <button
          type="button"
          className={`${css.viewerButton} ${css.viewerButtonGhostDanger}`}
          disabled={busy !== null}
          onClick={() => run("discard")}
        >
          <TrashIcon />
          {busy === "discard" ? props.t("window.loading") : props.t("viewer.discard")}
        </button>
      </div>
      {error === null ? null : (
        <span className={css.viewerActionError} role="status">
          {error}
        </span>
      )}
    </div>
  );
  return (
    <>
      {topbar}
      {confirmation}
    </>
  );
}

function ViewerStatus(props: {
  readonly role: "status" | "alert";
  readonly message: string;
  readonly action?: { readonly label: string; readonly onClick: () => void };
}): React.ReactElement {
  return (
    <div
      className={css.viewerStatus}
      role={props.role}
      aria-live={props.role === "status" ? "polite" : "assertive"}
    >
      <span>{props.message}</span>
      {props.action === undefined ? null : (
        <button type="button" className={css.viewerRetry} onClick={props.action.onClick}>
          {props.action.label}
        </button>
      )}
    </div>
  );
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
export function resolveViewerTarget(input: {
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
    return raw === "sheet" || raw === "doc" || raw === "slide" || raw === "board" || raw === "base"
      ? raw
      : "unsupported";
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
      editable: input.worktreeId === null && !target.readOnly,
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
      editable: false,
      scope: { kind: "worktree", worktreeId: input.worktreeId },
      ...(resolvedType === "unsupported"
        ? { unsupportedType: rawUnitType(input.fallbackUnitType) }
        : {}),
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
    ...(resolvedType === "unsupported"
      ? { unsupportedType: rawUnitType(input.fallbackUnitType) }
      : {}),
  };
}

function rawUnitType(value: string | null): string {
  return value === null || value === "" ? "unknown" : value;
}

function CheckIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m3 8 3 3 7-7" />
    </svg>
  );
}

function MergeIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 3v4c0 2 2 3 4 3h4M10 7l2 3-2 3" />
    </svg>
  );
}

function TrashIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 4h10M6 4V2h4v2m-6 0 .7 10h6.6L12 4M7 7v4m2-4v4" />
    </svg>
  );
}
