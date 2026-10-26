/** TASK-008R real UI/Server/Host verification. Requires private fixture paths in env. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { connectHost } from './host-connection.mjs';
const { chromium } = await import(
  process.env.SPACE_PLAYWRIGHT_MODULE ?? 'playwright'
);
const f = JSON.parse(await readFile(process.env.SPACE_TEST_LOGIN_FILE, 'utf8')),
  extra = JSON.parse(await readFile(process.env.SPACE_MVP_FIXTURES, 'utf8'));
const out = resolve(
  process.env.SPACE_EVIDENCE_DIR ?? '/tmp/space-plugin-evidence',
);
await mkdir(out, { recursive: true });
const h = await connectHost(),
  checks = [],
  errors = [],
  screens = [];
const b = await chromium.launch({
    headless: true,
    executablePath: process.env.SPACE_BROWSER_EXECUTABLE,
  }),
  c = await b.newContext({ viewport: { width: 1440, height: 900 } });
await c.addCookies(
  h.headers.cookie.split('; ').map((p) => ({
    name: p.slice(0, p.indexOf('=')),
    value: p.slice(p.indexOf('=') + 1),
    url: h.origin,
    httpOnly: true,
  })),
);
const p = await c.newPage();
p.setDefaultTimeout(15000);
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (e) => {
  if (e.type() === 'error') errors.push(e.text().slice(0, 400));
});
const panel = () => p.locator('.sp-floating-chat');
const shot = async (name) => {
  await p.screenshot({ path: resolve(out, name + '.png') });
  screens.push(name + '.png');
};
const check = (m) => {
  checks.push(m);
  console.log(m);
};
const cookieHash = async () =>
  createHash('sha256')
    .update(
      JSON.stringify(
        (await c.cookies(h.origin)).map(({ name, value }) => ({ name, value })),
      ),
    )
    .digest('hex');
async function back() {
  await p.getByRole('button', { name: 'Back to Chat', exact: true }).click();
  await p.locator('[data-space-sidebar]').waitFor({ state: 'hidden' });
}
async function open(n) {
  if (
    await p.getByRole('button', { name: 'Close viewer', exact: true }).count()
  )
    await p.getByRole('button', { name: 'Close viewer', exact: true }).click();
  await p
    .getByRole('navigation', { name: 'Space navigation', exact: true })
    .getByRole('button', { name: 'All', exact: true })
    .click();
  await p.locator('.sp-file-open').filter({ hasText: n.name }).click();
  if (n.resource?.unitType)
    await p.locator('.sp-viewer[data-viewer-state="ready"]').waitFor();
  else await p.locator('.sp-html-preview iframe').waitFor();
  assert.equal(await p.locator('.sp-page-title').count(), 0);
  assert.equal(await p.locator('.sp-page-toolbar').count(), 1);
}
async function settings() {
  await p
    .getByRole('button', { name: 'Workspace settings', exact: true })
    .click();
  await p
    .getByRole('dialog', { name: 'Workspace Settings', exact: true })
    .waitFor();
}
async function connect(endpoint) {
  await p.getByLabel('Workspace Endpoint', { exact: true }).fill(endpoint);
  await p.getByRole('button', { name: /^(连接服务|重新连接)$/ }).click();
  await p.waitForTimeout(500);
}
async function login() {
  await p.getByLabel('用户名', { exact: true }).fill(f.username);
  await p.getByLabel('密码', { exact: true }).fill(f.password);
  await p.getByRole('button', { name: '登录 Workspace', exact: true }).click();
  await p
    .getByRole('dialog', { name: 'Workspace Settings', exact: true })
    .waitFor({ state: 'hidden' });
}
const text = (blocks) =>
  Array.isArray(blocks)
    ? blocks
        .filter((x) => x.type === 'text')
        .map((x) => x.text)
        .join('\n')
    : '';
async function logs(id) {
  const root = process.env.SPACE_SESSION_ROOT,
    name = (await readdir(root, { recursive: true })).find(
      (n) => n.includes(id) && n.endsWith('session.v4.jsonl.zstd'),
    );
  assert.ok(name, 'Native log exists');
  const d = spawnSync('zstd', ['-dc', resolve(root, name)], {
    encoding: 'utf8',
    maxBuffer: 48 * 1024 * 1024,
  });
  assert.equal(d.status, 0);
  return d.stdout
    .trim()
    .split('\n')
    .map((x) => JSON.parse(x));
}
async function summarize(node, label) {
  await p
    .getByRole('button', { name: 'Chat about this document', exact: true })
    .click();
  await panel().locator('[data-context-state="linked"]').waitFor();
  assert.equal(
    await panel()
      .locator('[data-page-context]')
      .getAttribute('data-page-context'),
    node.id,
  );
  const id = await panel().getAttribute('data-session-id'),
    before = (await logs(id)).at(-1).seq;
  await panel().locator('[contenteditable="true"]').fill('总结当前文档');
  await panel().getByRole('button', { name: '发送消息', exact: true }).click();
  let rows, call, result, ended;
  for (let i = 0; i < 100; i++) {
    await p.waitForTimeout(1000);
    rows = await logs(id);
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
    ended =
      result && rows.find((r) => r.seq > result.seq && r.type === 'turn/end');
    if (ended) break;
  }
  assert.ok(call, 'Fresh native univer_inspect required');
  assert.equal(JSON.parse(call.data.arguments).nodeId, node.id);
  assert.equal(result?.data.message.isError, false);
  assert.ok(ended, 'Native turn ended');
  const events = rows.filter((r) => r.seq > before),
    human = events.find(
      (r) => r.type === 'user/message' && r.data.source?.kind === 'user',
    );
  assert.equal(text(human.data.content), '总结当前文档');
  const sanitized = events.flatMap((r) => {
    const a = { seq: r.seq, type: r.type, time: r.time };
    if (r.type === 'user/message')
      return [{ ...a, source: r.data.source, text: text(r.data.content) }];
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
    resolve(out, `native-${label}-tool.json`),
    JSON.stringify(
      {
        carrier: 'Official Electron-owned DSH Host exercised through Web UI',
        sessionId: id,
        nodeId: node.id,
        verified: {
          plainPrompt: true,
          freshToolCall: true,
          correctNode: true,
          successfulTool: true,
          turnEnded: true,
        },
        events: sanitized,
      },
      null,
      2,
    ),
  );
  await shot(`after-${label}-context`);
  check(
    `${label}: plain prompt → new native univer_inspect(${node.id}) → result → turn/end`,
  );
  return id;
}
try {
  await p.goto(h.origin);
  await p.getByText('TASK-006 最终正式路径验收', { exact: true }).click();
  await p.waitForTimeout(1000);
  const draft = await p.locator('[contenteditable="true"]').innerText(),
    cookie = await cookieHash();
  const handle = await p.locator('[data-side="sidebar"]').boundingBox();
  await p.mouse.move(handle.x + handle.width / 2, 200);
  await p.mouse.down();
  await p.mouse.move(handle.x + handle.width / 2 + 50, 200, { steps: 8 });
  await p.mouse.up();
  const width = await p
    .locator('[data-side="sidebar"]')
    .evaluate((e) => e.style.left);
  await shot('chat-before-space');
  await p.getByRole('button', { name: 'Space', exact: true }).click();
  await p.locator('[data-space-sidebar]').waitFor();
  assert.equal(
    await p
      .getByRole('navigation', { name: 'Space navigation', exact: true })
      .count(),
    1,
  );
  assert.equal(
    await p.locator('[data-side="sidebar"]').evaluate((e) => e.style.left),
    width,
  );
  await shot('after-navigation');
  check(
    'Space navigation immediately visible in one native sidebar at custom width',
  );
  await settings();
  if ((await h.request('space/status')).state !== 'connected') {
    await connect(f.origin);
    await login();
  } else await p.keyboard.press('Escape');
  await open(f.doc);
  await p.locator('[data-context-state="linked"]').waitFor();
  const session = await panel().getAttribute('data-session-id');
  await settings();
  await connect(f.origin);
  assert.equal((await h.request('space/status')).state, 'connected');
  await p.keyboard.press('Escape');
  assert.equal(await panel().getAttribute('data-session-id'), session);
  await p.locator('.sp-viewer[data-viewer-state="ready"]').waitFor();
  check(
    'Same-endpoint reconnect keeps Workspace login, file and existing DSH Session',
  );
  await assert.rejects(
    h.request('space/login', {
      username: f.username,
      password: 'invalid-test-' + crypto.randomUUID(),
    }),
  );
  assert.equal((await h.request('space/status')).state, 'connected');
  check(
    'Failed Workspace sign-in preserves the previous authorized Workspace identity',
  );
  await settings();
  await connect('http://127.0.0.1:1');
  assert.equal((await h.request('space/status')).state, 'connected');
  assert.equal((await h.request('space/status')).endpoint, f.origin);
  await shot('after-failed-connection');
  await p.keyboard.press('Escape');
  assert.equal(await panel().getAttribute('data-session-id'), session);
  check(
    'Unreachable replacement keeps existing authorized connection and Session',
  );
  await panel()
    .getByRole('button', { name: 'Remove document association', exact: true })
    .click();
  await panel().locator('[data-context-state="removed"]').waitFor();
  await panel().getByRole('button', { name: '关联', exact: true }).click();
  await panel().locator('[data-context-state="linked"]').waitFor();
  check(
    'Native input current-document association can be removed and restored',
  );
  const id = await summarize(f.doc, 'doc');
  await open(f.sheet);
  await p.locator('[data-context-state="linked"]').waitFor();
  assert.equal(await panel().getAttribute('data-session-id'), id);
  if (!process.env.SPACE_REUSE_TOOL_EVIDENCE) await summarize(f.sheet, 'sheet');
  for (const n of [...extra.nodes, extra.site]) {
    await open(n);
    assert.equal(await p.locator('[data-context-state="linked"]').count(), 0);
    await shot(`after-${n.resource?.unitType ?? 'site'}`);
  }
  check(
    'Six viewers use one identity toolbar and no outer title; unsupported read types clear prior document',
  );
  await open(f.doc);
  await back();
  assert.equal(await p.locator('[contenteditable="true"]').innerText(), draft);
  assert.equal(
    await p.locator('[data-side="sidebar"]').evaluate((e) => e.style.left),
    width,
  );
  assert.equal(await cookieHash(), cookie);
  await h.request('pluginManager/listBundles', { args: {} });
  check(
    'Chat return preserves original draft, native navigation, custom width and Host authorization',
  );
  await p.getByRole('button', { name: 'Space', exact: true }).click();
  await p.locator('[data-space-sidebar]').waitFor();
  await p.getByRole('button', { name: '收起侧边栏', exact: true }).click();
  await p.locator('[data-space-sidebar][data-wide="false"]').waitFor();
  await shot('after-collapsed');
  await back();
  assert.equal(
    await p.getByRole('button', { name: '打开侧边栏', exact: true }).count(),
    1,
  );
  await p.getByRole('button', { name: 'Space', exact: true }).click();
  await p
    .getByRole('button', { name: 'Expand Space navigation', exact: true })
    .click();
  await p.locator('[data-space-sidebar][data-wide="true"]').waitFor();
  check(
    'Native collapse/expand and Chat/Space switching preserve usable navigation',
  );
  await p.setViewportSize({ width: 820, height: 720 });
  await p.locator('[data-space-sidebar][data-wide="false"]').waitFor();
  await p.locator('.sp-viewer[data-viewer-state="ready"]').waitFor();
  await p.waitForTimeout(300);
  await shot('after-narrow');
  for (let i = 0; i < 5; i++) {
    await back();
    await p.getByRole('button', { name: 'Space', exact: true }).click();
    await p.locator('[data-space-sidebar]').waitFor();
    assert.equal(await p.locator('.sp-nav-scrim').count(), 0);
    assert.equal(
      await p
        .getByRole('button', { name: 'Space', exact: true })
        .getAttribute('aria-current'),
      'page',
    );
  }
  check(
    'Narrow window plus five round trips leaves no overlay or duplicate sidebar',
  );
  await p.setViewportSize({ width: 1440, height: 900 });
  await settings();
  await p.getByRole('button', { name: '断开 Workspace', exact: true }).click();
  await p.waitForTimeout(300);
  assert.equal((await h.request('space/status')).state, 'unconfigured');
  await connect(f.origin);
  await login();
  await open(f.doc);
  await p.locator('[data-context-state="linked"]').waitFor();
  assert.equal(await panel().getAttribute('data-session-id'), session);
  assert.equal(await cookieHash(), cookie);
  check(
    'Workspace disconnect/reconnect restores authorized file access without replacing DSH Session',
  );
  await c.setOffline(true);
  await p.waitForTimeout(500);
  await c.setOffline(false);
  await p.waitForTimeout(2500);
  await p.locator('[data-context-state="linked"]').waitFor();
  assert.equal(await panel().getAttribute('data-session-id'), session);
  assert.equal((await h.request('space/status')).state, 'connected');
  check(
    'Web transport offline/online reset preserves native Session and current file association',
  );
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(out, 'recovery-live.json'),
    JSON.stringify(
      {
        carrier: 'Official DSH Web, Edge headless, Electron-owned Host',
        checks,
        errors,
        screens,
        sessionId: session,
        customWidth: width,
      },
      null,
      2,
    ),
  );
} catch (e) {
  await shot('failure');
  await writeFile(
    resolve(out, 'failure.json'),
    JSON.stringify({ checks, errors, error: e.message }, null, 2),
  );
  throw e;
} finally {
  await b.close();
}
