import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createLoginBrowser } = require('../src/login-browser.cjs');
const { parseLoginCallback } = require('../src/login.cjs');
const origin = 'http://127.0.0.1:3101';
function fixture(failExternal, handler = 'System browser') {
  const windows = [], callbacks = [], failures = [], external = [];
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.loaded = []; this.closed = false; this.cleared = false;
      this.webContents = Object.assign(new EventEmitter(), { session: {
        setPermissionRequestHandler: handler => { this.permission = handler; },
        clearStorageData: async () => { this.cleared = true; },
      }, setWindowOpenHandler: handler => { this.openHandler = handler; } });
      windows.push(this);
    }
    setMenu() {}
    async loadURL(url) { this.loaded.push(url); }
    isDestroyed() { return this.closed; }
    close() { this.closed = true; this.emit('closed'); }
  }
  return { windows, callbacks, failures, external,
    browser: createLoginBrowser({ app: { getApplicationNameForProtocol: () => handler }, platform: 'linux',
      BrowserWindow: Window, origin, accept: value => callbacks.push(value), failed: error => failures.push(error),
      shell: { openExternal: async url => { external.push(url); if (failExternal) throw new Error('No browser handler'); } } }) };
}
test('default browser success creates no embedded window', async () => {
  const f = fixture(false); await f.browser.open('https://workspace.example/authorize');
  assert.equal(f.external.length, 1); assert.equal(f.windows.length, 0);
});
test('Linux without a registered browser opens the embedded window even if shell dispatch would succeed', async () => {
  const f = fixture(false, '');
  await f.browser.open('https://workspace.example/authorize');
  assert.equal(f.external.length, 0);
  assert.equal(f.windows.length, 1);
  assert.deepEqual(f.windows[0].loaded, ['https://workspace.example/authorize']);
});
test('failed browser launch uses a sandboxed temporary session and handles callback without OS protocol', async () => {
  const f = fixture(true); await f.browser.open('https://workspace.example/authorize');
  const window = f.windows[0];
  assert.equal(window.options.webPreferences.nodeIntegration, false);
  assert.equal(window.options.webPreferences.sandbox, true);
  assert.equal(window.options.webPreferences.contextIsolation, true);
  assert.equal(window.options.webPreferences.preload, undefined);
  assert.ok(!window.options.webPreferences.partition.startsWith('persist:'));
  let permission; window.permission(null, 'camera', value => { permission = value; });
  assert.equal(permission, false);
  let prevented = false;
  window.webContents.emit('will-redirect', { preventDefault() { prevented = true; } }, `${origin}/auth/oauth/callback?state=request&code=once`);
  assert.equal(prevented, true); assert.equal(window.closed, true); assert.equal(window.cleared, true);
  assert.deepEqual(f.callbacks, ['univer-workspace://login#state=request&code=once']);
  assert.equal(f.failures.length, 0);
});
test('retries retire the old window and cookies; unsafe navigation is blocked', async () => {
  const f = fixture(true); await f.browser.open('https://workspace.example/authorize');
  const first = f.windows[0];
  let prevented = false;
  first.webContents.emit('will-navigate', { preventDefault() { prevented = true; } }, 'file:///etc/passwd');
  assert.equal(prevented, true);
  assert.deepEqual(first.openHandler({ url: 'javascript:alert(1)' }), { action: 'deny' });
  await f.browser.open('https://workspace.example/authorize');
  assert.equal(first.closed, true); assert.equal(first.cleared, true);
  assert.notEqual(f.windows[1].options.webPreferences.partition, first.options.webPreferences.partition);
  assert.equal(f.callbacks.length, 0);
});
test('embedded loopback converts OAuth metadata without weakening desktop callback validation', async () => {
  const state = 'a'.repeat(43);
  for (const extra of ['&scope=identity+session', `&scope=identity&state=${state}`, '&scope=identity&error=denied']) {
    const f = fixture(true);
    await f.browser.open('https://workspace.example/authorize');
    const window = f.windows[0];
    window.webContents.emit('will-redirect', { preventDefault() {} }, `${origin}/auth/oauth/callback?code=once&state=${state}${extra}`);
    const parsed = parseLoginCallback(f.callbacks[0]);
    if (extra === '&scope=identity+session') assert.deepEqual(parsed, { state, code: 'once' });
    else assert.equal(parsed, undefined, 'Ambiguous callback fields must still be rejected');
    assert.equal(window.closed, true);
  }
});
