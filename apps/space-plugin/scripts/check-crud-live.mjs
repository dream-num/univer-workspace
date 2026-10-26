/** Actual UI -> official Host -> authenticated Workspace Server. No mocked CRUD. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { connectHost } from './host-connection.mjs';
import { WorkspaceConnection } from '../lib/workspace.js';
const { chromium } = await import(
  process.env.SPACE_PLAYWRIGHT_MODULE ?? 'playwright'
);
const h = await connectHost();
const f = JSON.parse(await readFile(process.env.SPACE_TEST_LOGIN_FILE, 'utf8'));
const out = resolve(
  process.env.SPACE_EVIDENCE_DIR ?? '/tmp/space-crud-evidence',
);
await mkdir(out, { recursive: true });
await h.request('space/configure', { endpoint: f.origin });
await h.request('space/login', { username: f.username, password: f.password });
const b = await chromium.launch({
  headless: true,
  executablePath: process.env.SPACE_BROWSER_EXECUTABLE,
});
const c = await b.newContext({ viewport: { width: 1440, height: 1000 } });
await c.addCookies(
  h.headers.cookie.split('; ').map((part) => ({
    name: part.slice(0, part.indexOf('=')),
    value: part.slice(part.indexOf('=') + 1),
    url: h.origin,
    httpOnly: true,
  })),
);
const p = await c.newPage();
p.setDefaultTimeout(30000);
const errors = [],
  consoleErrors = [],
  checks = [],
  matrix = [],
  records = {};
p.on('pageerror', (error) => errors.push(error.message));
p.on('console', (message) => {
  if (message.type() === 'error')
    consoleErrors.push(message.text().slice(0, 600));
});
const stamp = Date.now();
const ready = () =>
  p
    .locator(
      '[data-editor-state="saved"], [data-viewer-state="ready"], .sp-html-preview iframe',
    )
    .waitFor();
const metadata = (node) => h.request('space/metadata', { node });
const content = (node) => h.request('space/content', { node });
const fingerprint = (file) =>
  file.sourceSha256 ??
  createHash('sha256')
    .update(file.html ?? JSON.stringify(file.data))
    .digest('hex');
async function create(kind, label, name) {
  await p.locator('.sp-primary summary').click();
  const menu = p.locator('.sp-primary [role="menu"]');
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
  const d = p.getByRole('dialog', { name: `Create ${kind}`, exact: true });
  await d.getByLabel('Name', { exact: true }).fill(name);
  await d.getByRole('button', { name: 'Create', exact: true }).click();
  await d.waitFor({ state: 'hidden' });
}
async function action(label, value) {
  await p.locator('summary[aria-label="File menu"]').click();
  await p.getByRole('menuitem', { name: label, exact: true }).click();
  const d = p.getByRole('dialog', { name: label, exact: true });
  if (label === 'Rename') {
    await d.getByLabel('Name', { exact: true }).fill(value);
    await d.getByRole('button', { name: 'Save', exact: true }).click();
  } else if (label === 'Move to folder') {
    await d.getByRole('button', { name: value, exact: true }).click();
    await d.getByRole('button', { name: 'Move here', exact: true }).click();
  } else
    await d.getByRole('button', { name: 'Move to Trash', exact: true }).click();
  await d.waitFor({ state: 'hidden' });
}
async function directory(folder) {
  await p
    .getByRole('navigation', { name: 'Content types', exact: true })
    .getByRole('button', { name: records.space.name, exact: true })
    .click();
  await p.getByRole('tab', { name: 'Content', exact: true }).click();
  if (folder)
    await p.locator('.sp-file-open').filter({ hasText: folder.name }).click();
}
async function rowAction(node, label, context = false) {
  const row = p
    .getByRole('row')
    .filter({ has: p.locator('.sp-file-open').filter({ hasText: node.name }) });
  if (context) await row.click({ button: 'right' });
  else await row.locator('summary').click();
  const menu = p.getByRole('menu', {
    name: `Actions for ${node.name}`,
    exact: true,
  });
  assert.deepEqual(await menu.getByRole('menuitem').allTextContents(), [
    'Open',
    'Pin',
    'Share',
    'Rename',
    'Move to folder',
    'Delete',
  ]);
  await menu.getByRole('menuitem', { name: label, exact: true }).click();
}
try {
  await p.goto(h.origin);
  await p
    .getByRole('navigation', { name: 'Activity bar', exact: true })
    .getByRole('button', { name: 'Space', exact: true })
    .click();
  await create('space', 'Space', `CRUD ${stamp}`);
  records.space = (await h.request('space/spaces')).spaces.find(
    (space) => space.name === `CRUD ${stamp}`,
  );
  await p.locator('summary[aria-label="Space menu"]').click();
  await p.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  const renameSpace = p.getByRole('dialog', { name: 'Rename', exact: true });
  records.space.name += ' renamed';
  await renameSpace
    .getByLabel('Name', { exact: true })
    .fill(records.space.name);
  await renameSpace.getByRole('button', { name: 'Save', exact: true }).click();
  await renameSpace.waitFor({ state: 'hidden' });
  assert.ok(
    (await h.request('space/spaces')).spaces.some(
      (space) =>
        space.id === records.space.id && space.name === records.space.name,
    ),
  );
  matrix.push({
    type: 'Space',
    create: true,
    open: true,
    rename: true,
    move: 'not applicable; separate lifecycle investigation',
    delete: 'not implemented; separate lifecycle investigation',
    restore: 'not implemented; separate lifecycle investigation',
  });
  for (const key of ['folder', 'destination']) {
    await create('folder', 'Folder', `${key} ${stamp}`);
    records[key] = (
      await h.request('space/nodes', { space: records.space.id })
    ).nodes.find((node) => node.name === `${key} ${stamp}`);
  }
  await directory(records.folder);
  for (const [kind, label] of [
    ['doc', 'Doc'],
    ['sheet', 'Sheet'],
    ['slide', 'Slide'],
    ['board', 'Canvas'],
    ['base', 'Relational Table'],
    ['site', 'Page'],
  ]) {
    const name = `${label} ${stamp}`;
    await create(kind, label, name);
    await ready();
    const node = (
      await h.request('space/nodes', { parent: records.folder.id })
    ).nodes.find((item) => item.name === name);
    assert.ok(node);
    const original = await content(node.id);
    const digest = fingerprint(original);
    assert.equal(original.type, kind);
    assert.equal(node.parentNodeId, records.folder.id);
    const geometry = await p.locator('.sp-page-body').evaluate((element) => ({
      padding: getComputedStyle(element).padding,
      width: element.getBoundingClientRect().width,
      editorWidth: element.firstElementChild.getBoundingClientRect().width,
    }));
    assert.equal(geometry.padding, '0px');
    assert.equal(geometry.width, geometry.editorWidth);
    node.name += ' renamed';
    await action('Rename', node.name);
    let after = await metadata(node.id);
    assert.equal(after.node.name, node.name);
    assert.equal(after.node.resource.id, node.resource.id);
    await action('Move to folder', records.destination.name);
    after = await metadata(node.id);
    assert.equal(after.node.parentNodeId, records.destination.id);
    assert.equal(fingerprint(await content(node.id)), digest);
    await p.getByRole('button', { name: 'Close viewer', exact: true }).click();
    assert.equal(
      await p.locator('.sp-file-open').filter({ hasText: node.name }).count(),
      0,
    );
    await directory(records.destination);
    await rowAction(node, 'Open', kind === 'site');
    await ready();
    await action('Delete');
    assert.equal(await p.locator('.sp-page-toolbar').count(), 0);
    await assert.rejects(metadata(node.id));
    const batch = (await h.request('space/trash')).items.find(
      (item) => item.root.id === node.id,
    );
    assert.ok(batch?.capabilities.restore);
    await p
      .getByRole('navigation', { name: 'Content types', exact: true })
      .getByRole('button', { name: 'Trash', exact: true })
      .click();
    const trashRow = p.locator('.sp-trash-row').filter({ hasText: node.name });
    await trashRow
      .getByRole('button', { name: 'Restore', exact: true })
      .click();
    await trashRow.waitFor({ state: 'hidden' });
    after = await metadata(node.id);
    assert.equal(after.node.parentNodeId, records.destination.id);
    assert.equal(after.node.resource.id, node.resource.id);
    assert.equal(fingerprint(await content(node.id)), digest);
    await directory(records.destination);
    await p.locator('.sp-file-open').filter({ hasText: node.name }).click();
    await ready();
    if (kind === 'doc' || kind === 'base' || kind === 'site')
      await p.screenshot({ path: resolve(out, `crud-${kind}.png`) });
    await p.getByRole('button', { name: 'Close viewer', exact: true }).click();
    records[kind] = { ...node, parentNodeId: records.destination.id };
    matrix.push({
      type: label,
      nodeId: node.id,
      resourceId: node.resource.id,
      create: true,
      open: true,
      rename: true,
      move: true,
      delete: true,
      restore: true,
      contentHash: digest,
      geometry,
    });
    console.log(
      `${label}: Create / Open / Rename / Move / Delete / Restore verified`,
    );
    await directory(records.folder);
  }
  // Folder subtree lifecycle, including actual descendant restoration.
  await create('folder', 'Folder', `child ${stamp}`);
  const child = (
    await h.request('space/nodes', { parent: records.folder.id })
  ).nodes.find((node) => node.name === `child ${stamp}`);
  await directory();
  await rowAction(records.folder, 'Rename', true);
  const rename = p.getByRole('dialog', { name: 'Rename', exact: true });
  records.folder.name += ' renamed';
  await rename.getByLabel('Name', { exact: true }).fill(records.folder.name);
  await rename.getByRole('button', { name: 'Save', exact: true }).click();
  await rename.waitFor({ state: 'hidden' });
  await rowAction(records.folder, 'Move to folder');
  const move = p.getByRole('dialog', { name: 'Move to folder', exact: true });
  await move
    .getByRole('button', { name: records.destination.name, exact: true })
    .click();
  await move.getByRole('button', { name: 'Move here', exact: true }).click();
  await move.waitFor({ state: 'hidden' });
  await directory(records.destination);
  await rowAction(records.folder, 'Delete');
  await p
    .getByRole('dialog', { name: 'Delete', exact: true })
    .getByRole('button', { name: 'Move to Trash', exact: true })
    .click();
  await p
    .getByRole('dialog', { name: 'Delete', exact: true })
    .waitFor({ state: 'hidden' });
  await assert.rejects(metadata(child.id));
  await p
    .getByRole('navigation', { name: 'Content types', exact: true })
    .getByRole('button', { name: 'Trash', exact: true })
    .click();
  await p
    .locator('.sp-trash-row')
    .filter({ hasText: records.folder.name })
    .getByRole('button', { name: 'Restore', exact: true })
    .click();
  await p
    .locator('.sp-trash-row')
    .filter({ hasText: records.folder.name })
    .waitFor({ state: 'hidden' });
  assert.equal(
    (await metadata(records.folder.id)).node.parentNodeId,
    records.destination.id,
  );
  assert.equal((await metadata(child.id)).node.parentNodeId, records.folder.id);
  matrix.push({
    type: 'Folder',
    create: true,
    open: true,
    rename: true,
    move: true,
    delete: true,
    restore: true,
    descendantRestored: true,
  });
  // Server must reject strangers' writes; verify no metadata changes afterwards.
  const stranger = new WorkspaceConnection();
  const username = `crud-stranger-${stamp}`,
    password = randomBytes(24).toString('base64url');
  const registration = await fetch(f.origin + '/api/auth/password/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username,
      password,
      displayName: 'CRUD Permission Test',
    }),
  });
  assert.ok(registration.ok);
  stranger.configure(f.origin);
  await stranger.login(username, password);
  for (const input of [
    { action: 'rename', id: records.doc.id, name: 'forbidden' },
    { action: 'move', id: records.doc.id, parent: '' },
    { action: 'delete', id: records.doc.id },
  ])
    await assert.rejects(
      stranger.mutate(input, new AbortController().signal),
      (error) => error.status === 403 || error.status === 404,
    );
  await stranger.dispose();
  assert.equal((await metadata(records.doc.id)).node.name, records.doc.name);
  checks.push(
    'all eight menu items fixed across destinations',
    'six content types created/opened by UI and persisted on Server',
    'stable Resource/Unit identity and content through rename/move/trash/restore',
    'open file deletion returns to source list',
    'folder subtree restored',
    'row More and right-click menus share actions',
    'Server denies stranger writes',
    'all SDK outer containers have zero padding',
  );
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(out, 'crud-live.json'),
    JSON.stringify(
      {
        carrier: 'Official DSH 0.2.1-rc.3 Web / Microsoft Edge',
        at: new Date().toISOString(),
        matrix,
        checks,
        records,
        errors,
        consoleErrors,
      },
      null,
      2,
    ),
  );
  await writeFile('/tmp/task009b-r2-fixtures.json', JSON.stringify(records));
  await writeFile(
    '/tmp/task009b-r2-mvp.json',
    JSON.stringify({
      nodes: [records.slide, records.board, records.base],
      site: records.site,
    }),
  );
  console.log(
    JSON.stringify({
      objects: matrix.length,
      checks: checks.length,
      pageErrors: errors.length,
      consoleErrors: consoleErrors.length,
    }),
  );
} catch (error) {
  await p.screenshot({ path: resolve(out, 'crud-failure.png') });
  await writeFile(
    resolve(out, 'crud-failure.json'),
    JSON.stringify(
      { matrix, errors, consoleErrors, error: error.stack },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await b.close();
}
