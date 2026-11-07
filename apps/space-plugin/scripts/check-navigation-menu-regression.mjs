import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const { chromium } = await import(process.env.SPACE_PLAYWRIGHT_MODULE ?? 'playwright');
const evidence = resolve(process.env.SPACE_EVIDENCE_DIR ?? '/tmp/space-navigation-menu');
await mkdir(evidence, { recursive: true });
// Use the production Navigation and CreateMenu with enough pinned metadata to
// exercise its actual nested overflow container, not a substitute scroll box.
const nodes = Array.from({ length: 30 }, (_, i) => ({ id: `node-${i}`, name: `Pinned document ${i}`,
  spaceId: 'personal', type: 'resource', resource: { id: `res-${i}`, kind: 'unit', unitId: `unit-${i}`, unitType: 'doc' },
  capabilities: { rename: true } }));
const bundle = await build({ entryPoints: ['test/fixtures/create-menu-harness.tsx'], bundle: true,
  write: false, format: 'iife', platform: 'browser', jsx: 'automatic', loader: { '.css': 'empty' },
  plugins: [{ name: 'navigation-menu-fixture-data', setup(builder) {
    builder.onLoad({ filter: /create-menu-harness\.tsx$/ }, async ({ path }) => ({ loader: 'tsx',
      contents: (await readFile(path, 'utf8')).replace('all: [], recent: []', `all: ${JSON.stringify(nodes)}, recent: []`)
        .replace('pins: []', `pins: ${JSON.stringify(nodes.map(node => node.id))}`),
    }));
  } }],
});
const css = await readFile('src/space.css', 'utf8'), tw = await readFile('lib/tailwind.css', 'utf8');
const browser = await chromium.launch({ headless: true, executablePath: process.env.SPACE_BROWSER_EXECUTABLE });
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
page.setDefaultTimeout(10000);
const results = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.setContent(`<html><head><style>${tw}\n${css}</style></head><body style="font-family:system-ui"><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`);
  const row = page.locator('.sp-nav-file').first(), summary = row.locator('summary');
  const menu = page.getByRole('menu');
  await row.hover(); await summary.click(); await menu.waitFor();
  await page.waitForTimeout(100);
  const initial = await menu.evaluate(element => ({ menu: element.getBoundingClientRect().toJSON(),
    scroller: document.querySelector('.sp-nav-scroll').getBoundingClientRect().toJSON(),
    host: document.querySelector('.sp-shell:not(.sp-menu-portal)').getBoundingClientRect().toJSON() }));
  results.push({ case: 'menu may escape nested scroller while staying inside shell', result: initial,
    passed: initial.menu.left >= initial.host.left && initial.menu.right <= initial.host.right &&
      initial.menu.top >= initial.host.top && initial.menu.bottom <= initial.host.bottom });
  await summary.evaluate(element => {
    const scroller = element.closest('.sp-nav-scroll');
    const rect = element.getBoundingClientRect(), bounds = scroller.getBoundingClientRect();
    scroller.scrollTop += rect.top - bounds.top + rect.height / 2;
  });
  await page.waitForTimeout(200);
  const partial = await summary.evaluate(element => ({ anchor: element.getBoundingClientRect().toJSON(),
    scroller: element.closest('.sp-nav-scroll').getBoundingClientRect().toJSON(),
    portalCount: document.querySelectorAll('.sp-menu-portal').length }));
  results.push({ case: 'partly clipped reference keeps menu available', result: partial,
    passed: partial.anchor.top < partial.scroller.top && partial.anchor.bottom > partial.scroller.top && partial.portalCount === 1 });
  await page.locator('.sp-nav-scroll').evaluate(element => { element.scrollTop += 25; });
  await page.waitForTimeout(200);
  const hidden = await summary.evaluate(element => ({ anchor: element.getBoundingClientRect().toJSON(),
    scroller: element.closest('.sp-nav-scroll').getBoundingClientRect().toJSON(),
    host: element.closest('.sp-shell').getBoundingClientRect().toJSON(),
    portalCount: document.querySelectorAll('.sp-menu-portal').length,
    open: element.closest('details').open }));
  results.push({ case: 'fully clipped reference inside shell dismisses nested Navigation menu', result: hidden,
    passed: hidden.anchor.bottom <= hidden.scroller.top && hidden.anchor.top > hidden.host.top &&
      hidden.portalCount === 0 && !hidden.open });
  await page.screenshot({ path: resolve(evidence, 'navigation-after-scroll.png') });
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const shell = document.querySelector('.sp-shell');
    shell.style.width = '190px'; shell.style.setProperty('--sp-nav-width', '190px');
  });
  await page.locator('.sp-nav-create summary').click(); await menu.waitFor(); await page.waitForTimeout(200);
  const narrow = await menu.evaluate(element => ({ menu: element.getBoundingClientRect().toJSON(),
    buttons: Array.from(element.querySelectorAll('button')).map(button => {
      const range = document.createRange(); range.selectNodeContents(button);
      return { text: button.innerText, button: button.getBoundingClientRect().toJSON(), contents: range.getBoundingClientRect().toJSON(),
        scrollHeight: button.scrollHeight, clientHeight: button.clientHeight };
    }) }));
  results.push({ case: '190px Create host keeps wrapped label contents inside each row', result: narrow,
    passed: narrow.buttons.every(({ button, contents, scrollHeight, clientHeight }) =>
      contents.top >= button.top - 0.5 && contents.bottom <= button.bottom + 0.5 && scrollHeight <= clientHeight + 1) });
  await page.screenshot({ path: resolve(evidence, 'create-narrow.png') });
  assert.deepEqual(errors, []);
  assert.deepEqual(results.filter(result => !result.passed).map(result => result.case), []);
  console.log(`PASS ${results.length} actual Navigation/Create menu regression checks`);
} finally {
  await writeFile(resolve(evidence, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  await browser.close();
}
