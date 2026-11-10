import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const { chromium } = await import(process.env.SPACE_PLAYWRIGHT_MODULE ?? 'playwright');
const bundle = await build({ entryPoints: ['test/fixtures/floating-menu-harness.tsx'], bundle: true,
  write: false, format: 'iife', platform: 'browser', jsx: 'automatic', loader: { '.css': 'empty' } });
const css = await readFile('src/space.css', 'utf8');
const tailwind = await readFile('lib/tailwind.css', 'utf8');
const source = bundle.outputFiles[0].text.replaceAll('</script', '<\\/script');
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<html><head><style>${tailwind}\n${css}</style></head><body style="font-family:system-ui"><div id="root"></div><script>${source}</script></body></html>`);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ headless: true, executablePath: process.env.SPACE_BROWSER_EXECUTABLE });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.setDefaultTimeout(10000);
const checks = [], errors = [], evidence = resolve(process.env.SPACE_EVIDENCE_DIR ?? '/tmp/space-floating-menu');
await mkdir(evidence, { recursive: true });
page.on('pageerror', (error) => errors.push(error.message));
const menu = page.getByRole('menu');
const trigger = page.getByLabel('Fixture menu', { exact: true }).filter({ hasText: 'Open menu' });
const settle = async () => { await menu.waitFor({ state: 'visible' }); await page.waitForTimeout(100); };
async function withinHost() {
  await settle();
  const geometry = await menu.evaluate((element) => {
    const r = element.getBoundingClientRect(), h = document.querySelector('[data-testid="host"]').getBoundingClientRect();
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height,
      host: { x: h.x, y: h.y, right: Math.min(h.right, visualViewport.width + visualViewport.offsetLeft),
        bottom: Math.min(h.bottom, visualViewport.height + visualViewport.offsetTop) }, placement: element.dataset.placement };
  });
  assert.ok(geometry.width > 0 && geometry.height > 0, JSON.stringify(geometry));
  assert.ok(geometry.x >= geometry.host.x + 7 && geometry.y >= geometry.host.y + 7 &&
    geometry.right <= geometry.host.right - 7 && geometry.bottom <= geometry.host.bottom - 7, JSON.stringify(geometry));
  return geometry;
}
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  for (const position of [{ x: 10, y: 10 }, { x: 480, y: 10 }, { x: 10, y: 370 }, { x: 480, y: 370 }]) {
    await page.evaluate((position) => window.__floatingTest.setPosition(position), position);
    await trigger.click();
    const geometry = await withinHost();
    assert.equal(await menu.evaluate((element) => element.closest('[data-testid="host"]')), null);
    checks.push({ case: 'anchored corner', position, geometry });
    await page.keyboard.press('Escape');
  }
  await page.evaluate(() => window.__floatingTest.setPosition({ x: 250, y: 200 }));
  await trigger.focus();
  await page.keyboard.press('ArrowDown'); await settle();
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Item 0');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Item 2');
  await page.keyboard.press('End');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Item 4');
  await page.keyboard.press('Home'); await page.keyboard.press('Enter');
  await menu.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.__floatingTest.selected), 'Item 0');
  await trigger.focus(); await page.keyboard.press('ArrowUp'); await settle();
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Item 4');
  await page.keyboard.press('Escape');
  assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
  for (const [key, expected] of [['Tab', 'after'], ['Shift+Tab', 'before']]) {
    await trigger.focus(); await page.keyboard.press('ArrowDown'); await settle();
    await page.keyboard.press(key); await menu.waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => document.activeElement.id), expected);
  }
  checks.push({ case: 'keyboard: arrows, disabled skip, Home/End, activation, Escape, Tab and Shift+Tab' });
  await trigger.click(); await settle();
  await menu.getByRole('menuitem', { name: 'Item 1', exact: true }).click({ force: true });
  assert.equal(await menu.isVisible(), true);
  await page.locator('#outside').click(); await menu.waitFor({ state: 'detached' });
  checks.push({ case: 'disabled item stays open; outside pointer dismisses' });
  await page.evaluate(() => {
    const frame = document.createElement('iframe');
    frame.srcdoc = '<button>Iframe outside</button>';
    frame.style.cssText = 'position:absolute;left:680px;top:480px;width:110px;height:70px';
    document.body.append(frame);
  });
  await trigger.click(); await settle();
  await page.frameLocator('iframe').getByRole('button', { name: 'Iframe outside' }).click();
  await menu.waitFor({ state: 'detached' });
  await page.locator('iframe').evaluate((element) => element.remove());
  checks.push({ case: 'outside iframe click dismisses via window blur' });
  await page.evaluate(() => window.__floatingTest.setPosition({ x: 250, y: 80 }));
  await page.getByTestId('host').evaluate((element) => { element.scrollTop = 0; });
  await trigger.click(); await settle();
  const before = await menu.evaluate((element) => element.getBoundingClientRect().y);
  await page.getByTestId('host').evaluate((element) => { element.scrollTop = 50; });
  await page.waitForTimeout(150); await withinHost();
  const after = await menu.evaluate((element) => element.getBoundingClientRect().y);
  assert.ok(Math.abs(before - after - 50) <= 1, `${before} -> ${after}`);
  checks.push({ case: 'ancestor scroll follows anchor', before, after });
  await page.getByTestId('host').evaluate((element) => { element.scrollTop = 600; });
  await menu.waitFor({ state: 'detached' });
  await page.getByTestId('host').evaluate((element) => { element.scrollTop = 0; });
  await trigger.click(); await settle();
  checks.push({ case: 'scrolling the reference out of the host dismisses its menu' });
  await page.evaluate(() => window.__floatingTest.setCount(40));
  const long = await withinHost();
  assert.equal(await menu.evaluate((element) => element.scrollHeight > element.clientHeight), true);
  await page.keyboard.press('End');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Item 39');
  assert.equal(await menu.evaluate((element) => element.scrollTop > 0), true);
  await page.evaluate(() => window.__floatingTest.setDark(true)); await page.waitForTimeout(150);
  assert.equal(await menu.evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(24, 26, 27)');
  await page.screenshot({ path: resolve(evidence, 'long-menu-dark.png') });
  checks.push({ case: 'dynamic long menu scroll and portal theme switch', geometry: long });
  await page.evaluate(() => window.__floatingTest.setPosition({ x: 10, y: 80 }));
  await page.waitForTimeout(100);
  await page.getByTestId('host').evaluate((element) => { element.style.width = '190px'; element.style.height = '260px'; });
  await withinHost();
  checks.push({ case: 'host resize constrains actual menu width/height' });
  await page.setViewportSize({ width: 300, height: 230 }); await withinHost();
  checks.push({ case: 'viewport resize constrains host intersection' });
  await page.setViewportSize({ width: 800, height: 600 });
  await page.keyboard.press('Escape');
  await page.getByTestId('host').evaluate((element) => { element.style.width = '600px'; element.style.height = '420px'; element.scrollTop = 0; });
  await page.evaluate(() => { window.__floatingTest.setCount(5); window.__floatingTest.setPosition({ x: 100, y: 160 }); });
  await page.evaluate(() => { document.querySelector('[data-testid="host"]').style.zoom = '1.25'; });
  await trigger.click(); await withinHost();
  checks.push({ case: 'CSS host zoom 125%' });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.5 });
  await withinHost();
  checks.push({ case: 'visual viewport scale 150%' });
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  await page.keyboard.press('Escape');
  await page.evaluate(() => { document.querySelector('[data-testid="host"]').style.zoom = '1'; });
  for (const position of [{ x: 10, y: 10 }, { x: 430, y: 10 }, { x: 10, y: 350 }, { x: 430, y: 350 }]) {
    await page.evaluate((position) => window.__floatingTest.setPosition(position), position);
    await page.locator('#point').click({ button: 'right' });
    const geometry = await withinHost();
    await page.keyboard.press('End');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Point 4');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'point');
    checks.push({ case: 'point corner and keyboard', position, geometry });
  }
  await page.evaluate(() => window.__floatingTest.setReal(true));
  await page.locator('.sp-file-row').click({ button: 'right' });
  await withinHost();
  assert.equal(await menu.getAttribute('aria-label'), 'Actions for Fixture Doc');
  await page.screenshot({ path: resolve(evidence, 'content-file-actions.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.sp-file-open').evaluate((element) => element === document.activeElement), true);
  checks.push({ case: 'actual ContentBrowser right-click FileActions and focus return' });
  await page.locator('.sp-file-row summary').click(); await withinHost();
  assert.equal(await menu.getByRole('menuitem', { name: 'Move to folder', exact: true }).isDisabled(), true);
  await menu.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  await menu.waitFor({ state: 'detached' });
  const action = JSON.parse(await page.evaluate(() => window.__floatingTest.selected));
  assert.equal(action.action.kind, 'rename');
  assert.equal(action.action.node.id, 'fixture-node');
  assert.equal(action.action.node.resource.id, 'fixture-resource');
  checks.push({ case: 'actual row More retains FileActions capability and exact target identity' });
  await page.locator('.sp-file-row').click({ button: 'right' }); await settle();
  await page.evaluate(() => window.__floatingTest.setReal(false));
  await menu.waitFor({ state: 'detached' });
  assert.equal(await page.locator('.sp-menu-portal').count(), 0);
  checks.push({ case: 'anchor removal dismisses and portal is cleaned up' });
  assert.deepEqual(errors, []);
  await writeFile(resolve(evidence, 'results.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(`PASS ${checks.length} floating menu browser checks; evidence: ${evidence}`);
} catch (error) {
  await page.screenshot({ path: resolve(evidence, 'failure.png') });
  await writeFile(resolve(evidence, 'failure.json'), JSON.stringify({ checks, errors, error: String(error) }, null, 2));
  throw error;
} finally { await browser.close(); await new Promise((done) => server.close(done)); }
