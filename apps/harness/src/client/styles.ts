/**
 * Injected client styles for the harness sidebar list and origin setting.
 *
 * Deliberately self-contained and neutral: out-of-tree, so it does not assume
 * the dsh theme's `--dsw-*` token set. The skin plugin owns the branded
 * look; these rules only need to read acceptably on both light and dark.
 */
const css = `
.uwh-root{display:flex;flex-direction:column;gap:8px;padding:12px 8px;height:100%;min-height:0;overflow:auto;font-size:13px}
.uwh-collapsedButton{align-self:center;width:36px;height:36px;padding:0;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer;font:inherit}
.uwh-collapsedButton:hover{background:rgb(127 127 127 / 16%)}
.uwh-header{display:flex;align-items:center;gap:8px}
.uwh-title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uwh-adminBadge{flex:none;padding:1px 6px;border-radius:999px;font-size:11px;color:#fff;background:#b25d00}
.uwh-workspaceLine{display:flex;align-items:center;gap:6px;min-width:0}
.uwh-workspaceLabel{flex:none;color:#8a8a8a}
.uwh-workspacePath{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:#6c6c6c}
.uwh-banner,.uwh-error{padding:6px 8px;border-radius:4px;font-size:12px}
.uwh-banner{color:#0b5cad;background:#e7f1fb}
.uwh-error{color:#b42318;background:#fdecea}
.uwh-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.uwh-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border-radius:4px}
.uwh-row:hover{background:#f2f2f2}
.uwh-sessionRow{display:flex;align-items:center;width:100%;min-width:0;gap:8px;padding:6px 8px;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer;text-align:left;font:inherit}
.uwh-sessionRow:hover,.uwh-sessionRow.uwh-selected{background:rgb(127 127 127 / 16%)}
.uwh-sessionRow:disabled{cursor:default;opacity:0.5}
.uwh-sessionStatus{flex:none;width:6px;height:6px;border-radius:50%;background:#8a8a8a}
.uwh-rowButton{padding:5px 10px;border:1px solid #d0d0d0;border-radius:4px;background:transparent;color:inherit;cursor:pointer;font:inherit}
.uwh-rowButton:disabled{opacity:0.5;cursor:default}
.uwh-rowMain{display:flex;flex-direction:column;gap:2px;min-width:0}
.uwh-rowTitle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uwh-rowDesc{font-size:11px;color:#8a8a8a}
.uwh-empty{color:#8a8a8a;padding:8px 0}
.uwh-status{color:#8a8a8a;padding:8px 0}
.uwh-originSetting{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0}
.uwh-originHint{display:block;margin-top:2px;color:#8a8a8a;font-size:11px}
.uwh-originValue{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:240px;font-size:12px;color:#6c6c6c}
.uwh-originError{display:block;max-width:280px;margin-top:4px;color:#b00020;font-size:11px}
`;

const TAG_ID = "univer-workspace-harness/styles";

/** Install the harness client styles once (idempotent, removed with the plugin). */
export function installStyles(): () => void {
  if (typeof document === "undefined") return () => {};
  if (document.querySelector(`style[data-plugin-css='${TAG_ID}']`) === null) {
    const tag = document.createElement("style");
    tag.dataset.plugin = "univer-workspace-harness";
    tag.dataset.pluginCss = TAG_ID;
    tag.textContent = css;
    document.head.appendChild(tag);
  }
  return () => {
    document.querySelector(`style[data-plugin-css='${TAG_ID}']`)?.remove();
  };
}
