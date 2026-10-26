/** Two isolated browser contexts, actual keyboard edits and remote clipboard reads.
 * Content is never injected through Snapshot APIs or test-only application hooks. */
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connectHost } from './host-connection.mjs';
const { chromium } = await import(
  process.env.SPACE_PLAYWRIGHT_MODULE ?? 'playwright'
);
const h = await connectHost(),
  fixtures = JSON.parse(
    await readFile(
      process.env.SPACE_COLLAB_FIXTURES ?? '/tmp/task009b-fixtures.json',
      'utf8',
    ),
  );
const out = resolve(process.env.SPACE_EVIDENCE_DIR ?? '/tmp/task009b-evidence');
await mkdir(out, { recursive: true });
const b = await chromium.launch({
  headless: true,
  executablePath: process.env.SPACE_BROWSER_EXECUTABLE,
});
const clients = [],
  checks = [],
  wire = [],
  errors = [];
async function client(label) {
  const c = await b.newContext({
    viewport: { width: 1600, height: 1000 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await c.addCookies(
    h.headers.cookie.split('; ').map((p) => ({
      name: p.slice(0, p.indexOf('=')),
      value: p.slice(p.indexOf('=') + 1),
      url: h.origin,
      httpOnly: true,
    })),
  );
  const p = await c.newPage();
  p.setDefaultTimeout(30000);
  p.on('pageerror', (e) => errors.push({ client: label, error: e.message }));
  p.on('response', async (r) => {
    if (r.url().endsWith('/editor-http')) {
      const req = r.request().postDataJSON().payload,
        body = await r.json();
      wire.push({
        client: label,
        path: req.path,
        method: req.method,
        status: body.result.value?.status,
        error: body.result.error?.message,
        at: new Date().toISOString(),
      });
    }
  });
  p.on('websocket', (s) => {
    if (new URL(s.url()).pathname === '/universer-api/comb/connect') {
      const record = {
        client: label,
        path: '/universer-api/comb/connect',
        sent: 0,
        received: 0,
      };
      wire.push(record);
      s.on('framesent', () => record.sent++);
      s.on('framereceived', () => record.received++);
    }
  });
  await p.goto(h.origin);
  await p.getByText('TASK-006 最终正式路径验收', { exact: true }).click();
  await p
    .getByRole('navigation', { name: 'Activity bar', exact: true })
    .getByRole('button', { name: 'Space', exact: true })
    .click();
  clients.push({ c, p, label });
  return p;
}
async function open(p, node) {
  await p.locator('.sp-file-open').filter({ hasText: node.name }).click();
  await p.locator('[data-editor-state="saved"]').waitFor();
}
async function docFocus(p) {
  await p.bringToFront();
  const rect = await p.locator('.sp-sdk canvas').last().boundingBox();
  await p.mouse.click(rect.x + 190, rect.y + 100);
}
async function copyDoc(p) {
  await docFocus(p);
  await p.keyboard.press('Meta+a');
  await p.evaluate(() => navigator.clipboard.writeText('__pending_copy__'));
  await p.keyboard.press('Meta+c');
  await p.waitForFunction(
    async () => (await navigator.clipboard.readText()) !== '__pending_copy__',
  );
  return p.evaluate(() => navigator.clipboard.readText());
}
async function cell(p, col = 0) {
  await p.bringToFront();
  await p.keyboard.press('Escape');
  await p.keyboard.press('Escape');
  const namebox = p
    .locator('.sp-sdk input[class*="univer-appearance-none"]')
    .first();
  await namebox.fill(col === 0 ? 'A1' : 'B1');
  await namebox.press('Enter');
  const rect = await p.locator('.sp-sdk canvas').last().boundingBox();
  await p.mouse.click(rect.x + 80 + col * 88, rect.y + 34);
  await p.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}

async function copyCell(p, col) {
  await cell(p, col);
  await p.evaluate(() => navigator.clipboard.writeText('__pending_copy__'));
  await p.keyboard.press('Meta+c');
  await p.waitForFunction(
    async () => (await navigator.clipboard.readText()) !== '__pending_copy__',
  );
  return p.evaluate(() => navigator.clipboard.readText());
}
async function expectContent(read, expected, what) {
  for (let i = 0; i < 20; i++) {
    const text = await read();
    if (text.includes(expected)) {
      checks.push({ what, content: text, at: new Date().toISOString() });
      return text;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${what}: remote content did not contain ${expected}`);
}
const results = {};
try {
  const a = await client('A'),
    z = await client('B');
  for (const kind of ['doc', 'sheet']) {
    const node = fixtures[kind],
      stamp = Date.now(),
      tokenA = `FROM_A_${stamp}`,
      tokenB = `FROM_B_${stamp}`;
    await open(a, node);
    await open(z, node);
    if (kind === 'doc') {
      await docFocus(a);
      await a.keyboard.type(tokenA + ' ', { delay: 10 });
      await expectContent(
        () => copyDoc(z),
        tokenA,
        'Doc A → B without refresh',
      );
      await z.keyboard.press('ArrowRight');
      await z.keyboard.type(tokenB, { delay: 10 });
      await expectContent(
        () => copyDoc(a),
        tokenB,
        'Doc B → A without refresh',
      );
      await docFocus(z);
      await z.keyboard.press('Meta+z');
      for (let i = 0; i < 30; i++) {
        if (!(await copyDoc(a)).includes(tokenB)) break;
        await a.waitForTimeout(100);
      }
      assert.ok(!(await copyDoc(a)).includes(tokenB));
      checks.push({ what: 'Doc Undo remotely removes B edit' });
      await docFocus(z);
      await z.keyboard.press('Meta+Shift+z');
      await expectContent(
        () => copyDoc(a),
        tokenB,
        'Doc Redo remotely restores B edit',
      );
    } else {
      await cell(a, 0);
      await a.keyboard.type(tokenA, { delay: 30 });
      await a.keyboard.press('Enter');
      await expectContent(
        () => copyCell(z, 0),
        tokenA,
        'Sheet A1 A → B without refresh',
      );
      await cell(z, 1);
      await z.keyboard.type(tokenB, { delay: 30 });
      await z.keyboard.press('Enter');
      await expectContent(
        () => copyCell(a, 1),
        tokenB,
        'Sheet B1 B → A without refresh',
      );
    }
    for (const [label, p] of [
      ['A', a],
      ['B', z],
    ])
      await p.screenshot({ path: resolve(out, `${kind}-${label}-synced.png`) });
    // Both leave via the application flush barrier, then reload from Server.
    await a.getByRole('button', { name: 'Close viewer', exact: true }).click();
    await z.getByRole('button', { name: 'Close viewer', exact: true }).click();
    await a.locator('[data-editor-state]').waitFor({ state: 'detached' });
    await z.locator('[data-editor-state]').waitFor({ state: 'detached' });
    await open(a, node);
    await open(z, node);
    for (const [label, p] of [
      ['A', a],
      ['B', z],
    ]) {
      if (kind === 'doc') {
        const text = await copyDoc(p);
        assert.ok(text.includes(tokenA) && text.includes(tokenB));
        checks.push({ what: `Doc ${label} reopen`, content: text });
      } else {
        assert.ok((await copyCell(p, 0)).includes(tokenA));
        assert.ok((await copyCell(p, 1)).includes(tokenB));
        checks.push({
          what: `Sheet ${label} reopen A1/B1`,
          content: [await copyCell(p, 0), await copyCell(p, 1)],
        });
      }
    }
    const persisted = await h.request('space/content', { node: node.id });
    if (kind === 'doc')
      assert.ok(
        persisted.content.text.includes(tokenA) &&
          persisted.content.text.includes(tokenB),
      );
    else {
      const values = persisted.content.sheets.flatMap((s) =>
        s.cells.map((c) => c.value),
      );
      assert.ok(values.includes(tokenA) && values.includes(tokenB));
    }
    results[kind] = {
      nodeId: node.id,
      unitId: node.resource.unitId,
      revision: persisted.revision,
      content: persisted.content,
      sha256: persisted.sha256,
    };
    checks.push({
      what: `${kind} Server materialized content equals both browser reads`,
    });
    await a.getByRole('button', { name: 'Close viewer', exact: true }).click();
    await z.getByRole('button', { name: 'Close viewer', exact: true }).click();
  }
  assert.deepEqual(errors, []);
  assert.ok(
    wire.filter(
      (w) =>
        w.path === '/universer-api/comb/connect' &&
        w.sent > 0 &&
        w.received > 0,
    ).length >= 4,
  );
  await writeFile(
    resolve(out, 'collaboration-live.json'),
    JSON.stringify(
      {
        carrier:
          'Official DSH 0.2.1-rc.3 Web / two isolated Edge contexts / same Workspace Server, same Workspace user',
        checks,
        results,
        wire,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks: checks.length, results }));
} catch (e) {
  for (const { p, label } of clients) {
    await p
      .screenshot({ path: resolve(out, `collaboration-failure-${label}.png`) })
      .catch(() => {});
    console.log(label, (await p.locator('body').innerText()).slice(-2500));
  }
  console.log(JSON.stringify({ checks, errors, wire }));
  throw e;
} finally {
  await b.close();
}
