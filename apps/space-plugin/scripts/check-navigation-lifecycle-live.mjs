/** Actual official manager removal/reinstall while Space is active; no host source edits. */
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { connectHost } from './host-connection.mjs';
const { chromium } = await import(
  process.env.SPACE_PLAYWRIGHT_MODULE ?? 'playwright'
);
const h = await connectHost(),
  f = JSON.parse(await readFile(process.env.SPACE_TEST_LOGIN_FILE, 'utf8')),
  tarball = process.env.SPACE_PLUGIN_TARBALL,
  out = resolve(process.env.SPACE_EVIDENCE_DIR ?? '/tmp/space-plugin-evidence');
assert.ok(tarball?.startsWith('/'));
await mkdir(out, { recursive: true });
const b = await chromium.launch({
    headless: true,
    executablePath: process.env.SPACE_BROWSER_EXECUTABLE,
  }),
  c = await b.newContext({ viewport: { width: 1440, height: 900 } }),
  errors = [],
  pageErrors = [],
  steps = [];
await c.addCookies(
  h.headers.cookie.split('; ').map((p) => ({
    name: p.slice(0, p.indexOf('=')),
    value: p.slice(p.indexOf('=') + 1),
    url: h.origin,
    httpOnly: true,
  })),
);
const p = await c.newPage();
p.setDefaultTimeout(25000);
p.on('pageerror', (e) => pageErrors.push(e.message));
p.on('console', (e) => {
  if (e.type() === 'error') errors.push(e.text().slice(0, 800));
});
const session = 'session-f5a52ca5-3458-4d0e-ac46-cc8a5701edc0';
const sessionFile = (
  await readdir(process.env.SPACE_SESSION_ROOT, { recursive: true })
).find((n) => n.includes(session) && n.endsWith('session.v4.jsonl.zstd'));
assert.ok(sessionFile);
const digest = async () =>
  createHash('sha256')
    .update(
      await readFile(resolve(process.env.SPACE_SESSION_ROOT, sessionFile)),
    )
    .digest('hex');
