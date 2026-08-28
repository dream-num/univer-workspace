import css from "./styles.css";

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
