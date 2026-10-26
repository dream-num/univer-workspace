/** Personal file grants, inherited access and real Server denial on two accounts. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connectHost } from './host-connection.mjs';
const { chromium } = await import(
  process.env.SPACE_PLAYWRIGHT_MODULE ?? 'playwright'
);
const out = resolve(process.env.SPACE_EVIDENCE_DIR ?? '/tmp/space-sharing');
await mkdir(out, { recursive: true });
const hosts = [
  await connectHost(),
  await connectHost(process.env.SPACE_SECOND_DSH_LOG),
];
const f = await Promise.all(
  [process.env.SPACE_TEST_LOGIN_FILE, process.env.SPACE_SECOND_LOGIN_FILE].map(
    async (path) => JSON.parse(await readFile(path, 'utf8')),
  ),
);
for (let i = 0; i < 2; i++) {
  await hosts[i].request('space/configure', { endpoint: f[i].origin });
  await hosts[i].request('space/login', {
    username: f[i].username,
    password: f[i].password,
  });
}
const b = await chromium.launch({
    headless: true,
    executablePath: process.env.SPACE_BROWSER_EXECUTABLE,
  }),
  checks = [],
  wire = [],
  clients = [];
const record = (what, data = {}) => {
  checks.push({ what, ...data, at: new Date().toISOString() });
  console.log('PASS', what);
};
let stage = 'initialize',
  folder,
  doc;
async function client(i) {
  const h = hosts[i],
    context = await b.newContext({
      viewport: { width: 1440, height: 1000 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
  await context.addCookies(
    h.headers.cookie
      .split('; ')
      .map((s) => ({
        name: s.slice(0, s.indexOf('=')),
        value: s.slice(s.indexOf('=') + 1),
        url: h.origin,
        httpOnly: true,
      })),
  );
  const p = await context.newPage();
  p.setDefaultTimeout(20000);
  p.on('response', async (r) => {
    if (!r.url().endsWith('/sharing')) return;
    try {
      const request = r.request().postDataJSON().payload,
        result = (await r.json()).result;
      wire.push({ user: i, request, result });
    } catch {}
  });
  await p.goto(h.origin);
  await p.getByText('TASK-006 最终正式路径验收', { exact: true }).click();
  await p
    .getByRole('navigation', { name: 'Activity bar', exact: true })
    .getByRole('button', { name: 'Space', exact: true })
    .click();
  clients[i] = { p, context };
  return p;
}
async function all(p) {
  await p
    .getByRole('navigation', { name: 'Content types', exact: true })
    .getByRole('button', { name: 'All', exact: true })
    .click();
}
async function create(p, kind, label, name) {
  await p.locator('.sp-primary summary').click();
  await p
    .locator('.sp-primary [role=menu]')
    .getByRole('menuitem', { name: label, exact: true })
    .click();
  const d = p.getByRole('dialog', { name: 'Create ' + kind, exact: true });
  await d.getByLabel('Name', { exact: true }).fill(name);
  await d.getByRole('button', { name: 'Create', exact: true }).click();
  await d.waitFor({ state: 'hidden' });
}
async function rowShare(p, node) {
  const row = p
    .getByRole('row')
    .filter({ has: p.locator('.sp-file-open').filter({ hasText: node.name }) });
  await row.locator('summary').click();
  await p
    .getByRole('menu', { name: 'Actions for ' + node.name, exact: true })
    .getByRole('menuitem', { name: 'Share', exact: true })
    .click();
  return p.getByRole('dialog', { name: 'Share ' + node.name, exact: true });
}
async function grant(d, username, role) {
  await d.getByLabel('Add people', { exact: true }).fill(username);
  await d.getByRole('option').filter({ hasText: username }).click();
  await d.getByLabel('Invitation role', { exact: true }).selectOption(role);
  await d.getByRole('button', { name: 'Grant access', exact: true }).click();
  await d.getByLabel('Role for ' + username, { exact: true }).waitFor();
}
async function denied(h, node) {
  await assert.rejects(
    () => h.request('space/content', { node }),
    /not found|forbidden|permission/i,
  );
}
async function content(h, node) {
  const x = await h.request('space/metadata', { node });
  return x.node.resource.capabilities;
}
try {
  const a = await client(0);
  await all(a);
  stage = 'Personal creation';
  const folderName = 'TASK009C Access Folder ' + Date.now();
  await create(a, 'folder', 'Folder', folderName);
  folder = (await hosts[0].request('space/index')).nodes.find(
    (x) => x.name === folderName,
  );
  await a.locator('.sp-file-open').filter({ hasText: folderName }).click();
  const docName = 'TASK009C Direct Doc ' + Date.now();
  await create(a, 'doc', 'Doc', docName);
  await a.locator('[data-editor-state=saved]').waitFor({ timeout: 60000 });
  doc = (await hosts[0].request('space/index')).nodes.find(
    (x) => x.name === docName,
  );
  await a.getByRole('button', { name: 'Close viewer', exact: true }).click();
  await all(a);
  stage = 'Copy is not a grant';
  let d = await rowShare(a, doc);
  await d.getByRole('button', { name: 'Copy link', exact: true }).click();
  await denied(hosts[1], doc.id);
  record('Copying a private file link does not grant B access');
  await d.getByRole('button', { name: 'Done', exact: true }).click();
  stage = 'Folder inherited grant';
  d = await rowShare(a, folder);
  await grant(d, f[1].username, 'viewer');
  await d.getByRole('button', { name: 'Done', exact: true }).click();
  assert.equal((await content(hosts[1], doc.id)).editContent, false);
  record('Viewer grant on parent Folder gives B inherited read access');
  const z = await client(1);
  await z.locator('.sp-file-open').filter({ hasText: docName }).waitFor();
  await z.locator('.sp-file-open').filter({ hasText: docName }).click();
  await z.locator('[data-editor-state=saved]').waitFor({ timeout: 60000 });
  await z
    .locator('.sp-page-toolbar')
    .getByRole('button', { name: 'Share', exact: true })
    .click();
  const bd = z.getByRole('dialog', { name: 'Share ' + docName, exact: true });
  await bd.getByText(/You do not have permission to manage sharing/).waitFor();
  await z.screenshot({ path: resolve(out, 'file-share-viewer.png') });
  await bd.getByRole('button', { name: 'Done', exact: true }).click();
  await z.getByRole('button', { name: 'Close viewer', exact: true }).click();
  record(
    'B discovers inherited file through Shared API and sees accurate sharing restriction',
  );
  stage = 'Direct Editor grant';
  d = await rowShare(a, doc);
  await d.getByText('Inherited from ' + folderName, { exact: true }).waitFor();
  await grant(d, f[1].username, 'editor');
  assert.equal((await content(hosts[1], doc.id)).editContent, true);
  await a.screenshot({ path: resolve(out, 'file-direct-and-inherited.png') });
  record(
    'Direct Editor grant overrides inherited Viewer without changing the parent',
  );
  stage = 'Remove direct grant';
  await d
    .getByRole('button', { name: 'Remove ' + f[1].username, exact: true })
    .click();
  await d
    .getByText('Direct access removed. Inherited viewer access remains.', {
      exact: true,
    })
    .waitFor();
  assert.equal((await content(hosts[1], doc.id)).editContent, false);
  record(
    'Removing direct Editor preserves inherited Viewer and Server editContent becomes false',
  );
  await d.getByRole('button', { name: 'Done', exact: true }).click();
  stage = 'Parent Editor precedence';
  d = await rowShare(a, folder);
  await d
    .getByLabel('Role for ' + f[1].username, { exact: true })
    .selectOption('editor');
  await d.getByText('Access updated.', { exact: true }).waitFor();
  await d.getByRole('button', { name: 'Done', exact: true }).click();
  d = await rowShare(a, doc);
  await grant(d, f[1].username, 'viewer');
  assert.equal((await content(hosts[1], doc.id)).editContent, true);
  record(
    'Inherited Editor remains effective when a direct Viewer grant is added',
  );
  await d
    .getByRole('button', { name: 'Remove ' + f[1].username, exact: true })
    .click();
  await d
    .getByText('Direct access removed. Inherited editor access remains.', {
      exact: true,
    })
    .waitFor();
  await d.getByRole('button', { name: 'Done', exact: true }).click();
  stage = 'Revoke parent grant';
  d = await rowShare(a, folder);
  await d
    .getByRole('button', { name: 'Remove ' + f[1].username, exact: true })
    .click();
  await d.getByText('Direct access removed.', { exact: true }).waitFor();
  await denied(hosts[1], doc.id);
  record('Removing the only parent grant revokes B access to the child');
  await d.getByRole('button', { name: 'Done', exact: true }).click();
  stage = 'Existing link sharing';
  d = await rowShare(a, doc);
  await d
    .getByLabel('File link access', { exact: true })
    .selectOption('viewer');
  await d.getByText('Link access updated.', { exact: true }).waitFor();
  assert.equal((await content(hosts[1], doc.id)).editContent, false);
  record('Formal file link sharing grants Viewer access');
  await d.getByLabel('File link access', { exact: true }).selectOption('off');
  await d.getByText('Link access updated.', { exact: true }).waitFor();
  await denied(hosts[1], doc.id);
  record('Disabling the file link revokes access when no grants remain');
  await d.getByRole('button', { name: 'Done', exact: true }).click();
  stage = 'Page Toolbar share';
  await all(a);
  const pageName = 'TASK009C Shared Page ' + Date.now();
  await create(a, 'site', 'Page', pageName);
  await a.locator('.sp-html-preview iframe').waitFor({ timeout: 60000 });
  const pageNode = (await hosts[0].request('space/index')).nodes.find(
    (x) => x.name === pageName,
  );
  await a
    .locator('.sp-page-toolbar')
    .getByRole('button', { name: 'Share', exact: true })
    .click();
  d = a.getByRole('dialog', { name: 'Share ' + pageName, exact: true });
  await grant(d, f[1].username, 'viewer');
  assert.equal(
    (await hosts[1].request('space/content', { node: pageNode.id })).type,
    'site',
  );
  await a.screenshot({ path: resolve(out, 'page-toolbar-share.png') });
  await clients[1].context.close();
  const pageB = await client(1);
  await pageB.locator('.sp-file-open').filter({ hasText: pageName }).click();
  await pageB.locator('.sp-html-preview iframe').waitFor({ timeout: 60000 });
  await pageB
    .getByRole('button', { name: 'Close viewer', exact: true })
    .click();
  await d
    .getByRole('button', { name: 'Remove ' + f[1].username, exact: true })
    .click();
  await d.getByText('Direct access removed.', { exact: true }).waitFor();
  await denied(hosts[1], pageNode.id);
  await d.getByRole('button', { name: 'Done', exact: true }).click();
  await a.getByRole('button', { name: 'Close viewer', exact: true }).click();
  record(
    'Page Toolbar grants B real HTML Viewer access; removal revokes reopened access',
    { pageNode },
  );
  stage = 'Cancel optional invitation';
  await all(a);
  const teamName = 'TASK009C Member Feedback ' + Date.now();
  await a.locator('.sp-primary summary').click();
  await a
    .locator('.sp-primary [role=menu]')
    .getByRole('menuitem', { name: 'Space', exact: true })
    .click();
  let teamCreate = a.getByRole('dialog', { name: 'Create space', exact: true });
  await teamCreate.getByLabel('Name', { exact: true }).fill(teamName);
  await teamCreate
    .getByRole('button', { name: 'Invite people (optional)' })
    .click();
  await teamCreate
    .getByLabel('Add people', { exact: true })
    .fill(f[1].username);
  await teamCreate
    .getByRole('option')
    .filter({ hasText: f[1].username })
    .click();
  await teamCreate
    .getByRole('button', { name: 'Cancel selected invitation' })
    .click();
  await teamCreate.getByRole('button', { name: 'Create', exact: true }).click();
  await teamCreate.waitFor({ state: 'hidden' });
  const team = (await hosts[0].request('space/spaces')).spaces.find(
    (x) => x.name === teamName,
  );
  await assert.rejects(
    () => hosts[1].request('space/sharing', { action: 'members', id: team.id }),
    /not found|permission|forbidden/i,
  );
  record(
    'Canceling the optional invite before Create does not grant B membership',
  );
  await a.getByRole('button', { name: 'Share Space', exact: true }).click();
  let td = a.getByRole('dialog', { name: 'Share ' + teamName, exact: true });
  await td.getByLabel('Add people', { exact: true }).fill(f[1].username);
  await td.getByRole('option').filter({ hasText: f[1].username }).click();
  await td.getByLabel('Invitation role').selectOption('admin');
  await td.getByRole('button', { name: 'Add member', exact: true }).click();
  await td.getByLabel('Role for ' + f[1].username, { exact: true }).waitFor();
  assert.ok(
    (
      await hosts[1].request('space/sharing', {
        action: 'members',
        id: team.id,
      })
    ).members.some(
      (x) => x.user.username === f[1].username && x.role === 'admin',
    ),
  );
  record('Post-create Share adds B with a persisted Admin role');
  await clients[1].context.close();
  const memberB = await client(1);
  await memberB.getByRole('button', { name: teamName, exact: true }).click();
  await memberB
    .getByRole('button', { name: 'Share Space', exact: true })
    .click();
  const stale = memberB.getByRole('dialog', {
    name: 'Share ' + teamName,
    exact: true,
  });
  await stale.getByLabel('Add people', { exact: true }).fill(f[0].username);
  await stale.getByRole('option').filter({ hasText: f[0].username }).click();
  await td
    .getByLabel('Role for ' + f[1].username, { exact: true })
    .selectOption('viewer');
  await td.getByText('Role updated.', { exact: true }).waitFor();
  await stale.getByRole('button', { name: 'Add member', exact: true }).click();
  const failure = await stale.getByRole('alert').innerText();
  assert.match(failure, /forbidden|permission|allowed|cannot perform/i);
  record(
    'A real Server denial appears as invitation failure after B loses management permission',
    { failure },
  );
  await stale.getByRole('button', { name: 'Retry', exact: true }).click();
  await stale
    .getByText(
      'You can view members. Your role does not allow managing access.',
      { exact: true },
    )
    .waitFor();
  await td.getByRole('button', { name: 'Done', exact: true }).click();
  stage = 'Personal Space scope';
  const personal = (await hosts[0].request('space/spaces')).spaces.find(
    (x) => x.type === 'personal',
  );
  await a.getByRole('button', { name: personal.name, exact: true }).click();
  await a.getByRole('button', { name: 'Share Space', exact: true }).click();
  await a
    .getByRole('dialog', { name: 'Share ' + personal.name, exact: true })
    .getByText('Only you have access to this Personal Space.', { exact: true })
    .waitFor();
  record(
    'Personal Space share accurately distinguishes private Space from file grants',
  );
  await writeFile(
    resolve(out, 'sharing-live.json'),
    JSON.stringify(
      {
        status: 'PASS',
        at: new Date().toISOString(),
        carrier: 'official packaged DSH Web runtime / Edge; independent Hosts',
        sourceVersion: process.env.SPACE_SOURCE_VERSION,
        folder,
        doc,
        checks,
        wire,
      },
      null,
      2,
    ),
  );
  console.log('Sharing PASS', checks.length);
} catch (error) {
  for (let i = 0; i < clients.length; i++)
    await clients[i].p
      .screenshot({ path: resolve(out, `sharing-failure-${i}.png`) })
      .catch(() => {});
  await writeFile(
    resolve(out, 'sharing-failure.json'),
    JSON.stringify(
      {
        status: 'FAIL',
        stage,
        message: error.message,
        folder,
        doc,
        checks,
        wire,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await b.close();
}
