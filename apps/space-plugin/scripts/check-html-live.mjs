/** Formal Page renderer, scripts and bound Sheet edits against the real Server. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceConnection } from '../lib/workspace.js';
import { connectHost, authorizeWorkspace, openWorkspaceSettings } from './host-connection.mjs';
const { chromium } = await import(
  process.env.SPACE_PLAYWRIGHT_MODULE ?? 'playwright'
);
const h = await connectHost(),
  f = JSON.parse(await readFile(process.env.SPACE_TEST_LOGIN_FILE, 'utf8'));
const fixtures = JSON.parse(
  await readFile('/tmp/task009b-r2-fixtures.json', 'utf8'),
);
await h.request('space/configure', { endpoint: f.origin });
await authorizeWorkspace(h, f);
const out = resolve(
  process.env.SPACE_EVIDENCE_DIR ?? '/tmp/space-html-evidence',
);
await mkdir(out, { recursive: true });
const workspace = new WorkspaceConnection();
workspace.configure(f.origin);
await workspace.login(f.username, f.password);
const before = await workspace.read(fixtures.sheet.id);
const sheet = before.data.sheetOrder[0],
  unit = before.unitId;
const cell = `${unit}:${sheet}:A1`,
  name = `Bound Page ${Date.now()}`;
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>Live Page</h1><p id="script-marker"></p><span id="readout" data-univer-cell-text="${cell}"></span><input aria-label="Bound cell" data-univer-cell-model="${cell}"><script>document.getElementById('script-marker').textContent='HTML_RUNTIME_OK';</script></body></html>`;
const reserved = await workspace.json('/api/blob-upload-sessions', {
  method: 'POST',
  headers: { 'Idempotency-Key': randomUUID() },
  body: JSON.stringify({
    spaceId: fixtures.space.id,
    parentNodeId: fixtures.destination.id,
    name,
    originalFilename: `${name}.univer.html`,
    byteSize: Buffer.byteLength(html),
    declaredMediaType: 'text/html',
  }),
});
await workspace.request(
  `/api/blob-upload-sessions/${reserved.upload.id}/content`,
  {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream' },
    body: html,
  },
);
const created = await workspace.json(
  `/api/blob-upload-sessions/${reserved.upload.id}/complete`,
  { method: 'POST' },
);
const nodeId = created.node?.id ?? created.operation?.result?.nodeId;
assert.ok(nodeId);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.SPACE_BROWSER_EXECUTABLE,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
await context.addCookies(
  h.headers.cookie
    .split('; ')
    .map((part) => ({
      name: part.slice(0, part.indexOf('=')),
      value: part.slice(part.indexOf('=') + 1),
      url: h.origin,
      httpOnly: true,
    })),
);
const p = await context.newPage(),
  errors = [],
  consoleErrors = [],
  requests = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (e) => {
  if (e.type() === 'error') consoleErrors.push(e.text().slice(0, 500));
});
p.on('response', async (r) => {
  if (r.url().endsWith('/editor-http')) {
    const request = r.request().postDataJSON().payload;
    const envelope = await r.json().catch(() => null);
    requests.push({
      path: request.path,
      method: request.method,
      status: envelope?.result.value?.status ?? null,
      bodyUnavailable: !envelope,
    });
  }
});
p.setDefaultTimeout(30000);
const token = `BOUND_${Date.now()}`;
try {
  await p.goto(h.origin);
  await p.getByText('TASK-006 最终正式路径验收', { exact: true }).click();
  await p
    .getByRole('navigation', { name: 'Activity bar', exact: true })
    .getByRole('button', { name: 'Space', exact: true })
    .click();
  await p.locator('.sp-file-open').filter({ hasText: name }).click();
  const frame = p.frameLocator('.sp-html-preview iframe');
  await frame
    .locator('#script-marker')
    .getByText('HTML_RUNTIME_OK', { exact: true })
    .waitFor();
  const input = frame.getByRole('textbox', { name: 'Bound cell', exact: true });
  await input.waitFor({ state: 'visible' });
  await input.fill(token);
  await frame.getByRole('heading', { name: 'Live Page', exact: true }).click();
  await p.waitForFunction(() => !document.querySelector('.sp-editor-error'));
  await p.getByRole('button', { name: 'Close viewer', exact: true }).click();
  await p.locator('.sp-page-toolbar').waitFor({ state: 'hidden' });
  const saved = await workspace.read(fixtures.sheet.id);
  assert.ok(
    saved.content.sheets
      .flatMap((s) => s.cells)
      .some(
        (entry) =>
          entry.row === 0 && entry.column === 0 && entry.value === token,
      ),
  );
  await p.locator('.sp-file-open').filter({ hasText: name }).click();
  await frame.locator('#readout').getByText(token, { exact: true }).waitFor();
  await p.getByRole('button', { name: 'Inspect page', exact: true }).click();
  await p.locator('.sp-html-inspect[aria-pressed="true"]').waitFor();
  assert.equal(
    await p
      .getByRole('button', { name: 'Inspect page', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  await p.getByRole('button', { name: 'Inspect page', exact: true }).click();
  await p.locator('.sp-html-inspect[aria-pressed="false"]').waitFor();
  const settings = await openWorkspaceSettings(p);
  await settings.getByLabel('Custom Workspace URL', { exact: true }).fill('http://127.0.0.1:1');
  await settings.getByRole('button', { name: 'Change Server', exact: true }).click();
  await settings.getByRole('alert').waitFor();
  await p.getByRole('button', { name: '关闭', exact: true }).click();
  const recovered = `${token}_RESUMED`;
  await input.fill(recovered);
  await frame.getByRole('heading', { name: 'Live Page', exact: true }).click();
  await p.getByRole('button', { name: 'Close viewer', exact: true }).click();
  await p.locator('.sp-page-toolbar').waitFor({ state: 'hidden' });
  assert.ok(
    (await workspace.read(fixtures.sheet.id)).content.sheets
      .flatMap((s) => s.cells)
      .some(
        (entry) =>
          entry.row === 0 && entry.column === 0 && entry.value === recovered,
      ),
  );
  await p.locator('.sp-file-open').filter({ hasText: name }).click();
  await frame
    .locator('#readout')
    .getByText(recovered, { exact: true })
    .waitFor();
  await p.screenshot({ path: resolve(out, 'html-bound-page.png') });
  assert.deepEqual(errors, []);
  assert.ok(
    requests.some(
      (request) =>
        request.path.includes('new_changes') && request.status === 200,
    ),
  );
  await writeFile(
    resolve(out, 'html-live.json'),
    JSON.stringify(
      {
        carrier: 'Official DSH Web / Microsoft Edge',
        nodeId,
        sourceNodeId: fixtures.sheet.id,
        at: new Date().toISOString(),
        checks: [
          'shared formal HTML renderer mounts real source',
          'sandbox script executes inside Page',
          'bound Sheet authenticated load',
          'human edit flushes to Server on close',
          'reopen displays persisted cell value',
          'formal inspection control',
          'failed connection change resumes same Page and source writes persist',
          'no Page errors',
        ],
        errors,
        consoleErrors,
        requests,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks: 8, errors, consoleErrors }));
} catch (error) {
  await p.screenshot({ path: resolve(out, 'html-failure.png') });
  await writeFile(
    resolve(out, 'html-failure.json'),
    JSON.stringify(
      { error: error.stack, errors, consoleErrors, requests },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
  await workspace.dispose();
}
