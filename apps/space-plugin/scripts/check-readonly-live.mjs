/** Real SDK read-only controls, independent from the native Agent send test. */
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connectHost } from './host-connection.mjs';
const { chromium } = await import(
  process.env.SPACE_PLAYWRIGHT_MODULE ?? 'playwright'
);
const host = await connectHost();
const extra = JSON.parse(
  await readFile(
    process.env.SPACE_MVP_FIXTURES ?? '/tmp/task008-fixtures.json',
    'utf8',
  ),
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.SPACE_BROWSER_EXECUTABLE
    ? { executablePath: process.env.SPACE_BROWSER_EXECUTABLE }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
await context.addCookies(
  host.headers.cookie
    .split('; ')
    .map((pair) => ({
      name: pair.slice(0, pair.indexOf('=')),
      value: pair.slice(pair.indexOf('=') + 1),
      url: host.origin,
      httpOnly: true,
    })),
);
const page = await context.newPage(),
  checks = [],
  errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.goto(host.origin);
  await page.getByRole('button', { name: 'Space', exact: true }).click();
  await page.getByRole('table', { name: 'Content', exact: true }).waitFor();
  for (const type of ['base', 'slide']) {
    const node = extra.nodes.find((node) => node.resource.unitType === type);
    const before = await host.request('space/content', { node: node.id });
    await page.locator('.sp-file-open').filter({ hasText: node.name }).click();
    await page.locator('.sp-viewer[data-viewer-state="ready"]').waitFor();
    if (type === 'base') {
      assert.equal(
        await page
          .locator('.sp-sdk')
          .getByRole('button', { name: '添加记录', exact: true })
          .isDisabled(),
        true,
      );
      assert.equal(
        await page
          .locator('.sp-sdk')
          .getByRole('button', { name: '添加表', exact: true })
          .isDisabled(),
        true,
      );
      checks.push(
        'Base: record and table creation controls are disabled by SDK permissions',
      );
    } else {
      await page
        .locator('.sp-sdk button')
        .filter({ hasText: '+ 新增' })
        .click();
      await page.getByText('空白', { exact: true }).click();
      await page
        .getByText('该内容已受保护，无法执行此操作。', { exact: true })
        .waitFor();
      checks.push(
        'Slides: visible Add menu cannot insert a blank slide; SDK rejects the mutation as protected',
      );
    }
    assert.equal(
      (await host.request('space/content', { node: node.id })).sourceSha256,
      before.sourceSha256,
    );
    await page
      .getByRole('button', { name: 'Close viewer', exact: true })
      .click();
  }
  assert.deepEqual(errors, []);
  const out = resolve(
    process.env.SPACE_EVIDENCE_DIR ?? '/tmp/space-plugin-evidence',
  );
  await mkdir(out, { recursive: true });
  await writeFile(
    resolve(out, 'readonly-ui.json'),
    JSON.stringify(
      {
        carrier: 'Official DSH Web; real published SDK controls',
        checks,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: checks.length }));
} finally {
  await browser.close();
}
