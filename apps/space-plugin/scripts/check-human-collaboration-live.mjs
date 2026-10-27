/** Two independent official DSH hosts and distinct real Workspace identities.
 * UI actions create membership, content and comments. Evidence never stores auth.
 */
import assert from 'node:assert/strict';
import { CombCmd } from '@univerjs/protocol';
import {
  serializeCombRequest,
  deserializeToCombResponse,
} from '@univerjs-pro/collaboration-client';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connectHost, authorizeWorkspace } from './host-connection.mjs';
const { chromium } = await import(
  process.env.SPACE_PLAYWRIGHT_MODULE ?? 'playwright'
);
const out = resolve(
  process.env.SPACE_EVIDENCE_DIR ?? '/tmp/space-human-collaboration',
);
await mkdir(out, { recursive: true });
const hosts = [
  await connectHost(),
  await connectHost(process.env.SPACE_SECOND_DSH_LOG),
];
const logins = await Promise.all(
  [process.env.SPACE_TEST_LOGIN_FILE, process.env.SPACE_SECOND_LOGIN_FILE].map(
    async (file) => JSON.parse(await readFile(file, 'utf8')),
  ),
);
const checks = [],
  wire = [],
  errors = [],
  consoleErrors = [],
  clients = [];
let stage = 'identity',
  bWrite,
  probeSocket;
