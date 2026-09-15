import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseLoginCallback, createLoginController } = require('../src/login.cjs');
const { desktopEntry } = require('../src/protocol.cjs');
const state = 'a'.repeat(43), nextState = 'b'.repeat(43);
const callback = (value = state) => `univer-workspace://login#state=${value}&code=one-use-code`;
test('strict callback parser rejects forged, duplicate, oversized and misplaced fields', () => {
  assert.deepEqual(parseLoginCallback(callback()), { state, code: 'one-use-code' });
  for (const value of [callback().replace('login#', 'other#'), callback().replace('login#', 'login:8080#'),
    callback().replace('login#', 'user@login#'), callback().replace('#', '?'), `${callback()}&state=${state}`,
    `${callback()}&error=denied`, `${callback()}&token=secret`, callback().replace('one-use-code', 'x'.repeat(4096))])
    assert.equal(parseLoginCallback(value), undefined);
});
test('external browser receives only authorization URL; app redeems once and refreshes account', async () => {
  const requests = [], opened = []; let reloads = 0;
  const controller = createLoginController({ origin: 'http://127.0.0.1:3101',
    fetch: async (url, options) => {
      requests.push({ url, options });
      return Response.json(url.endsWith('/start') ? { authorizationUrl: 'https://workspace.example/api/auth/authorize?state=' + state, state, expiresAt: Date.now() + 10000 }
        : url.endsWith('/complete') ? { connected: true, version: 'v2' } : { connected: true, switching: false });
    }, openExternal: async url => opened.push(url), connected: async () => { reloads++; } });
  await assert.rejects(controller.accept(callback()), /expired/);
  await controller.start();
  assert.equal(new URL(opened[0]).origin, 'https://workspace.example');
  await assert.rejects(controller.accept(callback(nextState)), /expired/);
  assert.equal(await controller.accept(callback()), true);
  await assert.rejects(controller.accept(callback()), /expired/);
  assert.equal(reloads, 1);
  assert.equal(requests[0].options.headers.origin, 'http://127.0.0.1:3101');
  assert.equal(requests[2].options.headers['x-uwh-connection'], 'v2');
});
test('retry supersedes old callbacks, cancellation allows another login', async () => {
  let attempts = 0;
  const controller = createLoginController({ origin: 'http://127.0.0.1:3101',
    fetch: async () => Response.json({ authorizationUrl: 'https://workspace.example/authorize',
      state: ++attempts === 1 ? state : nextState, expiresAt: Date.now() + 10000 }),
    openExternal: async () => {}, connected: async () => {} });
  await controller.start(); await controller.start();
  await assert.rejects(controller.accept(callback()), /expired/);
  await assert.rejects(controller.accept(`univer-workspace://login#state=${nextState}&error=access_denied`), /cancelled/);
  await controller.start();
});
test('Linux protocol entry quotes executable paths and rejects injected lines', () => {
  assert.match(desktopEntry('/opt/Workspace Agent/a%25.AppImage'), /Exec="\/opt\/Workspace Agent\/a%%25.AppImage" %u/);
  assert.match(desktopEntry('/opt/Agent.AppImage'), /MimeType=x-scheme-handler\/univer-workspace;/);
  assert.throws(() => desktopEntry('/opt/app\nExec=evil'));
  assert.throws(() => desktopEntry('relative'));
});
