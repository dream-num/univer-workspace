const { app, BrowserWindow, Menu, dialog, shell, net, session, ipcMain } = require("electron");
const { createUpdateController } = require("./updates.cjs");
const { autoUpdater } = require("electron-updater");
const { spawn } = require("node:child_process");
const { readFile, mkdir } = require("node:fs/promises");
const { join, delimiter } = require("node:path");
const {
  REPOSITORY,
  DEFAULT_PORT,
  localOrigin,
  isLocalUrl,
  isWebUrl,
  readyUrl,
} = require("./policy.cjs");
const { assertPortAvailable, stopBackend } = require("./runtime.cjs");

const { prepareRuntimeHome } = require("./runtime-home.cjs");
let startupLog;
let stopping;
function stopService() {
  quitting = true;
  return stopping ??= stopBackend(backend);
}
let window,
  backend,
  quitting = false,
  release;
const origin = localOrigin();
app.setName("Univer Workspace Agent");
// Electron 44's default Windows cache drops our ~45 MB browser entry between
// launches. A native repeat-launch probe retains it with this capacity. Apply
// before session creation in both build-time warmup and the installed app.
if (process.platform === 'win32') app.commandLine.appendSwitch('disk-cache-size', String(512 * 1024 * 1024));
// Keep Electron profile and application data together when an explicit profile
// directory is requested (also used by installed-application smoke tests).
const profileDirectory = app.commandLine.getSwitchValue("user-data-dir");
if (profileDirectory) app.setPath("userData", require("node:path").resolve(profileDirectory));
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    window?.restore();
    window?.show();
    window?.focus();
  });
  app.on("activate", () => {
    window?.show();
    window?.focus();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    void stopService().catch((error) => startupLog?.write({ phase: "shutdown-failed", error: error.message })).finally(() => app.exit());
  });
  void app
    .whenReady()
    .then(start)
    .catch((error) => {
      startupLog?.write({ phase: "fatal", error: error.message, stack: error.stack });
      if (!quitting) dialog.showErrorBox("Unable to start Workspace Agent",
        `${error.message}\n\nStartup log: ${startupLog?.path ?? "unavailable"}`);
      app.quit();
    });
}