const record = (what, result = {}) => {
  checks.push({ what, at: new Date().toISOString(), ...result });
  console.log('PASS', what);
};
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.SPACE_BROWSER_EXECUTABLE,
});
for (let i = 0; i < 2; i++) {
  await hosts[i].request('space/configure', { endpoint: logins[i].origin });
  await authorizeWorkspace(hosts[i], logins[i]);
}
const identities = await Promise.all(
  hosts.map((h) => h.request('space/status')),
);
assert.notEqual(identities[0].user.id, identities[1].user.id);
record('Two distinct Workspace users on independent Hosts', {
  users: identities.map((x) => x.user),
});
async function client(i) {
  const h = hosts[i],
    context = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
  await context.addCookies(
    h.headers.cookie.split('; ').map((pair) => ({
      name: pair.slice(0, pair.indexOf('=')),
      value: pair.slice(pair.indexOf('=') + 1),
      url: h.origin,
      httpOnly: true,
    })),
  );
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => errors.push({ user: i, message: e.message }));
  page.on('console', (e) => {
    if (e.type() === 'error')
      consoleErrors.push({ user: i, message: e.text().slice(0, 800) });
  });
  page.on('response', async (response) => {
    try {
      if (response.status() >= 400)
        wire.push({
          user: i,
          path: new URL(response.url()).pathname,
          status: response.status(),
          kind: 'HTTP failure',
        });
      if (!response.url().includes('/api/space/')) return;
      const op = new URL(response.url()).pathname.split('/').at(-1);
      if (!['editor-http', 'sharing', 'create', 'metadata'].includes(op))
        return;
      const input = response.request().postDataJSON().payload,
        envelope = await response.json(),
        result = envelope.result.value;
      if (op === 'editor-http') {
        wire.push({
          user: i,
          path: input.path,
          method: input.method,
          status: result?.status,
          error: envelope.result.error?.message,
          at: new Date().toISOString(),
        });
        if (
          i === 1 &&
          /\/new_changes/.test(input.path) &&
          result?.status === 200
        )
          bWrite = input;
      } else
        wire.push({
          user: i,
          operation: op,
          request: input,
          status: response.status(),
          result: result ?? envelope.result.error,
          at: new Date().toISOString(),
        });
    } catch {
      /* A response canceled by closing a test client is recorded by its assertion. */
    }
  });
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname !== '/universer-api/comb/connect')
      return;
    const row = {
      user: i,
      path: '/universer-api/comb/connect',
      sent: 0,
      received: 0,
    };
    wire.push(row);
    socket.on('framesent', () => row.sent++);
    socket.on('framereceived', ({ payload }) => {
      row.received++;
      try {
        const message = deserializeToCombResponse({
          data:
            typeof payload === 'string' ? payload : payload.toString('utf8'),
        });
        const data = message.collaMsg;
        const cs = data?.permissionRejEvent?.cs ?? data?.csRejEvent?.cs;
        if (cs)
          wire.push({
            user: i,
            kind: 'Unit rejection',
            eventID: data.eventID,
            unitId: cs.unitID,
            reqId: cs.reqId,
            baseRev: cs.baseRev,
            at: new Date().toISOString(),
          });
      } catch {
        /* Non-JSON control frames carry no mutation acceptance evidence. */
      }
    });
  });
  await page.goto(h.origin);
  await page
    .getByText(
      process.env.SPACE_TEST_SESSION_TITLE ?? 'TASK-006 最终正式路径验收',
      { exact: true },
    )
    .click();
  await page
    .getByRole('navigation', { name: 'Activity bar', exact: true })
    .getByRole('button', { name: 'Space', exact: true })
    .click();
  clients[i] = { page, context };
  return page;
}
async function create(page, kind, label, name, invite = false) {
  await page.locator('.sp-primary summary').click();
  const menu = page.locator('.sp-primary [role=menu]');
  assert.deepEqual(await menu.getByRole('menuitem').allTextContents(), [
    'Doc',
    'Sheet',
    'Slide',
    'Canvas',
    'Relational Table',
    'Page',
    'Folder',
    'Space',
  ]);
  await menu.getByRole('menuitem', { name: label, exact: true }).click();
  const dialog = page.getByRole('dialog', {
    name: `Create ${kind}`,
    exact: true,
  });
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  if (invite) {
    await dialog
      .getByRole('button', { name: 'Invite people (optional)' })
      .click();
    await dialog
      .getByLabel('Add people', { exact: true })
      .fill(logins[1].username);
    await dialog
      .getByRole('option')
      .filter({ hasText: logins[1].username })
      .click();
    await dialog.getByLabel('Invitation role').selectOption('editor');
  }
  const membership = invite ? page.waitForResponse(response => {
    if (!response.url().endsWith('/api/space/sharing')) return false;
    try { return response.request().postDataJSON().payload?.action === 'set-member'; } catch { return false; }
  }) : undefined;
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  if (membership) assert.equal((await (await membership).json()).result.ok, true);
}
async function ready(page) {
  await page.locator('[data-editor-state=saved]').waitFor({ timeout: 60000 });
}
async function focusDoc(page) {
  await page.bringToFront();
  const boxes = await page.locator('.sp-sdk canvas').evaluateAll((elements) =>
    elements
      .map((element) => {
        const r = element.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })
      .filter((r) => r.width > 400 && r.height > 200),
  );
  const r = boxes.sort((a, b) => b.width * b.height - a.width * a.height)[0];
  assert.ok(r, 'Visible document canvas');
  await page.mouse.dblclick(r.x + 300, r.y + 100);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  return r;
}
async function copyDoc(page) {
  await focusDoc(page);
  await page.keyboard.press('Meta+a');
  await page.evaluate(() => navigator.clipboard.writeText('__copy_pending__'));
  await page.keyboard.press('Meta+c');
  await page.waitForFunction(
    async () => (await navigator.clipboard.readText()) !== '__copy_pending__',
  );
  return page.evaluate(() => navigator.clipboard.readText());
}
async function waitText(page, token) {
  for (let n = 0; n < 25; n++) {
    const text = await copyDoc(page);
    if (text.includes(token)) return text;
    await page.waitForTimeout(200);
  }
  throw new Error(`Document did not synchronize ${token}`);
}
async function comments(page) {
  const show = page.getByRole('button', {
    name: 'Show all comments',
    exact: true,
  });
  if (await show.count()) await show.click();
  await page
    .locator('.sp-sdk')
    .getByText('评论管理', { exact: true })
    .waitFor();
}
async function open(page, name) {
  await page.locator('.sp-file-open').filter({ hasText: name }).click();
  await ready(page);
}
async function permissionProbe(unitId) {
  const input = {
    endpoint: logins[1].origin,
    userId: identities[1].user.id,
    path: '/universer-api/user/session-ticket',
    method: 'GET',
    body: null,
  };
  const ticket = JSON.parse(
    (await hosts[1].request('space/editor-http', input)).body,
  ).ticket;
  const socket = new WebSocket(
    logins[1].origin.replace(/^http/, 'ws') +
      '/universer-api/comb/connect?sessionTicket=' +
      encodeURIComponent(ticket),
  );
  probeSocket = socket;
  const once = (predicate) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.removeEventListener('message', receive);
        reject(new Error('No protocol response'));
      }, 10000);
      function receive(event) {
        const message = deserializeToCombResponse(event);
        if (predicate(message)) {
          clearTimeout(timer);
          socket.removeEventListener('message', receive);
          resolve(message);
        }
      }
      socket.addEventListener('message', receive);
    });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener(
      'error',
      () => reject(new Error('Protocol socket unavailable')),
      { once: true },
    );
  });
  const helloWait = once((message) => message.cmd === CombCmd.HELLO);
  socket.send(
    serializeCombRequest({
      cmd: CombCmd.HELLO,
      routeKey: 'hello',
      routeType: '',
    }),
  );
  const hello = await helloWait;
  assert.equal(hello.code, 1);
  const joinWait = once((message) => message.cmd === CombCmd.JOIN);
  socket.send(
    serializeCombRequest({
      cmd: CombCmd.JOIN,
      routeKey: unitId,
      routeType: '',
      data: { rooms: [{ roomID: unitId, args: '' }] },
    }),
  );
  const join = await joinWait;
  assert.equal(join.code, 1);
  return {
    socket,
    memberID: hello.data.memberID,
    rejected: (reqId) =>
      once(
        (message) =>
          (
            message.collaMsg?.permissionRejEvent?.cs ??
            message.collaMsg?.csRejEvent?.cs
          )?.reqId === reqId,
      ),
  };
}
async function shot(page, filename) {
  await page.screenshot({ path: resolve(out, filename) });
}
let space, doc, rootId;
try {
  const a = await client(0),
    name = `TASK009C Collaboration ${Date.now()}`;
  stage = 'Space creation and invitation';
  await create(a, 'space', 'Space', name, true);
  space = (await hosts[0].request('space/spaces')).spaces.find(
    (x) => x.name === name,
  );
  assert.ok(space);
  const membership = await hosts[1].request('space/sharing', {
    action: 'members',
    id: space.id,
  });
  assert.ok(
    membership.members.some(
      (x) => x.user.id === identities[1].user.id && x.role === 'editor',
    ),
  );
  record(
    'A creates Space and invites B as Editor; B reads persisted membership',
    { space, membership },
  );
  await a.getByRole('button', { name: 'Share Space', exact: true }).click();
  await a
    .getByRole('dialog', { name: 'Share ' + name, exact: true })
    .getByText(identities[1].user.displayName, { exact: true })
    .waitFor();
  await shot(a, 'space-members.png');
  await a.getByRole('button', { name: 'Done', exact: true }).click();
  stage = 'Document creation';
  const docName = `TASK009C Shared Doc ${Date.now()}`;
  await create(a, 'doc', 'Doc', docName);
  await ready(a);
  doc = (await hosts[0].request('space/index')).nodes.find(
    (x) => x.name === docName,
  );
  assert.ok(doc);
  const b = await client(1);
  await open(b, docName);
  record('B discovers authorized Space and opens its Doc', {
    nodeId: doc.id,
    resourceId: doc.resource.id,
    unitId: doc.resource.unitId,
  });
  stage = 'Presence';
  for (const page of [a, b])
    for (const user of identities.map((x) => x.user))
      await page
        .locator(`.sp-collaborators [data-user-id="${user.id}"]`)
        .waitFor();
  record('Both clients show the actual two Workspace identities online');
  stage = 'Bidirectional editing';
  const tokenA = 'FROM_A_' + Date.now(),
    tokenB = 'FROM_B_' + Date.now();
  await focusDoc(a);
  await a.keyboard.type(`Alpha passage. Beta discussion anchor. ${tokenA} `, {
    delay: 15,
  });
  const textAtB = await waitText(b, tokenA);
  await b.keyboard.press('ArrowRight');
  await b.keyboard.type(tokenB, { delay: 15 });
  const textAtA = await waitText(a, tokenB);
  await ready(a);
  await ready(b);
  record('A to B and B to A synchronize without refresh', { textAtA, textAtB });
  await shot(a, 'two-user-doc.png');
  stage = 'Team file inherited access';
  await a
    .locator('.sp-page-toolbar')
    .getByRole('button', { name: 'Share', exact: true })
    .click();
  const share = a.getByRole('dialog', {
    name: 'Share ' + docName,
    exact: true,
  });
  await share.getByText('Inherited from Space', { exact: true }).waitFor();
  assert.equal(
    await share
      .getByRole('button', { name: 'Grant access', exact: true })
      .count(),
    0,
  );
  await shot(a, 'file-inherited-share.png');
  await share.getByRole('button', { name: 'Done', exact: true }).click();
  record(
    'Team file sharing shows inherited members without inventing direct grants',
  );
  stage = 'Root comment';
  // Keep the native Insert ribbon selected while making a real canvas selection.
  await a.locator('.sp-sdk').getByText('插入', { exact: true }).click();
  await focusDoc(a);
  await a.keyboard.press('Meta+a');
  await a
    .locator('.sp-sdk [data-u-command="docs.operation.start-add-comment"]')
    .click();
  const rootText = 'TASK009C A: discuss the selected passage';
  await a.keyboard.type(rootText, { delay: 20 });
  await a.getByRole('button', { name: '回复', exact: true }).click();
  await a.locator('.sp-sdk').getByText(rootText, { exact: true }).waitFor();
  let snapshot,
    anchors = [];
  for (let n = 0; n < 50; n++) {
    snapshot = await hosts[0].request('space/content', { node: doc.id });
    anchors = snapshot.data.body.customDecorations ?? [];
    if (anchors.length) break;
    await a.waitForTimeout(100);
  }
  assert.ok(anchors.length > 0);
  rootId = anchors[0].id;
  record('A creates a comment anchored to actual selected Docs text', {
    anchors,
    revision: snapshot.revision,
  });
  stage = 'B sees root and replies';
  await comments(b);
  await b.locator('.sp-sdk').getByText(rootText, { exact: true }).waitFor();
  // Activate the formal thread then focus its existing RichTextEditor surface.
  await b.locator('.sp-sdk').getByText(rootText, { exact: true }).click();
  const replyArea = await b
    .locator('.sp-sdk')
    .getByText('回复', { exact: true })
    .last()
    .boundingBox();
  assert.ok(replyArea);
  await b.mouse.click(
    replyArea.x + replyArea.width / 2,
    replyArea.y + replyArea.height / 2,
  );
  const reply = 'TASK009C B: reply from an independent account';
  await b.keyboard.type(reply, { delay: 20 });
  await b.getByRole('button', { name: '回复', exact: true }).click();
  await a.locator('.sp-sdk').getByText(reply, { exact: true }).waitFor();
  record('B sees A comment and replies; A sees reply without refresh');
  await shot(b, 'comment-reply-b.png');
  stage = 'Resolve';
  await a.locator('[aria-label="标记为已解决"]').click();
  await b
    .locator('.sp-sdk')
    .getByText('已解决', { exact: true })
    .first()
    .waitFor();
  record('A resolves thread and B observes resolved state');
  await shot(b, 'comment-resolved-b.png');
  stage = 'Reopen';
  await a
    .locator('.sp-sdk')
    .getByText('已解决', { exact: true })
    .first()
    .click();
  await a.locator('[aria-label="标记为未解决"]').click();
  await b.locator('.sp-sdk').getByText(reply, { exact: true }).waitFor();
  record('A reopens the same thread and B observes active discussion');
  stage = 'Close reopen comments';
  await a.getByRole('button', { name: 'Hide comments', exact: true }).click();
  await comments(a);
  await a.locator('.sp-sdk').getByText(reply, { exact: true }).waitFor();
  record('Closing and reopening the Comments panel preserves the discussion');
  stage = 'Reopen documents';
  for (const page of [a, b]) {
    await page
      .getByRole('button', { name: 'Close viewer', exact: true })
      .click();
    if (await page.getByRole('tab', { name: 'Content', exact: true }).count())
      await page.getByRole('tab', { name: 'Content', exact: true }).click();
    await open(page, docName);
    await comments(page);
    await page.locator('.sp-sdk').getByText(reply, { exact: true }).waitFor();
  }
  const persisted = await hosts[0].request('space/content', { node: doc.id });
  assert.ok(
    persisted.content.text.includes(tokenA) &&
      persisted.content.text.includes(tokenB),
  );
  record(
    'Both clients reopen document and preserve content, anchors, root and reply',
    { revision: persisted.revision, sha256: persisted.sha256 },
  );
  stage = 'Original text removal';
  await a.getByRole('button', { name: 'Hide comments', exact: true }).click();
  const beforeRemoval = await copyDoc(a);
  assert.equal(
    beforeRemoval.trim(),
    (
      await hosts[0].request('space/content', { node: doc.id })
    ).content.text.trim(),
  );
  await a.keyboard.press('Backspace');
  await ready(a);
  for (let n = 0; n < 40; n++) {
    if (
      !(
        await hosts[0].request('space/content', { node: doc.id })
      ).content.text.trim()
    )
      break;
    await a.waitForTimeout(100);
  }
  assert.equal(
    (
      await hosts[0].request('space/content', { node: doc.id })
    ).content.text.trim(),
    '',
  );
  await comments(a);
  await a
    .locator('[aria-label="Original text unavailable"]')
    .getByText(rootText, { exact: true })
    .waitFor();
  await shot(a, 'comment-original-unavailable.png');
  await a.getByRole('button', { name: 'Close viewer', exact: true }).click();
  await open(a, docName);
  await comments(a);
  await a
    .locator('[aria-label="Original text unavailable"]')
    .getByText(reply, { exact: true })
    .waitFor();
  record('Removing original text keeps root and reply visible after reopen');
  stage = 'Presence departure';
  await b.getByRole('button', { name: 'Close viewer', exact: true }).click();
  await a
    .locator(`.sp-collaborators [data-user-id="${identities[1].user.id}"]`)
    .waitFor({ state: 'detached' });
  record('Presence removes B when B leaves the document');
  await open(b, docName);
  const freshBToken = 'B_AFTER_REOPEN_' + Date.now();
  await focusDoc(b);
  await b.keyboard.type(freshBToken, { delay: 15 });
  await ready(b);
  for (let n = 0; n < 40; n++) {
    if (
      (
        await hosts[0].request('space/content', { node: doc.id })
      ).content.text.includes(freshBToken)
    )
      break;
    await b.waitForTimeout(100);
  }
  assert.ok(
    (
      await hosts[0].request('space/content', { node: doc.id })
    ).content.text.includes(freshBToken),
  );
  record('B submits a fresh write from the reopened collaboration session');
  stage = 'Role downgrade';
  await a
    .locator('.sp-page-toolbar')
    .getByRole('button', { name: 'Share', exact: true })
    .click();
  await a
    .getByRole('button', { name: 'Manage Space access', exact: true })
    .click();
  const teamDialog = a.getByRole('dialog', {
    name: 'Share ' + name,
    exact: true,
  });
  await teamDialog
    .getByLabel(`Role for ${logins[1].username}`, { exact: true })
    .selectOption('viewer');
  await teamDialog.getByText('Role updated.', { exact: true }).waitFor();
  await b.locator('[data-editor-state=denied]').waitFor({ timeout: 15000 });
  assert.equal(await b.locator('.sp-sdk').evaluate((el) => el.inert), true);
  assert.ok(bWrite, 'A real B changeset was captured for permission recheck');
  const beforeDenied = await hosts[0].request('space/content', {
    node: doc.id,
  });
  const writeProbe = structuredClone(bWrite),
    requestBody = JSON.parse(writeProbe.body);
  assert.ok(requestBody.changeset?.mutations?.length);
  // A separate protocol test connection uses B's actual identity. It does not
  // inject unknown request IDs into the live editor's SDK state machine.
  const probe = await permissionProbe(doc.resource.unitId);
  requestBody.memberID = probe.memberID;
  requestBody.changeset.memberID = probe.memberID;
  requestBody.changeset.sid = probe.memberID;
  requestBody.changeset.reqId = 1;
  requestBody.changeset.baseRev = beforeDenied.revision;
  requestBody.changeset.revision = beforeDenied.revision + 1;
  writeProbe.body = JSON.stringify(requestBody);
  const rejectionWait = probe.rejected(requestBody.changeset.reqId);
  const denied = await hosts[1].request('space/editor-http', writeProbe);
  const rejectedMessage = await rejectionWait;
  const rejectedCs =
    rejectedMessage.collaMsg.permissionRejEvent?.cs ??
    rejectedMessage.collaMsg.csRejEvent?.cs;
  const rejection = {
    user: 1,
    kind: 'Unit rejection',
    eventID: rejectedMessage.collaMsg.eventID,
    unitId: rejectedCs.unitID,
    reqId: rejectedCs.reqId,
    baseRev: rejectedCs.baseRev,
    source: 'independent permission test connection',
  };
  wire.push(rejection);
  probe.socket.close();
  assert.equal(rejection.reqId, requestBody.changeset.reqId);
  const afterDenied = await hosts[0].request('space/content', { node: doc.id });
  assert.equal(afterDenied.revision, beforeDenied.revision);
  assert.equal(afterDenied.sha256, beforeDenied.sha256);
  record(
    'Server rejects fresh B mutation over WS and keeps persisted version unchanged',
    {
      httpStatus: denied.status,
      httpResponse: JSON.parse(denied.body),
      rejection,
      revisionBefore: beforeDenied.revision,
      revisionAfter: afterDenied.revision,
      sha256: afterDenied.sha256,
    },
  );
  record(
    'B role becomes Viewer; existing editor stops input and Server rejects a captured B write',
    { status: denied.status, response: JSON.parse(denied.body) },
  );
  stage = 'Member removal';
  await teamDialog
    .getByRole('button', { name: `Remove ${logins[1].username}`, exact: true })
    .click();
  await teamDialog.getByText('Member removed.', { exact: true }).waitFor();
  await assert.rejects(
    () => hosts[1].request('space/content', { node: doc.id }),
    /not found|forbidden|permission/i,
  );
  await assert.rejects(
    () =>
      hosts[1].request('space/mutate', {
        action: 'rename',
        id: doc.id,
        name: 'Unauthorized rename',
      }),
    /not found|forbidden|permission/i,
  );
  const afterRemoval = await hosts[0].request('space/content', {
    node: doc.id,
  });
  assert.equal(afterRemoval.sha256, beforeDenied.sha256);
  record(
    'Removing B revokes reopened content and Server metadata writes; content stays unchanged',
    { sha256: afterRemoval.sha256, revision: afterRemoval.revision },
  );
  await shot(b, 'permission-revoked-b.png');
  const expectedRejections = errors.filter(
    (e) => e.message === '[SyncedState]: received rejection.',
  );
  const unexpectedErrors = errors.filter(
    (e) => e.message !== '[SyncedState]: received rejection.',
  );
  assert.deepEqual(unexpectedErrors, []);
  await writeFile(
    resolve(out, 'human-collaboration-live.json'),
    JSON.stringify(
      {
        status: 'PASS',
        at: new Date().toISOString(),
        carrier: 'official packaged DSH Web runtime / Edge; independent Hosts',
        sourceVersion: process.env.SPACE_SOURCE_VERSION,
        expectedRejections,
        identities: identities.map((x) => x.user),
        space,
        doc,
        rootId,
        checks,
        wire,
        errors,
        consoleErrors,
      },
      null,
      2,
    ),
  );
  console.log('Human collaboration workflow PASS', checks.length);
} catch (error) {
  for (let i = 0; i < clients.length; i++)
    await shot(clients[i].page, `human-failure-${i}.png`).catch(() => {});
  await writeFile(
    resolve(out, 'human-collaboration-failure.json'),
    JSON.stringify(
      {
        status: 'FAIL',
        stage,
        message: error.message,
        at: new Date().toISOString(),
        identities: identities.map((x) => x.user),
        space,
        doc,
        rootId,
        checks,
        wire,
        errors,
        consoleErrors,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  probeSocket?.close();
  await browser.close();
}
