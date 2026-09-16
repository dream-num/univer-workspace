import { createRoot } from "react-dom/client";
import { CollaborationStatus } from "@univerjs-pro/collaboration-client";
import {
  WorkspaceHtmlViewer,
  type WorkspaceHtmlViewerHandle,
  type HtmlViewHostOptions,
} from "@univerjs/univer-workspace-html-viewer";
import { Button } from "@univerjs/univer-workspace-ui";
import runtime from "virtual:html-view-runtime";
import type { UniverLocaleKey } from "../locales.ts";
import { retainUntilSaved } from "./retained-preview.ts";
import css from "./html-view.module.scss";

const ALLOWED_ORIGINS = ["https://cdn.jsdelivr.net"] as const;

/** Keep the iframe at a stable DOM address, even when the native tab unmounts. */
export function mountRetainedHtmlView(options: {
  anchor: HTMLElement;
  source: string;
  name: string;
  loadEngine: HtmlViewHostOptions["loadEngine"];
  t: (key: UniverLocaleKey) => string;
}): () => void {
  const container = document.createElement("div");
  container.className = css.layer!;
  document.body.append(container);
  const root = createRoot(container);
  let viewer: WorkspaceHtmlViewerHandle | null = null;
  let unsynced = false;
  let error = "";
  let released = false;
  let saving = false;
  let saveFailed = false;
  let frame = 0;
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (saveFailed || unsynced || viewer?.hasPendingChanges()) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  window.addEventListener("beforeunload", beforeUnload);
  const owner = retainUntilSaved({
    flush: async () => {
      await viewer?.flush();
    },
    dispose: () => {
      cancelAnimationFrame(frame);
      clearTimeout(recoveryTimer);
      window.removeEventListener("beforeunload", beforeUnload);
      root.unmount();
      container.remove();
    },
    onSaving: () => {
      saving = true;
      render();
    },
    onError: (reason) => {
      clearTimeout(recoveryTimer);
      saving = false;
      saveFailed = true;
      error = reason instanceof Error ? reason.message : String(reason);
      // Native close has already happened: retain a visible, usable recovery surface.
      container.classList.add(css.recovery!);
      container.removeAttribute("style");
      render();
    },
  });
  const setViewer = (value: WorkspaceHtmlViewerHandle | null) => {
    viewer = value;
  };
  const onError = (message: string) => {
    error = message;
    render();
  };
  function render() {
    container.inert = saving;
    root.render(
      <section className={css.surface} aria-label={options.name}>
        {released ? (
          <header className={css.recoveryHeader}>
            <strong>{options.name}</strong>
            <span>{options.t(saving ? "html.saving" : "html.saveFailed")}</span>
            <Button
              disabled={saving}
              onClick={() => {
                void owner.saveAndClose();
              }}
            >
              {options.t("html.retrySave")}
            </Button>
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => {
                if (window.confirm(options.t("html.discardConfirm"))) owner.discard();
              }}
            >
              {options.t("html.discard")}
            </Button>
          </header>
        ) : null}
        {error ? (
          <p className={css.error} role="alert">
            {error}
          </p>
        ) : null}
        <WorkspaceHtmlViewer
          ref={setViewer}
          source={options.source}
          runtime={runtime}
          title={options.name}
          allowedOrigins={ALLOWED_ORIGINS}
          loadEngine={options.loadEngine}
          onError={onError}
          onStatus={(states) => {
            unsynced = states.some((state) => state !== CollaborationStatus.SYNCED);
          }}
          className={css.iframe}
        />
      </section>,
    );
  }
  const place = () => {
    const rect = options.anchor.getBoundingClientRect();
    // Match the native pane, including its resized/floating/fullscreen position.
    const visible =
      options.anchor.checkVisibility({ visibilityProperty: true, opacityProperty: true }) &&
      rect.width > 0 &&
      rect.height > 0;
    let zIndex = 30;
    for (let parent: HTMLElement | null = options.anchor; parent; parent = parent.parentElement) {
      const level = Number.parseInt(getComputedStyle(parent).zIndex, 10);
      if (Number.isFinite(level)) zIndex = Math.max(zIndex, level + 1);
    }
    Object.assign(container.style, {
      visibility: visible ? "visible" : "hidden",
      zIndex: String(zIndex),
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    frame = requestAnimationFrame(place);
  };
  render();
  place();
  return () => {
    if (released) return;
    released = true;
    cancelAnimationFrame(frame);
    // Hide without removing/reparenting the iframe, which would destroy its browsing context.
    container.style.visibility = "hidden";
    recoveryTimer = setTimeout(() => {
      container.classList.add(css.recovery!);
      container.removeAttribute("style");
    }, 500);
    void owner.saveAndClose();
  };
}
