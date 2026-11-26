import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const { chromium } = await import(process.env.SPACE_PLAYWRIGHT_MODULE ?? 'playwright');
const { outputFiles } = await build({
  entryPoints: ['src/host-layout.ts'], format: 'iife', globalName: 'adapter', write: false,
});
const css = await readFile('src/space.css', 'utf8');
const browser = await chromium.launch({
  executablePath: process.env.SPACE_BROWSER_EXECUTABLE, chromiumSandbox: true,
});
const releases = [
  { version: '0.2.2-rc.1', commit: 'c59d10a' },
  { version: '0.2.2-rc.5', commit: '3f85d88' },
];
const panel = '<button aria-label="Space"><span aria-hidden="true">S</span><span>Space</span></button>';
const more = '<button aria-label="More" aria-haspopup="menu"><span aria-hidden="true">+</span><span>More</span></button>';
const region = '<div><div data-slot="sidebar.workspaces"></div></div>';
const footer = '<footer><div><div data-slot="sidebar.footer.action"><i id="anchor"></i></div></div><button aria-haspopup="menu">Settings</button></footer>';
const sidebars = [
  `<button aria-label="New session"></button><nav>${panel}<div>${more}</div></nav>${region}`,
  `<div><div data-slot="sidebar.session.action"><button aria-label="New session"></button></div></div>
   <div><div><nav><div>${panel}<button aria-label="Unpin Space" style="position:absolute"></button></div><div>${more}</div></nav>${region}</div></div>`,
];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  for (const [i, markup] of sidebars.entries()) {
    await page.setContent(`<main style="display:grid;grid-template-columns:280px minmax(0,1fr)">
      <aside><div data-slot="sidebar"><div>${markup}${footer}</div></div></aside><div data-shell-overlay></div>
    </main>`);
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: outputFiles[0].text });
    const result = await page.evaluate(({ release, other }) => {
      const anchor = document.getElementById('anchor');
      const frame = document.querySelector('main');
      const nav = document.querySelector('nav');
      const nativeRows = nav.innerHTML;
      function install(release) {
        return window.adapter.installHostNavigation(anchor, {
          graph: { release, entries: [
            { id: '@deepseek-ai/dsh-client-ui-sidebar' }, { id: '@deepseek-ai/dsh-client-ui-layout' },
          ] },
          active: () => 'space-plugin', toggle() {}, collapsed() {},
        });
      }
      const wrongLayout = install(other);
      const untouched = !wrongLayout && !frame.hasAttribute('data-space-host-frame') && nav.innerHTML === nativeRows;
      wrongLayout?.dispose();
      const installed = install(release);
      const row = nav.querySelector('button[aria-label="Space"]');
      const result = {
        untouched, version: frame.dataset.spaceHostFrame,
        rail: nav.getBoundingClientRect().width,
        secondary: document.querySelector('[data-space-host-part="regionArea"]')?.getBoundingClientRect().width,
        button: row.getBoundingClientRect().width,
        glyph: row.firstElementChild.getBoundingClientRect().width,
        title: getComputedStyle(row.lastElementChild).display,
        more: nav.querySelector('[aria-label="More"]').dataset.spaceHostPart,
        unpin: nav.querySelector('[aria-label="Unpin Space"]')?.hasAttribute('data-space-host-part') ?? false,
      };
      installed?.dispose();
      return { ...result, restored: nav.innerHTML === nativeRows &&
        !document.querySelector('[data-space-host-part], [data-space-host-frame], [data-space-host-navigation], [data-space-toggle-mount]') };
    }, { release: releases[i], other: releases[1 - i] });
    assert.deepEqual(result, {
      untouched: true, version: releases[i].version, rail: 52, secondary: 288, button: 36,
      glyph: 18, title: 'none', more: 'panelRow', unpin: false, restored: true,
    });
    console.log(`PASS ${releases[i].version} layout, cross-release fallback and disposal`);
  }
} finally {
  await browser.close();
}
