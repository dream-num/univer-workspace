import type { LocaleRuntime } from "@deepseek-ai/dsh-client-locale/client";

export type ConnectionNoticeState = "checking" | "changed" | "expired" | "unavailable";

const en = {
  checkingTitle: "Checking connection",
  checkingBody: "This page is paused while the connection is checked.",
  changedTitle: "Account changed",
  changedBody: "This page is paused because the active account changed. Refresh to continue with the current account.",
  expiredTitle: "Sign-in required",
  expiredBody: "Your browser session has expired. Refresh to sign in again.",
  unavailableTitle: "Connection unavailable",
  unavailableBody: "This page is paused. Check the connection and try again.",
  refresh: "Refresh page",
  retry: "Check again",
  waiting: "Please wait…",
};
const zh: Record<keyof typeof en, string> = {
  checkingTitle: "正在检查连接",
  checkingBody: "正在检查连接，当前页面已暂停操作。",
  changedTitle: "账号已切换",
  changedBody: "当前账号已变更，此页面已暂停操作。请刷新以使用当前账号。",
  expiredTitle: "请重新登录",
  expiredBody: "浏览器登录状态已过期，请刷新页面重新登录。",
  unavailableTitle: "连接暂不可用",
  unavailableBody: "当前页面已暂停操作，请检查连接后重试。",
  refresh: "刷新页面",
  retry: "重新检查",
  waiting: "请稍候…",
};

/** A native modal makes the existing page inert, including previously opened portals. */
export function createConnectionNotice(locale: LocaleRuntime, actions: { refresh: () => void; retry: () => void }) {
  const namespace = "workspace-agent.connection";
  const unregisterEn = locale.register(namespace, "en", en);
  const unregisterZh = locale.register(namespace, "zh", zh);
  const t = locale.bind(namespace);
  const style = document.createElement("style");
  style.textContent = `
    dialog[data-workspace-connection-notice] { width: min(420px, calc(100vw - 48px)); box-sizing: border-box; padding: 28px; border: 1px solid var(--color-border, #e5e7eb); border-radius: 16px; background: var(--color-background, #fff); color: var(--color-foreground, #1d2129); box-shadow: 0 24px 80px #0003; font: 14px/1.6 system-ui, sans-serif; }
    dialog[data-workspace-connection-notice]::backdrop { background: #0006; }
    dialog[data-workspace-connection-notice] h2 { margin: 0 0 12px; font-size: 20px; line-height: 1.4; }
    dialog[data-workspace-connection-notice] p { margin: 0 0 24px; color: var(--color-muted-foreground, #69707e); }
    dialog[data-workspace-connection-notice] button { display: block; margin-left: auto; padding: 9px 18px; border: 0; border-radius: 8px; background: #2563eb; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
    dialog[data-workspace-connection-notice] button:disabled { opacity: .55; cursor: wait; }
    dialog[data-workspace-connection-notice] button:focus-visible { outline: 3px solid #93c5fd; outline-offset: 3px; }
  `;
  const dialog = document.createElement("dialog");
  dialog.dataset.workspaceConnectionNotice = "";
  dialog.setAttribute("aria-labelledby", "workspace-connection-title");
  dialog.setAttribute("aria-describedby", "workspace-connection-body");
  dialog.tabIndex = -1;
  const title = document.createElement("h2");
  title.id = "workspace-connection-title";
  const body = document.createElement("p");
  body.id = "workspace-connection-body";
  const button = document.createElement("button");
  button.type = "button";
  dialog.append(title, body, button);
  document.head.append(style);
  document.body.append(dialog);
  let state: ConnectionNoticeState | undefined;
  const render = () => {
    if (state === undefined) return;
    title.textContent = t(`${state}Title`);
    body.textContent = t(`${state}Body`);
    button.textContent = t(state === "checking" ? "waiting" : state === "unavailable" ? "retry" : "refresh");
    button.disabled = state === "checking";
  };
  button.addEventListener("click", () => {
    if (state === "unavailable") actions.retry();
    else if (state === "changed" || state === "expired") actions.refresh();
  });
  dialog.addEventListener("cancel", event => event.preventDefault());
  // Keep dialog keyboard interactions out of the underlying application's shortcuts.
  dialog.addEventListener("keydown", event => {
    event.stopPropagation();
    if (event.key === "Tab") {
      event.preventDefault();
      (button.disabled ? dialog : button).focus();
    }
  });
  dialog.addEventListener("keyup", event => event.stopPropagation());
  const unsubscribeLocale = locale.subscribe(render);
  return {
    show(next: ConnectionNoticeState | undefined) {
      const previous = state;
      state = next;
      if (state === undefined) { if (dialog.open) dialog.close(); return; }
      render();
      if (!dialog.open) dialog.showModal();
      if (state !== previous) (button.disabled ? dialog : button).focus();
    },
    dispose() {
      unsubscribeLocale();
      unregisterZh();
      unregisterEn();
      if (dialog.open) dialog.close();
      dialog.remove();
      style.remove();
    },
  };
}
