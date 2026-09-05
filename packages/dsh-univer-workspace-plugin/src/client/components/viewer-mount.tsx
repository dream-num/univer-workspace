/**
 * React mount for the viewer engine: creates a ViewerHandle for the resolved
 * target and disposes it when the target or bootstrap changes — the caller
 * switches context (trunk↔worktree, unit, editability) by changing props.
 * @module dsh-univer-workspace-plugin/client/components/viewer-mount
 */

import * as React from "react";
import { LocaleType } from "@univerjs/core";
import {
  createViewer,
  type ViewerHandle,
  type ViewerScope,
  type ViewerSelection,
} from "../viewer-engine.ts";
import { isViewerUnitTypeSupported, type ViewerUnitType } from "../viewer-types.ts";
import type { ViewerBootstrap } from "../viewer-bootstrap.ts";
import type { ViewerLocale } from "../viewer-locale.ts";
import type { UniverLocaleKey } from "../locales.ts";
import css from "./review-panel.module.scss";

/** Mount one live editor for the target inside a sized parent. */
export function ViewerMount(props: {
  readonly unitId: string;
  readonly unitType: string;
  readonly editable: boolean;
  readonly scope: ViewerScope;
  readonly bootstrap: ViewerBootstrap | null;
  readonly viewerLocale: ViewerLocale;
  readonly t: (key: UniverLocaleKey) => string;
  readonly onSelectionChange?: (selection: ViewerSelection | null) => void;
}): React.ReactElement {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  // Keep one host element for this mount. Replacing its id in a second effect
  // races the async Univer bootstrap: the first instance can finish after its
  // cleanup and leave a ghost canvas behind, which causes visible flashing.
  const instanceIdRef = React.useRef(`uws-viewer-${Math.random().toString(36).slice(2)}`);
  const instanceId = instanceIdRef.current;
  const [error, setError] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);
  const selectionCallbackRef = React.useRef(props.onSelectionChange);
  selectionCallbackRef.current = props.onSelectionChange;

  const locale: LocaleType = props.viewerLocale === "en-US" ? LocaleType.EN_US : LocaleType.ZH_CN;
  const scopeKey =
    props.scope.kind === "trunk" ? "trunk" : `${props.scope.kind}:${props.scope.worktreeId}`;
  const unitType: ViewerUnitType | undefined =
    props.unitType === "sheet" ||
    props.unitType === "doc" ||
    props.unitType === "slide" ||
    props.unitType === "board" ||
    props.unitType === "base"
      ? props.unitType
      : undefined;
  const supported = unitType !== undefined && isViewerUnitTypeSupported(unitType);

  React.useEffect(() => {
    const element = containerRef.current;
    const bootstrap = props.bootstrap;
    if (!supported || unitType === undefined || element === null || bootstrap === null) return;
    let disposed = false;
    let handle: ViewerHandle | null = null;
    setError(null);
    setReady(false);
    const mount = async (): Promise<void> => {
      const created = await createViewer({
        container: instanceId,
        unitId: props.unitId,
        unitType,
        scope: props.scope,
        editable: props.editable,
        locale,
        license: bootstrap.license,
        user: bootstrap.user,
        onSelectionChange: (selection) => selectionCallbackRef.current?.(selection),
      });
      if (disposed) {
        created.dispose();
        return;
      }
      handle = created;
      setReady(true);
    };
    void mount().catch((reason: unknown) => {
      if (!disposed) setError(viewerErrorMessage(reason));
    });
    return () => {
      disposed = true;
      handle?.dispose();
      handle = null;
    };
  }, [
    instanceId,
    props.unitId,
    unitType,
    supported,
    scopeKey,
    props.editable,
    locale,
    props.bootstrap,
  ]);

  React.useEffect(() => {
    const element = containerRef.current;
    if (unitType !== "doc" || element === null || !props.onSelectionChange) return;
    const reportTextSelection = (): void => {
      const selection = window.getSelection();
      if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
        selectionCallbackRef.current?.(null);
        return;
      }
      const anchor = selection.anchorNode;
      if (anchor === null || !element.contains(anchor)) return;
      const text = selection.toString().trim();
      selectionCallbackRef.current?.(text === "" ? null : { kind: "text", text });
    };
    document.addEventListener("selectionchange", reportTextSelection);
    return () => document.removeEventListener("selectionchange", reportTextSelection);
  }, [unitType, props.onSelectionChange]);

  if (!supported) {
    return (
      <div className={css.viewerStatus} role="alert" aria-live="assertive">
        <span>
          {props.t("window.unsupportedType")}
          {props.unitType === "" ? "" : ` (${props.unitType})`}
        </span>
      </div>
    );
  }

  return (
    <div className={css.viewerEditor} aria-busy={!ready}>
      {!ready && error === null ? (
        <div className={css.viewerStatus} role="status" aria-live="polite">
          <span>{props.t("window.loading")}</span>
        </div>
      ) : null}
      {error !== null ? (
        <div className={css.viewerStatus} role="alert" aria-live="assertive">
          <span>{`${props.t("window.loadFailed")}: ${error}`}</span>
        </div>
      ) : null}
      <div ref={containerRef} id={instanceId} className={css.viewerContainer} />
    </div>
  );
}

function viewerErrorMessage(reason: unknown): string {
  if (reason instanceof Error && reason.message !== "") return reason.message;
  if (typeof reason === "string" && reason !== "") return reason;
  if (reason !== null && typeof reason === "object") {
    try {
      const encoded = JSON.stringify(reason);
      if (encoded !== undefined && encoded !== "{}") return encoded;
    } catch {
      /* Fall through to a stable user-facing message. */
    }
  }
  return "Viewer failed to load";
}
