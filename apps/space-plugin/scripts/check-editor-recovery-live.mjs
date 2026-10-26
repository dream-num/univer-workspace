import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { WorkspaceConnection } from '../lib/workspace.js';
import { connectHost } from './host-connection.mjs';
const { chromium } = await import(
  process.env.SPACE_PLAYWRIGHT_MODULE ?? 'playwright'
);
const h = await connectHost(),
  f = JSON.parse(await readFile(process.env.SPACE_TEST_LOGIN_FILE, 'utf8')),
  x = JSON.parse(await readFile('/tmp/task009b-fixtures.json', 'utf8')),
  out = resolve(process.env.SPACE_EVIDENCE_DIR ?? '/tmp/task009b-evidence');
await mkdir(out, { recursive: true });
await h.request('space/configure', { endpoint: f.origin });
await h.request('space/login', { username: f.username, password: f.password });
const checks = [],
  errors = [];
const status = await h.request('space/status');
const dshIdentity = await fetch(f.origin + '/api/session', {
  headers: { cookie: h.headers.cookie },
}).then((r) => r.json());
assert.equal(dshIdentity.authenticated, false);
checks.push('DSH owner cookie does not authenticate to Workspace');
await assert.rejects(
  h.request('space/editor-http', {
    endpoint: f.origin,
    userId: 'dsh-owner',
    path: '/universer-api/user/session-ticket',
    method: 'GET',
    body: null,
  }),
);
checks.push('editor request rejects mismatched Workspace identity');
const username = `task009b-outsider-${Date.now()}`,
  password = randomBytes(24).toString('base64url');
const registration = await fetch(f.origin + '/api/auth/password/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    username,
    password,
    displayName: 'TASK-009B outsider',
  }),
});
assert.equal(registration.ok, true);
const other = new WorkspaceConnection();
other.configure(f.origin);
try {
  const stranger = await other.login(username, password);
  const denied = await other.editorRequest(
    {
      endpoint: f.origin,
      userId: stranger.user.id,
      path: `/universer-api/snapshot/1/unit/${x.doc.resource.unitId}/rev/0`,
      method: 'GET',
      body: null,
    },
    new AbortController().signal,
  );
  assert.ok([403, 404].includes(denied.status));
  checks.push(
    'real Server denies another Workspace user access to private Unit',
  );
  await assert.rejects(
    other.create(
      {
        kind: 'doc',
        name: 'Denied',
        space: x.space.id,
        parent: x.folder.id,
        key: crypto.randomUUID(),
      },
      new AbortController().signal,
    ),
    (e) => [403, 404].includes(e.status),
  );
  checks.push('real product API denies creation in inaccessible parent');
} finally {
  await other.dispose();
}
const b = await chromium.launch({
    headless: true,
    executablePath: process.env.SPACE_BROWSER_EXECUTABLE,
  }),
  c = await b.newContext({
    viewport: { width: 1600, height: 1000 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
await c.addCookies(
  h.headers.cookie.split('; ').map((s) => ({
    name: s.slice(0, s.indexOf('=')),
    value: s.slice(s.indexOf('=') + 1),
    url: h.origin,
    httpOnly: true,
  })),
);
const p = await c.newPage();
p.setDefaultTimeout(45000);
p.on('pageerror', (e) => errors.push(e.message));
const token = `RECOVERED_${Date.now()}`;
try {
  await p.goto(h.origin);
  await p
    .getByRole('navigation', { name: 'Activity bar', exact: true })
    .getByRole('button', { name: 'Space', exact: true })
    .click();
  await p.locator('.sp-file-open').filter({ hasText: x.doc.name }).click();
  await p.locator('[data-editor-state="saved"]').waitFor();
  await p.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const composer = p.locator('.sp-floating-chat [contenteditable="true"]');
  let draft;
  if (await composer.count()) {
    const current = await composer.innerText();
    if (/^(RECOVERED_\d+\s*)+$/.test(current)) await composer.fill('');
    draft = await composer.innerText();
  }
  await c.setOffline(true);
  await p.locator('[data-editor-state="offline"]').waitFor();
  const rect = await p.locator('.sp-sdk canvas').last().boundingBox();
  await p.mouse.click(
    (await p.locator('.sp-sdk canvas').last().boundingBox()).x + 300,
    (await p.locator('.sp-sdk canvas').last().boundingBox()).y + 100,
  );
  await p.keyboard.type(token, { delay: 30 });
  assert.equal(await p.locator('.sp-sdk').evaluate((el) => el.inert), true);
  checks.push('offline editor input surface is inert');
  assert.ok(
    !(
      await h.request('space/content', { node: x.doc.id })
    ).content.text.includes(token),
  );
  checks.push('offline attempt does not change Server');
  await p.screenshot({ path: resolve(out, 'doc-offline.png') });
  if (draft !== undefined)
    assert.equal(
      await composer.innerText(),
      draft,
      'blocked offline typing cannot enter native Composer',
    );
  await c.setOffline(false);
  await p.locator('[data-editor-state="saved"]').waitFor();
  await p.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await p.bringToFront();
  await p.mouse.click(
    (await p.locator('.sp-sdk canvas').last().boundingBox()).x + 300,
    (await p.locator('.sp-sdk canvas').last().boundingBox()).y + 100,
  );
  await p.keyboard.type(token, { delay: 30 });
  await p.locator('[data-editor-state="saved"]').waitFor();
  await p.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await p.keyboard.press('Meta+a');
  await p.evaluate(() => navigator.clipboard.writeText('__pending_copy__'));
  await p.keyboard.press('Meta+c');
  await p.waitForFunction(
    async () => (await navigator.clipboard.readText()) !== '__pending_copy__',
  );
  assert.ok(
    (await p.evaluate(() => navigator.clipboard.readText())).includes(token),
  );
  checks.push('typing works again after reconnect');
  await p.getByRole('button', { name: 'Close viewer', exact: true }).click();
  await p.locator('.sp-file-open').filter({ hasText: x.doc.name }).click();
  await p.locator('[data-editor-state="saved"]').waitFor();
  await p.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await p.mouse.click(
    (await p.locator('.sp-sdk canvas').last().boundingBox()).x + 300,
    (await p.locator('.sp-sdk canvas').last().boundingBox()).y + 100,
  );
  await p.keyboard.press('Meta+a');
  await p.evaluate(() => navigator.clipboard.writeText('__pending_copy__'));
  await p.keyboard.press('Meta+c');
  await p.waitForFunction(
    async () => (await navigator.clipboard.readText()) !== '__pending_copy__',
  );
  const reopened = await p.evaluate(() => navigator.clipboard.readText());
  assert.ok(reopened.includes(token));
  const persisted = await h.request('space/content', { node: x.doc.id });
  assert.ok(persisted.content.text.includes(token));
  checks.push(
    'reconnect restores editing; fresh edit is saved and survives reopen',
  );
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(out, 'editor-recovery-live.json'),
    JSON.stringify(
      {
        checks,
        errors,
        token,
        content: persisted.content,
        revision: persisted.revision,
        carrier:
          'Official DSH Web / isolated Edge context with network offline/online',
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks: checks.length, errors }));
} catch (e) {
  await c.setOffline(false);
  await p.screenshot({ path: resolve(out, 'recovery-failure.png') });
  console.log(
    JSON.stringify({
      checks,
      errors,
      body: (await p.locator('body').innerText()).slice(-2000),
    }),
  );
  throw e;
} finally {
  await b.close();
}
