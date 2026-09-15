import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import updates from "../src/updates.cjs";
import { trustedFrame } from "../src/update-window.cjs";

const digest = Buffer.alloc(64).toString('base64');
function fixture({ version = "0.1.0-alpha.1", next = "0.1.0-alpha.2", enabled = true,
  metadata = next, failDownload = false, download, stop } = {}) {
  const events = [], states = [];
  const extension = { linux: 'linux-x64.AppImage', win32: 'win-x64.exe', darwin: 'mac-arm64.zip' }[process.platform];
  const info = { version: metadata, files: [{ url: `Agent-${next}-${extension}`, size: 10, sha512: digest }] };
  const updater = Object.assign(new EventEmitter(), {
    setFeedURL(feed) { events.push(['feed', feed]); },
    async checkForUpdates() { return { isUpdateAvailable: true, updateInfo: info }; },
    async downloadUpdate() { events.push('stage'); },
    quitAndInstall(...args) { events.push(['install', args]); },
  });
  const controller = updates.createUpdateController({
    app: { isPackaged: true, getVersion: () => version, getPath: () => '/test' }, autoUpdater: updater,
    updatesEnabled: enabled,
    net: { async fetch() { events.push('fetch'); return { ok: true, json: async () => [
      { tag_name: 'v99.0.0' }, { tag_name: `agent-v${next}`, prerelease: next.includes('-'), body: '<b>Release notes</b>' },
    ] }; } },
    show: () => events.push('show'), changed: state => states.push(state),
    download: download ?? (async options => { events.push('download'); options.onProgress({ percent: 50 });
      if (failDownload) throw new Error('offline'); return '/test/package'; }),
    serve: async () => ({ url: 'http://127.0.0.1:123/token/', close: async () => events.push('close feed') }),
    beforeInstall: stop ?? (async () => events.push('stop backend')),
  });
  return { controller, events, states, updater };
}

test('checking, downloading and installation require distinct actions', async () => {
  const { controller: c, events, states, updater } = fixture();
  await c.check(false);
  assert.equal(c.getState().phase, 'available');
  assert.equal(events.includes('download'), false);
  await c.download();
  assert.equal(c.getState().phase, 'ready');
  assert.equal(events.includes('stop backend'), false);
  assert.ok(states.some(s => s.percent === 50));
  await c.install();
  assert.deepEqual(events.slice(-2), ['stop backend', ['install', [false, true]]]);
  assert.equal(updater.autoInstallOnAppQuit, false);
});
test('download failure retains retry action without stopping the app', async () => {
  const { controller: c, events } = fixture({ failDownload: true });
  await c.check(); await c.download(); await c.download();
  assert.equal(c.getState().phase, 'download-error');
  assert.equal(events.filter(e => e === 'download').length, 2);
  assert.equal(events.includes('stop backend'), false);
});
test('manual check during download shows existing progress without starting another transfer', async () => {
  let finish;
  const { controller: c, events } = fixture({ download: () => new Promise(resolve => { finish = resolve; }) });
  await c.check();
  const pending = c.download();
  await Promise.resolve();
  const other = c.check();
  assert.equal(c.getState().phase, 'downloading');
  assert.equal(events.filter(e => e === 'fetch').length, 1);
  finish('/test/package');
  await Promise.all([pending, other]);
  assert.equal(c.getState().phase, 'ready');
});
test('pause can resume and preserves staging/installation order', async () => {
  let count = 0;
  const { controller: c, events } = fixture({ download: ({ signal }) => {
    if (count++) return Promise.resolve('/test/package');
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  } });
  await c.check(); const pending = c.download(); await Promise.resolve(); c.pause(); await pending;
  assert.equal(c.getState().phase, 'paused');
  assert.equal(events.includes('stage'), false);
  await c.download(); assert.equal(c.getState().phase, 'ready');
});
test('preview and mismatched metadata never download; check errors can retry', async () => {
  const preview = fixture({ enabled: false }); await preview.controller.check();
  assert.equal(preview.events.includes('fetch'), false);
  const mismatch = fixture({ metadata: '99.0.0' }); await mismatch.controller.check();
  assert.equal(mismatch.controller.getState().phase, 'check-error');
  await mismatch.controller.download(); await mismatch.controller.check();
  assert.equal(mismatch.events.includes('download'), false);
  assert.equal(mismatch.events.filter(e => e === 'fetch').length, 2);
});
test('release promotions retain channel policy', async () => {
  for (const [version, next, channel] of [
    ['0.1.0-alpha.1', '0.1.0-beta.1', 'beta'], ['0.1.0-beta.1', '0.1.0-rc.1', 'rc'],
    ['0.1.0-rc.1', '0.1.0', 'latest'], ['0.1.0-alpha.1', '0.1.0-alpha.2', 'alpha'],
  ]) {
    const { controller: c, events } = fixture({ version, next }); await c.check();
    assert.equal(events.find(e => e[0] === 'feed')[1].channel, channel);
  }
  const stable = fixture({ version: '0.1.0', next: '0.2.0-alpha.1' }); await stable.controller.check();
  assert.equal(stable.controller.getState().phase, 'current');
});
test('failed shutdown keeps the verified update available for retry', async () => {
  const { controller: c, events } = fixture({ stop: async () => { throw Error('busy'); } });
  await c.check(); await c.download(); await c.install();
  assert.equal(c.getState().phase, 'ready'); assert.equal(c.getState().installError, true);
  assert.equal(events.some(e => e[0] === 'install'), false);
});
test('asset selection confines downloads to the selected release and platform', () => {
  const feed = 'https://github.com/dream-num/univer-workspace/releases/download/agent-v1.0.0/';
  const file = { url: 'Agent-mac-arm64.zip', sha512: digest, size: 10 };
  assert.ok(updates.selectAsset({ files: [file] }, feed, 'darwin', 'arm64').url.startsWith(feed));
  for (const url of ['https://attacker.invalid/Agent-mac-arm64.zip', '../Agent-mac-arm64.zip', 'Agent-win-x64.exe'])
    assert.throws(() => updates.selectAsset({ files: [{ ...file, url }] }, feed, 'darwin', 'arm64'));
});
test('NSIS metadata without size uses the matching GitHub release asset size', () => {
  const feed = 'https://github.com/dream-num/univer-workspace/releases/download/agent-v1.0.0/';
  const info = { files: [{ url: 'Agent-win-x64.exe', sha512: digest }] };
  const assets = [{ browser_download_url: feed + 'Agent-win-x64.exe', size: 123456 }];
  assert.equal(updates.selectAsset(info, feed, 'win32', 'x64', assets).size, 123456);
  assert.throws(() => updates.selectAsset(info, feed, 'win32', 'x64', []));
});
test('update IPC rejects subframes, OAuth windows and navigated contents', () => {
  const frame = { url: 'file:///update.html' };
  const contents = { mainFrame: frame, isDestroyed: () => false };
  const allowed = url => url === 'file:///update.html';
  assert.ok(trustedFrame({ sender: contents, senderFrame: frame }, contents, allowed));
  assert.ok(!trustedFrame({ sender: contents, senderFrame: { ...frame } }, contents, allowed));
  assert.ok(!trustedFrame({ sender: {}, senderFrame: frame }, contents, allowed));
  frame.url = 'https://workspace.example/';
  assert.ok(!trustedFrame({ sender: contents, senderFrame: frame }, contents, allowed));
});
