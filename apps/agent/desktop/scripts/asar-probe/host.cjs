const { app, BrowserWindow, session, utilityProcess } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

const settings = JSON.parse(fs.readFileSync(path.join(__dirname, 'probe.json'), 'utf8'));
const runtime = settings.runtime;
const run = path.join(__dirname, `run-${Date.now()}`);
fs.mkdirSync(run);
app.setPath('userData', path.join(run, 'electron'));
app.commandLine.appendSwitch('disk-cache-size', String(512 * 1024 * 1024));
app.commandLine.appendSwitch('lang', 'en-US');
let child;
let stopping = false;
let diagnostics = '';
const report = { run };
const save = () => fs.writeFileSync(path.join(__dirname, 'host-result.json'), JSON.stringify(report, null, 2));
const fail = (error) => {
  report.error = error.message;
  report.diagnostics = diagnostics.replace(/token=[^\s"']+/g, 'token=[redacted]');
  save();
  child?.kill();
  app.exit(1);
};

app.on('before-quit', (event) => {
  if (!child || stopping) return;
  event.preventDefault();
  stopping = true;
  const start = Date.now();
  const timer = setTimeout(() => {
    report.forcedStop = true;
    save();
    child.kill();
    app.exit(1);
  }, 10000);
  child.once('exit', (code) => {
    clearTimeout(timer);
    report.serviceExitCode = code;
    report.stopMs = Date.now() - start;
    save();
    app.exit(code === 0 ? 0 : 1);
  });
  child.postMessage({ type: 'stop' });
});

app.whenReady().then(async () => {
  const cache = await require('./browser-cache.cjs').prepareBrowserCache(runtime, app.getPath('userData'), process.versions.electron);
  if (cache) session.defaultSession.setCodeCachePath(cache);
  for (const directory of ['home', 'data', 'workspace']) fs.mkdirSync(path.join(run, directory));
  const port = await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
  const origin = `http://127.0.0.1:${port}`;
  const release = JSON.parse(fs.readFileSync(path.join(runtime, 'release.json'), 'utf8'));
  const env = {
    ...process.env, NODE_ENV: 'production', UWA_DESKTOP: '1',
    DSH_HOME: path.join(run, 'home'), UWH_DSH_DATA_HOME: path.join(run, 'data'),
    UWA_DESKTOP_CLIENT_ROOT: path.join(runtime, 'desktop-client'),
    UWH_BIND_HOST: '127.0.0.1', UWH_PUBLIC_HOST: '127.0.0.1', UWH_PUBLIC_ORIGIN: origin,
    UWH_MODEL_SETTINGS_ENABLED: 'true', UWH_RENDER_PAGE_ROOT: path.join(runtime, 'render-runtime'),
    UWH_RENDER_BROWSER: path.join(runtime, release.browser),
  };
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', 'DSH_PROFILE',
    'UWH_CONNECTION_STATE_PATH', 'UWH_SHARED_SETTINGS_PATH', 'UWH_SHARED_CREDENTIALS_PATH', 'UWH_WORKSPACE_ORIGIN']) delete env[key];
  const window = new BrowserWindow({ width: 1440, height: 960, title: 'ASAR prototype', show: true, webPreferences: {
    nodeIntegration: false, contextIsolation: true, sandbox: true,
  } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const start = Date.now();
  child = utilityProcess.fork(path.join(__dirname, 'service.cjs'),
    ['--port', String(port), '--no-open', '--trusted-host', '127.0.0.1'],
    { cwd: path.join(run, 'workspace'), env, stdio: 'pipe' });
  child.stderr.on('data', (bytes) => { diagnostics = (diagnostics + bytes).slice(-16000); });
  child.stdout.on('data', () => {});
  const timer = setTimeout(() => fail(new Error('DSH readiness timed out')), 60000);
  child.on('exit', (code) => {
    clearTimeout(timer);
    if (!stopping) fail(new Error(`DSH exited unexpectedly: ${code}`));
  });
  child.on('message', (message) => {
    if (message?.type !== 'uwh-desktop-ready') return;
    clearTimeout(timer);
    report.serviceReadyMs = Date.now() - start;
    try {
      if (new URL(message.url).origin !== origin) throw new Error('Unexpected readiness origin');
      void window.loadURL(message.url).then(() => {
        report.pageReadyMs = Date.now() - start;
        save();
      }).catch(fail);
    } catch (error) { fail(error); }
  });
}).catch(fail);