async function start() {
  startupLog = require("./startup-log.cjs").createStartupLog(join(app.getPath("userData"), "logs"));
  startupLog.write({ phase: "start", version: app.getVersion(), platform: process.platform, arch: process.arch });
  const resources = app.isPackaged
    ? join(process.resourcesPath, "runtime")
    : join(__dirname, "..", ".build", "runtime");
  release = JSON.parse(await readFile(join(resources, "release.json"), "utf8"));
  if (release.platform !== process.platform || release.arch !== process.arch)
    throw new Error("This installer does not match this computer.");
  await assertPortAvailable(DEFAULT_PORT);
  const userData = app.getPath("userData");
  const runtime = resources;
  const data = join(userData, "data");
  const workspace = join(userData, "workspace");
  await mkdir(data, { recursive: true });
  await mkdir(workspace, { recursive: true });
  const browserCache = await require('./browser-cache.cjs').prepareBrowserCache(resources, userData, process.versions.electron);
  if (browserCache) session.defaultSession.setCodeCachePath(browserCache);
  window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 600,
    title: "Univer Workspace Agent",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "desktop-preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url) && !isLocalUrl(url, origin)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.on("will-navigate", (event, url) => {
    if (isLocalUrl(url, origin) && new URL(url).pathname === "/auth/oauth/start") {
      event.preventDefault();
      void login();
    } else if (!isLocalUrl(url, origin)) {
      event.preventDefault();
      if (isWebUrl(url)) void shell.openExternal(url);
    }
  });
  window.webContents.on("will-redirect", (event, url) => {
    if (!isLocalUrl(url, origin)) event.preventDefault();
  });
  const html = `<meta charset="utf-8"><title>Workspace Agent</title>
    <body style="font:16px system-ui;background:#f8fafc;color:#172033;margin:0;display:grid;place-items:center;height:100vh">
    <main style="width:480px"><h1 style="font-size:24px">Starting Workspace Agent</h1>
    <p id="stage">Preparing your workspace</p><progress id="progress" style="width:100%"></progress>
    <p id="detail" style="color:#64748b">Starting your local workspace.</p>
    <p>You can find startup details in Help → Open startup logs.</p></main></body>`;
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  window.show();
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: "Help", submenu: [{
    label: "Open startup logs", click: () => shell.showItemInFolder(startupLog.path),
  }] }]));
  let last = 0, lastPhase;
  const report = (event) => {
    if (event.phase === lastPhase && Date.now() - last < 500) return;
    last = Date.now(); lastPhase = event.phase;
    startupLog.write(event);
    const labels = { cleanup: "Preparing installation", copy: "Copying application files", verify: "Checking application files", activate: "Finishing setup", failed: "Setup failed", backend: "Starting local service" };
    const label = labels[event.phase] ?? event.phase;
    const detail = event.total ? `${event.completed} of ${event.total} files checked` :
      event.completed ? `${event.completed} entries processed` : "Please wait";
    void window.webContents.executeJavaScript(`document.getElementById('stage').textContent=${JSON.stringify(label)};
      document.getElementById('detail').textContent=${JSON.stringify(detail)};
      ${event.total ? `document.getElementById('progress').max=${event.total};document.getElementById('progress').value=${event.completed};` : "document.getElementById('progress').removeAttribute('value');"}`).catch(() => {});
  };
  const runtimeHome = await prepareRuntimeHome(resources, join(userData, "runtime/home"));
  if (quitting) return;
  report({ phase: "backend" });
  const bin = join(runtime, "node", "bin");
  const node = process.execPath;
  const env = {
    ...process.env,
    NODE_ENV: "production",
    UWA_DESKTOP: "1",
    UWA_DESKTOP_CLIENT_ROOT: join(runtime, "desktop-client"),
    UWH_BIND_HOST: "127.0.0.1",
    UWH_MODEL_SETTINGS_ENABLED: "true",
    DSH_HOME: runtimeHome,
    NODE_COMPILE_CACHE: join(userData, "compile-cache"),
    UWH_DSH_DATA_HOME: data,
    UWA_DESKTOP_HOST: join(runtime, "dsh-host.cjs"),
    UWH_PUBLIC_ORIGIN: origin,
    UWH_PUBLIC_HOST: "127.0.0.1",
    UWH_RENDER_PAGE_ROOT: join(runtime, "render-runtime"),
    UWH_RENDER_BROWSER: join(runtime, release.browser),
    AGENT_BROWSER_EXECUTABLE_PATH: join(runtime, release.browser),
    PATH: `${bin}${delimiter}${process.env.PATH || ""}`,
  };
  // Clear inherited runtime injection before enabling our Electron Node host.
  for (const key of [
    "ELECTRON_RUN_AS_NODE",
    "NODE_OPTIONS",
    "NODE_TLS_REJECT_UNAUTHORIZED",
    "NODE_PATH",
    "DSH_PROFILE",
    "UWH_CONNECTION_STATE_PATH",
    "UWH_SHARED_SETTINGS_PATH",
    "UWH_SHARED_CREDENTIALS_PATH",
  ])
    delete env[key];
  env.ELECTRON_RUN_AS_NODE = "1";
  backend = spawn(
    node,
    [
      join(runtime, "start-local.mjs"),
      "--port",
      String(DEFAULT_PORT),
      "--no-open",
      "--trusted-host",
      "127.0.0.1",
    ],
    {
      cwd: workspace,
      env,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  let started = false;
  backend.on("exit", () => {
    if (started && !quitting) {
      dialog.showErrorBox(
        "Workspace Agent",
        "The local service stopped. Restart the application to continue.",
      );
      app.quit();
    }
  });
  const address = await new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("The local service did not become ready within two minutes."));
    }, 120000);
    const onMessage = (message) => {
      const url = readyUrl(message, origin);
      if (url) {
        cleanup();
        resolveReady(url);
      }
    };
    const onExit = () => {
      cleanup();
      reject(new Error("The local service exited before startup completed."));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      backend.off("message", onMessage);
      backend.off("exit", onExit);
      backend.off("error", onExit);
    };
    backend.on("message", onMessage);
    backend.once("exit", onExit);
    backend.once("error", onExit);
  });
  startupLog.write({ phase: "backend-ready" });
  if (quitting) return;
  started = true;
  await window.loadURL(address);
  startupLog.write({ phase: "ready" });
  if (app.isPackaged && process.platform === 'win32') {
    void require('./retire-install.cjs').retirePreviousInstallation(
      process.execPath, resources, event => startupLog.write(event),
    ).catch(error => startupLog.write({ phase: 'update-cleanup-failed', error: error.message }));
  }
  const updateWindow = require("./update-window.cjs").createUpdateWindow({
    BrowserWindow, ipcMain, shell, dialog, mainWindow: window, origin,
  });
  let diagnostics;
  const updateController = createUpdateController({
    app,
    autoUpdater,
    net,
    show: updateWindow.show,
    changed: state => { updateWindow.changed(state); diagnostics?.recordUpdate(state); },
    updatesEnabled: release.updatesEnabled,
    beforeInstall: async () => {
      try {
        await stopService();
      } catch (error) {
        quitting = false;
        stopping = undefined;
        throw error;
      }
    },
  });
  diagnostics = require("./diagnostics.cjs").createDiagnostics({
    app, resources, updatesEnabled: release.updatesEnabled, getUpdateState: updateController.getState,
  });
  updateWindow.attach(updateController, diagnostics);
  const checkUpdates = updateController.check;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin"
        ? [{ role: "appMenu" }]
        : [{ label: "File", submenu: [{ role: "quit" }] }]),
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { role: "togglefullscreen" },
        ],
      },
      {
        label: "Help",
        submenu: [
          { label: "Open startup logs", click: () => shell.showItemInFolder(startupLog.path) },
          {
            label: "Check for Updates…",
            click: () => {
              void checkUpdates(true);
            },
          },
          {
            label: "Downloads",
            click: () => {
              void shell.openExternal(`https://github.com/${REPOSITORY}/releases`);
            },
          },
        ],
      },
    ]),
  );
  setTimeout(() => {
    void checkUpdates(false);
  }, 10000).unref();
  setInterval(
    () => {
      void checkUpdates(false);
    },
    6 * 60 * 60 * 1000,
  ).unref();
}

// Keep the main renderer on its local origin. The isolated login window shares
// the local cookie jar and can navigate through Workspace's OAuth providers.
async function login() {
  const popup = new BrowserWindow({
    parent: window,
    width: 1000,
    height: 760,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  popup.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  popup.webContents.on("will-attach-webview", (e) => e.preventDefault());
  const restrict = (event, url) => {
    if (!isWebUrl(url)) event.preventDefault();
  };
  popup.webContents.on("will-navigate", restrict);
  popup.webContents.on("will-redirect", restrict);
  popup.webContents.on("did-navigate", (_event, url) => {
    if (isLocalUrl(url, origin) && new URL(url).pathname === "/") {
      popup.close();
      void window.loadURL(origin);
    }
  });
  await popup.loadURL(`${origin}/auth/oauth/start`).catch(() => {
    if (!popup.isDestroyed()) popup.close();
  });
}
