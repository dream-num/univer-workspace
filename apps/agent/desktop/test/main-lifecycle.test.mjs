import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../src/main.cjs', import.meta.url), 'utf8');
async function fixture({ pauseHome = false, migrationOnly = false, headless = false, migrationError } = {}) {
  const errors = [];
  const child = new EventEmitter();
  let update, spawnCount = 0, quitCount = 0, releaseHome, exitCode, windowCount = 0;
  const homeReady = pauseHome ? new Promise(resolve => { releaseHome = resolve; }) : Promise.resolve('/user/runtime/home');
  const app = Object.assign(new EventEmitter(), {
    setName() {}, requestSingleInstanceLock: () => true,
    commandLine: { getSwitchValue: () => '', appendSwitch() {} }, getPath: () => '/user',
    getLocale: () => 'en-US', getVersion: () => '0.1.0', whenReady: () => Promise.resolve(),
    quit() { quitCount++; }, exit(code) { quitCount++; exitCode = code; },
  });
  const webContents = Object.assign(new EventEmitter(), {
    session: { setPermissionRequestHandler() {} }, setWindowOpenHandler() {},
    executeJavaScript: async () => {},
  });
  class BrowserWindow {
    constructor() { windowCount++; }
    webContents = webContents;
    loadURL = async () => {};
    show() {}
  }
  const modules = {
    electron: { app, BrowserWindow, ipcMain: { handle() {} }, Menu: { setApplicationMenu() {}, buildFromTemplate: x => x },
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
    './runtime-home.cjs': { prepareRuntimeHome: () => migrationError ? Promise.reject(migrationError) : homeReady },
    './data-upgrade.cjs': { ...require('../src/data-upgrade.cjs'), createDataUpgrade: () => ({
      load: async () => {}, run: task => task(() => {}), report() {}, dispose() {},
    }) },
    './profile-runtime.cjs': { selectProfileRuntime: async () => ({ archived: true }) },
    './browser-cache.cjs': { prepareBrowserCache: async () => undefined },
    './startup-log.cjs': { createStartupLog: () => ({ write() {} }) },
    './policy.cjs': require('../src/policy.cjs'),
    './login.cjs': require('../src/login.cjs'),
    './login-browser.cjs': require('../src/login-browser.cjs'),
    './updates.cjs': { createUpdateController(options) { update = options; return { check() {} }; } },
    './diagnostics.cjs': { createDiagnostics: () => ({}) },
    './update-window.cjs': { createUpdateWindow: () => ({ show() {}, changed() {}, attach() {} }) },
  };
  vm.runInNewContext(source, {
    require: name => modules[name] ?? require(name), __dirname: '/desktop/src',
    process: { ...process, argv: [...process.argv, ...(migrationOnly ? ['--migrate-data-only'] : []), ...(headless ? ['--migration-headless'] : [])] },
    URL, setTimeout, clearTimeout, setInterval: () => ({ unref() {} }),
  });
  for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
  return { app, errors, get update() { return update; }, get spawnCount() { return spawnCount; },
    get quitCount() { return quitCount; }, get exitCode() { return exitCode; }, get windowCount() { return windowCount; }, releaseHome };
}

test('update shutdown cannot display the unexpected-backend-exit modal', async () => {
  const f = await fixture();
  assert.deepEqual(f.errors, []);
  assert.ok(f.update);
  await f.update.beforeInstall();
  assert.deepEqual(f.errors, []);
  assert.equal(f.quitCount, 0);
});

test('installer migration mode exits without starting business services', async () => {
  for (const headless of [false, true]) {
    const f = await fixture({ migrationOnly: true, headless });
    assert.equal(f.spawnCount, 0);
    assert.equal(f.exitCode, 0);
    assert.equal(f.windowCount, headless ? 0 : 1);
    assert.equal(f.update, undefined);
  }
});

test('silent installer receives failure status without a dialog or backend', async () => {
  const f = await fixture({ migrationOnly: true, headless: true,
    migrationError: Object.assign(new Error('newer data'), { code: 'DATA_VERSION_NEWER' }) });
  assert.equal(f.exitCode, 21);
  assert.equal(f.spawnCount, 0);
  assert.equal(f.windowCount, 0);
  assert.deepEqual(f.errors, []);
});

test('closing during profile preparation never starts an orphan backend afterward', async () => {
  const f = await fixture({ pauseHome: true });
  f.app.emit('before-quit', { preventDefault() {} });
  f.releaseHome('/user/runtime/home');
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.spawnCount, 0);
  assert.equal(f.quitCount, 1);
});
