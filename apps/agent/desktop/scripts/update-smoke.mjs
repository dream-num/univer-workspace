import assert from 'node:assert/strict';
import { _electron } from 'playwright';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Linux under Xvfb: an isolated public-SDK staging probe plus the actual update
// page/preloads. Native installation/signature acceptance remains platform CI.
const profile = await mkdtemp(join(tmpdir(), 'uwa-update-ui-'));
let application;
try {
  application = await _electron.launch({ args: [
    fileURLToPath(new URL('../test/update-smoke.cjs', import.meta.url)),
    '--lang=en-US', `--user-data-dir=${profile}`,
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
  ], timeout: 60000 });
  application.process().stdout.pipe(process.stdout);
  application.process().stderr.on('data', data => {
    if (String(data).includes('AssertionError')) process.stderr.write(data);
  });
  let page;
  for (let attempt = 0; attempt < 300; attempt++) {
    page = application.windows().find(p => p.url().endsWith('/update.html'));
    if (page) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(page, 'Update window must open after the real updater handoff');
  await page.getByRole('heading', { name: 'Software update', exact: true }).waitFor();
  assert.ok((await page.locator('#version').innerText()).includes('0.1.0-alpha.9'));
  await page.getByRole('button', { name: 'Download update', exact: true }).click();
  await page.getByRole('heading', { name: 'Downloading update…', exact: true }).waitFor();
  assert.ok((await page.locator('#transfer').innerText()).includes('42.0%'));
  assert.equal(await page.locator('progress').getAttribute('value'), '42');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Resume download', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Resume download', exact: true }).click();
  await page.close();
  const reopened = application.waitForEvent('window');
  await application.evaluate(() => globalThis.updateSmoke.show());
  const again = await reopened;
  await again.getByRole('heading', { name: 'Downloading update…', exact: true }).waitFor();
  assert.ok((await again.locator('#transfer').innerText()).includes('42.0%'));
  await application.evaluate(() => globalThis.updateSmoke.set({ phase: 'download-error' }));
  await again.getByRole('button', { name: 'Retry download', exact: true }).waitFor();
  await again.getByRole('button', { name: 'Retry download', exact: true }).click();
  await application.evaluate(() => globalThis.updateSmoke.set({ phase: 'ready' }));
  await again.getByRole('button', { name: 'Restart and install', exact: true }).waitFor();
  assert.equal(await again.locator('img').count(), 0);
  const forbidden = await again.evaluate(async () => {
    // The update page has no arbitrary IPC or Node access.
    return { require: typeof window.require, ipc: typeof window.ipcRenderer, desktop: typeof window.workspaceDesktop };
  });
  assert.deepEqual(forbidden, { require: 'undefined', ipc: 'undefined', desktop: 'undefined' });
  await again.screenshot({ path: '/tmp/uwa-update-window.png' });
  console.log('Update UI progress, pause/resume, reopen, retry and restart consent passed.');
} finally {
  await application?.close();
  await rm(profile, { recursive: true, force: true });
}