async function enter() {
  await p
    .getByRole('navigation', { name: 'Activity bar', exact: true })
    .getByRole('button', { name: 'Space', exact: true })
    .click();
  await p
    .getByRole('button', { name: 'Space settings', exact: true })
    .waitFor();
}
async function reconnect() {
  await p.getByRole('button', { name: 'Space settings', exact: true }).click();
  if ((await h.request('space/status')).state !== 'connected') {
    await p.getByLabel('Workspace Endpoint', { exact: true }).fill(f.origin);
    await p.getByRole('button', { name: /^(连接服务|重新连接)$/ }).click();
    await p.getByLabel('用户名', { exact: true }).fill(f.username);
    await p.getByLabel('密码', { exact: true }).fill(f.password);
    await p
      .getByRole('button', { name: '登录 Workspace', exact: true })
      .click();
    await p
      .getByRole('dialog', { name: 'Space settings', exact: true })
      .waitFor({ state: 'hidden' });
  } else await p.keyboard.press('Escape');
}
try {
  await p.goto(h.origin);
  await p.locator('[contenteditable="true"]').first().waitFor();
  await p.getByText('TASK-006 最终正式路径验收', { exact: true }).click();
  await p.locator('[contenteditable="true"]').waitFor();
  const original = await p.locator('[contenteditable="true"]').innerText();
  await p.locator('[contenteditable="true"]').fill('TASK-009A lifecycle draft');
  await enter();
  await reconnect();
  await p
    .getByRole('navigation', { name: 'Content types', exact: true })
    .getByRole('button', { name: 'All', exact: true })
    .click();
  await p.locator('.sp-file-open').filter({ hasText: f.doc.name }).click();
  await p.locator('[data-context-state="linked"]').waitFor();
  assert.equal(
    await p.locator('.sp-floating-chat').getAttribute('data-session-id'),
    session,
  );
  const before = await digest();
  const removed = await h.request('pluginManager/removeBundle', {
    args: { name: 'dsh-space-plugin' },
  });
  assert.equal(removed.application, 'applied');
  steps.push({
    operation: 'removeBundle',
    application: removed.application,
    stage: removed.stage,
  });
  await p
    .locator('[data-space-navigation-anchor]')
    .waitFor({ state: 'detached' });
  await p.waitForTimeout(800);
  assert.equal(
    await p
      .locator(
        '[data-space-host-frame],[data-space-host-navigation],[data-space-activity-mount],[data-space-toggle-mount],[data-space-window-chrome]',
      )
      .count(),
    0,
  );
  assert.equal(await p.locator('style[data-plugin="space-plugin"]').count(), 0);
  assert.equal(
    await p.getByRole('button', { name: 'Space', exact: true }).count(),
    0,
  );
  await p.locator('[contenteditable="true"]').waitFor();
  assert.equal(
    await p.locator('[contenteditable="true"]').innerText(),
    'TASK-009A lifecycle draft',
  );
  assert.equal(await digest(), before);
  await h.request('pluginManager/listBundles', { args: {} });
  const route = await fetch(h.origin + '/api/space/status', {
    method: 'POST',
    headers: h.headers,
    body: h.body('space/status', {}),
  });
  assert.equal(route.status, 404);
  await p.screenshot({ path: resolve(out, 'after-uninstall-chat.png') });
  steps.push({
    operation: 'restoration',
    nativeNavigation: true,
    allIntegrationAttributesAndNodesRemoved: true,
    workspaceRoutesRemoved: true,
    sameNativeSessionLog: true,
    nativeDraftPreserved: true,
    hostStillAuthorized: true,
  });
  if (process.env.SPACE_LIFECYCLE_REMOVE_ONLY === '1') {
    await p.locator('[contenteditable="true"]').fill(original);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(errors, []);
    await writeFile(
      resolve(out, 'uninstall.json'),
      JSON.stringify(
        {
          carrier: 'Official Host Web UI + actual plugin manager removal',
          pluginVersion: JSON.parse(
            await readFile(new URL('../package.json', import.meta.url), 'utf8'),
          ).version,
          sessionId: session,
          uninstallFunctionalAcceptance: true,
          steps,
          nativeSessionLogBefore: before,
          nativeSessionLogAfter: await digest(),
          pageErrors,
          consoleErrors: errors,
        },
        null,
        2,
      ),
    );
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(errors, []);
    console.log(
      'Actual removal restores native navigation, Session and draft; all navigation mounts removed',
    );
  } else {
    const installed = await h.request('pluginManager/installBundle', {
      args: { spec: tarball, options: { enabled: true } },
    });
    steps.push({
      operation: 'installBundle',
      application: installed.application,
      stage: installed.stage,
      error: installed.error,
    });
    assert.equal(installed.application, 'applied');
    await p
      .getByRole('navigation', { name: 'Activity bar', exact: true })
      .waitFor();
    assert.equal(
      await p.locator('[contenteditable="true"]').innerText(),
      'TASK-009A lifecycle draft',
    );
    await p.locator('[contenteditable="true"]').fill(original);
    await enter();
    await reconnect();
    await p
      .getByRole('navigation', { name: 'Content types', exact: true })
      .getByRole('button', { name: 'All', exact: true })
      .click();
    await p.locator('.sp-file-open').filter({ hasText: f.doc.name }).click();
    await p.locator('[data-context-state="linked"]').waitFor();
    assert.equal(
      await p.locator('.sp-floating-chat').getAttribute('data-session-id'),
      session,
    );
    assert.equal(await digest(), before);
    await p.screenshot({ path: resolve(out, 'after-reinstall-space.png') });
    assert.deepEqual(pageErrors, []);
    const knownRedi = [
      /\[redi\]: You are loading scripts of redi more than once!/,
      /\[redi\]: "RediContext" is already created\./,
    ];
    assert.deepEqual(
      errors.filter((e) => !knownRedi.some((rule) => rule.test(e))),
      [],
    );
    await writeFile(
      resolve(out, 'navigation-lifecycle.json'),
      JSON.stringify(
        {
          carrier:
            'Official Electron-owned Host manager + actual Web hot removal/reinstall while Space active',
          sessionId: session,
          steps,
          nativeSessionLogBefore: before,
          nativeSessionLogAfter: await digest(),
          functionalAcceptance: true,
          consoleClean: errors.length === 0,
          pageErrors,
          consoleErrors: errors,
          knownGap: errors.length
            ? 'Hot reinstall loaded Univer/Redi again in the same browser realm; warnings are retained and not a zero-console pass'
            : 'none',
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ passed: true, steps }));
  }
} catch (error) {
  await p.screenshot({ path: resolve(out, 'lifecycle-failure.png') });
  await writeFile(
    resolve(out, 'lifecycle-failure.json'),
    JSON.stringify(
      { steps, error: error.message, pageErrors, errors },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await b.close();
}
