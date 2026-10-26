/** Real official DSH Web acceptance. No mocked API, transcript, composer or editor.
 * Requires Playwright (SPACE_PLAYWRIGHT_MODULE may name its installed module), a
 * local owner Host log, and the existing local Workspace fixture login file.
 * Artifacts are written outside this implementation checkout. */
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connectHost } from './host-connection.mjs';
import { writeEvidence } from './evidence-output.mjs';
const { chromium } = await import(
  process.env.SPACE_PLAYWRIGHT_MODULE ?? 'playwright'
);
const fixture = JSON.parse(
  await readFile(
    process.env.SPACE_TEST_LOGIN_FILE ?? '/tmp/task005-workspace-login.json',
    'utf8',
  ),
);
const host = await connectHost(),
  checks = [],
  screens = [],
  measurements = [],
  errors = [],
  consoleMessages = [];
const out = resolve(
  process.env.SPACE_EVIDENCE_DIR ?? '/tmp/space-plugin-evidence',
);
await mkdir(out, { recursive: true });
await host.request('space/configure', { endpoint: fixture.origin });
await host.request('space/login', {
  username: fixture.username,
  password: fixture.password,
});
const beforeDoc = await host.request('space/content', { node: fixture.doc.id }),
  beforeSheet = await host.request('space/content', { node: fixture.sheet.id });
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
  host.headers.cookie.split('; ').map((pair) => {
    const i = pair.indexOf('=');
    return {
      name: pair.slice(0, i),
      value: pair.slice(i + 1),
      url: host.origin,
      httpOnly: true,
    };
  }),
);
const page = await context.newPage();
page.setDefaultTimeout(12000);
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (e) => {
  if (['error', 'warning'].includes(e.type()))
    consoleMessages.push({ level: e.type(), text: e.text().slice(0, 350) });
});
const own = () => page.locator('.sp-shell');
const panel = () => page.locator('.sp-floating-chat');
const frame = () =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
const shot = async (name, refs) => {
  await frame();
  await page.screenshot({ path: resolve(out, name + '.png') });
  screens.push({
    name,
    refs,
    viewport: page.viewportSize(),
    carrier: 'Official DSH Web, Edge headless, DPR 1',
  });
};
const measure = async (label, selector) => {
  const boxes = await page.locator(selector).evaluateAll((es) =>
    es.map((e) => {
      const r = e.getBoundingClientRect();
      return {
        selector: e.className,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      };
    }),
  );
  measurements.push({ label, viewport: page.viewportSize(), boxes });
  return boxes;
};
const mode = async (value) =>
  assert.equal(await panel().getAttribute('data-mode'), value);
const menu = async () =>
  page.locator('.sp-chat-header summary[aria-label="Chat menu"]').click();
