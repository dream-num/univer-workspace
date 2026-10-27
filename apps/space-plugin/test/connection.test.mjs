import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import {
  WorkspaceConnection,
  normalizeEndpoint,
  SpaceError,
} from '../lib/workspace.js';

test('endpoint validation prevents embedded credentials and insecure remote authentication', () => {
  assert.equal(
    normalizeEndpoint('https://workspace.example/'),
    'https://workspace.example',
  );
  assert.equal(
    normalizeEndpoint('http://127.0.0.1:3020'),
    'http://127.0.0.1:3020',
  );
  for (const value of [
    'bad',
    'file:///tmp/data',
    'http://remote.example',
    'https://user:secret@example.com',
    'https://example.com/api',
    'https://example.com/?token=secret',
    'https://example.com/#secret',
  ]) {
    assert.throws(
      () => normalizeEndpoint(value),
      (error) => error instanceof SpaceError && error.status === 400,
    );
  }
});

test('changing endpoint aborts an in-flight login and cannot carry its credential into the new origin', async () => {
  let release;
  const requested = new Promise((resolve) => (release = resolve));
  const cookies = [];
  const server = createServer((req, res) => {
    cookies.push(req.headers.cookie ?? null);
    if (req.url === '/api/auth/password/login') {
      release();
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ authenticated: false }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const connection = new WorkspaceConnection();
  try {
    connection.configure(origin);
    const login = connection.login('test', 'unit-test-password');
    const rejected = assert.rejects(login);
    await requested;
    connection.configure('http://127.0.0.1:1');
    connection.configure(origin);
    await rejected;
    assert.equal((await connection.status()).state, 'unauthenticated');
    assert.deepEqual(cookies, [null, null]);
  } finally {
    await connection.dispose();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('no endpoint is a distinct state, independent of network availability', async () => {
  const connection = new WorkspaceConnection();
  try {
    assert.deepEqual(await connection.status(), {
      state: 'unconfigured',
      endpoint: '',
    });
  } finally {
    await connection.dispose();
  }
});

test('reconnecting and failed replacement never discard an authenticated Workspace cookie', async () => {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/auth/password/login') {
      if (req.method === 'POST') {
        res.setHeader(
          'set-cookie',
          'workspace_test=authorized; HttpOnly; Path=/',
        );
        res.end('{}');
        return;
      }
    }
    res.end(
      JSON.stringify({
        authenticated: req.headers.cookie === 'workspace_test=authorized',
        user: req.headers.cookie ? { id: 'account' } : null,
      }),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`,
    connection = new WorkspaceConnection();
  try {
    await connection.connect(origin);
    await connection.login('account', 'test-only');
    assert.equal((await connection.connect(origin)).state, 'connected');
    await assert.rejects(connection.connect('not an origin'));
    await assert.rejects(connection.connect('http://127.0.0.1:1'));
    assert.equal(connection.endpoint, origin);
    assert.equal((await connection.status()).state, 'connected');
  } finally {
    await connection.dispose();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('resource creation preserves idempotency and never masks a Server permission denial', async () => {
  const received = [];
  const server = createServer((req, res) => {
    received.push({ path: req.url, key: req.headers['idempotency-key'] });
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({ error: { message: 'Cannot create in this folder.' } }),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const connection = new WorkspaceConnection();
  try {
    connection.configure(`http://127.0.0.1:${server.address().port}`);
    await assert.rejects(
      connection.create(
        {
          kind: 'doc',
          name: 'Denied',
          space: 's',
          parent: 'p',
          key: 'stable-attempt',
        },
        new AbortController().signal,
      ),
      (e) => e.status === 403 && e.message === 'Cannot create in this folder.',
    );
    assert.deepEqual(received, [
      { path: '/api/resources', key: 'stable-attempt' },
    ]);
  } finally {
    await connection.dispose();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('editor transport binds Workspace identity and denies snapshot replacement or path escapes', async () => {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/auth/password/login') {
      res.setHeader('set-cookie', 'workspace_test=owner; HttpOnly; Path=/');
      res.end('{}');
      return;
    }
    res.end(
      JSON.stringify({ authenticated: true, user: { id: 'workspace-owner' } }),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const connection = new WorkspaceConnection(),
    endpoint = `http://127.0.0.1:${server.address().port}`;
  try {
    connection.configure(endpoint);
    await connection.login('owner', 'test');
    const input = {
        endpoint,
        userId: 'workspace-owner',
        path: '/universer-api/user/session-ticket',
        method: 'GET',
        body: null,
      },
      signal = new AbortController().signal;
    assert.equal((await connection.editorRequest(input, signal)).status, 200);
    assert.equal((await connection.editorRequest({ ...input, path: '/universer-api/history/unit-1/list?length=20' }, signal)).status, 200);
    await assert.rejects(connection.editorRequest({ ...input, path: '/universer-api/history/unit-1/list', method: 'POST', body: '{}' }, signal), (e) => e.status === 400);
    await assert.rejects(
      connection.editorRequest({ ...input, userId: 'dsh-owner' }, signal),
      (e) => e.status === 401,
    );
    for (const path of [
      'https://foreign.example/api',
      '/api/resources',
      '/universer-api/worktrees/a/merge',
      '/universer-api/snapshot/%2e%2e/%2e%2e/api/resources',
    ])
      await assert.rejects(
        connection.editorRequest({ ...input, path }, signal),
      );
    await assert.rejects(
      connection.editorRequest(
        {
          ...input,
          path: '/universer-api/snapshot/1/unit/u',
          method: 'POST',
          body: '{}',
        },
        signal,
      ),
      (e) => e.status === 400,
    );
  } finally {
    await connection.dispose();
    await new Promise((r) => server.close(r));
  }
});

test('the metadata index discovers a Page under another Page without inventing a Folder or duplicating roots', async () => {
  const connection = new WorkspaceConnection();
  const page = (id, parentNodeId) => ({ id, parentNodeId, spaceId: 's', name: `${id}.univer.html`, resource: { id: `r-${id}`, kind: 'blob' } });
  const parent = page('parent', null), child = page('child', 'parent');
  const reads = [];
  connection.json = async (path) => {
    reads.push(path.split('?')[0]);
    if (path === '/api/spaces') return { spaces: [{ id: 's' }] };
    if (path.startsWith('/api/shared-with-me?')) return { items: [], nextCursor: null };
    if (path.startsWith('/api/spaces/s/nodes?')) return { nodes: [parent], nextCursor: null };
    if (path.startsWith('/api/html-views?')) return { items: [parent, child].map(node => ({ node, resource: node.resource })), nextCursor: null };
    throw new Error(`Unexpected content/body read: ${path}`);
  };
  try {
    const result = await connection.index(new AbortController().signal);
    assert.equal(result.nodes.length, 2);
    assert.equal(result.nodes.find(node => node.id === child.id).parentNodeId, parent.id);
    assert.ok(result.nodes.every(node => node.resource.htmlView));
    assert.deepEqual(reads, ['/api/spaces', '/api/shared-with-me', '/api/spaces/s/nodes', '/api/html-views']);
  } finally { await connection.dispose(); }
});
