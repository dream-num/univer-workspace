import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../src/main.cjs', import.meta.url), 'utf8');
async function fixture({ pauseHome = false } = {}) {
  const errors = [];
  const child = new EventEmitter();
  let update, spawnCount = 0, quitCount = 0, releaseHome;
  const homeReady = pauseHome ? new Promise(resolve => { releaseHome = resolve; }) : Promise.resolve('/user/runtime/home');
  const app = Object.assign(new EventEmitter(), {
    setName() {}, requestSingleInstanceLock: () => true,
    commandLine: { getSwitchValue: () => '', appendSwitch() {} }, getPath: () => '/user',
    getVersion: () => '0.1.0', whenReady: () => Promise.resolve(),
    quit() { quitCount++; }, exit() { quitCount++; },
  });
  const webContents = Object.assign(new EventEmitter(), {
    session: { setPermissionRequestHandler() {} }, setWindowOpenHandler() {},
    executeJavaScript: async () => {},
  });
  class BrowserWindow {
    webContents = webContents;
    loadURL = async () => {};
    show() {}
  }
  const modules = {
    electron: { app, BrowserWindow, Menu: { setApplicationMenu() {}, buildFromTemplate: x => x },
      dialog: { showErrorBox: (...args) => errors.push(args) }, shell: {}, net: {} },
    'electron-updater': { autoUpdater: {} },
    'node:fs/promises': { mkdir: async () => {}, readFile: async () => JSON.stringify({ platform: process.platform, arch: process.arch, browser: "browser/chrome" }) },
    'node:child_process': { spawn() {
      spawnCount++;
      setImmediate(() => child.emit('message', { type: 'uwh-desktop-ready', url: 'http://127.0.0.1:3101/?token=test' }));
      return child;
    } },
    './runtime.cjs': { assertPortAvailable: async () => {}, stopBackend: async () => {
      child.emit('exit', 0); // Reproduce exit delivery while beforeInstall awaits.
    } },
    './runtime-home.cjs': { prepareRuntimeHome: () => homeReady },
    './browser-cache.cjs': { prepareBrowserCache: async () => undefined },
    './startup-log.cjs': { createStartupLog: () => ({ write() {} }) },
    './policy.cjs': require('../src/policy.cjs'),
    './updates.cjs': { createUpdateChecker(options) { update = options; return () => {}; } },
  };
  vm.runInNewContext(source, {
    require: name => modules[name] ?? require(name), __dirname: '/desktop/src', process,
    URL, setTimeout, clearTimeout, setInterval: () => ({ unref() {} }),
  });
  for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
  return { app, errors, get update() { return update; }, get spawnCount() { return spawnCount; },
    get quitCount() { return quitCount; }, releaseHome };
}

test('update shutdown cannot display the unexpected-backend-exit modal', async () => {
  const f = await fixture();
  assert.deepEqual(f.errors, []);
  assert.ok(f.update);
  await f.update.beforeInstall();
  assert.deepEqual(f.errors, []);
  assert.equal(f.quitCount, 0);
});

test('closing during profile preparation never starts an orphan backend afterward', async () => {
  const f = await fixture({ pauseHome: true });
  f.app.emit('before-quit', { preventDefault() {} });
  f.releaseHome('/user/runtime/home');
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.spawnCount, 0);
  assert.equal(f.quitCount, 1);
});
