/** Minimal reproduction of public Host toggle width loss; changes only this Web client's layout. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connectHost } from './host-connection.mjs';
const { chromium } = await import(
  process.env.SPACE_PLAYWRIGHT_MODULE ?? 'playwright'
);
const h = await connectHost(),
  b = await chromium.launch({
    headless: true,
    ...(process.env.SPACE_BROWSER_EXECUTABLE
      ? { executablePath: process.env.SPACE_BROWSER_EXECUTABLE }
      : {}),
  }),
  c = await b.newContext({ viewport: { width: 1440, height: 900 } });
await c.addCookies(
  h.headers.cookie
    .split('; ')
    .map((p) => ({
      name: p.slice(0, p.indexOf('=')),
      value: p.slice(p.indexOf('=') + 1),
      url: h.origin,
      httpOnly: true,
    })),
);
const p = await c.newPage();
try {
  await p.goto(h.origin);
  await p.getByRole('button', { name: 'Space', exact: true }).waitFor();
  if (await p.getByRole('button', { name: '打开侧边栏', exact: true }).count())
    await p.getByRole('button', { name: '打开侧边栏', exact: true }).click();
  const handle = await p.locator('[data-side="sidebar"]').boundingBox();
  await p.mouse.move(handle.x + handle.width / 2, 200);
  await p.mouse.down();
  await p.mouse.move(handle.x + handle.width / 2 + 50, 200, { steps: 10 });
  await p.mouse.up();
  const custom = Number.parseFloat(
    await p.locator('[data-side="sidebar"]').evaluate((e) => e.style.left),
  );
  await p.getByRole('button', { name: '收起侧边栏', exact: true }).click();
  await p.waitForTimeout(400);
  const rail = Number.parseFloat(
    await p
      .locator('[data-sidebar-collapsed="true"]')
      .first()
      .evaluate((e) => getComputedStyle(e).gridTemplateColumns),
  );
  await p.getByRole('button', { name: '打开侧边栏', exact: true }).click();
  await p.waitForTimeout(400);
  const reopened = Number.parseFloat(
    await p.locator('[data-side="sidebar"]').evaluate((e) => e.style.left),
  );
  assert.equal(custom, 330);
  assert.equal(reopened, 280);
  const out = resolve(
    process.env.SPACE_EVIDENCE_DIR ?? '/tmp/space-plugin-evidence',
  );
  await mkdir(out, { recursive: true });
  await writeFile(
    resolve(out, 'layout-repro.json'),
    JSON.stringify(
      {
        carrier:
          'Official DSH Web, 1440x900, native controls calling public toggleSidebar',
        custom,
        reopened,
        collapsedState: rail,
        verified:
          'Two toggles discard a custom sidebar width; panelInfo has no sidebar state in the published contract',
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ custom, reopened }));
} finally {
  await b.close();
}
