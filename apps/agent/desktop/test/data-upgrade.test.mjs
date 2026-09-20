import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { createDataUpgrade, migrationFailure } from '../src/data-upgrade.cjs';

async function fixture(t, { brokenLog = false } = {}) {
  const handlers = new Map(), opened = [], logs = [];
  const window = Object.assign(new EventEmitter(), {
    webContents: { mainFrame: { url: '' }, isDestroyed: () => false },
    async loadURL(url) { this.webContents.mainFrame.url = url; },
    show() {}, close() { this.emit('closed'); },
  });
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  const controller = createDataUpgrade({ window, locale: 'zh-CN', installer: true,
    ipcMain: { handle: (name, action) => handlers.set(name, action), removeHandler: name => handlers.delete(name) },
    shell: { showItemInFolder: path => opened.push(path), openPath: async path => { opened.push(path); return ''; } },
    log: { path: '/data/logs/startup.log', write: item => { if (brokenLog) throw new Error('disk full'); logs.push(item); } },
    home: '/data/runtime/home',
  });
  t.after(() => controller.dispose());
  await controller.load();
  return { controller, window, event, handlers, opened, logs,
    state: () => handlers.get('uwa:data-upgrade-state')(event),
    action: name => handlers.get('uwa:data-upgrade-action')(event, name),
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('migration failure stays available for diagnostics and one serialized retry', async t => {
  const f = await fixture(t);
  let attempts = 0;
  const result = f.controller.run(async report => {
    report({ phase: 'preparing' });
    if (++attempts === 1) throw Object.assign(new Error('full'), { code: 'ENOSPC' });
    return '/data/runtime/home';
  });
  await tick();
  assert.equal(f.state().phase, 'failed');
  assert.equal(f.state().reason, 'space');
  await f.action('logs');
  await f.action('backups');
  assert.deepEqual(f.opened, ['/data/logs/startup.log', '/data/runtime']);
  const retry = f.action('retry');
  await assert.rejects(f.action('retry'), /running/);
  await retry;
  assert.equal(await result, '/data/runtime/home');
  assert.equal(attempts, 2);
});

test('newer data cannot be retried or reset; closing resolves without starting the app', async t => {
  const f = await fixture(t);
  const result = f.controller.run(async () => { throw Object.assign(new Error('newer'), { code: 'DATA_VERSION_NEWER' }); });
  await tick();
  assert.equal(f.state().retryable, false);
  await assert.rejects(f.action('retry'), /unavailable/);
  await assert.rejects(f.action('reset'), /unavailable/);
  await f.action('exit');
  assert.equal(await result, undefined);
  assert.equal(f.handlers.size, 0);
});

test('a full diagnostic disk does not remove the migration failure UI', async t => {
  const f = await fixture(t, { brokenLog: true });
  const result = f.controller.run(async report => { report({ phase: 'checking' }); throw new Error('failure'); });
  await tick();
  assert.equal(f.state().phase, 'failed');
  f.window.close();
  assert.equal(await result, undefined);
});

test('upgrade IPC rejects subframes, other windows, navigated pages, and arbitrary actions', async t => {
  const f = await fixture(t);
  const get = f.handlers.get('uwa:data-upgrade-state');
  const action = f.handlers.get('uwa:data-upgrade-action');
  assert.throws(() => get({ ...f.event, sender: {} }), /Untrusted/);
  assert.throws(() => get({ ...f.event, senderFrame: { ...f.event.senderFrame } }), /Untrusted/);
  f.window.webContents.mainFrame.url = 'http://127.0.0.1:3101/';
  await assert.rejects(action(f.event, 'logs'), /Untrusted/);
  assert.deepEqual(f.opened, []);
});

test('closing during preparation never returns a ready home to its caller', async t => {
  const f = await fixture(t);
  let finish;
  const result = f.controller.run(() => new Promise(resolve => { finish = resolve; }));
  f.window.close();
  finish('/data/runtime/home');
  assert.equal(await result, undefined);
});

test('nested migration errors preserve actionable installer results', () => {
  assert.deepEqual(migrationFailure(new Error('step failed', { cause: Object.assign(new Error('access'), { code: 'EACCES' }) })),
    { reason: 'permission', exitCode: 24, retryable: true });
});
