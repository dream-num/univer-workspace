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
const { SCHEME, createLoginController } = require("./login.cjs");
let loginController;
let pendingLoginUrl = process.argv.find(value => value.startsWith(`${SCHEME}://`));
const focus = () => { window?.restore(); window?.show(); window?.focus(); };
function reportLoginError(error) {
  const zh = app.getLocale().startsWith("zh");
  const message = error.message === "workspace_login_cancelled"
    ? zh ? "授权已取消。可以重新登录，并在浏览器里切换账号。" : "Authorization was cancelled. Sign in again or switch accounts in your browser."
    : error.message === "workspace_login_expired" || error.message === "workspace_login_invalid"
      ? zh ? "登录请求已过期或无效，请在应用中重新点击登录。" : "This sign-in request has expired or is invalid. Start sign-in again in the app."
      : zh ? "未能完成登录，请检查网络后重试。你可以在默认浏览器里退出或切换账号。" : "Unable to finish signing in. Check your connection and try again. You can sign out or switch accounts in your default browser.";
  dialog.showErrorBox(zh ? "Workspace 登录" : "Workspace sign-in", message);
}
function acceptLoginUrl(url) {
  if (!loginController) { pendingLoginUrl = url; return; }
  focus();
  void loginController.accept(url).catch(reportLoginError);
}
app.on("open-url", (event, url) => { event.preventDefault(); acceptLoginUrl(url); });
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
  app.on("second-instance", (_event, argv) => {
    const callback = argv.find(value => value.startsWith(`${SCHEME}://`));
    if (callback) acceptLoginUrl(callback);
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
      void loginController?.start().catch(reportLoginError);
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
  const profileRuntime = await require('./profile-runtime.cjs').selectProfileRuntime(resources, runtimeHome);
  let dshHome = runtimeHome;
  if (quitting) return;
  report({ phase: "backend" });
  const bin = join(runtime, "node", "bin");
  const node = profileRuntime.archived ? process.execPath : join(bin, process.platform === 'win32' ? 'node.exe' : 'node');
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
  if (profileRuntime.archived) env.ELECTRON_RUN_AS_NODE = "1";
  else {
    delete env.UWA_DESKTOP_HOST;
    env.DSH_BIN = profileRuntime.dsh;
  }
  backend = spawn(
    node,
    [
      join(runtime, "start-local.mjs"),
      ...(profileRuntime.archived ? [] : ['--patch', profileRuntime.patch]),
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
  backend.on("message", message => {
    if (message?.type === "uwh-desktop-runtime" && typeof message.home === "string") dshHome = message.home;
  });
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
  const loginBrowser = require("./login-browser.cjs").createLoginBrowser({
    BrowserWindow, shell, mainWindow: window, origin, accept: acceptLoginUrl,
    failed: reportLoginError, zh: app.getLocale().startsWith("zh"),
  });
  loginController = createLoginController({ origin, fetch: optionsFetch,
    openExternal: loginBrowser.open, connected: async () => { loginBrowser.close(); focus(); await window.loadURL(origin); } });
  ipcMain.handle("uwa:login", event => {
    if (!require("./update-window.cjs").trustedFrame(event, window.webContents, url => isLocalUrl(url, origin)))
      throw new Error("Untrusted login caller");
    return loginController.start();
  });
  await window.loadURL(address);
  startupLog.write({ phase: "ready" });
  if (app.isPackaged) {
    try { await require("./protocol.cjs").registerLoginProtocol(app); }
    catch { startupLog.write({ phase: "login-protocol-registration-failed" }); }
  }
  if (pendingLoginUrl) { const url = pendingLoginUrl; pendingLoginUrl = undefined; acceptLoginUrl(url); }
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
    getDshHome: () => dshHome,
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

function optionsFetch(url, options) { return session.defaultSession.fetch(url, options); }
