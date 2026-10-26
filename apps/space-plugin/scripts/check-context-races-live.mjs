/** Delays real HTTP requests without fabricating responses; preserves the native runtime. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connectHost } from './host-connection.mjs';
const { chromium } = await import(
    process.env.SPACE_PLAYWRIGHT_MODULE ?? 'playwright'
  ),
  f = JSON.parse(await readFile(process.env.SPACE_TEST_LOGIN_FILE, 'utf8')),
  out = resolve(process.env.SPACE_EVIDENCE_DIR ?? '/tmp/space-plugin-evidence');
await mkdir(out, { recursive: true });
const h = await connectHost(),
  b = await chromium.launch({
    headless: true,
    executablePath: process.env.SPACE_BROWSER_EXECUTABLE,
  }),
  c = await b.newContext({ viewport: { width: 1440, height: 900 } }),
  checks = [],
  errors = [],
  receipts = [];
await c.addCookies(
  h.headers.cookie.split('; ').map((p) => ({
    name: p.slice(0, p.indexOf('=')),
    value: p.slice(p.indexOf('=') + 1),
    url: h.origin,
    httpOnly: true,
  })),
);
const p = await c.newPage();
p.setDefaultTimeout(20000);
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (e) => {
  if (e.type() === 'error') errors.push(e.text().slice(0, 400));
});
const panel = () => p.locator('.sp-floating-chat');
const nav = (label) =>
  p
    .getByRole('navigation', { name: 'Space navigation', exact: true })
    .getByRole('button', { name: label, exact: true });
async function open(n) {
  await nav('All').click();
  await p.locator('.sp-file-open').filter({ hasText: n.name }).click();
  await p.locator('.sp-viewer[data-viewer-state="ready"]').waitFor();
}
try {
  await p.goto(h.origin);
  await p.getByText('TASK-006 最终正式路径验收', { exact: true }).click();
  await p.getByRole('button', { name: 'Space', exact: true }).click();
  await open(f.doc);
  await p.locator('[data-context-state="linked"]').waitFor();
  const session = await panel().getAttribute('data-session-id');
  const persistedBefore = (await h.request('space/content', { node: f.doc.id }))
    .sourceSha256;
  const initialProtectedNotice = await p
    .getByText('该内容已受保护，无法执行此操作。', { exact: true })
    .count();
  if (initialProtectedNotice)
    await p
      .getByText('该内容已受保护，无法执行此操作。', { exact: true })
      .waitFor({ state: 'hidden' });
  await p
    .getByRole('button', { name: 'Chat about this document', exact: true })
    .click();
  const editor = await panel()
      .locator('[contenteditable="true"]')
      .elementHandle(),
    originalDraft = await panel()
      .locator('[contenteditable="true"]')
      .innerText();
  const content = await p.locator('.sp-editor').boundingBox(),
    before = await panel().boundingBox();
  const resize = await p
    .getByRole('separator', { name: 'Resize chat width left', exact: true })
    .boundingBox();
  await p.mouse.move(resize.x + 8, resize.y + 80);
  await p.mouse.down();
  await p.mouse.move(resize.x - 72, resize.y + 80, { steps: 8 });
  await p.mouse.up();
  assert.equal((await panel().boundingBox()).width, before.width + 80);
  assert.deepEqual(await p.locator('.sp-editor').boundingBox(), content);
  checks.push('Floating resize keeps Page geometry unchanged');
  await p.getByRole('button', { name: 'Minimize chat', exact: true }).click();
  await p
    .getByRole('button', { name: 'Restore floating chat', exact: true })
    .click();
  await p
    .getByRole('button', { name: 'Expand floating chat', exact: true })
    .click();
  assert.equal(
    await editor.evaluate(
      (e) =>
        e.isConnected &&
        e ===
          document.querySelector('.sp-floating-chat [contenteditable="true"]'),
    ),
    true,
  );
  assert.equal(await panel().getAttribute('data-session-id'), session);
  assert.equal(await p.locator('[data-conversation-content]').count(), 1);
  checks.push(
    'Minimize/restore/expand preserves the exact native Composer DOM and Session',
  );
  const grip = p.getByRole('button', {
      name: 'Move floating chat',
      exact: true,
    }),
    pos = await panel().boundingBox();
  await grip.focus();
  await p.keyboard.press('ArrowLeft');
  assert.equal((await panel().boundingBox()).x, pos.x - 16);
  await p.waitForTimeout(300);
  assert.equal(
    await p
      .getByText('该内容已受保护，无法执行此操作。', { exact: true })
      .count(),
    0,
  );
  checks.push(
    'Floating Chat keyboard movement retained without triggering SDK commands',
  );
  await p
    .getByRole('button', { name: 'View chat history', exact: true })
    .click();
  await p
    .locator(
      'button[data-session-option="session-0657f847-ea4b-48f6-b11c-b06314d2ea5f"]',
    )
    .click();
  await p.waitForFunction(
    () =>
      document
        .querySelector('.sp-floating-chat')
        ?.getAttribute('data-session-id') ===
      'session-0657f847-ea4b-48f6-b11c-b06314d2ea5f',
  );
  await p
    .getByRole('button', { name: 'Chat about this document', exact: true })
    .click();
  await panel().locator('button[data-workspace-reference]').first().click();
  await p.locator('[data-context-state="linked"]').waitFor();
  assert.equal(
    await panel().getAttribute('data-session-id'),
    'session-0657f847-ea4b-48f6-b11c-b06314d2ea5f',
  );
  assert.ok(
    (await p.locator('.sp-page-toolbar').innerText()).includes(f.doc.name),
  );
  checks.push(
    'Existing durable Workspace reference still opens the real file in the originating Session',
  );
  await p
    .getByRole('button', { name: 'View chat history', exact: true })
    .click();
  await p.locator(`button[data-session-option="${session}"]`).click();
  await p.waitForFunction(
    (id) =>
      document
        .querySelector('.sp-floating-chat')
        ?.getAttribute('data-session-id') === id,
    session,
  );
  await p.locator('[data-context-state="linked"]').waitFor();
  await p.getByRole('button', { name: 'Close viewer', exact: true }).click();
  const create = p.getByRole('button', { name: 'Create', exact: true }).last();
  assert.equal(await create.isDisabled(), true);
  assert.match(await create.getAttribute('title'), /Creation is not available/);
  await p.screenshot({ path: resolve(out, 'after-create-menu.png') });
  checks.push(
    'Create is disabled with feature availability rather than false read-only/permission language',
  );
  await open(f.doc);
  await p.locator('[data-context-state="linked"]').waitFor();
  await p.locator('summary[aria-label="File menu"]').click();
  await p
    .getByText('该内容已受保护，无法执行此操作。', { exact: true })
    .waitFor({ state: 'hidden' });
  await p.screenshot({ path: resolve(out, 'after-file-menu.png') });
  await p.keyboard.press('Escape');
  let release, heldResolve;
  const held = new Promise((r) => (heldResolve = r)),
    gate = new Promise((r) => (release = r));
  let delayed = false;
  await p.route('**/api/space/current', async (route) => {
    const data = route.request().postDataJSON().payload;
    if (data.nodeId === f.sheet.id && !delayed) {
      delayed = true;
      heldResolve();
      await gate;
    }
    await route.continue();
  });
  p.on('response', async (response) => {
    if (new URL(response.url()).pathname === '/api/space/current') {
      const data = response.request().postDataJSON().payload;
      try {
        const value = await response.json();
        receipts.push({
          nodeId: data.nodeId,
          sequence: data.sequence,
          applied: value.result?.value?.applied,
        });
      } catch {}
    }
  });
  await panel()
    .locator('[contenteditable="true"]')
    .pressSequentially('TASK-008R unsent check', { delay: 25 });
  assert.equal(
    await panel().locator('[contenteditable="true"]').innerText(),
    'TASK-008R unsent check',
  );
  await open(f.sheet);
  await held;
  await p.locator('[data-context-state="linking"]').waitFor();
  assert.equal(
    await panel()
      .getByRole('button', { name: '发送消息', exact: true })
      .isDisabled(),
    true,
  );
  await open(f.doc);
  await p.locator('[data-context-state="linked"]').waitFor();
  release();
  await p.waitForTimeout(700);
  assert.equal(
    await p.locator('[data-page-context]').getAttribute('data-page-context'),
    f.doc.id,
  );
  assert.equal(await p.locator('[data-context-state="linked"]').count(), 1);
  assert.ok(
    receipts.some((r) => r.nodeId === f.sheet.id && r.applied === false),
  );
  assert.equal(
    await panel()
      .getByRole('button', { name: '发送消息', exact: true })
      .isEnabled(),
    true,
  );
  await panel().locator('[contenteditable="true"]').fill(originalDraft);
  checks.push(
    'Delayed older Sheet association is rejected by the real Host after newer Doc association; no stale chip or Composer unblock',
  );
  assert.equal(
    (await h.request('space/content', { node: f.doc.id })).sourceSha256,
    persistedBefore,
  );
  checks.push(
    'Native typing preserves the unsent draft and persisted Doc input remains unchanged',
  );
  assert.deepEqual(errors, []);
  await p.screenshot({ path: resolve(out, 'after-context-race.png') });
  await writeFile(
    resolve(out, 'context-races-live.json'),
    JSON.stringify(
      {
        carrier:
          'Official DSH Web, existing native Session; only request timing delayed, real Host/Workspace responses',
        sessionId: session,
        checks,
        knownSDKGap: {
          initialProtectedNotice: initialProtectedNotice > 0,
          detail:
            'SDK may show its protected-content notice while initializing the detached read-only Doc, before Chat keys; not hidden or treated as success',
        },
        receipts,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks, errors }));
} finally {
  await b.close();
}
