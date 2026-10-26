/** Actual Host settings theme changes; preserve the user's original preference. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connectHost } from './host-connection.mjs';
const { chromium } = await import(
  process.env.SPACE_PLAYWRIGHT_MODULE ?? 'playwright'
);
const h = await connectHost(),
  out = resolve(process.env.SPACE_EVIDENCE_DIR ?? '/tmp/space-plugin-evidence');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.SPACE_BROWSER_EXECUTABLE,
  }),
  context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
await context.addCookies(
  h.headers.cookie.split('; ').map((x) => ({
    name: x.slice(0, x.indexOf('=')),
    value: x.slice(x.indexOf('=') + 1),
    url: h.origin,
    httpOnly: true,
  })),
);
const p = await context.newPage(),
  errors = [],
  states = [];
p.setDefaultTimeout(25000);
p.on('pageerror', (e) => errors.push(e.message));
async function settings() {
  await p.locator('[data-space-system-settings]').click();
  await p.getByRole('menuitem', { name: '设置', exact: true }).click();
  return p.getByRole('dialog', { name: '设置', exact: true });
}
async function theme(name) {
  const d = await settings();
  await d.getByRole('button', { name, exact: true }).click();
  await d.getByRole('button', { name: '关闭', exact: true }).click();
  await p.waitForFunction(
    (expected) => document.body.hasAttribute('data-ds-dark-theme') === expected,
    name === '深色',
  );
}
async function metrics() {
  return p.evaluate(() => {
    const rgba = (value) => {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      const x = c.getContext('2d');
      x.fillStyle = value;
      x.fillRect(0, 0, 1, 1);
      return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const luminance = (rgb) =>
      rgb
        .map((x) => {
          x /= 255;
          return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        })
        .reduce((n, x, i) => n + x * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a, b) => {
      const x = luminance(rgba(a)),
        y = luminance(rgba(b));
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const root = document.querySelector('[data-space-host-navigation]'),
      heading = document.querySelector('.sp-nav-heading strong'),
      row = document.querySelector('.sp-nav-row:not(.sp-selected)'),
      selected = document.querySelector('.sp-nav-row.sp-selected');
    const background = getComputedStyle(root).backgroundColor,
      color = getComputedStyle(row).color,
      selectedColor = getComputedStyle(selected).color;
    return {
      dark: document.body.hasAttribute('data-ds-dark-theme'),
      title: heading.textContent,
      background,
      color,
      selectedColor,
      contrast: ratio(color, background),
      selectedContrast: ratio(selectedColor, background),
      headingY: heading.getBoundingClientRect().y,
      extraChrome: document.querySelectorAll('[data-space-window-chrome]')
        .length,
    };
  });
}
let original;
try {
  await p.goto(h.origin);
  await p.locator('[data-space-system-settings]').waitFor();
  const d = await settings();
  original = await d
    .locator('button[aria-pressed="true"]')
    .filter({ hasText: /^(浅色|深色|跟随系统)$/ })
    .innerText();
  await d.getByRole('button', { name: '关闭', exact: true }).click();
  for (const [name, id] of [
    ['浅色', 'light'],
    ['深色', 'dark'],
  ]) {
    await theme(name);
    await p
      .getByRole('navigation', { name: 'Activity bar', exact: true })
      .getByRole('button', { name: 'Space', exact: true })
      .click();
    await p
      .getByRole('navigation', { name: 'Content types', exact: true })
      .getByRole('button', { name: 'All', exact: true })
      .click();
    await p.locator('.sp-file-open').first().waitFor();
    const m = await metrics();
    assert.equal(m.title, 'Space');
    assert.ok(m.contrast >= 4.5);
    assert.ok(m.selectedContrast >= 4.5);
    assert.equal(m.extraChrome, 0);
    assert.equal(m.headingY, 14);
    states.push({ theme: id, ...m });
    await p.screenshot({ path: resolve(out, 'space-' + id + '.png') });
    await p
      .getByRole('navigation', { name: 'Activity bar', exact: true })
      .getByRole('button', { name: 'Chat', exact: true })
      .click();
    await p.evaluate(async () => {
      const finite = document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity);
      await Promise.all(finite.map((a) => a.finished.catch(() => {})));
    });
    await p.waitForFunction(() =>
      [
        ...document.querySelectorAll(
          '.kB3qhq_newSessionLabel, [role="treeitem"]',
        ),
      ].every((e) => getComputedStyle(e).opacity === '1'),
    );
    await p.screenshot({ path: resolve(out, 'chat-' + id + '.png') });
  }
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(out, 'theme-live.json'),
    JSON.stringify(
      {
        carrier:
          'Official Host Web, actual native Settings buttons; no injected theme CSS',
        originalPreference: original,
        states,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(states));
} finally {
  if (original) await theme(original);
  await browser.close();
}
