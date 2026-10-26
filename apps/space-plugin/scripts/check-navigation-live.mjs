/** TASK-009A real Host UI: stable global rail, native regions, files, Composer and Tool. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { connectHost } from './host-connection.mjs';
const { chromium } = await import(
  process.env.SPACE_PLAYWRIGHT_MODULE ?? 'playwright'
);
const f = JSON.parse(await readFile(process.env.SPACE_TEST_LOGIN_FILE, 'utf8')),
  extra = JSON.parse(await readFile(process.env.SPACE_MVP_FIXTURES, 'utf8')),
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
  pageErrors = [],
  metrics = {},
  layout = {},
  screens = [];
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
p.on('pageerror', (e) => pageErrors.push(e.message));
p.on('console', (e) => {
  if (e.type() === 'error') errors.push(e.text().slice(0, 700));
});
const activity = (label) =>
  p
    .getByRole('navigation', { name: 'Activity bar', exact: true })
    .getByRole('button', { name: label, exact: true });
const nativeRoot = () => p.locator('[data-space-host-navigation]'),
  frame = () => p.locator('[data-space-host-frame]');
const panel = () => p.locator('.sp-floating-chat');
const check = (message) => {
  checks.push(message);
  console.log(message);
};
async function settle() {
  await p.waitForFunction(
    () =>
      !document
        .querySelector('[data-space-host-frame]')
        ?.hasAttribute('data-animating'),
  );
  await p.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}
async function shot(name) {
  await settle();
  await p.screenshot({ path: resolve(out, name + '.png') });
  screens.push(name + '.png');
}
async function measure(name) {
  await settle();
  metrics[name] = await p
    .getByRole('navigation', { name: 'Activity bar', exact: true })
    .locator('button[aria-label]')
    .evaluateAll((rows) =>
      rows.map((e) => {
        const b = e.getBoundingClientRect(),
          s = e.querySelector('svg'),
          r = s?.getBoundingClientRect();
        return {
          label: e.getAttribute('aria-label'),
          box: { x: b.x, y: b.y, w: b.width, h: b.height },
          svg: r && { x: r.x, y: r.y, w: r.width, h: r.height },
          viewBox: s?.getAttribute('viewBox'),
          color: getComputedStyle(e).color,
        };
      }),
    );
  return metrics[name];
}
function sameGeometry(a, b) {
  assert.deepEqual(
    a.map(({ label, box, svg, viewBox }) => ({ label, box, svg, viewBox })),
    b.map(({ label, box, svg, viewBox }) => ({ label, box, svg, viewBox })),
  );
  for (const r of b) {
    assert.equal(r.box.w, 36);
    assert.equal(r.box.h, 36);
    if (r.svg) {
      assert.equal(r.svg.w, 18);
      assert.equal(r.svg.h, 18);
      assert.equal(r.svg.x + r.svg.w / 2, 26);
    }
  }
}
async function mode(value) {
  await p
    .locator(`[data-space-host-frame][data-space-mode="${value}"]`)
    .waitFor();
  await settle();
}
async function connect() {
  await p.getByRole('button', { name: 'Space settings', exact: true }).click();
  await p
    .getByRole('dialog', { name: 'Space settings', exact: true })
    .waitFor();
  let status = await h.request('space/status');
  if (status.state !== 'connected') {
    await p.getByLabel('Workspace Endpoint', { exact: true }).fill(f.origin);
    await p.getByRole('button', { name: /^(连接服务|重新连接)$/ }).click();
    await p.getByLabel('用户名', { exact: true }).fill(f.username);
    await p.getByLabel('密码', { exact: true }).fill(f.password);
    await p
      .getByRole('button', { name: '登录 Workspace', exact: true })
      .click();
    await p
      .getByRole('dialog', { name: 'Space settings', exact: true })
      .waitFor({ state: 'hidden' });
  } else await p.keyboard.press('Escape');
  assert.equal((await h.request('space/status')).state, 'connected');
}
async function all() {
  await p
    .getByRole('navigation', { name: 'Content types', exact: true })
    .getByRole('button', { name: 'All', exact: true })
    .click();
  await p.locator('.sp-file-open').first().waitFor();
}
async function open(n) {
  await all();
  await p.locator('.sp-file-open').filter({ hasText: n.name }).click();
  await p.locator('.sp-page-toolbar').waitFor();
  if (n.resource?.unitType)
    await p.locator('.sp-viewer[data-viewer-state="ready"]').waitFor();
  else await p.locator('.sp-html-preview iframe').waitFor();
  assert.equal(await p.locator('.sp-page-title').count(), 0);
  assert.equal(await p.locator('.sp-page-toolbar').count(), 1);
}
const source = process.env.SPACE_SESSION_ROOT;
async function nativeLog(id) {
  const name = (await readdir(source, { recursive: true })).find(
    (n) => n.includes(id) && n.endsWith('session.v4.jsonl.zstd'),
  );
  assert.ok(name);
  const d = spawnSync('zstd', ['-dc', resolve(source, name)], {
    encoding: 'utf8',
    maxBuffer: 48 * 1024 * 1024,
  });
  assert.equal(d.status, 0);
  return d.stdout.trim().split('\n').map(JSON.parse);
}
const text = (blocks) =>
  Array.isArray(blocks)
    ? blocks
        .filter((x) => x.type === 'text')
        .map((x) => x.text)
        .join('\n')
    : '';
try {
  await p.goto(h.origin);
  await p.locator('[contenteditable="true"]').first().waitFor();
  await p
    .getByRole('navigation', { name: 'Activity bar', exact: true })
    .waitFor();
  await p.getByText('TASK-006 最终正式路径验收', { exact: true }).click();
  await p.locator('[contenteditable="true"]').waitFor();
  const original = await p.locator('[contenteditable="true"]').innerText();
  await p
    .locator('[contenteditable="true"]')
    .fill('TASK-009A unsent navigation draft');
  const navNode = await p
    .getByRole('navigation', { name: 'Activity bar', exact: true })
    .elementHandle();
  const handle = await p.locator('[data-side="sidebar"]').boundingBox(),
    drag = async (delta) => {
      await p.mouse.move(handle.x + handle.width / 2, 250);
      await p.mouse.down();
      await p.mouse.move(handle.x + handle.width / 2 + delta, 250, {
        steps: 8,
      });
      await p.mouse.up();
      await settle();
    };
  await drag(8);
  const resizedHandle = await p.locator('[data-side="sidebar"]').boundingBox();
  assert.equal(resizedHandle.x + resizedHandle.width / 2, 340);
  assert.equal((await p.locator('.PIRFFq_centerCol').boundingBox()).x, 340);
  const baseline = await measure('chat-expanded');
  await shot('chat-expanded');
  await activity('Space').click();
  await mode('space');
  sameGeometry(baseline, await measure('space-expanded'));
  await connect();
  await all();
  layout.library = await p
    .locator(
      '.sp-nav-heading strong, .sp-nav-heading button, .sp-secondary-controls button, .sp-nav-create, .sp-nav-row',
    )
    .evaluateAll((es) =>
      es.slice(0, 7).map((e) => ({
        text: e.textContent,
        label: e.getAttribute('aria-label'),
        box: e.getBoundingClientRect().toJSON(),
      })),
    );
  assert.equal(layout.library.find((x) => x.text === 'Space').box.x, 68);
  assert.equal(
    layout.library.find((x) => x.label === 'Search content').box.x,
    250,
  );
  assert.equal(
    layout.library.find((x) => x.label === 'Toggle secondary sidebar').box.x,
    294,
  );
  await shot('space-library');
  const labels = ['Docs', 'Sheets', 'Slides', 'Canvas', 'Databases', 'Sites'];
  for (const label of labels)
    assert.equal(
      await p
        .getByRole('navigation', { name: 'Content types', exact: true })
        .getByRole('button', { name: label, exact: true })
        .count(),
      1,
    );
  assert.doesNotMatch(
    await p
      .getByRole('navigation', { name: 'Content types', exact: true })
      .innerText(),
    /Boards \/|Bases \/|Pages \/|Connect Workspace/,
  );
  assert.equal(await activity('Space').count(), 1);
  check(
    'Stable 52px global rail and single product names; navigation title is Space',
  );
  await activity('Chat').click();
  await mode('chat');
  assert.equal(
    await p.locator('[contenteditable="true"]').innerText(),
    'TASK-009A unsent navigation draft',
  );
  sameGeometry(baseline, await measure('chat-returned'));
  check(
    'Chat → Space → Chat retains original native Composer draft and custom secondary width',
  );
  await p
    .getByRole('button', { name: 'Toggle secondary sidebar', exact: true })
    .click();
  await p.waitForFunction(
    () =>
      document
        .querySelector('[data-space-host-frame]')
        ?.getAttribute('data-space-secondary-collapsed') === 'true',
  );
  sameGeometry(baseline, await measure('chat-collapsed'));
  assert.equal(await p.locator('.kB3qhq_regionArea').isVisible(), false);
  assert.equal((await p.locator('.PIRFFq_centerCol').boundingBox()).x, 52);
  await shot('chat-collapsed');
  check(
    'Collapsed and expanded activity hitboxes, SVG sizes, centers and positions match exactly',
  );
  await activity('Space').click();
  await mode('space');
  assert.equal(await p.locator('.kB3qhq_regionArea').isVisible(), true);
  await activity('Space').click();
  await p.waitForFunction(
    () =>
      document
        .querySelector('[data-space-host-frame]')
        ?.getAttribute('data-space-secondary-collapsed') === 'true',
  );
  sameGeometry(baseline, await measure('space-collapsed'));
  await shot('space-collapsed');
  await activity('Space').click();
  await settle();
  check(
    'Top sidebar control and selected Activity entries collapse/restore without an inner icon rail',
  );
  for (const [label, name] of [
    ['自动化任务', 'automation'],
    ['插件', 'plugins'],
  ]) {
    await activity(label).click();
    await mode('panel');
    assert.equal(await p.locator('.kB3qhq_regionArea').isVisible(), false);
    assert.equal(await p.locator('.kB3qhq_newSession').isVisible(), false);
    assert.equal((await p.locator('.PIRFFq_centerCol').boundingBox()).x, 52);
    assert.equal(await p.locator('[data-side="sidebar"]').isVisible(), false);
    sameGeometry(baseline, await measure(name));
    await shot(name);
  }
  check(
    'Automation and Plugins have no Session list, New Session row or empty secondary track',
  );
  await activity('Chat').click();
  await mode('chat');
  assert.equal(
    await p.locator('[contenteditable="true"]').innerText(),
    'TASK-009A unsent navigation draft',
  );
  await p.locator('[contenteditable="true"]').fill(original);
  await shot('chat-restored');
  await activity('Space').click();
  await mode('space');
  const files = [f.doc, f.sheet, ...extra.nodes, extra.site],
    hashes = [];
  for (const n of files) {
    const before = await h.request('space/content', { node: n.id });
    await open(n);
    await p
      .locator(`[data-page-context="${n.id}"][data-context-state="linked"]`)
      .waitFor();
    const after = await h.request('space/content', { node: n.id });
    assert.equal(
      after.sourceSha256 ?? after.sha256,
      before.sourceSha256 ?? before.sha256,
    );
    hashes.push({
      nodeId: n.id,
      type: after.type,
      before: before.sourceSha256 ?? before.sha256,
      after: after.sourceSha256 ?? after.sha256,
    });
    if (
      after.type === 'doc' ||
      after.type === 'site' ||
      after.type === 'slide'
    ) {
      layout['viewer-' + after.type] = await p
        .locator('.sp-page-toolbar > .sp-menu, .sp-page-toolbar > button')
        .evaluateAll((es) =>
          es.map((e) => ({
            label: e.getAttribute('aria-label') ?? e.textContent,
            box: e.getBoundingClientRect().toJSON(),
          })),
        );
      await shot('viewer-' + after.type);
    }
  }
  check(
    'Six actual file types retain one file toolbar; persisted document/HTML input unchanged',
  );
  await all();
  await p.setViewportSize({ width: 820, height: 720 });
  await settle();
  assert.equal((await p.locator('.PIRFFq_centerCol').boundingBox()).x, 52);
  await measure('narrow-collapsed');
  await shot('narrow-collapsed');
  await activity('Space').click();
  await settle();
  assert.equal(await p.locator('.kB3qhq_regionArea').isVisible(), true);
  await shot('narrow-expanded');
  await p
    .getByRole('button', { name: 'Toggle secondary sidebar', exact: true })
    .click();
  await settle();
  for (let i = 0; i < 4; i++) {
    await activity('Chat').click();
    await mode('chat');
    await activity('Space').click();
    await mode('space');
  }
  assert.equal(
    await navNode.evaluate(
      (e) =>
        e.isConnected &&
        e === document.querySelector('nav[aria-label="Activity bar"]'),
    ),
    true,
  );
  check(
    'Narrow navigation and repeated mode changes keep the same global Activity Bar DOM',
  );
  await p.setViewportSize({ width: 1440, height: 900 });
  await settle();
  await open(f.doc);
  await p
    .getByRole('button', { name: 'Chat about this document', exact: true })
    .click();
  await p.locator('[data-context-state="linked"]').waitFor();
  const session = await panel().getAttribute('data-session-id');
  assert.equal(session, 'session-f5a52ca5-3458-4d0e-ac46-cc8a5701edc0');
  const before = (await nativeLog(session)).at(-1).seq;
  await panel().locator('[contenteditable="true"]').fill('总结当前文档');
  await panel().getByRole('button', { name: '发送消息', exact: true }).click();
  let rows, call, result, done;
  for (let i = 0; i < 90; i++) {
    await p.waitForTimeout(1000);
    rows = await nativeLog(session);
    call = rows.find(
      (r) =>
        r.seq > before &&
        r.type === 'tool/call' &&
        r.data.name === 'univer_inspect',
    );
    result =
      call &&
      rows.find(
        (r) =>
          r.type === 'tool/result' &&
          r.data.message.toolCallId === call.data.callId,
      );
    done =
      result && rows.find((r) => r.seq > result.seq && r.type === 'turn/end');
    if (done) break;
  }
  assert.ok(call);
  assert.equal(JSON.parse(call.data.arguments).nodeId, f.doc.id);
  assert.equal(result.data.message.isError, false);
  assert.match(text(result.data.message.content), /SPACE-ORBIT-7419/);
  assert.ok(done);
  const human = rows.find(
    (r) =>
      r.seq > before &&
      r.type === 'user/message' &&
      r.data.source?.kind === 'user',
  );
  assert.equal(text(human.data.content), '总结当前文档');
  await shot('native-tool');
  check(
    'Same existing native Session executes a new successful formal Workspace Tool read',
  );
  const appearance = await p.evaluate(() => {
    const root = document.querySelector('[data-space-host-navigation]');
    const s = getComputedStyle(root);
    return {
      rail: s.getPropertyValue('--sp-rail-fill'),
      secondary: s.getPropertyValue('--sp-secondary-fill'),
      secondaryRendered: s.backgroundColor,
    };
  });
  await p.evaluate(() =>
    document.documentElement.setAttribute('data-platform', 'darwin'),
  );
  await settle();
  const dragContract = await p.evaluate(() => {
    const rect = (e) => e?.getBoundingClientRect().toJSON();
    const prop = (e) =>
      e && getComputedStyle(e).getPropertyValue('-webkit-app-region');
    const header = document.querySelector('.sp-page-toolbar');
    const controls = [
      ...document.querySelectorAll(
        '.sp-page-toolbar button, .sp-page-toolbar summary, .sp-secondary-controls button',
      ),
    ];
    return {
      carrier:
        'Edge Web with CSS-only darwin platform flag; not native window movement',
      toolbar: { box: rect(header), region: prop(header) },
      controls: controls.map((e) => ({
        label: e.getAttribute('aria-label'),
        region: prop(e),
      })),
      activity: rect(document.querySelector('nav[aria-label="Activity bar"]')),
    };
  });
  assert.equal(dragContract.toolbar.region, 'drag');
  assert.ok(dragContract.controls.every((x) => x.region === 'no-drag'));
  assert.equal(dragContract.toolbar.box.y, 0);
  assert.equal(await p.locator('[data-space-window-chrome]').count(), 0);
  assert.equal(dragContract.activity.y, 48);
  await p
    .getByRole('button', { name: 'Toggle secondary sidebar', exact: true })
    .click();
  await activity('Space').click();
  await p.getByRole('button', { name: 'Search content', exact: true }).click();
  await p.locator('.sp-browser .sp-search input').waitFor();
  await shot('darwin-css-contract');
  await p.evaluate(() =>
    document.documentElement.removeAttribute('data-platform'),
  );
  await settle();
  await writeFile(
    resolve(out, 'drag-contract.json'),
    JSON.stringify(
      {
        appearance,
        dragContract,
        nativeAcceptance:
          'Blocked: Computer Use service startup failed twice; OS window movement not verified',
      },
      null,
      2,
    ),
  );
  check(
    'Theme-aware Space navigation and existing-header drag/no-drag contract; no added chrome or top padding',
  );
  const toolEvents = rows
    .filter((r) => r.seq > before)
    .flatMap((r) => {
      const a = { seq: r.seq, type: r.type, time: r.time };
      if (r.type === 'user/message' && r.data.source?.kind === 'user')
        return [{ ...a, text: text(r.data.content), source: 'user' }];
      if (
        r.type === 'user/message' &&
        r.data.source?.kind === 'runtime-context'
      )
        return [
          {
            ...a,
            source: 'runtime-context',
            sections: r.data.source.sections.filter(
              (s) => s.name === 'space:current-document',
            ),
          },
        ];
      if (r.type === 'tool/call')
        return [
          {
            ...a,
            name: r.data.name,
            callId: r.data.callId,
            arguments: r.data.arguments,
          },
        ];
      if (r.type === 'tool/result')
        return [
          {
            ...a,
            callId: r.data.message.toolCallId,
            isError: r.data.message.isError,
            text: text(r.data.message.content),
          },
        ];
      if (r.type === 'assistant/message')
        return [{ ...a, text: text(r.data.message.content) }];
      if (r.type === 'turn/end') return [a];
      return [];
    });
  await writeFile(
    resolve(out, 'native-tool.json'),
    JSON.stringify({ sessionId: session, events: toolEvents }, null, 2),
  );
  assert.deepEqual(pageErrors, []);
  await writeFile(
    resolve(out, 'navigation-live.json'),
    JSON.stringify(
      {
        carrier:
          'Official Electron-owned DSH Host, Edge Web, real existing Server/user/Session',
        pluginVersion: JSON.parse(
          await readFile(new URL('../package.json', import.meta.url), 'utf8'),
        ).version,
        checks,
        functionalAcceptance: true,
        consoleClean: errors.length === 0,
        pageErrors,
        layout,
        metrics,
        hashes,
        screens,
        errors,
      },
      null,
      2,
    ),
  );
  if (errors.length) process.exitCode = 1;
} catch (error) {
  await p.screenshot({ path: resolve(out, 'failure.png') });
  await writeFile(
    resolve(out, 'failure.json'),
    JSON.stringify({ checks, error: error.message, errors }, null, 2),
  );
  throw error;
} finally {
  await b.close();
}
