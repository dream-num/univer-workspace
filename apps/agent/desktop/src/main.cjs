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
      if (!quitting) dialog.showErrorBox("Unable to start Workspace Agent", error.message);
      app.quit();
    });
}

async function start() {
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
  await window.loadURL(
    'data:text/html,<title>Univer Workspace Agent</title><body style="font:16px system-ui;padding:48px">Setting up Workspace Agent…<p>The first launch or an update can take a few minutes.</p></body>',
  );
  window.show();
  await installRuntime(resources, runtime);
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
  started = true;
  await window.loadURL(address);
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
