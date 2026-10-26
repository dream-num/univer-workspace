import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connectHost } from './host-connection.mjs';
const { chromium } = await import(
  process.env.SPACE_PLAYWRIGHT_MODULE ?? 'playwright'
);
const h = await connectHost(),
  f = JSON.parse(await readFile(process.env.SPACE_TEST_LOGIN_FILE, 'utf8')),
  x = JSON.parse(
    await readFile(
      process.env.SPACE_COLLAB_FIXTURES ?? '/tmp/task009b-fixtures.json',
      'utf8',
    ),
  ),
  extra = JSON.parse(await readFile(process.env.SPACE_MVP_FIXTURES, 'utf8'));
const out = resolve(process.env.SPACE_EVIDENCE_DIR ?? '/tmp/task009b-evidence');
await mkdir(out, { recursive: true });
const b = await chromium.launch({
    headless: true,
    executablePath: process.env.SPACE_BROWSER_EXECUTABLE,
  }),
  c = await b.newContext({
    viewport: { width: 1600, height: 1000 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
await c.addCookies(
  h.headers.cookie.split('; ').map((p) => ({
    name: p.slice(0, p.indexOf('=')),
    value: p.slice(p.indexOf('=') + 1),
    url: h.origin,
    httpOnly: true,
  })),
);
const p = await c.newPage(),
  errors = [],
  consoleErrors = [],
  checks = [];
p.setDefaultTimeout(30000);
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (e) => {
  if (e.type() === 'error') consoleErrors.push(e.text().slice(0, 600));
});
const activity = (name) =>
  p
    .getByRole('navigation', { name: 'Activity bar', exact: true })
    .getByRole('button', { name, exact: true });
async function open(node) {
  await p
    .getByRole('navigation', { name: 'Content types', exact: true })
    .getByRole('button', { name: 'All', exact: true })
    .click();
  await p.locator('.sp-file-open').filter({ hasText: node.name }).click();
  await p
    .locator(
      '[data-editor-state="saved"], [data-viewer-state="ready"], .sp-html-preview iframe',
    )
    .waitFor();
}
try {
  await p.goto(h.origin);
  await p.getByText('TASK-006 最终正式路径验收', { exact: true }).click();
  const composer = p.locator('[contenteditable="true"]').first();
  await composer.waitFor();
  const original = (await composer.innerText()).replace(
    /^TASK-009B retained native draft$/,
    '',
  );
  await composer.fill('TASK-009B retained native draft');
  await activity('Space').click();
  for (const n of [f.doc, f.sheet, ...extra.nodes, extra.site]) {
    await open(n);
    await p
      .locator(`[data-page-context="${n.id}"][data-context-state="linked"]`)
      .waitFor();
    await p.getByRole('button', { name: 'Close viewer', exact: true }).click();
    checks.push(
      `${n.resource?.unitType ?? 'site'} opens and associates the same native Session`,
    );
  }
  for (const label of ['Docs', 'Sheets']) {
    await p
      .getByRole('navigation', { name: 'Content types', exact: true })
      .getByRole('button', { name: label, exact: true })
      .click();
    await p.getByRole('heading', { name: label, exact: true }).waitFor();
  }
  checks.push('Docs and Sheets filters survive async save/navigation');
  await open(x.doc);
  await p
    .locator('.sp-sdk canvas')
    .last()
    .click({ position: { x: 300, y: 100 }, button: 'right' });
  await p.locator('.univer-shadow-md[tabindex="-1"]').waitFor();
  assert.ok(
    (await p.locator('.univer-shadow-md[tabindex="-1"]').innerText()).length >
      0,
  );
  await p.screenshot({ path: resolve(out, 'doc-context-menu.png') });
  await p.keyboard.press('Escape');
  checks.push('Docs native right-click menu exercised');
  await p.getByRole('button', { name: 'Close viewer', exact: true }).click();
  await open(x.sheet);
  await p
    .locator('.sp-sdk canvas')
    .last()
    .click({ position: { x: 80, y: 34 } });
  await p.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await p
    .locator('.sp-sdk canvas')
    .last()
    .click({ position: { x: 80, y: 34 }, button: 'right' });
  await p
    .getByText('复制', { exact: true })
    .filter({ visible: true })
    .first()
    .waitFor();
  await p.screenshot({ path: resolve(out, 'sheet-context-menu.png') });
  await p.keyboard.press('Escape');
  checks.push('Sheets native right-click menu exercised');
  await p.getByRole('button', { name: 'Close viewer', exact: true }).click();
  await open(x.doc);
  const quickToken = 'FAST_CLOSE_' + Date.now();
  await p
    .locator('.sp-sdk canvas')
    .last()
    .click({ position: { x: 300, y: 100 } });
  await p.keyboard.type(quickToken, { delay: 5 });
  await p.getByRole('button', { name: 'Close viewer', exact: true }).click();
  await open(x.doc);
  await p
    .locator('.sp-sdk canvas')
    .last()
    .click({ position: { x: 300, y: 100 } });
  await p.keyboard.press('Meta+a');
  await p.evaluate(() => navigator.clipboard.writeText('__pending_copy__'));
  await p.keyboard.press('Meta+c');
  await p.waitForFunction(
    async () => (await navigator.clipboard.readText()) !== '__pending_copy__',
  );
  assert.ok(
    (await p.evaluate(() => navigator.clipboard.readText())).includes(
      quickToken,
    ),
  );
  assert.ok(
    (
      await h.request('space/content', { node: x.doc.id })
    ).content.text.includes(quickToken),
  );
  checks.push(
    'Doc immediate close flushes input cache and remote queue; reopen and Server agree',
  );
  await p.getByRole('button', { name: 'Close viewer', exact: true }).click();
  await activity('Chat').click();
  assert.equal(
    await p.locator('[contenteditable="true"]').first().innerText(),
    'TASK-009B retained native draft',
  );
  await p.locator('[contenteditable="true"]').first().fill(original);
  checks.push('Chat/Space retains native Session and unsent Composer draft');
  await activity('Space').click();
  for (const label of ['插件', '自动化任务']) {
    await p.getByRole('button', { name: label, exact: true }).click();
    await activity('Space').click();
  }
  checks.push('Activity Bar Plugins/Automation/Space round trips');
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(out, 'editor-regression-live.json'),
    JSON.stringify(
      { checks, errors, consoleErrors, carrier: 'Official DSH Web / Edge' },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks: checks.length, errors, consoleErrors }));
} catch (e) {
  await p.screenshot({ path: resolve(out, 'regression-failure.png') });
  console.log(
    JSON.stringify({
      body: (await p.locator('body').innerText()).slice(-4000),
      checks,
      errors,
      consoleErrors,
    }),
  );
  throw e;
} finally {
  await b.close();
}