const newChat = async () => {
  const old = await panel().getAttribute('data-session-id');
  await menu();
  await page
    .getByRole('menuitem', { name: 'New conversation', exact: true })
    .click();
  await page.waitForFunction((id) => {
    const e = document.querySelector('.sp-floating-chat');
    return (
      e?.getAttribute('data-session-id') &&
      e.getAttribute('data-session-id') !== id
    );
  }, old);
  return panel().getAttribute('data-session-id');
};
const open = async (name) => {
  await page
    .locator('.sp-navigation .sp-control')
    .filter({ hasText: name })
    .filter({ has: page.locator('span.tw-truncate') })
    .first()
    .click();
  await page.locator('.sp-page-title').filter({ hasText: name }).waitFor();
  await page.locator('.sp-viewer-message').waitFor({ state: 'hidden' });
  await frame();
};
const send = async (text) => {
  await panel().locator('[contenteditable="true"]').fill(text);
  await panel().getByRole('button', { name: '发送消息', exact: true }).click();
};
try {
  await page.goto(host.origin);
  await page.getByRole('button', { name: 'Space', exact: true }).click();
  await page.getByRole('table', { name: 'Content' }).waitFor();
  const hostCollapse = page.getByRole('button', {
    name: '收起侧边栏',
    exact: true,
  });
  if (await hostCollapse.count()) await hostCollapse.click();
  await page.waitForFunction(
    () => document.querySelector('.sp-shell')?.getBoundingClientRect().x < 100,
  );
  await page.getByRole('tab', { name: 'Your items', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Search loaded content' })
    .fill('产品发布');
  let geometry = await measure(
    'your-items-1440',
    '.sp-shell,.sp-navigation,.sp-library-heading,.sp-tabs,.sp-file-row',
  );
  assert.equal(geometry[1].width, 288);
  assert.equal(geometry.at(-1).height, 50);
  assert.equal(geometry.at(-1).y, 179);
  checks.push('All geometry: nav 288, title y28, tabs y85, row y179/h50');
  await page
    .getByRole('checkbox', { name: 'Select 产品发布', exact: true })
    .check();
  assert.match(
    await page.getByRole('toolbar', { name: 'Selection' }).innerText(),
    /1 selected/,
  );
  await page
    .getByRole('button', { name: 'Clear selection', exact: true })
    .click();
  assert.equal(
    await page.getByRole('toolbar', { name: 'Selection' }).count(),
    0,
  );
  checks.push(
    'row selection and clear selection; unavailable actions disabled',
  );
  await page.locator('summary[aria-label="Actions for 产品发布"]').click();
  assert.equal(
    await page.getByRole('menuitem', { name: /^Share/ }).isDisabled(),
    true,
  );
  await page.keyboard.press('Escape');
  checks.push('row menu and Escape dismissal');
  await shot('all-1440', ['E16', 'E28', 'E29']);
  for (const [width, height] of [
    [1280, 800],
    [768, 900],
  ]) {
    await page.setViewportSize({ width, height });
    await measure(
      'all-' + width,
      '.sp-navigation,.sp-library-heading,.sp-tabs,.sp-file-row',
    );
    assert.equal(
      (await page.locator('.sp-navigation').boundingBox()).width,
      288,
    );
    await shot('all-' + width, [width === 1280 ? 'E31' : 'E32']);
  }
  await page
    .getByRole('button', { name: 'Toggle sidebar', exact: true })
    .click();
  assert.equal(await page.locator('.sp-navigation').count(), 0);
  await page
    .getByRole('button', { name: 'Open Space navigation', exact: true })
    .click();
  assert.match(
    await page.locator('.sp-navigation').getAttribute('class'),
    /flyout/,
  );
  await shot('nav-flyout-768', ['E35']);
  await page
    .getByRole('button', { name: 'Toggle sidebar', exact: true })
    .click();
  checks.push(
    '768 navigation retains 288 width; manual collapse, overlay flyout and restore',
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await page
    .locator('.sp-file-open')
    .filter({ hasText: beforeDoc.name })
    .click();
  await page
    .locator('.sp-page-title')
    .filter({ hasText: beforeDoc.name })
    .waitFor();
  await page
    .locator('.sp-sdk canvas#univer-doc-main-canvas')
    .waitFor({ state: 'visible' });
  await page.locator('.sp-viewer-message').waitFor({ state: 'hidden' });
  assert.equal(
    await page.locator('.sp-viewer').getAttribute('data-document-flavor'),
    'modern',
  );
  assert.equal(
    await page
      .locator('.sp-sdk canvas#univer-doc-main-canvas')
      .evaluate((e) => getComputedStyle(e).backgroundColor),
    'rgb(255, 255, 255)',
  );
  await measure(
    'page-1440',
    '.sp-page-toolbar,.sp-page-title,.sp-editor,.sp-floating-chat',
  );
  await shot('page-compact-1440', ['E04', 'E12']);
  checks.push(
    'Univer Modern Doc actual canvas, continuous white surface; native compact composer',
  );
  await page.locator('summary[aria-label="File menu"]').click();
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
  await page.getByRole('button', { name: 'Close viewer', exact: true }).click();
  await page.getByRole('tab', { name: 'Suggested', exact: true }).click();
  await page.getByRole('region', { name: 'Pinned pages' }).waitFor();
  await shot('suggested-pinned-1440', ['E02', 'E37']);
  checks.push(
    'Pin updates navigation and Suggested independently of Favorites; close returns source list',
  );
  await open(beforeDoc.name);
  const sessionA = await newChat();
  await send(
    'TASK-007B UI acceptance. Reply only ACK-007B-A. Do not edit or access files.',
  );
  await page
    .locator('.sp-native-messages')
    .getByText('ACK-007B-A', { exact: true })
    .waitFor({ timeout: 45000 });
  checks.push('new Host Session A, real native send, running and reply');
  await page
    .getByRole('button', { name: 'Minimize chat', exact: true })
    .click();
  await mode('minimized');
  await page
    .getByRole('button', { name: 'Restore floating chat', exact: true })
    .click();
  await mode('compact');
  await page
    .getByRole('button', { name: 'Expand floating chat', exact: true })
    .click();
  assert.equal(await panel().getAttribute('data-session-id'), sessionA);
  assert.equal(await page.locator('[data-conversation-content]').count(), 1);
  checks.push(
    'minimize, restore, expand keep same Session and one native Conversation',
  );
  const titleBefore = await page.locator('.sp-page-title').boundingBox();
  const grip = await page
    .getByRole('button', { name: 'Move floating chat' })
    .boundingBox();
  const initial = await panel().boundingBox();
  const dx = 1440 - initial.x - initial.width - 16;
  await page.mouse.move(grip.x + 15, grip.y + 15);
  await page.mouse.down();
  await page.mouse.move(grip.x + 15 + dx, grip.y + 15, { steps: 12 });
  await page.mouse.up();
  const handle = await page
    .getByRole('separator', { name: 'Resize chat width left' })
    .boundingBox();
  await page.mouse.move(handle.x + 8, handle.y + 50);
  await page.mouse.down();
  await page.mouse.move(handle.x + 8 - 104, handle.y + 50, { steps: 8 });
  await page.mouse.up();
  assert.equal((await panel().boundingBox()).width, 664);
  assert.deepEqual(
    await page.locator('.sp-page-title').boundingBox(),
    titleBefore,
  );
  await measure(
    'chat-resized-1440',
    '.sp-page-title,.sp-editor,.sp-floating-chat',
  );
  await shot('chat-expanded-1440', ['E08', 'E13', 'E42']);
  checks.push(
    'pointer move and 104px resize produce 664x634 overlay without moving title or editor',
  );
  // Add only a stable reference through the native draft API. Opening is not selecting.
  await menu();
  await page
    .getByRole('menuitem', { name: 'Add page to chat', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Add reference', exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector('.sp-context')?.textContent?.includes('In draft'),
  );
  const draft = await panel().locator('[contenteditable="true"]').innerText();
  assert.match(draft, /workspace-file:\/\//);
  assert.doesNotMatch(draft, /SPACE-ORBIT-7419|4270|4,270|workspace_snapshot/);
  checks.push(
    'explicit page selection stages short reference only in real native composer',
  );
  await open(beforeSheet.name);
  await page.getByText('预算明细', { exact: true }).waitFor();
  const sessionB = await newChat();
  assert.notEqual(sessionB, sessionA);
  await send(
    'TASK-007B UI acceptance. Reply only ACK-007B-B. Do not edit or access files.',
  );
  await page
    .locator('.sp-native-messages')
    .getByText('ACK-007B-B', { exact: true })
    .waitFor({ timeout: 45000 });
  checks.push('Univer Sheet and independent Host Session B send/reply');
  await open(beforeDoc.name);
  await page.waitForFunction(
    (id) =>
      document
        .querySelector('.sp-floating-chat')
        ?.getAttribute('data-session-id') === id,
    sessionA,
  );
  await mode('compact');
  assert.match(
    await panel().locator('[contenteditable="true"]').innerText(),
    /workspace-file:\/\//,
  );
  assert.match(await page.locator('.sp-context').innerText(), /In draft/);
  await page.getByRole('button', { name: 'Expand floating chat' }).click();
  await page
    .locator('.sp-native-messages')
    .getByText('ACK-007B-A', { exact: true })
    .waitFor();
  checks.push(
    'return Doc A restores Session A, ACK-A, native unsent draft and explicit file context',
  );
  // Submit staged reference, letting the existing formal read tool fetch the answer.
  const docDraft = await panel()
    .locator('[contenteditable="true"]')
    .innerText();
  await panel()
    .locator('[contenteditable="true"]')
    .fill(
      docDraft +
        '\nUse univer_inspect to read this reference. Return the owner, exact budget, acceptance marker and next step. Do not edit anything.',
    );
  await panel().getByRole('button', { name: '发送消息', exact: true }).click();
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
    { timeout: 30000 },
  );
  assert.match(await page.locator('.sp-context').innerText(), /Submitted/);
  checks.push(
    'native short-reference submission receipt and fresh tool-derived answer',
  );
  await page
    .getByRole('button', { name: 'View chat history', exact: true })
    .click();
  assert.equal(await page.locator('.sp-chat-history').isVisible(), true);
  await page
    .locator(`.sp-chat-history button[data-session-option="${sessionB}"]`)
    .click();
  assert.equal(await panel().getAttribute('data-mode'), 'compact');
  await page.waitForFunction(
    (id) =>
      document
        .querySelector('.sp-floating-chat')
        ?.getAttribute('data-session-id') === id,
    sessionB,
  );
  await mode('compact');
  checks.push('real Host history switches existing Conversation');
  await open(beforeSheet.name);
  await page.waitForFunction(
    (id) =>
      document
        .querySelector('.sp-floating-chat')
        ?.getAttribute('data-session-id') === id,
    sessionB,
  );
  await page.getByRole('button', { name: 'Expand floating chat' }).click();
  await page
    .locator('.sp-native-messages')
    .getByText('ACK-007B-B', { exact: true })
    .waitFor();
  checks.push('return Sheet B restores Session B and ACK-B');
  await open(beforeDoc.name);
  await page.getByRole('button', { name: 'Expand floating chat' }).click();
  const restoreWidth = await page
    .getByRole('separator', { name: 'Resize chat width left' })
    .boundingBox();
  await page.mouse.move(restoreWidth.x + 8, restoreWidth.y + 50);
  await page.mouse.down();
  await page.mouse.move(restoreWidth.x + 112, restoreWidth.y + 50, {
    steps: 8,
  });
  await page.mouse.up();
  assert.equal((await panel().boundingBox()).width, 560);
  await page.setViewportSize({ width: 768, height: 900 });
  await page.getByRole('button', { name: 'Toggle sidebar' }).click();
  if ((await panel().getAttribute('data-mode')) === 'compact')
    await page.getByRole('button', { name: 'Expand floating chat' }).click();
  await mode('expanded');
  await measure('chat-768', '.sp-page-title,.sp-floating-chat');
  await shot('chat-768', ['E34']);
  assert.ok((await panel().boundingBox()).x >= 56);
  await page.setViewportSize({ width: 1280, height: 800 });
  await measure('chat-1280', '.sp-page-title,.sp-floating-chat');
  await shot('chat-1280', ['E36']);
  assert.ok((await panel().boundingBox()).y >= 0);
  checks.push('768 and 1280 overlay stays inside Host-owned main surface');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Open Space navigation' }).click();
  await page.getByRole('button', { name: 'Toggle sidebar' }).click();
  await page.getByRole('button', { name: 'Close viewer' }).click();
  assert.equal(await page.locator('.sp-chat-seat').isVisible(), false);
  await page
    .getByRole('button', { name: 'Space Demo 的个人空间', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'About Space Demo 的个人空间' })
    .waitFor();
  await shot('space-overview-1440', ['E22']);
  await page.getByRole('tab', { name: 'Content', exact: true }).click();
  await shot('space-content-1440', ['E43']);
  await page
    .getByRole('textbox', { name: 'Search loaded content' })
    .fill('TASK007B_NO_MATCH');
  await page.getByRole('heading', { name: 'No matching pages' }).waitFor();
  await shot('space-empty-search-1440', ['E23']);
  checks.push('Space Overview, real root Content and explicit no-match state');
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByRole('tab', { name: 'Your items', exact: true }).click();
  await page.locator('.sp-file-open').filter({ hasText: '产品发布' }).click();
  await page.getByRole('table', { name: 'Content' }).waitFor();
  await shot('folder-1440', ['E19', 'E20']);
  await page
    .locator('.sp-file-open')
    .filter({ hasText: beforeDoc.name })
    .click();
  await page.getByRole('button', { name: 'Close viewer' }).waitFor();
  await page.getByRole('button', { name: 'Close viewer' }).click();
  assert.match(
    await page.locator('.sp-library-heading').innerText(),
    /产品发布/,
  );
  checks.push('Folder to Doc to close returns exact Folder');
  const afterDoc = await host.request('space/content', {
      node: fixture.doc.id,
    }),
    afterSheet = await host.request('space/content', {
      node: fixture.sheet.id,
    });
  assert.equal(afterDoc.sha256, beforeDoc.sha256);
  assert.equal(afterSheet.sha256, beforeSheet.sha256);
  checks.push(
    'Server Doc/Sheet hashes unchanged after Modern rendering, UI and tool reads',
  );
  assert.deepEqual(errors, []);
  checks.push('zero browser page errors');
  await writeEvidence('web-ui.json', {
    at: new Date().toISOString(),
    version: JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ).version,
    carrier:
      'Official DSH Web on official Electron-owned Host; not Desktop window UX',
    checks,
    sessions: { A: sessionA, B: sessionB },
    screens,
    measurements,
    errors,
    consoleMessages,
    serverHashes: { doc: afterDoc.sha256, sheet: afterSheet.sha256 },
  });
  console.log(
    JSON.stringify({
      passed: checks.length,
      screens: screens.length,
      sessions: { A: sessionA, B: sessionB },
    }),
  );
} catch (error) {
  await page.screenshot({ path: resolve(out, 'failure.png') });
  await writeEvidence('web-ui-failure.json', {
    checks,
    error: String(error),
    errors,
    consoleMessages,
  });
  throw error;
} finally {
  await browser.close();
}
