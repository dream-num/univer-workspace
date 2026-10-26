import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WorkspaceConnection, normalizeEndpoint, SpaceError } from '../lib/workspace.js';

test('endpoint validation prevents embedded credentials and insecure remote authentication', () => {
  assert.equal(normalizeEndpoint('https://workspace.example/'), 'https://workspace.example');
  assert.equal(normalizeEndpoint('http://127.0.0.1:3020'), 'http://127.0.0.1:3020');
  for (const value of ['bad', 'file:///tmp/data', 'http://remote.example', 'https://user:secret@example.com', 'https://example.com/api', 'https://example.com/?token=secret', 'https://example.com/#secret']) {
    assert.throws(() => normalizeEndpoint(value), error => error instanceof SpaceError && error.status === 400);
  }
});

test('changing endpoint aborts an in-flight login and cannot carry its credential into the new origin', async () => {
  let release;
  const requested = new Promise(resolve => release = resolve);
  const cookies = [];
  const server = createServer((req, res) => {
    cookies.push(req.headers.cookie ?? null);
    if (req.url === '/api/auth/password/login') { release(); return; }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ authenticated: false }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const connection = new WorkspaceConnection();
  try {
    connection.configure(origin);
    const login = connection.login('test', 'unit-test-password');
    const rejected = assert.rejects(login);
    await requested;
    connection.configure(origin);
    await rejected;
    assert.equal((await connection.status()).state, 'unauthenticated');
    assert.deepEqual(cookies, [null, null]);
  } finally {
    await connection.dispose(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('no endpoint is a distinct state, independent of network availability', async () => {
  const connection = new WorkspaceConnection();
  try { assert.deepEqual(await connection.status(), { state: 'unconfigured', endpoint: '' }); }
  finally { await connection.dispose(); }
});
