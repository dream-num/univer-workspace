/** Read-only observation of the original Workspace Browser editor, not a replacement UI. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const { chromium } = await import(
  process.env.SPACE_PLAYWRIGHT_MODULE ?? 'playwright'
);
const f = JSON.parse(await readFile(process.env.SPACE_TEST_LOGIN_FILE, 'utf8'));
const browserOrigin = process.env.SPACE_WORKSPACE_BROWSER_ORIGIN;
const out = resolve(
  process.env.SPACE_EVIDENCE_DIR ?? '/tmp/space-plugin-evidence',
);
await mkdir(out, { recursive: true });
const login = await fetch(f.origin + '/api/auth/password/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: f.username, password: f.password }),
});
assert.ok(login.ok);
const cookie = login.headers
  .getSetCookie()
  .map((v) => v.split(';')[0])
  .join('; ');
const snapshot = async () => {
  const r = await fetch(
    f.origin + `/universer-api/snapshot/1/unit/${f.doc.resource.unitId}/rev/0`,
    { headers: { cookie } },
  );
  assert.ok(r.ok);
  return createHash('sha256')
    .update(await r.text())
    .digest('hex');
};
const before = await snapshot(),
  b = await chromium.launch({
    headless: true,
    executablePath: process.env.SPACE_BROWSER_EXECUTABLE,
  }),
  c = await b.newContext({ viewport: { width: 1440, height: 900 } }),
  errors = [],
  sockets = [],
  requests = [];
await c.addCookies(
  login.headers.getSetCookie().map((value) => {
    const first = value.split(';')[0],
      i = first.indexOf('=');
    return {
      name: first.slice(0, i),
      value: first.slice(i + 1),
      url: browserOrigin,
      httpOnly: true,
    };
  }),
);
const p = await c.newPage();
p.setDefaultTimeout(30000);
p.on('pageerror', (e) => errors.push(e.message));
p.on('websocket', (s) => {
  const a = { path: new URL(s.url()).pathname, sent: 0, received: 0 };
  sockets.push(a);
  s.on('framesent', () => a.sent++);
  s.on('framereceived', () => a.received++);
});
p.on('response', (r) => {
  const path = new URL(r.url()).pathname;
  if (path.startsWith('/universer-api/'))
    requests.push({ method: r.request().method(), path, status: r.status() });
});
try {
  await p.goto(browserOrigin + '/nodes/' + f.doc.id);
  await p.getByText('版本历史记录', { exact: true }).waitFor();
  await p.waitForTimeout(3000);
  await p.screenshot({ path: resolve(out, 'formal-editor.png') });
  await p.getByText('版本历史记录', { exact: true }).click();
  await p.getByText('当前版本', { exact: true }).waitFor();
  await p.screenshot({ path: resolve(out, 'formal-history.png') });
  assert.ok(
    sockets.some(
      (s) =>
        s.path === '/universer-api/comb/connect' &&
        s.sent > 0 &&
        s.received > 0,
    ),
  );
  assert.deepEqual(errors, []);
  await p.goto('about:blank');
  const after = await snapshot();
  assert.equal(
    after,
    before,
    'Opening the editor/history must not change persisted content',
  );
  await writeFile(
    resolve(out, 'formal-editor-live.json'),
    JSON.stringify(
      {
        carrier:
          'Original Univer Workspace Browser served by its Vite config against the same real Server and user',
        nodeId: f.doc.id,
        verified: {
          nativeCollaborationSocket: true,
          historyCurrentVersionVisible: true,
          persistedSnapshotUnchanged: true,
          noContentEdits: true,
        },
        before,
        after,
        sockets,
        requests,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    'Original editor: live collaboration socket, current history version, unchanged persisted Snapshot',
  );
} finally {
  await b.close();
}
