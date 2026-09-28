import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadResumable } from '../src/update-download.cjs';
import { serveUpdate } from '../src/update-feed.cjs';

async function fixture(t, handler) {
  const directory = await mkdtemp(join(tmpdir(), 'uwa-update-test-'));
  const body = randomBytes(256 * 1024);
  const sha512 = createHash('sha512').update(body).digest('base64');
  const requests = [];
  const server = createServer((req, res) => {
    const start = Number(/^bytes=(\d+)-/.exec(req.headers.range ?? '')?.[1] ?? 0);
    requests.push(start);
    const send = () => { res.writeHead(206, { 'Content-Range': `bytes ${start}-${body.length - 1}/${body.length}` }); res.end(body.subarray(start)); };
    handler ? handler({ req, res, body, start, send, requests }) : send();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const options = { url: `http://127.0.0.1:${server.address().port}/asset`, directory, sha512, size: body.length,
    fetch, retryDelays: [1, 1, 1] };
  return { options, body, requests, directory };
}

test('interrupted response automatically resumes at persisted byte offset', async t => {
  const f = await fixture(t, ({ res, body, start, send, requests }) => {
    if (requests.length > 1) return send();
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${body.length - 1}/${body.length}` });
    res.write(body.subarray(0, 65536)); setTimeout(() => res.destroy(), 100);
  });
  const retries = [], progress = [];
  const path = await downloadResumable({ ...f.options, onRetry: r => retries.push(r), onProgress: p => progress.push(p) });
  assert.deepEqual(await readFile(path), f.body);
  assert.equal(f.requests[1], 65536);
  assert.equal(retries.length, 1);
  assert.equal(progress.at(-1).percent, 100);
});
test('pause then a new downloader reuses its on-disk partial after restart', async t => {
  const f = await fixture(t, ({ res, body, start, send }) => {
    if (start) return send();
    res.writeHead(206, { 'Content-Range': `bytes 0-${body.length - 1}/${body.length}` });
    res.write(body.subarray(0, 65536));
  });
  const controller = new AbortController();
  await assert.rejects(downloadResumable({ ...f.options, signal: controller.signal,
    onProgress: p => { if (p.transferred) controller.abort(); } }));
  // Pausing on the first progress event can split a server write across reads.
  // Resume from the bytes actually persisted, not the server's write size.
  const files = await readdir(f.directory);
  assert.equal(files.length, 1);
  const partial = await readFile(join(f.directory, files[0]));
  assert.ok(partial.length > 0 && partial.length <= 65536);
  assert.deepEqual(partial, f.body.subarray(0, partial.length));
  const path = await downloadResumable(f.options);
  assert.equal(f.requests[1], partial.length);
  assert.deepEqual(await readFile(path), f.body);
});
test('server ignoring Range replaces partial bytes instead of appending', async t => {
  let first = true;
  const f = await fixture(t, ({ res, body }) => {
    res.writeHead(200);
    if (first) { first = false; res.write(body.subarray(0, 65536)); setTimeout(() => res.destroy(), 100); }
    else res.end(body);
  });
  assert.deepEqual(await readFile(await downloadResumable(f.options)), f.body);
  assert.equal(f.requests[1], 65536);
});
test('malformed Content-Range never appends and checksum mismatch removes corrupt cache', async t => {
  const badRange = await fixture(t, ({ res, body }) => {
    res.writeHead(206, { 'Content-Range': `bytes 1-${body.length}/${body.length + 1}` }); res.end(body);
  });
  await assert.rejects(downloadResumable({ ...badRange.options, retryDelays: [] }), /range/);
  assert.equal((await readdir(badRange.directory)).length, 0);
  const corrupt = await fixture(t);
  await assert.rejects(downloadResumable({ ...corrupt.options, sha512: Buffer.alloc(64).toString('base64') }), /checksum/);
  assert.equal((await readdir(corrupt.directory)).length, 0);
});
test('stalled connections have bounded retries and remain retryable', async t => {
  const f = await fixture(t, () => {});
  await assert.rejects(downloadResumable({ ...f.options, idleTimeout: 20, retryDelays: [1] }));
  assert.equal(f.requests.length, 2);
});
test('completed cache avoids another network request and generic feed only serves verified asset', async t => {
  const f = await fixture(t);
  const path = await downloadResumable(f.options);
  await downloadResumable(f.options);
  assert.equal(f.requests.length, 1);
  const feed = await serveUpdate({ path, file: { ...f.options, url: 'https://github.com/release/Agent.AppImage' },
    version: '1.0.0', channel: 'latest', platform: 'linux' });
  t.after(() => feed.close());
  const metadata = await (await fetch(feed.url + 'latest-linux.yml?noCache=1')).json();
  assert.equal(metadata.version, '1.0.0');
  assert.equal(metadata.files[0].sha512, f.options.sha512);
  assert.deepEqual(Buffer.from(await (await fetch(feed.url + metadata.files[0].url)).arrayBuffer()), f.body);
  assert.equal((await fetch(new URL('/Agent.AppImage', feed.url))).status, 404);
  assert.equal((await fetch(feed.url + '../asset')).status, 404);
});
