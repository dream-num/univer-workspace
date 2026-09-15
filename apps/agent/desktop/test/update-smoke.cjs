// Real Electron fixture: no existing profile, external service, or installation.
const { app, BrowserWindow, ipcMain, shell, net } = require('electron');
const { createServer } = require('node:http');
const { createHash, randomBytes } = require('node:crypto');
const { mkdtemp, writeFile, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const { downloadResumable } = require('../src/update-download.cjs');
const { serveUpdate } = require('../src/update-feed.cjs');
const { createUpdateWindow } = require('../src/update-window.cjs');

app.whenReady().then(async () => {
  const root = await mkdtemp(join(app.commandLine.getSwitchValue('user-data-dir') || tmpdir(), 'uwa-update-electron-'));
  app.setPath('userData', root);
  process.env.XDG_CACHE_HOME = root;
  let assetServer, feed;
  try {
    const body = randomBytes(256 * 1024);
    const requests = [];
    assetServer = createServer((req, res) => {
      const start = Number(/^bytes=(\d+)-/.exec(req.headers.range)?.[1] ?? 0);
      requests.push(start);
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${body.length - 1}/${body.length}` });
      if (requests.length === 1) {
        res.write(body.subarray(0, 65536)); setTimeout(() => res.destroy(), 100);
      } else res.end(body.subarray(start));
    });
    await new Promise(resolve => assetServer.listen(0, '127.0.0.1', resolve));
    const file = { url: `http://127.0.0.1:${assetServer.address().port}/Agent.AppImage`,
      sha512: createHash('sha512').update(body).digest('base64'), size: body.length };
    const path = await downloadResumable({ ...file, directory: join(root, 'parts'),
      fetch: net.fetch.bind(net), retryDelays: [1] });
    assert.equal(requests[1], 65536);
    assert.deepEqual(await readFile(path), body);
    // Exercise the public generic provider and actual checksum/cache/staging in
    // electron-updater, not a fake downloader. Never call quitAndInstall here.
    process.env.APPIMAGE = join(root, 'current.AppImage');
    await writeFile(process.env.APPIMAGE, 'fixture');
    const { AppImageUpdater } = require('electron-updater');
    const updater = new AppImageUpdater();
    updater.logger = null;
    updater.forceDevUpdateConfig = true;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.disableDifferentialDownload = true;
    const config = join(root, 'update.yml');
    await writeFile(config, JSON.stringify({ updaterCacheDirName: 'fixture-cache' }));
    updater.updateConfigPath = config;
    feed = await serveUpdate({ path, file, version: '99.0.0', channel: 'latest', platform: 'linux' });
    updater.setFeedURL({ provider: 'generic', url: feed.url, channel: 'latest' });
    const result = await updater.checkForUpdates();
    assert.equal(result.isUpdateAvailable, true);
    const [staged] = await updater.downloadUpdate();
    assert.deepEqual(await readFile(staged), body);
    console.log('Real Electron resume and electron-updater generic handoff passed.');
    await feed.close(); feed = undefined;
    assetServer.closeAllConnections(); await new Promise(resolve => assetServer.close(resolve)); assetServer = undefined;

    // Browser/preload fixture for the real native update page and IPC guards.
    const mainWindow = new BrowserWindow({ show: false, webPreferences: {
      preload: join(__dirname, '../src/desktop-preload.cjs'), sandbox: true, contextIsolation: true,
    } });
    const ui = createUpdateWindow({ BrowserWindow, ipcMain, shell, mainWindow, origin: 'http://127.0.0.1:3101' });
    let state = { phase: 'available', currentVersion: '0.1.0-alpha.8', version: '0.1.0-alpha.9', notes: '<img src=x onerror=alert(1)> Release notes are plain text.' };
    const set = patch => { state = { ...state, ...patch }; ui.changed(state); };
    const controller = { getState: () => state, check: () => {},
      download: () => set({ phase: 'downloading', percent: 42, transferred: 42 * 1024 * 1024, total: 100 * 1024 * 1024, bytesPerSecond: 1024 * 1024 }),
      pause: () => set({ phase: 'paused' }), install: () => { throw Error('Test must not install'); } };
    ui.attach(controller);
    globalThis.updateSmoke = { set, show: ui.show };
    ui.show();
    app.once('will-quit', () => { void rm(root, { recursive: true, force: true }); });
  } catch (error) {
    console.error(error);
    if (feed) await feed.close();
    assetServer?.closeAllConnections(); assetServer?.close();
    await rm(root, { recursive: true, force: true });
    app.exit(1);
  }
});
