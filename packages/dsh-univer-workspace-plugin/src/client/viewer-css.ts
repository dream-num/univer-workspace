/**
 * Viewer stylesheet loader.
 *
 * The Univer preset stylesheets (aggregated into {@link viewerCss} by
 * scripts/gen-css.mjs) are attached as one <style> tag while any viewer is
 * mounted — the DSH page does not load Univer styles on its own.
 * @module dsh-univer-workspace-plugin/client/viewer-css
 */

import viewerCss from "./gen-univer.css";

const STYLE_ID = "univer-viewer-css";

let refCount = 0;

/** Attach viewer styles once; dispose removes them when the last viewer unmounts. */
export function ensureViewerStyles(): () => void {
  refCount += 1;
  if (
    typeof document !== "undefined"
    && document.querySelector(`style[data-plugin-css='${STYLE_ID}']`) === null
  ) {
    const style = document.createElement("style");
    style.dataset.pluginCss = STYLE_ID;
    style.textContent = viewerCss;
    document.head.appendChild(style);
  }
  return () => {
    refCount = Math.max(0, refCount - 1);
    if (refCount > 0 || typeof document === "undefined") return;
    document.querySelector(`style[data-plugin-css='${STYLE_ID}']`)?.remove();
  };
}
