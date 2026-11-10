import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { WorkspaceConnection } from '../lib/workspace.js';
import { ToolBindings } from '../lib/tools.js';

async function fixture(t, files) {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, path: req.url, range: req.headers.range, conditional: req.headers['if-none-match'] });
    if (req.url === '/api/session') {
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ authenticated: true, user: { id: 'fixture-owner' } })); return;
    }
    const [, family, id, operation] = req.url.match(/^\/api\/(nodes|resources|blob-resources)\/([^/]+)(?:\/(open|content|download))?$/) ?? [];
    const file = files[id];
    if (!file) { res.writeHead(404).end(); return; }
    if (file.denied) { res.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'Access revoked' } })); return; }
    const resource = { id, kind: 'blob', capabilities: { openContent: true, editContent: true, downloadContent: true } };
    const sha256 = createHash('sha256').update(file.bytes).digest('hex');
    if (family === 'nodes') {
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ node: { id, name: file.filename, resource } }));
    } else if (operation === 'open') {
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ resource: { ...resource, originalFilename: file.filename, mediaType: file.mime, byteSize: file.bytes.length, sha256 } }));
    } else {
      if (operation === 'download' && file.denyDownload) { res.writeHead(403).end(); return; }
      res.writeHead(file.partial ? 206 : 200, { 'content-type': file.mime, etag: `"${sha256}"`, ...(file.partial ? { 'content-range': `bytes 0-9/${file.bytes.length}` } : {}),
        ...(operation === 'download' ? { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`, 'content-length': file.bytes.length } : {}),
      });
      // Deliver in multiple chunks to exercise complete body consumption.
      res.write(file.bytes.subarray(0, 100)); res.end(file.bytes.subarray(100));
    }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const connection = new WorkspaceConnection();
  const origin = `http://127.0.0.1:${server.address().port}`;
  connection.activateSession(origin, 'disposable-fixture-token');
  t.after(async () => { await connection.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { connection, requests, files };
}

for (const size of [Math.ceil(1.2 * 1024 * 1024), 5 * 1024 * 1024]) {
  test(`complete ${size}-byte HTML opens and reopens; fresh permission check still precedes cache`, async t => {
    const source = '<h1>Start</h1><!--' + 'x'.repeat(size) + '--><p>END_OF_HTML</p><script>window.marker="SCRIPT_RETAINED";</script>';
    const f = await fixture(t, { page: { filename: 'large.univer.html', mime: 'text/html', bytes: Buffer.from(source) } });
    const first = await f.connection.open('page');
    assert.equal(first.type, 'site'); assert.equal(first.html, source);
    assert.equal((await f.connection.open('page')).html, source);
    assert.equal(f.requests.filter(r => r.path.endsWith('/content')).length, 1);
    const changed = source + '<p>REPLACED_SAME_RESOURCE</p>';
    f.files.page.bytes = Buffer.from(changed);
    assert.equal((await f.connection.open('page')).html, changed);
    f.files.page.denied = true;
    await assert.rejects(f.connection.open('page'), error => error.status === 403);
    assert.equal(f.requests.filter(r => r.path.endsWith('/content')).length, 2);
    assert.ok(f.requests.every(r => !r.range));
  });
}

test('HTML rejects a partial response instead of opening a truncated sandbox', async t => {
  const f = await fixture(t, { page: { filename: 'partial.univer.html', mime: 'text/html', bytes: Buffer.from('<p>incomplete</p>'), partial: true } });
  await assert.rejects(f.connection.open('page'), /incomplete Page content/);
});

for (const filename of ['Notes.md', 'Notes.MARKDOWN']) {
  test(`Markdown Blob ${filename} preserves the complete original source and identity`, async t => {
    const source = '# Heading\r\n\r\n| A | B |\r\n|---|---|\r\n| 汉字 | 😀 |\r\n<script>no execution</script>\r\n';
    const f = await fixture(t, { md: { filename, mime: 'application/octet-stream', bytes: Buffer.from(source) } });
    const file = await f.connection.open('md');
    assert.equal(file.type, 'markdown'); assert.equal(file.markdown, source);
    assert.equal(file.resourceId, 'md'); assert.equal(file.unitId, '');
    assert.equal(file.node.resource.kind, 'blob'); assert.equal(file.data, null);
    assert.equal((await f.connection.read('md')).content.text, source);
    assert.ok(f.requests.every(r => !r.range && (r.method === 'GET' || r.path.endsWith('/open'))));
  });
}

test('Markdown large and empty Blobs open without a preview cutoff or an empty-content request', async t => {
  const source = '# Complete\n' + 'Text with 汉字 😀\n'.repeat(80000) + 'END_OF_MARKDOWN\n';
  const f = await fixture(t, {
    large: { filename: 'large.md', mime: 'text/markdown', bytes: Buffer.from(source) },
    empty: { filename: 'empty.markdown', mime: 'text/plain', bytes: Buffer.alloc(0) },
  });
  assert.equal((await f.connection.open('large')).markdown, source);
  assert.equal((await f.connection.open('empty')).markdown, '');
  assert.equal(f.requests.filter(r => r.path === '/api/blob-resources/empty/content').length, 0);
});

test('Markdown invalid UTF-8, binary, partial and forbidden files do not produce a preview', async t => {
  const f = await fixture(t, {
    utf8: { filename: 'invalid.md', mime: 'text/markdown', bytes: Buffer.from([0xff]) },
    binary: { filename: 'binary.md', mime: 'application/octet-stream', bytes: Buffer.from([0]) },
    partial: { filename: 'partial.md', mime: 'text/plain', bytes: Buffer.from('part'), partial: true },
    forbidden: { filename: 'forbidden.md', mime: 'text/markdown', bytes: Buffer.from('private'), denied: true },
  });
  for (const id of Object.keys(f.files)) await assert.rejects(f.connection.open(id));
});

test('native Session association and authorized inspection retain Markdown as a Blob', async t => {
  const source = '# Current Markdown\nOriginal source\n';
  const f = await fixture(t, { md: { filename: 'notes.markdown', mime: 'text/markdown', bytes: Buffer.from(source) } });
  const bindings = new ToolBindings(f.connection);
  const file = await bindings.bind('native-session', 'md');
  assert.equal(file.type, 'markdown'); assert.equal(file.unitId, '');
  const inspected = await bindings.inspect('native-session', 'md', new AbortController().signal, 0, 20);
  assert.equal(inspected.format, 'markdown-source');
  assert.deepEqual(inspected.lines.map(line => line.text), source.trimEnd().split('\n').concat(''));
});

for (const filename of ['原文 空格.md', '原文 "引号".markdown']) {
  test(`original download retains exact bytes and the Server filename: ${filename}`, async t => {
    const bytes = Buffer.from('\ufeff# Original\r\n\r\n中文 😀\r\n');
    const f = await fixture(t, { md: { filename, mime: 'text/markdown', bytes } });
    const preview = await f.connection.open('md');
    assert.notEqual(preview.markdown, bytes.toString()); // UTF-8 preview decoding removes BOM.
    const response = await f.connection.blobDownload({ endpoint: f.connection.endpoint, userId: 'fixture-owner', nodeId: 'md', resourceId: 'md' }, new Request('http://host/api/space/blob-download'));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    assert.equal(response.headers.get('content-disposition'), `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    assert.equal(response.headers.get('content-length'), String(bytes.length));
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('set-cookie'), null);
  });
}

test('cached preview grants no download after revocation, nor on a fresh byte-route denial', async t => {
  const f = await fixture(t, { md: { filename: 'private.md', mime: 'text/markdown', bytes: Buffer.from('# Private') } });
  const input = { endpoint: f.connection.endpoint, userId: 'fixture-owner', nodeId: 'md', resourceId: 'md' };
  const request = () => new Request('http://host/api/space/blob-download');
  await f.connection.open('md');
  f.files.md.denied = true;
  await assert.rejects(f.connection.blobDownload(input, request()), e => e.status === 403);
  assert.equal(f.requests.filter(r => r.path.endsWith('/download')).length, 0);
  f.files.md.denied = false; f.files.md.denyDownload = true;
  await assert.rejects(f.connection.blobDownload(input, request()), e => e.status === 403);
});

test('download rejects stale account/endpoint/resource identity and partial bytes', async t => {
  const f = await fixture(t, { md: { filename: 'sample.markdown', mime: 'text/markdown', bytes: Buffer.from('# Text'), partial: true } });
  const input = { endpoint: f.connection.endpoint, userId: 'fixture-owner', nodeId: 'md', resourceId: 'md' };
  const request = () => new Request('http://host/api/space/blob-download');
  await assert.rejects(f.connection.blobDownload({ ...input, userId: 'previous-account' }, request()), e => e.status === 401);
  await assert.rejects(f.connection.blobDownload({ ...input, endpoint: 'http://127.0.0.1:1' }, request()), e => e.status === 409);
  await assert.rejects(f.connection.blobDownload({ ...input, resourceId: 'other' }, request()), e => e.status === 409);
  await assert.rejects(f.connection.blobDownload(input, request()), e => e.status === 502);
});
