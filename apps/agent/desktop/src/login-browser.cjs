const { randomUUID } = require('node:crypto');
const { SCHEME } = require('./login.cjs');
const { isWebUrl, isLocalUrl } = require('./policy.cjs');

/** Prefer the OS browser; use a fresh, unprivileged session only if launch fails. */
function createLoginBrowser({ BrowserWindow, shell, mainWindow, origin, accept, failed, zh = false }) {
  let popup;
  const close = () => { if (popup && !popup.isDestroyed()) popup.close(); popup = undefined; };
  return {
    close,
    async open(authorizationUrl) {
      close();
      try { await shell.openExternal(authorizationUrl); return; }
      catch { /* No registered browser, or the OS browser launch failed. */ }
      const window = new BrowserWindow({
        parent: mainWindow, width: 1000, height: 760, autoHideMenuBar: true,
        title: zh ? 'Workspace 登录 — 内置浏览器（部分 OAuth 登录可能不可用）'
          : 'Workspace sign-in — Built-in browser (some OAuth providers may be unavailable)',
        webPreferences: {
          // Non-persistent, new for every attempt: neither old account cookies
          // nor the privileged local app cookie/preload enter this browser.
          partition: `uwa-login-${randomUUID()}`,
          nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
        },
      });
      popup = window;
      window.setMenu(null);
      window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      window.webContents.on('will-attach-webview', event => event.preventDefault());
      window.webContents.on('page-title-updated', event => event.preventDefault());
      let returned = false;
      const intercept = url => {
        let callback;
        if (isLocalUrl(url, origin) && new URL(url).pathname === '/auth/oauth/callback') {
          // Intercept the exact loopback return directly. Fallback must work
          // even when the OS custom-protocol handler is unavailable as well.
          callback = `${SCHEME}://login#${new URL(url).searchParams.toString()}`;
        } else if (url.startsWith(`${SCHEME}:`)) callback = url;
        if (!callback) return false;
        if (!returned) {
          returned = true;
          window.close();
          accept(callback); // The shared controller validates state and PKCE.
        }
        return true;
      };
      const navigate = (event, url) => {
        if (intercept(url) || !isWebUrl(url)) event.preventDefault();
      };
      window.webContents.on('will-navigate', navigate);
      window.webContents.on('will-redirect', navigate);
      const load = url => {
        void window.loadURL(url).catch(() => {
          if (returned || window.isDestroyed()) return;
          window.close();
          failed(new Error('workspace_login_failed'));
        });
      };
      window.webContents.setWindowOpenHandler(({ url }) => {
        // Keep provider popups in the same sandbox and cookie session.
        if (!intercept(url) && isWebUrl(url)) setImmediate(() => {
          if (!window.isDestroyed()) load(url);
        });
        return { action: 'deny' };
      });
      const browserSession = window.webContents.session;
      window.once('closed', () => {
        if (popup === window) popup = undefined;
        void browserSession.clearStorageData().catch(() => {});
      });
      load(authorizationUrl);
    },
  };
}
module.exports = { createLoginBrowser };
