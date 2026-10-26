/** TASK-008: real official DSH Web, native Sessions/Composer/Tools and Workspace SDK.
 * Requires seed-product + seed-mvp fixtures. No mocked HTTP or rendered content. */
import assert from 'node:assert/strict';
import { readFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { connectHost } from './host-connection.mjs';
const { chromium } = await import(
  process.env.SPACE_PLAYWRIGHT_MODULE ?? 'playwright'
);
const fixture = JSON.parse(
  await readFile(
    process.env.SPACE_TEST_LOGIN_FILE ?? '/tmp/task005-workspace-login.json',
    'utf8',
  ),
);
const extra = JSON.parse(
  await readFile(
    process.env.SPACE_MVP_FIXTURES ?? '/tmp/task008-fixtures.json',
    'utf8',
  ),
);
const host = await connectHost(),
  checks = [],
  screens = [],
  errors = [],
  consoleMessages = [],
  measurements = [];
const out = resolve(
  process.env.SPACE_EVIDENCE_DIR ?? '/tmp/space-plugin-evidence',
);
await mkdir(out, { recursive: true });
const sessionRoot = process.env.SPACE_SESSION_ROOT;
async function sessionHashes() {
  const result = {};
  if (!sessionRoot) return result;
  for (const path of await readdir(sessionRoot, { recursive: true }))
    if (path.endsWith('session.v4.jsonl.zstd'))
      result[path] = createHash('sha256')
        .update(await readFile(resolve(sessionRoot, path)))
        .digest('hex');
  return result;
}
const existingSessions = await sessionHashes();
await host.request('space/configure', { endpoint: fixture.origin });
await host.request('space/login', {
  username: fixture.username,
  password: fixture.password,
});
const files = [fixture.doc, fixture.sheet, ...extra.nodes, extra.site],
  before = {};
for (const n of files)
  before[n.id] = await host.request('space/content', { node: n.id });
const index = (await host.request('space/index')).nodes;
assert.equal(index.find((n) => n.id === extra.site.id).resource.htmlView, true);
assert.equal(
  index.find((n) => n.id === extra.plainHtml.id).resource.htmlView,
  undefined,
);
checks.push(
  'Server HTML Views mapping includes .univer.html, excludes ordinary HTML',
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.SPACE_BROWSER_EXECUTABLE
    ? { executablePath: process.env.SPACE_BROWSER_EXECUTABLE }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
await context.addCookies(
  host.headers.cookie
    .split('; ')
    .map((p) => ({
      name: p.slice(0, p.indexOf('=')),
      value: p.slice(p.indexOf('=') + 1),
      url: host.origin,
      httpOnly: true,
    })),
);
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (e) => {
  if (['error', 'warning'].includes(e.type()))
    consoleMessages.push({ level: e.type(), text: e.text().slice(0, 400) });
});
const frame = () =>
  page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
const shot = async (name) => {
  await frame();
  await page.screenshot({ path: resolve(out, name + '.png') });
  screens.push({
    name,
    viewport: page.viewportSize(),
    carrier: 'Official DSH Web, Edge headless, DPR 1',
  });
};
const own = () => page.locator('.sp-shell'),
  panel = () => page.locator('.sp-floating-chat');
async function drawer() {
  if (
    !(await own()
      .getByRole('complementary', { name: 'Space navigation', exact: true })
      .count())
  )
    await page
      .getByRole('button', { name: 'Open Space navigation', exact: true })
      .click();
  return page.getByRole('complementary', {
    name: 'Space navigation',
    exact: true,
  });
}
async function all() {
  if (
    await page
      .getByRole('button', { name: 'Close viewer', exact: true })
      .count()
  )
    await page
      .getByRole('button', { name: 'Close viewer', exact: true })
      .click();
  await (await drawer())
    .getByRole('button', { name: 'All', exact: true })
    .click();
  await page.getByRole('table', { name: 'Content', exact: true }).waitFor();
}
async function open(n) {
  await all();
  await page.locator('.sp-file-open').filter({ hasText: n.name }).click();
  await page.locator('.sp-page-toolbar').waitFor();
  if (n.resource.unitType)
    await page.locator('.sp-viewer[data-viewer-state="ready"]').waitFor();
  else await page.locator('.sp-html-preview iframe').waitFor();
  await frame();
}
async function back() {
  await (await drawer())
    .getByRole('button', { name: 'Back to Chat', exact: true })
    .click();
  await own().waitFor({ state: 'hidden' });
}
async function newChat() {
  const old = await panel().getAttribute('data-session-id');
  await page.locator('.sp-chat-header summary[aria-label="Chat menu"]').click();
  await page
    .getByRole('menuitem', { name: 'New conversation', exact: true })
    .click();
  await page.waitForFunction((id) => {
    const next = document
      .querySelector('.sp-floating-chat')
      ?.getAttribute('data-session-id');
    return next && next !== id;
  }, old);
  return panel().getAttribute('data-session-id');
}
async function send(text) {
  await panel().locator('[contenteditable="true"]').fill(text);
  await panel().getByRole('button', { name: '发送消息', exact: true }).click();
}
async function expand() {
  if ((await panel().getAttribute('data-mode')) === 'minimized')
    await page
      .getByRole('button', { name: 'Restore floating chat', exact: true })
      .click();
  if ((await panel().getAttribute('data-mode')) === 'compact')
    await page
      .getByRole('button', { name: 'Expand floating chat', exact: true })
      .click();
}
let sessionA, sessionB;
try {
  await page.goto(host.origin);
  await page.locator('[contenteditable="true"]').first().waitFor();
  const originalDraft = await page
    .locator('[contenteditable="true"]')
    .first()
    .innerText();
  if (
    await page.getByRole('button', { name: '打开侧边栏', exact: true }).count()
  )
    await page.getByRole('button', { name: '打开侧边栏', exact: true }).click();
  // Verify a nondefault Host drag width survives both directions without a blind toggle.
  const handle = await page.locator('[data-side="sidebar"]').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 100);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 50, handle.y + 100, {
    steps: 8,
  });
  await page.mouse.up();
  await frame();
  const expandedWidth = (
    await page.locator('[data-side="sidebar"]').boundingBox()
  ).x;
  await page.getByRole('button', { name: 'Space', exact: true }).click();
  await page.getByRole('table', { name: 'Content', exact: true }).waitFor();
  assert.equal(await page.locator('.sp-navigation').count(), 0);
  assert.equal(
    (await page.locator('[data-side="sidebar"]').boundingBox()).x,
    expandedWidth,
  );
  checks.push(
    'Space entry has no second full sidebar; Host custom width unchanged',
  );
  await shot('after-navigation');
  await back();
  assert.equal(
    (await page.locator('[data-side="sidebar"]').boundingBox()).x,
    expandedWidth,
  );
  assert.equal(
    await page.locator('[contenteditable="true"]').first().innerText(),
    originalDraft,
  );
  checks.push(
    'Chat return preserves custom Host width and original native draft',
  );
  await page.getByRole('button', { name: '收起侧边栏', exact: true }).click();
  await page.getByRole('button', { name: 'Space', exact: true }).click();
  await page.getByRole('table', { name: 'Content', exact: true }).waitFor();
  assert.equal(await page.locator('[data-side="sidebar"]').count(), 0);
  await back();
  assert.equal(await page.locator('[data-side="sidebar"]').count(), 0);
  checks.push('Collapsed Chat → Space → Chat preserves collapsed navigation');
  await page.getByRole('button', { name: 'Space', exact: true }).click();
  await page.getByRole('table', { name: 'Content', exact: true }).waitFor();
  const nav = await drawer();
  assert.equal((await nav.boundingBox()).width, 288);
  assert.equal(
    await nav.getByRole('button', { name: 'Images', exact: true }).count(),
    0,
  );
  await shot('navigation-drawer');
  await page.keyboard.press('Escape');
  await page.locator('.sp-navigation').waitFor({ state: 'hidden' });
  checks.push(
    'Space overlay navigation opens/closes at 288px; Images is absent',
  );
  for (const [type, label, node] of [
    ['doc', 'Docs', fixture.doc],
    ['sheet', 'Sheets', fixture.sheet],
    ['slide', 'Slides', extra.nodes[0]],
    ['board', 'Boards / Canvas', extra.nodes[1]],
    ['base', 'Bases / Databases', extra.nodes[2]],
    ['site', 'Pages / Sites', extra.site],
  ]) {
    await (await drawer())
      .getByRole('button', { name: label, exact: true })
      .click();
    await page
      .locator('.sp-file-open')
      .filter({ hasText: node.name })
      .waitFor();
    assert.ok((await page.locator('.sp-file-open').count()) >= 1);
    if (type === 'site')
      assert.equal(
        await page
          .locator('.sp-file-open')
          .filter({ hasText: extra.plainHtml.name })
          .count(),
        0,
      );
    await page.locator('.sp-file-open').filter({ hasText: node.name }).click();
    if (type === 'site') {
      await page
        .frameLocator('.sp-html-preview iframe')
        .getByRole('heading', { name: 'Space MVP Release', exact: true })
        .waitFor();
      assert.equal(
        await page.locator('.sp-html-preview iframe').getAttribute('sandbox'),
        '',
      );
    } else {
      await page.locator('.sp-viewer[data-viewer-state="ready"]').waitFor();
      assert.ok(await page.locator('.sp-sdk canvas').count());
    }
    if (type === 'doc') {
      assert.equal(await page.locator('.sp-page-title').count(), 0);
      assert.match(
        await page.locator('.sp-page-toolbar').innerText(),
        new RegExp(fixture.doc.name),
      );
      assert.ok(
        before[node.id].data.body.dataStream.startsWith(fixture.doc.name),
      );
    }
    if (['base', 'board', 'slide'].includes(type))
      assert.match(
        await page.locator('.sp-preview-notice').innerText(),
        /Core SDK preview/,
      );
    if (type === 'base') {
      assert.match(JSON.stringify(before[node.id].data), /Verify navigation/);
    }
    if (
      type === 'doc' ||
      type === 'slide' ||
      type === 'base' ||
      type === 'site'
    ) {
      await page
        .getByRole('button', { name: 'Minimize chat', exact: true })
        .click();
      await page.waitForTimeout(type === 'doc' ? 2800 : 250);
      await shot('after-' + type);
    }
    checks.push(
      `${label}: real category, identity/icon/list and ${type === 'site' ? 'sandbox HTML' : 'published SDK'} preview${type === 'doc' ? ', no extra DOM title' : ''}`,
    );
    await page
      .getByRole('button', { name: 'Close viewer', exact: true })
      .click();
  }
  await all();
  await page
    .getByLabel('Search loaded content', { exact: true })
    .fill('no-match-008');
  await page.getByText('No results found', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  checks.push('Name search and no-results recovery');
  await page.getByRole('button', { name: 'Grid view', exact: true }).click();
  assert.ok(await page.locator('.sp-file-grid').count());
  await page.getByRole('button', { name: 'List view', exact: true }).click();
  await page.getByLabel('Select ' + fixture.doc.name, { exact: true }).check();
  await page.getByRole('toolbar', { name: 'Selection', exact: true }).waitFor();
  await page
    .getByRole('button', { name: 'Clear selection', exact: true })
    .click();
  checks.push('Grid/List, row selection and clear selection retained');
  await page.locator('.sp-file-open').filter({ hasText: '产品发布' }).click();
  await page
    .locator('.sp-file-open')
    .filter({ hasText: fixture.doc.name })
    .click();
  await page.locator('.sp-viewer[data-viewer-state="ready"]').waitFor();
  await page.getByRole('button', { name: 'Close viewer', exact: true }).click();
  assert.equal(await page.locator('.sp-file-open').count(), 2);
  checks.push('Folder → Doc → Close returns to the actual source Folder');
  await open(fixture.doc);
  await page.locator('summary[aria-label="File menu"]').click();
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
  await (await drawer())
    .getByRole('button', { name: 'All', exact: true })
    .click();
  assert.ok(
    await page
      .locator('.sp-preview')
      .filter({ hasText: fixture.doc.name })
      .count(),
  );
  checks.push('Pin updates real Suggested cards and navigation');
  await open(fixture.doc);
  sessionA = await newChat();
  await send(
    'TASK-008 Web acceptance. Reply only ACK-008-A. Do not use tools or edit files.',
  );
  await page
    .locator('.sp-native-messages')
    .getByText('ACK-008-A', { exact: true })
    .waitFor({ timeout: 60000 });
  checks.push('New native Conversation A sends and receives ACK');
  await page
    .getByRole('button', { name: 'Minimize chat', exact: true })
    .click();
  await expand();
  assert.equal(await panel().getAttribute('data-session-id'), sessionA);
  assert.equal(await page.locator('[data-conversation-content]').count(), 1);
  checks.push(
    'Minimize/restore/expand retains exactly one native Conversation tree',
  );
  const editorBefore = await page.locator('.sp-editor').boundingBox(),
    sizeBefore = await panel().boundingBox();
  const resize = await page
    .getByRole('separator', { name: 'Resize chat width left', exact: true })
    .boundingBox();
  await page.mouse.move(resize.x + 8, resize.y + 80);
  await page.mouse.down();
  await page.mouse.move(resize.x - 72, resize.y + 80, { steps: 8 });
  await page.mouse.up();
  assert.equal((await panel().boundingBox()).width, sizeBefore.width + 80);
  assert.deepEqual(
    await page.locator('.sp-editor').boundingBox(),
    editorBefore,
  );
  checks.push('Floating Chat resize keeps content geometry fixed');
  await page.locator('.sp-chat-header summary[aria-label="Chat menu"]').click();
  await page
    .getByRole('menuitem', { name: 'Add page to chat', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Add reference', exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector('.sp-context')?.textContent?.includes('In draft'),
  );
  const docDraft = await panel()
    .locator('[contenteditable="true"]')
    .innerText();
  assert.match(docDraft, /workspace-file:\/\//);
  assert.doesNotMatch(
    docDraft,
    /SPACE-ORBIT-7419|4270|4,270|workspace_snapshot/,
  );
  checks.push(
    'Explicit selection inserts only a stable reference into the Host draft',
  );
  await open(fixture.sheet);
  sessionB = await newChat();
  await send(
    'TASK-008 Web acceptance. Reply only ACK-008-B. Do not use tools or edit files.',
  );
  await page
    .locator('.sp-native-messages')
    .getByText('ACK-008-B', { exact: true })
    .waitFor({ timeout: 60000 });
  assert.notEqual(sessionA, sessionB);
  checks.push('Native Conversation B has independent identity and ACK');
  await open(fixture.doc);
  assert.equal(await panel().getAttribute('data-session-id'), sessionA);
  assert.match(
    await panel().locator('[contenteditable="true"]').innerText(),
    /workspace-file:\/\//,
  );
  await expand();
  await page
    .locator('.sp-native-messages')
    .getByText('ACK-008-A', { exact: true })
    .waitFor();
  checks.push(
    'Doc A / Sheet B restores each Session, message history, explicit Context and unsent draft',
  );
  await send(
    docDraft +
      '\nUse univer_inspect to read this reference. Return the owner, exact budget, acceptance marker and next step. Do not edit anything.',
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector('.sp-native-messages')
        ?.textContent?.includes('SPACE-ORBIT-7419'),
    {},
    { timeout: 60000 },
  );
  await page.waitForFunction(
    () =>
      !document.querySelector(
        '.sp-floating-chat button[aria-label="停止生成"]',
      ),
    {},
    { timeout: 45000 },
  );
  assert.match(await page.locator('.sp-context').innerText(), /Submitted/);
  const chip = page
    .locator(`button[data-workspace-reference="${fixture.doc.id}"]`)
    .first();
  await chip.waitFor();
  assert.equal(await chip.isEnabled(), true);
  checks.push(
    'Durable native message renders a clickable Workspace file reference; receipt is Submitted',
  );
  await chip.scrollIntoViewIfNeeded();
  await shot('file-reference');
  await page.getByRole('button', { name: 'Close viewer', exact: true }).click();
  await open(fixture.sheet);
  await expand();
  await page
    .getByRole('button', { name: 'View chat history', exact: true })
    .click();
  await page.locator(`button[data-session-option="${sessionA}"]`).click();
  await expand();
  await page
    .locator(`button[data-workspace-reference="${fixture.doc.id}"]`)
    .first()
    .click();
  await page.waitForFunction(
    (name) =>
      document.querySelector('.sp-page-toolbar')?.textContent?.includes(name),
    fixture.doc.name,
  );
  await page.locator('.sp-viewer[data-viewer-state="ready"]').waitFor();
  assert.match(
    await page.locator('.sp-page-toolbar').innerText(),
    new RegExp(fixture.doc.name),
  );
  assert.equal(await panel().getAttribute('data-session-id'), sessionA);
  checks.push(
    'Click reference from another file opens the authoritative Doc in the originating Session',
  );
  await back();
  assert.equal(
    await page.locator('[contenteditable="true"]').first().innerText(),
    originalDraft,
  );
  checks.push(
    'Original Host Chat draft survives new floating Conversations and file reference navigation',
  );
  for (const width of [768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: 'Space', exact: true }).click();
    await all();
    await page.getByRole('table', { name: 'Content', exact: true }).waitFor();
    assert.equal(await page.locator('.sp-navigation').count(), 0);
    const d = await drawer();
    assert.ok((await d.boundingBox()).width <= width);
    await d.getByRole('button', { name: 'All', exact: true }).click();
    measurements.push({ width, shell: await own().boundingBox() });
    await back();
  }
  checks.push('768/1280 Chat–Space switching and temporary navigation drawer');
  const after = {};
  for (const n of files) {
    const current = await host.request('space/content', { node: n.id });
    assert.equal(current.sha256, before[n.id].sha256);
    assert.equal(current.sourceSha256, before[n.id].sourceSha256);
    if (n.resource.unitType === 'doc') {
      const body = (data) => {
        const clone = structuredClone(data.body);
        for (const section of clone.sectionBreaks ?? [])
          delete section.sectionId;
        return clone;
      };
      assert.deepEqual(body(current.data), body(before[n.id].data));
    }
    after[n.id] = {
      type: current.type,
      sha256: current.sha256,
      revision: current.revision,
      sourceSha256: current.sourceSha256,
    };
  }
  checks.push(
    'All five Office types and HTML Server hashes unchanged; original Doc body unchanged',
  );
  const finalSessions = await sessionHashes();
  for (const [path, hash] of Object.entries(existingSessions))
    assert.equal(finalSessions[path], hash, path);
  if (sessionRoot)
    checks.push(
      'Every pre-existing durable native Session log is byte-for-byte unchanged',
    );
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleMessages, []);
  checks.push(
    'Zero browser page errors and zero captured console warnings/errors',
  );
  await writeFile(
    resolve(out, 'web-ui.json'),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        version: JSON.parse(
          await readFile(new URL('../package.json', import.meta.url), 'utf8'),
        ).version,
        carrier:
          'Official DSH Web on Electron-owned Host; Desktop window acceptance deferred',
        checks,
        screens,
        measurements,
        sessions: { A: sessionA, B: sessionB },
        existingSessionsPreserved: Object.keys(existingSessions).length,
        content: after,
        errors,
        consoleMessages,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: checks.length,
      sessions: { A: sessionA, B: sessionB },
      screens: screens.length,
    }),
  );
} catch (error) {
  await page.screenshot({ path: resolve(out, 'failure.png') });
  await writeFile(
    resolve(out, 'web-ui-failure.json'),
    JSON.stringify(
      { checks, error: String(error), errors, consoleMessages },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
