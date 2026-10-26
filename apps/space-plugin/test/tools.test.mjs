import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ToolBindings } from '../lib/tools.js';
function setup() {
  let user = 'user1',
    resource = 'r1',
    readCount = 0;
  const workspace = {
    endpoint: 'http://localhost',
    status: async () => ({
      state: 'connected',
      endpoint: 'http://localhost',
      user: { id: user },
    }),
    json: async () => ({
      node: {
        id: 'n1',
        name: 'Document',
        resource: {
          id: resource,
          unitId: 'u1',
          unitType: 'doc',
          capabilities: { openContent: true },
        },
      },
    }),
    read: async () => {
      readCount++;
      return {
        endpoint: 'http://localhost',
        resourceId: resource,
        unitId: 'u1',
        type: 'doc',
        revision: 2,
        sha256: 'digest',
        capturedAt: 'now',
        content: { text: 'one\rtwo\rthree', sheets: [] },
      };
    },
  };
  return {
    bindings: new ToolBindings(workspace),
    user(value) {
      user = value;
    },
    resource(value) {
      resource = value;
    },
    reads: () => readCount,
  };
}
test('read grant is bound to Session and current identity; association does not fetch body', async () => {
  const f = setup();
  await f.bindings.bind('s1', 'n1');
  assert.equal(f.reads(), 0);
  await assert.rejects(
    f.bindings.inspect('s2', 'n1', new AbortController().signal),
    /Associate/,
  );
  await assert.rejects(
    f.bindings.inspect('s1', 'other', new AbortController().signal),
    /not associated/,
  );
  const read = await f.bindings.inspect(
    's1',
    'n1',
    new AbortController().signal,
    0,
    2,
  );
  assert.deepEqual(read.lines, [
    { index: 0, text: 'one' },
    { index: 1, text: 'two' },
  ]);
  assert.equal(read.nextOffset, 2);
  f.user('user2');
  await assert.rejects(
    f.bindings.inspect('s1', 'n1', new AbortController().signal),
    /Associate/,
  );
  assert.equal(f.reads(), 1);
});
test('changed resource identity, cancellation and logout clear cannot use an old grant', async () => {
  const f = setup();
  await f.bindings.bind('s1', 'n1');
  f.resource('other');
  await assert.rejects(
    f.bindings.inspect('s1', 'n1', new AbortController().signal),
    /identity changed/,
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(f.bindings.inspect('s1', 'n1', abort.signal));
  f.bindings.clear();
  await assert.rejects(f.bindings.scope('s1'), /Associate/);
});

test('current Page is frozen at native message admission, including queued turns and removal', async () => {
  const f = setup();
  await f.bindings.setCurrent('s1', 'n1', 'surface', 1);
  f.bindings.admit('s1', 'message-A');
  await f.bindings.setCurrent('s1', '', 'surface', 2);
  f.bindings.beginStep('s1', 10, [{ id: 'message-A' }]);
  assert.equal(f.bindings.currentFile('s1').nodeId, 'n1');
  assert.match(f.bindings.contextText('s1'), /always call univer_inspect/);
  await f.bindings.setCurrent('s1', 'n1', 'surface', 3);
  f.bindings.admit('s1', 'message-B');
  f.bindings.endTurn('s1');
  await f.bindings.setCurrent('s1', '', 'surface', 4);
  f.bindings.beginStep('s1', 11, [{ id: 'message-B' }]);
  assert.equal(f.bindings.currentFile('s1').nodeId, 'n1');
  f.bindings.endTurn('s1');
  assert.equal(f.bindings.currentFile('s1'), null);
  assert.match(f.bindings.contextText('s1'), /No Workspace document/);
  assert.equal(
    (await f.bindings.setCurrent('s1', 'n1', 'surface', 2)).applied,
    false,
  );
  f.bindings.clear();
  assert.equal(f.bindings.contextText('s1'), '');
});

test('slow old association and identity changes cannot overwrite the latest Page', async () => {
  let resume;
  const workspace = {
    status: async () => ({
      state: 'connected',
      endpoint: 'http://localhost',
      user: { id: 'u' },
    }),
    json: async (path) => {
      if (path.endsWith('/old'))
        await new Promise((r) => {
          resume = r;
        });
      return {
        node: {
          id: path.split('/').at(-1),
          name: 'File',
          resource: {
            id: 'r',
            unitId: 'unit',
            unitType: 'doc',
            capabilities: { openContent: true },
          },
        },
      };
    },
  };
  const b = new ToolBindings(workspace),
    old = b.setCurrent('s', 'old', 'surface', 1);
  while (!resume) await new Promise((r) => setImmediate(r));
  await b.setCurrent('s', 'new', 'surface', 2);
  resume();
  assert.equal((await old).applied, false);
  assert.equal(b.currentFile('s').nodeId, 'new');
  resume = undefined;
  const canceled = b.setCurrent('s', 'old', 'surface', 3);
  while (!resume) await new Promise((r) => setImmediate(r));
  b.clear();
  resume();
  await assert.rejects(canceled, /identity changed/);
  assert.equal(b.contextText('s'), '');
});

test('all six current file types bind without reading bodies and expose current real content on demand', async () => {
  for (const type of ['doc', 'sheet', 'slide', 'board', 'base', 'site']) {
    let reads = 0;
    const w = {
      status: async () => ({
        state: 'connected',
        endpoint: 'http://localhost',
        user: { id: 'u' },
      }),
      json: async (path) =>
        path.startsWith('/api/resources/')
          ? { resource: { originalFilename: 'view.univer.html' } }
          : {
              node: {
                id: 'n',
                name: type,
                resource: {
                  kind: type === 'site' ? 'blob' : 'univer',
                  id: 'r',
                  unitId: type === 'site' ? undefined : 'unit',
                  unitType: type,
                  capabilities: { openContent: true },
                },
              },
            },
      read: async () => {
        reads++;
        return {
          endpoint: 'http://localhost',
          resourceId: 'r',
          unitId: type === 'site' ? '' : 'unit',
          type,
          revision: 1,
          sha256: 'hash',
          data: { name: 'real content' },
          html: '<h1>Site content</h1>',
          content: {
            text: 'Doc content',
            sheets:
              type === 'sheet'
                ? [
                    {
                      id: 's',
                      name: 'Budget',
                      cells: [{ row: 0, column: 0, value: '4270' }],
                    },
                  ]
                : [],
          },
        };
      },
    };
    const bindings = new ToolBindings(w);
    await bindings.setCurrent('s', 'n', 'surface', 1);
    assert.equal(reads, 0);
    assert.equal(bindings.currentFile('s').type, type);
    const result = await bindings.inspect(
      's',
      'n',
      new AbortController().signal,
    );
    assert.equal(reads, 1);
    assert.ok(result.lines.length > 0);
    assert.equal(result.file.type, type);
    assert.ok(result.format);
  }
});
