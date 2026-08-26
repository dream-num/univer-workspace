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
.uws-viewer-dock{display:flex;flex-direction:column;gap:8px;position:fixed;right:16px;bottom:16px;z-index:1000;max-width:720px}
.uws-viewer-window{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2,#0000001a);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 8px 30px rgb(0 0 0 / 20%);overflow:hidden;width:520px;max-width:calc(100vw - 32px)}
.uws-viewer-header{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,#0000000a)}
.uws-viewer-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;font-size:13px}
.uws-viewer-meta{flex:none;color:#8a8a8a;font-size:11px}
.uws-viewer-close{flex:none;width:24px;height:24px;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer;font-size:16px;line-height:1}
.uws-viewer-close:hover{background:rgb(127 127 127 / 16%)}
.uws-viewer-body{height:380px;min-height:0}
.uws-viewer-editor{position:relative;width:100%;height:100%}
.uws-viewer-container{position:absolute;inset:0}
.uws-viewer-error{position:absolute;inset:0;display:grid;place-items:center;color:#b42318;font-size:13px}
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
