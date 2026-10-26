/** Adds real nonempty Office/HTML fixtures to the explicit local test account. */
import { Univer } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import { UniverDocsPlugin } from '@univerjs/docs';
import { UniverSlidesPlugin } from '@univerjs-pro/slides';
import { UniverBoardsPlugin } from '@univerjs-pro/boards';
import { UniverBasesPlugin } from '@univerjs-pro/bases';
import '@univerjs-pro/slides/facade';
import '@univerjs-pro/boards/facade';
import '@univerjs-pro/bases/facade';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const fixture = JSON.parse(
  await readFile(
    process.env.SPACE_TEST_LOGIN_FILE ?? '/tmp/task005-workspace-login.json',
    'utf8',
  ),
);
if (!['localhost', '127.0.0.1'].includes(new URL(fixture.origin).hostname))
  throw new Error('Local fixture required.');
let cookie = '';
async function request(path, body, method = 'POST', extra = {}) {
  const r = await fetch(fixture.origin + path, {
    method,
    headers: { cookie, 'content-type': 'application/json', ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.headers.getSetCookie().length)
    cookie = r.headers
      .getSetCookie()
      .map((v) => v.split(';')[0])
      .join('; ');
  const data = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(data));
  return data;
}
await request('/api/auth/password/login', {
  username: fixture.username,
  password: fixture.password,
});
const runtime = new Univer();
runtime.registerPlugin(UniverDocsPlugin);
runtime.registerPlugin(UniverSlidesPlugin);
runtime.registerPlugin(UniverBoardsPlugin);
runtime.registerPlugin(UniverBasesPlugin);
const api = FUniver.newAPI(runtime),
  units = [];
const deck = api.createPresentation({
  id: randomUUID(),
  name: 'MVP Release Slides',
});
const slide =
  deck.getSlideByIndex(0) ?? deck.appendSlide({ name: 'Release overview' });
slide.setBackground({
  type: api.Enum.SlideBackgroundTypeEnum.Solid,
  color: '#d9e9dd',
});
const shape = slide.insertShape({
  shapeType: api.Enum.ShapeTypeEnum.Rect,
  transform: { left: 80, top: 80, width: 600, height: 200 },
});
shape?.getText().setText('Space MVP · Ready for demo');
units.push(['slide', deck.save()]);
const board = api.createBoard({
  id: randomUUID(),
  name: 'MVP Planning Canvas',
});
board.insertText({
  text: 'Space MVP · Release plan',
  left: 80,
  top: 80,
  width: 400,
  height: 120,
});
units.push(['board', board.save()]);
const base = api.createBase({ id: randomUUID(), name: 'MVP Release Database' });
base
  .getTables()[0]
  .addRecord({ Name: 'Verify navigation' }, api.Enum.BaseFieldKeyEnum.Name);
base
  .getTables()[0]
  .addRecord({ Name: 'Verify all file types' }, api.Enum.BaseFieldKeyEnum.Name);
units.push(['base', base.save()]);
const nodes = [];
for (const [unitType, initialData] of units) {
  const r = await request(
    '/api/resources',
    {
      kind: 'univer',
      spaceId: fixture.spaceId,
      parentNodeId: null,
      name: initialData.name,
      unitType,
      initialData,
    },
    'POST',
    { 'idempotency-key': randomUUID() },
  );
  nodes.push(r.node);
}
const html =
  '<!doctype html><html><head><meta charset="utf-8"><style>body{font:18px system-ui;padding:40px;background:#f4f7f3}h1{font-size:36px}article{border:1px solid #ccc;border-radius:16px;padding:24px;background:white}</style></head><body><h1>Space MVP Release</h1><article><h2>Ready for review</h2><p>Docs · Sheets · Slides · Canvas · Database</p><p>Published HTML Blob, served by Workspace.</p></article></body></html>';
async function upload(originalFilename, name) {
  const data = Buffer.from(html);
  const r = await request(
    '/api/blob-upload-sessions',
    {
      spaceId: fixture.spaceId,
      parentNodeId: null,
      name,
      originalFilename,
      byteSize: data.length,
      declaredMediaType: 'text/html',
    },
    'POST',
    { 'idempotency-key': randomUUID() },
  );
  const uploaded = await fetch(fixture.origin + r.uploadTarget.contentUrl, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/octet-stream' },
    body: data,
  });
  if (!uploaded.ok) throw new Error('Upload failed');
  return (await request(`/api/blob-upload-sessions/${r.upload.id}/complete`))
    .node;
}
const site = await upload('release.univer.html', 'MVP Release Site'),
  plainHtml = await upload('plain.html', 'Ordinary HTML (not a Site)');
await writeFile(
  '/tmp/task008-fixtures.json',
  JSON.stringify({ nodes, site, plainHtml }),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    nodes: nodes.map((n) => ({
      name: n.name,
      id: n.id,
      type: n.resource.unitType,
    })),
    site: site.id,
    plainHtml: plainHtml.id,
  }),
);
runtime.dispose();
