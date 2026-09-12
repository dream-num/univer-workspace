const { app, BrowserWindow, Menu, dialog, shell, net } = require("electron");
const { createUpdateChecker } = require("./updates.cjs");
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
const { installRuntime, assertPortAvailable, stopBackend } = require("./runtime.cjs");

let startupLog;
let window,
  backend,
  quitting = false,
  release;
const origin = localOrigin();
app.setName("Univer Workspace Agent");
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
    quitting = true;
    void stopBackend(backend).finally(() => app.quit());
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
  const runtime = join(userData, "runtime");
  const data = join(userData, "data");
  const workspace = join(userData, "workspace");
  await mkdir(data, { recursive: true });
  await mkdir(workspace, { recursive: true });
  window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 600,
    title: "Univer Workspace Agent",
    show: false,
    webPreferences: {
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
    <p id="detail" style="color:#64748b">Preparing files for the first launch.</p>
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
  await installRuntime(resources, runtime, report);
  report({ phase: "backend" });
  const bin = join(runtime, "node", "bin");
  const node = join(bin, process.platform === "win32" ? "node.exe" : "node");
  const env = {
    ...process.env,
    NODE_ENV: "production",
    UWA_DESKTOP: "1",
    UWH_BIND_HOST: "127.0.0.1",
    UWH_MODEL_SETTINGS_ENABLED: "true",
    DSH_HOME: join(runtime, "home"),
    UWH_DSH_DATA_HOME: data,
    DSH_BIN: join(runtime, "bootstrap", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
    UWH_PUBLIC_ORIGIN: origin,
    UWH_PUBLIC_HOST: "127.0.0.1",
    UWH_RENDER_PAGE_ROOT: join(runtime, "render-runtime"),
    UWH_RENDER_BROWSER: join(runtime, release.browser),
    AGENT_BROWSER_EXECUTABLE_PATH: join(runtime, release.browser),
    PATH: `${bin}${delimiter}${join(runtime, "bootstrap", "node_modules", ".bin")}${delimiter}${process.env.PATH || ""}`,
  };
  // Electron switches and inherited Node injection must not alter the standalone host.
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
  started = true;
  await window.loadURL(address);
  startupLog.write({ phase: "ready" });
  const checkUpdates = createUpdateChecker({
    app,
    autoUpdater,
    dialog,
    net,
    window,
    updatesEnabled: release.updatesEnabled,
    beforeInstall: async () => {
      await stopBackend(backend);
      quitting = true;
    },
  });
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
