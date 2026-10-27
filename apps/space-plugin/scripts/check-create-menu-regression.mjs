import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const { chromium } = await import(process.env.SPACE_PLAYWRIGHT_MODULE ?? 'playwright');
const bundled = await build({ entryPoints: ['test/fixtures/create-menu-harness.tsx'], bundle: true,
  write: false, format: 'iife', platform: 'browser', jsx: 'automatic', loader: { '.css': 'empty' } });
const css = await readFile('src/space.css', 'utf8');
const tailwind = await readFile('lib/tailwind.css', 'utf8');
const source = bundled.outputFiles[0].text.replaceAll('</script', '<\\/script');
let releaseCreate;
const held = new Promise((resolve) => { releaseCreate = resolve; });
const requests = [];
const server = createServer(async (req, res) => {
  if (req.url === '/fixture/create') {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    await held;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'server-created-sheet' }));
  } else {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<html><head><style>${tailwind}\n${css}</style></head><body><div id="root"></div><script>${source}</script></body></html>`);
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, executablePath: process.env.SPACE_BROWSER_EXECUTABLE });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(10000);
const checks = [];
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const main = page.locator('.sp-primary'), trigger = main.locator('summary');
  const item = (name) => main.getByRole('menuitem', { name, exact: true });
  const dialog = (kind) => page.getByRole('dialog', { name: `Create ${kind}`, exact: true });
  const cancel = async (kind) => dialog(kind).getByRole('button', { name: 'Cancel', exact: true }).click();

  await page.evaluate(() => window.__menuTest.setBusy(true));
  await page.getByText('Loading content…').waitFor();
  await trigger.click();
  assert.deepEqual(await main.getByRole('menuitem').allTextContents(), ['Doc','Sheet','Slide','Canvas','Relational Table','Page','Folder','Space']);
  assert.equal(await item('Sheet').isEnabled(), true);
  await item('Sheet').click();
  assert.equal(await dialog('sheet').isVisible(), true);
  await cancel('sheet');
  checks.push('first Sheet click opens the dialog while background work is pending');

  for (let i = 0; i < 3; i++) {
    await trigger.click();
    assert.equal(await main.locator('details').getAttribute('open'), '');
    await trigger.click();
    assert.equal(await main.locator('details').getAttribute('open'), null);
  }
  await trigger.click();
  await item('Doc').hover();
  await item('Sheet').hover();
  await page.locator('h1').click();
  assert.equal(await main.locator('details').getAttribute('open'), null);
  checks.push('repeated opening, pointer movement and outside dismissal');

  await trigger.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  assert.equal(await item('Sheet').evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press('Enter');
  assert.equal(await dialog('sheet').isVisible(), true);
  await cancel('sheet');
  await trigger.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  assert.equal(await main.locator('details').getAttribute('open'), null);
  checks.push('keyboard opening, navigation, selection and Escape');

  for (const [label, kind] of [['Doc','doc'],['Sheet','sheet'],['Slide','slide'],['Canvas','board'],['Relational Table','base'],['Page','site'],['Folder','folder'],['Space','space']]) {
    await trigger.click();
    await item(label).click();
    assert.equal(await dialog(kind).isVisible(), true);
    await cancel(kind);
  }
  await page.evaluate(() => window.__menuTest.setAllowed(false));
  await trigger.click();
  assert.equal(await item('Sheet').isDisabled(), true);
  assert.equal(await item('Space').isEnabled(), true);
  await trigger.click();
  await page.evaluate(() => window.__menuTest.setAllowed(true));
  checks.push('all eight entries remain selectable and destination permissions still apply');

  await page.evaluate(() => window.__menuTest.setBusy(false));
  await trigger.click();
  await item('Sheet').click();
  await dialog('sheet').getByLabel('Name', { exact: true }).fill('Slow Sheet');
  const outgoing = page.waitForRequest((req) => req.url().endsWith('/fixture/create'));
  await dialog('sheet').getByRole('button', { name: 'Create', exact: true }).click();
  await outgoing;
  assert.equal(await dialog('sheet').getByRole('button', { name: 'Creating…', exact: true }).isDisabled(), true);
  await dialog('sheet').evaluate((form) => { form.requestSubmit(); form.requestSubmit(); });
  releaseCreate();
  await page.getByTestId('editor-fixture').waitFor();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].kind, 'sheet');
  assert.equal(requests[0].name, 'Slow Sheet');
  checks.push('one request for rapid repeat submissions, with loading until the delayed response');

  const sidebar = page.locator('.sp-nav-create');
  await sidebar.locator('summary').click();
  await sidebar.getByRole('menuitem', { name: 'Doc', exact: true }).click();
  assert.equal(await dialog('doc').isVisible(), true);
  await cancel('doc');
  await sidebar.locator('summary').click();
  assert.equal(await sidebar.getByRole('menuitem', { name: 'Sheet', exact: true }).isVisible(), true);
  checks.push('menu reopens after creation and while an editor fixture is mounted');

  const events = await page.evaluate(() => window.__menuTest.events);
  const result = { carrier: 'Playwright / real React menu components / controllable HTTP fixture; not a real Server or Desktop', checks, requests: requests.length, events };
  if (process.env.SPACE_EVIDENCE_DIR) {
    await mkdir(process.env.SPACE_EVIDENCE_DIR, { recursive: true });
    await writeFile(resolve(process.env.SPACE_EVIDENCE_DIR, 'create-menu-component.json'), JSON.stringify(result, null, 2));
  }
  console.log(JSON.stringify({ carrier: result.carrier, checks, requests: requests.length }, null, 2));
} finally {
  releaseCreate();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
