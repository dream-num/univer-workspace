/** Six real current-file identities and new native Agent reads in the same existing Session. */
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { connectHost } from './host-connection.mjs';
const { chromium } = await import(
  process.env.SPACE_PLAYWRIGHT_MODULE ?? 'playwright'
);
const h = await connectHost(),
  fixture = JSON.parse(
    await readFile(process.env.SPACE_TEST_LOGIN_FILE, 'utf8'),
  ),
  extra = JSON.parse(await readFile(process.env.SPACE_MVP_FIXTURES, 'utf8')),
  out = resolve(process.env.SPACE_EVIDENCE_DIR ?? '/tmp/space-plugin-evidence');
await mkdir(out, { recursive: true });
const session = 'session-f5a52ca5-3458-4d0e-ac46-cc8a5701edc0',
  root = process.env.SPACE_SESSION_ROOT,
  file = (await readdir(root, { recursive: true })).find(
    (x) => x.includes(session) && x.endsWith('session.v4.jsonl.zstd'),
  );
assert.ok(file);
function log() {
  const r = spawnSync('zstd', ['-dc', resolve(root, file)], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(r.status, 0);
  return r.stdout.trim().split('\n').map(JSON.parse);
}
const text = (blocks) =>
  blocks
    ?.filter((x) => x.type === 'text')
    .map((x) => x.text)
    .join('\n') ?? '';
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
  results = [],
  errors = [];
p.setDefaultTimeout(25000);
p.on('pageerror', (e) => errors.push(e.message));
try {
  await p.goto(h.origin);
  await p.locator('[contenteditable="true"]').first().waitFor();
  await p.getByText('TASK-006 最终正式路径验收', { exact: true }).click();
  await p
    .getByRole('navigation', { name: 'Activity bar', exact: true })
    .getByRole('button', { name: 'Space', exact: true })
    .click();
  for (const n of [fixture.doc, fixture.sheet, ...extra.nodes, extra.site]) {
    await p
      .getByRole('navigation', { name: 'Content types', exact: true })
      .getByRole('button', { name: 'All', exact: true })
      .click();
    await p.locator('.sp-file-open').filter({ hasText: n.name }).click();
    await p
      .locator(`[data-page-context="${n.id}"][data-context-state="linked"]`)
      .waitFor();
    await p
      .getByRole('button', { name: 'Chat about this document', exact: true })
      .click();
    assert.equal(
      await p.locator('.sp-floating-chat').getAttribute('data-session-id'),
      session,
    );
    const before = log().at(-1).seq,
      prompt =
        '请使用 univer_inspect 读取当前文件，简短概括其内容。不要修改文件。';
    await p.locator('.sp-floating-chat [contenteditable="true"]').fill(prompt);
    await p
      .locator('.sp-floating-chat')
      .getByRole('button', { name: '发送消息', exact: true })
      .click();
    let rows, call, result, done;
    for (let i = 0; i < 120; i++) {
      await p.waitForTimeout(1000);
      rows = log().filter((r) => r.seq > before);
      call = rows.find(
        (r) => r.type === 'tool/call' && r.data.name === 'univer_inspect',
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
    assert.equal(JSON.parse(call.data.arguments).nodeId, n.id);
    assert.ok(result);
    assert.equal(result.data.message.isError, false);
    assert.ok(done);
    const value = JSON.parse(text(result.data.message.content));
    assert.equal(value.file.nodeId, n.id);
    assert.ok(value.lines.length > 0);
    const human = rows.find(
      (r) => r.type === 'user/message' && r.data.source?.kind === 'user',
    );
    assert.equal(text(human.data.content), prompt);
    const type = value.file.type;
    await p.screenshot({ path: resolve(out, 'context-' + type + '.png') });
    results.push({
      type,
      nodeId: n.id,
      sessionId: session,
      currentIdentityVisible: true,
      normalHumanPrompt: prompt,
      call: {
        seq: call.seq,
        name: call.data.name,
        arguments: JSON.parse(call.data.arguments),
        callId: call.data.callId,
      },
      result: { seq: result.seq, isError: false, value },
      answer: rows
        .filter((r) => r.type === 'assistant/message')
        .map((r) => text(r.data.message.content))
        .join('\n'),
      turnEnded: done.seq,
    });
    await writeFile(
      resolve(out, 'all-context-live.json'),
      JSON.stringify(
        {
          carrier:
            'Official Host Web, existing real Server/user/Session, native Agent and formal Workspace Tool',
          pluginVersion: JSON.parse(
            await readFile(new URL('../package.json', import.meta.url), 'utf8'),
          ).version,
          results,
          pageErrors: errors,
        },
        null,
        2,
      ),
    );
    console.log(type + ': current identity and new native Tool read passed');
    await p
      .getByRole('button', { name: 'Remove document association', exact: true })
      .click();
    await p.locator('[data-context-state="removed"]').waitFor();
    await p.getByRole('button', { name: '关联', exact: true }).click();
    await p
      .locator(`[data-page-context="${n.id}"][data-context-state="linked"]`)
      .waitFor();
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
