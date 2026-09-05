/**
 * Full-height middle Workspace surface for ONE opened Resource: a restrained
 * header (name + close) above the shared Viewer kernel. It deliberately does
 * NOT reuse the message-embedded ReviewPanel card shell — the two surfaces
 * only share the kernel (`PanelViewer` → `ViewerMount` → Univer runtime), so
 * no fixed 590px height, fold/fullscreen controls or double header leaks in.
 * @module dsh-univer-workspace-plugin/client/components/WorkspaceResourceViewer
 */

import { useEffect, useState, type CSSProperties, type ReactElement } from "react";
import { Button, CloseIcon } from "@univerjs/univer-workspace-ui";
import { getFileState } from "../api/univer-api.ts";
import { PanelViewer, type ViewerTarget } from "./review-panel.tsx";
import type { WorkspaceResourceSurface } from "../navigation/workspace-navigation.ts";
import type { DocumentFileState } from "../../shared/state.ts";
import type { ViewerBootstrap } from "../viewer-bootstrap.ts";
import type { ViewerLocale } from "../viewer-locale.ts";
import type { UniverLocaleKey } from "../locales.ts";
import type { WorkspaceResourceReferenceInsertResult } from "../workspace-resource-reference.ts";
import type { ViewerSelection } from "../viewer/contracts.ts";
import css from "./WorkspaceResourceViewer.module.scss";
import { UnitTypeIcon } from "./worktree-review/unit-markers.tsx";

type FileState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly value: DocumentFileState }
  | { readonly status: "error"; readonly message: string };

export interface WorkspaceResourceViewerProps {
  readonly target: WorkspaceResourceSurface;
  /** Measured sidebar right edge from the inset adapter; `null` falls back to
   * the CSS default so the surface still renders (and closes) when the
   * conversation host is missing. */
  readonly surfaceLeft: number | null;
  readonly surfaceWidth: number;
  readonly onClose: () => void;
  readonly loadViewerBootstrap: () => Promise<ViewerBootstrap>;
  readonly getViewerLocale: () => ViewerLocale;
  readonly t: (key: UniverLocaleKey) => string;
  readonly insertResourceReference: (
    resource: {
      readonly resourceId: string;
      readonly name: string;
    },
    selection?: ViewerSelection,
  ) => WorkspaceResourceReferenceInsertResult;
}

/** Resolve the trunk Viewer target; fail closed on unknown Unit types. */
function resolveTrunkViewer(state: DocumentFileState): ViewerTarget | undefined {
  const target = state.viewerTarget;
  if (target === null) return undefined;
  const unitType =
    target.unitType === "sheet" ||
    target.unitType === "doc" ||
    target.unitType === "slide" ||
    target.unitType === "board" ||
    target.unitType === "base"
      ? target.unitType
      : "unsupported";
  return {
    unitId: target.unitId,
    unitType,
    editable: !target.readOnly,
    scope: { kind: "trunk" },
    ...(unitType === "unsupported" ? { unsupportedType: target.unitType } : {}),
  };
}

export function WorkspaceResourceViewer(props: WorkspaceResourceViewerProps): ReactElement {
  const [fileState, setFileState] = useState<FileState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    setFileState({ status: "loading" });
    void getFileState(props.target.docKey)
      .then((value) => {
        if (active) setFileState({ status: "ready", value });
      })
      .catch((reason: unknown) => {
        if (active) {
          setFileState({
            status: "error",
            message: reason instanceof Error ? reason.message : String(reason),
          });
        }
      });
    return () => {
      active = false;
    };
  }, [props.target.docKey]);

  const viewer = fileState.status === "ready" ? resolveTrunkViewer(fileState.value) : undefined;
  const surfaceStyle = {
    "--uwh-resource-surface-left":
      props.surfaceLeft === null ? undefined : `${props.surfaceLeft}px`,
    "--uwh-resource-surface-width": `${props.surfaceWidth}px`,
  } as CSSProperties & {
    "--uwh-resource-surface-left": string | undefined;
    "--uwh-resource-surface-width": string;
  };

  return (
    <section className={css.surface} style={surfaceStyle} aria-label={props.target.name}>
      <header className={css.header}>
        <div className={css.identity}>
          <span className={css.glyph} aria-hidden="true">
            <UnitTypeIcon type={props.target.unitType ?? ""} />
          </span>
          <div className={css.titleBlock}>
            <strong className={css.name}>{props.target.name}</strong>
            {props.target.spaceName === undefined ? null : (
              <span className={css.spaceName}>{props.target.spaceName}</span>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={props.t("resource.addToMessage")}
          title={props.t("resource.addToMessage")}
          onClick={() =>
            props.insertResourceReference({
              resourceId: props.target.resourceId,
              name: props.target.name,
            })
          }
        >
          <ConversationAddIcon />
        </Button>
        <button
          type="button"
          className={css.close}
          aria-label={props.t("dock.close")}
          onClick={props.onClose}
        >
          <CloseIcon />
        </button>
      </header>
      <div className={css.content}>
        {fileState.status === "loading" ? (
          <div className={css.status} role="status">
            {props.t("window.loading")}
          </div>
        ) : fileState.status === "error" ? (
          <div className={css.statusError} role="alert">
            {`${props.t("window.loadFailed")}: ${fileState.message}`}
          </div>
        ) : viewer === undefined ? (
          <div className={css.status} role="status">
            {props.t("dock.unavailable")}
          </div>
        ) : viewer.unitType === "unsupported" ? (
          <div className={css.status} role="status">
            {props.t("window.unsupportedType")}
          </div>
        ) : (
          <PanelViewer
            viewer={viewer}
            runtime={props}
            worktreeId={null}
            resource={{ resourceId: props.target.resourceId, name: props.target.name }}
            insertResourceReference={props.insertResourceReference}
          />
        )}
      </div>
    </section>
  );
}

function ConversationAddIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 4.5h9a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H8l-3.5 3v-3H3.5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Z" />
      <circle cx="15.2" cy="15.1" r="3.2" fill="var(--color-background)" />
      <circle cx="15.2" cy="15.1" r="2.5" fill="currentColor" stroke="none" />
      <path d="M15.2 13.7v2.8M13.8 15.1h2.8" stroke="var(--color-background)" />
    </svg>
  );
}
