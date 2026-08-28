import baseCss from "./styles/workspace.css";
import tokensCss from "./styles/tokens.css";
import viewerCss from "./styles/viewer.css";

// Keep the injected stylesheet composable like dsh-univer-office: product
// chrome, design tokens, and embedded-viewer rules can evolve independently
// while the host still installs one idempotent tag.
const css = [tokensCss, baseCss, viewerCss].join("\n");

const TAG_ID = "dsh-univer-workspace-plugin/styles";

/** Install the capability plugin client stylesheet (idempotent and reversible). */
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
