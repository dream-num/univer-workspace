/** Fresh official Host profile + actual Workspace; Web acceptance only. */
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connectHost } from './host-connection.mjs';
const { chromium } = await import(process.env.SPACE_PLAYWRIGHT_MODULE ?? 'playwright');
const host = await connectHost();
assert.equal((await host.request('space/status')).state, 'unconfigured');
const login = JSON.parse(await readFile(process.env.SPACE_TEST_LOGIN_FILE, 'utf8'));
const out = resolve(process.env.SPACE_EVIDENCE_DIR); await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.SPACE_BROWSER_EXECUTABLE });
const checks = [], errors = [];
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies(host.headers.cookie.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: host.origin, httpOnly: true })));
  page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(host.origin);
  // The optional Host account prompt can arrive after hydration. Dismiss its
  // actual close control when it blocks a click; never force through a modal.
  const click = async (control) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await control.click({ timeout: 1500 }); return; }
      catch (error) {
        if (!await page.getByText('开始使用', { exact: true }).isVisible()) throw error;
        await page.getByRole('button', { name: '关闭', exact: true }).click();
        await page.getByText('开始使用', { exact: true }).waitFor({ state: 'hidden' });
      }
    }
    throw new Error('Host setup keeps blocking Workspace settings.');
  };
  const spaceEntry = () => page.getByRole('navigation', { name: 'Activity bar', exact: true }).getByRole('button', { name: 'Space', exact: true });
  await click(spaceEntry());
  await click(page.getByRole('button', { name: 'Settings', exact: true }));
  const dialog = page.getByRole('dialog', { name: 'Space settings' });
  await dialog.getByLabel('Workspace Endpoint').fill('http://127.0.0.1:1');
  await dialog.getByRole('button', { name: '连接服务', exact: true }).click();
  await dialog.getByRole('alert').waitFor();
  assert.equal((await host.request('space/status')).state, 'unconfigured');
  checks.push('First launch offers endpoint settings; failed connection keeps the form and allows retry');
  await page.screenshot({ path: resolve(out, 'connection-error.png') });
  await dialog.getByLabel('Workspace Endpoint').fill(login.origin);
  await dialog.getByRole('button', { name: '连接服务', exact: true }).click();
  await dialog.locator('[data-workspace-status="unauthenticated"]').waitFor();
  await dialog.getByLabel('用户名', { exact: true }).fill(login.username);
  await dialog.getByLabel('密码', { exact: true }).fill(login.password);
  await dialog.getByRole('button', { name: '登录 Workspace', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.locator('.sp-file-open').first().waitFor();
  assert.equal((await host.request('space/status')).state, 'connected');
  checks.push('Actual password authentication closes Settings and opens Space Home with Server content');
  const preferences = await page.evaluate(() => JSON.parse(localStorage.getItem('dsh-space-plugin.connection.v1')));
  assert.deepEqual(preferences, { endpoint: login.origin });
  await page.reload();
  await click(spaceEntry());
  await page.locator('.sp-file-open').first().waitFor();
  checks.push('Reload keeps the non-secret endpoint preference; no password, cookie or license in that record');
  await page.getByRole('button', { name: 'Space settings', exact: true }).click();
  await dialog.locator('[data-workspace-status="connected"]').waitFor();
  assert.equal(await dialog.getByLabel('Workspace Endpoint').inputValue(), login.origin);
  checks.push('The formal Sidebar settings entry reopens the current connection');
  await page.screenshot({ path: resolve(out, 'connected-settings.png') });
  assert.deepEqual(errors, []);
  console.log('PASS first-use Web workflow', checks.length);
} catch (error) {
  if (page) {
    console.log('Fresh Host visible state:', (await page.locator('body').innerText()).slice(-3500));
    await page.screenshot({ path: resolve(out, 'first-use-failure.png') });
  }
  throw error;
} finally {
  await writeFile(resolve(out, 'first-use.json'), JSON.stringify({ carrier: 'official packaged DSH Web; fresh profile, not Desktop', checks, pageErrors: errors, boundary: 'Reload verified. Native application restart and origin persistence need Desktop acceptance.' }, null, 2));
  await browser.close();
}
