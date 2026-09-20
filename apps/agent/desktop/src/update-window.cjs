const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { REPOSITORY, isLocalUrl } = require("./policy.cjs");

function trustedFrame(event, contents, allowedUrl) {
  return contents && !contents.isDestroyed() && event.sender === contents &&
    event.senderFrame === contents.mainFrame && allowedUrl(event.senderFrame.url);
}

function createUpdateWindow({ BrowserWindow, ipcMain, shell, dialog, mainWindow, origin }) {
  let window, controller, diagnostics;
  const page = join(__dirname, "update.html");
  const pageUrl = pathToFileURL(page).href;
  const show = () => {
    if (window && !window.isDestroyed()) { window.show(); window.focus(); return; }
    window = new BrowserWindow({ width: 560, height: 620, minWidth: 460, minHeight: 480,
      title: "Workspace Agent — Software update", autoHideMenuBar: true, show: false,
      webPreferences: { preload: join(__dirname, "update-preload.cjs"),
        nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
    window.setMenu(null);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", event => event.preventDefault());
    window.webContents.on("will-redirect", event => event.preventDefault());
    window.webContents.on("will-attach-webview", event => event.preventDefault());
    window.once("ready-to-show", () => window?.show());
    // Closing this window leaves downloads running. The About page reopens the
    // same controller and progress; it never starts a second transfer.
    window.on("closed", () => { window = undefined; });
    void window.loadFile(page);
  };
  ipcMain.handle("uwa:open-updates", event => {
    if (!trustedFrame(event, mainWindow.webContents, url => isLocalUrl(url, origin)))
      throw new Error("Untrusted update caller");
    if (controller) { show(); void controller.check(true); }
  });
  const diagnosticActions = {
    "uwa:devtools": () => mainWindow.webContents.openDevTools({ mode: "detach" }),
    "uwa:diagnostics": () => diagnostics.snapshot(),
    "uwa:diagnostic-directory": id => diagnostics.openDirectory(id, shell),
    "uwa:diagnostic-export": () => diagnostics.exportReport(mainWindow, dialog),
  };
  for (const [name, action] of Object.entries(diagnosticActions)) {
    ipcMain.handle(name, (event, id) => {
      if (!trustedFrame(event, mainWindow.webContents, url => isLocalUrl(url, origin)))
        throw new Error("Untrusted diagnostic caller");
      return action(id);
    });
  }
  const actions = {
    state: () => controller.getState(), check: () => { void controller.check(true); },
    download: () => { void controller.download(); }, pause: () => controller.pause(),
    install: () => { void controller.install(); },
    releases: () => shell.openExternal(`https://github.com/${REPOSITORY}/releases`),
  };
  for (const [name, action] of Object.entries(actions)) {
    ipcMain.handle(`uwa:update-${name}`, event => {
      if (!trustedFrame(event, window?.webContents, url => url === pageUrl))
        throw new Error("Untrusted update caller");
      return action();
    });
  }
  return { show, attach: (value, diagnosticService) => { controller = value; diagnostics = diagnosticService; },
    changed: state => {
      if (window && !window.isDestroyed()) window.webContents.send("uwa:update-state", state);
      const busy = ["checking", "verifying", "staging", "installing"].includes(state.phase);
      const progress = ["downloading", "retrying"].includes(state.phase) ? (state.percent ?? 0) / 100 : busy ? 2 : -1;
      if (!mainWindow.isDestroyed()) mainWindow.setProgressBar(progress);
      window?.setProgressBar(progress);
    },
  };
}
module.exports = { createUpdateWindow, trustedFrame };
