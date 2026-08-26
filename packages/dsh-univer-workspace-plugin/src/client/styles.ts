/**
 * The capability plugin's client styles (space picker).
 */
const css = `
.uws-space-picker{display:flex;flex-direction:column;gap:4px;min-width:0}
.uws-space-status,.uws-space-empty,.uws-space-error{color:#8a8a8a;font-size:12px;padding:4px 0}
.uws-space-error{color:#b42318}
.uws-space-row{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:6px 8px;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer;text-align:left;font:inherit}
.uws-space-row:hover,.uws-space-row.uws-space-selected{background:rgb(127 127 127 / 16%)}
.uws-space-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.uws-space-meta{flex:none;color:#8a8a8a;font-size:11px}
`;

const TAG_ID = "dsh-univer-workspace-plugin/styles";

/** Install the capability plugin client styles (idempotent, removed with the plugin). */
export function installStyles(): () => void {
  if (typeof document === "undefined") return () => {};
  if (document.querySelector(`style[data-plugin-css='${TAG_ID}']`) === null) {
    const tag = document.createElement("style");
    tag.dataset.plugin = "dsh-univer-workspace-plugin";
    tag.dataset.pluginCss = TAG_ID;
    tag.textContent = css;
    document.head.appendChild(tag);
  }
  return () => {
    document.querySelector(`style[data-plugin-css='${TAG_ID}']`)?.remove();
  };
}
