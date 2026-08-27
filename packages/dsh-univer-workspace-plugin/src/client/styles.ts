/**
 * The capability plugin's client styles: space picker, Turn-tail document
 * card, and the floating viewer window chrome (drag/resize/maximize), styled
 * after the dsh-univer-office window.
 */
const css = `
.uws-space-picker{display:flex;flex-direction:column;gap:4px;min-width:0}
.uws-space-status,.uws-space-empty,.uws-space-error{color:#8a8a8a;font-size:12px;padding:4px 0}
.uws-space-error{color:#b42318}
.uws-space-row{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:6px 8px;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer;text-align:left;font:inherit}
.uws-space-row:hover,.uws-space-row.uws-space-selected{background:rgb(127 127 127 / 16%)}
.uws-space-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.uws-space-meta{flex:none;color:#8a8a8a;font-size:11px}

/* ── Turn-tail document card ─────────────────────────────────────────── */
.uws-turn-card{display:flex;flex-direction:column;gap:6px;margin:6px 0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,#0000001a);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff);font-size:12px}
.uws-turn-cardTitle{font-weight:600;color:#8a8a8a;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.uws-turn-cardList{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.uws-turn-cardRow{display:flex;align-items:center;gap:8px;min-width:0}
.uws-turn-chip{flex:none;padding:1px 8px;border-radius:999px;background:rgb(127 127 127 / 14%);font-size:11px;text-transform:uppercase}
.uws-turn-cardName{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.uws-turn-cardMode{flex:none;color:#8a8a8a;font-size:11px}
.uws-turn-cardOpen{flex:none;padding:3px 10px;border:1px solid var(--dsw-alias-border-l2,#d0d0d0);border-radius:6px;background:transparent;color:inherit;cursor:pointer;font:inherit;font-size:12px}
.uws-turn-cardOpen:hover{background:rgb(127 127 127 / 12%)}

/* ── Floating viewer window ──────────────────────────────────────────── */
.uws-viewer-dock{position:fixed;inset:0;z-index:1000;pointer-events:none}
.uws-viewer-window{pointer-events:auto;display:flex;flex-direction:column;position:fixed;border:1px solid var(--dsw-alias-border-l2,#0000001a);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 8px 30px rgb(0 0 0 / 24%);overflow:hidden;min-width:320px;min-height:220px}
.uws-viewer-window[data-interaction]{user-select:none}
.uws-viewer-window-max{border-radius:0}
.uws-viewer-header{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,#0000000a);cursor:grab;touch-action:none}
.uws-viewer-window[data-interaction="move"] .uws-viewer-header{cursor:grabbing}
.uws-viewer-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;font-size:13px}
.uws-viewer-meta{flex:none;color:#8a8a8a;font-size:11px}
.uws-viewer-controls{flex:none;display:flex;gap:2px}
.uws-viewer-control{width:24px;height:24px;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer;font-size:13px;line-height:1}
.uws-viewer-control:hover{background:rgb(127 127 127 / 16%)}
.uws-viewer-controlDanger:hover{background:#b4231822;color:#b42318}
.uws-viewer-body{flex:1;min-height:0}
.uws-viewer-editor{position:relative;width:100%;height:100%}
.uws-viewer-container{position:absolute;inset:0}
.uws-viewer-error{position:absolute;inset:0;display:grid;place-items:center;color:#b42318;font-size:13px}

/* Resize handles: thin edge strips and corner squares. */
.uws-resizeHandle{position:absolute;z-index:2;touch-action:none}
.uws-resize_n,.uws-resize_s{left:8px;right:8px;height:6px;cursor:ns-resize}
.uws-resize_n{top:-3px}.uws-resize_s{bottom:-3px}
.uws-resize_w,.uws-resize_e{top:8px;bottom:8px;width:6px;cursor:ew-resize}
.uws-resize_w{left:-3px}.uws-resize_e{right:-3px}
.uws-resize_nw,.uws-resize_ne,.uws-resize_sw,.uws-resize_se{width:12px;height:12px}
.uws-resize_nw{top:-4px;left:-4px;cursor:nwse-resize}
.uws-resize_ne{top:-4px;right:-4px;cursor:nesw-resize}
.uws-resize_sw{bottom:-4px;left:-4px;cursor:nesw-resize}
.uws-resize_se{bottom:-4px;right:-4px;cursor:nwse-resize}
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
