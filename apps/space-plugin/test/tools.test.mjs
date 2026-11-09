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
  const bindings = new ToolBindings(workspace);
  bindings.claimOwner('surface');
  return {
    bindings,
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
  await f.bindings.setCurrent('s1', 'n1', 'surface', 1, 'space-a', 'folder-a');
  f.bindings.admit('s1', 'message-A');
  await f.bindings.setCurrent('s1', '', 'surface', 2, 'space-b');
  f.bindings.beginStep('s1', 10, [{ id: 'message-A' }]);
  assert.equal(f.bindings.currentFile('s1').nodeId, 'n1');
  assert.equal(f.bindings.currentSpace('s1'), 'space-a');
  assert.equal(f.bindings.currentParent('s1'), 'folder-a');
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
  const b = new ToolBindings(workspace);
  b.claimOwner('surface');
  const old = b.setCurrent('s', 'old', 'surface', 1);
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
    bindings.claimOwner('surface');
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


const focus = (text = 'B', channel = 'mount') => ({
  id: text, channel, kind: 'selection', segmentId: '', paragraphs: [{ id: 'para_1', text }],
  start: 0, end: 1, startOffset: 0, endOffset: 1, text, nodeId: 'n1', resourceId: 'r1', unitId: 'u1',
});
const version = (action, generation = 1, sequence = 1, extra = {}) => ({
  owner: 'surface', association: 1, generation, sequence, channel: 'mount', action, ...extra,
});
const captured = (bindings, turn = 1) => {
  bindings.admit('s1', `m${turn}`);
  bindings.beginStep('s1', turn, [{ id: `m${turn}` }]);
  return bindings.activeTurn('s1').focus;
};

test('owner acquisition fences delayed binds and retired owners cannot reacquire', async () => {
  let release;
  const bindings = new ToolBindings({
    status: async () => ({ state: 'connected', endpoint: 'http://local', user: { id: 'user' } }),
    json: async path => {
      if (path.endsWith('old')) await new Promise(resolve => { release = resolve; });
      return { node: { id: path.split('/').at(-1), name: 'Doc', resource: {
        id: 'r1', unitId: 'u1', unitType: 'doc', capabilities: { openContent: true },
      } } };
    },
  });
  bindings.claimOwner('old');
  const pending = bindings.setCurrent('s1', 'old', 'old', 99);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  bindings.claimOwner('surface');
  await bindings.setCurrent('s1', 'new', 'surface', 1);
  release();
  assert.equal((await pending).applied, false);
  assert.equal(bindings.currentFile('s1').nodeId, 'new');
  assert.equal(bindings.claimOwner('old').accepted, false);
  assert.equal((await bindings.setCurrent('s1', 'old', 'old', 100)).applied, false);
  bindings.claimOwner('surface', true);
  assert.equal(bindings.currentFile('s1'), null);
  assert.equal(bindings.claimOwner('surface').accepted, false);
});

test('reverse register/update/clear delivery cannot restore an old mount, including same Unit remount', async () => {
  const { bindings: b } = setup();
  await b.setCurrent('s1', 'n1', 'surface', 1);
  assert.equal(b.setFocus('s1', version('register', 2), null).accepted, true);
  assert.equal(b.setFocus('s1', version('update', 2, 3), focus('B')).accepted, true);
  assert.equal(b.setFocus('s1', version('update', 2, 2), focus('A')).accepted, false);
  assert.equal(b.setFocus('s1', version('update', 2, 3), focus('A')).accepted, false);
  for (const action of ['register', 'update', 'retire'])
    assert.equal(b.setFocus('s1', version(action, 1, 99), action === 'update' ? focus('A') : null).accepted, false);
  assert.equal(captured(b).text, 'B');
  assert.equal(b.setFocus('s1', version('retire', 2, 4), null).accepted, true);
  assert.equal(b.setFocus('s1', version('update', 2, 999), focus('A')).accepted, false);
  assert.equal(captured(b, 2), null);
  // A clear which arrives before its registration retires that generation too.
  assert.equal(b.setFocus('s1', version('retire', 3, 9), null).accepted, true);
  assert.equal(b.setFocus('s1', version('register', 3), null).accepted, false);
  assert.equal(b.setFocus('s1', version('update', 3, 10), focus('A')).accepted, false);
  assert.equal(b.setFocus('s1', version('register', 4), null).accepted, true);
  assert.equal(b.setFocus('s1', version('update', 4, 11), focus('B')).accepted, true);
  assert.equal(captured(b, 3).text, 'B');
});

test('null selection updates recover, identity mismatch and unregistered mounts are rejected', async () => {
  const { bindings: b } = setup();
  await b.setCurrent('s1', 'n1', 'surface', 1);
  assert.equal(b.setFocus('s1', version('update'), focus()).accepted, false);
  b.setFocus('s1', version('register'), null);
  assert.equal(b.setFocus('s1', version('update', 1, 2), { ...focus(), unitId: 'other' }).accepted, false);
  assert.equal(b.setFocus('s1', version('update', 1, 2), focus('A')).accepted, true);
  assert.equal(b.setFocus('s1', version('update', 1, 3), null).accepted, true);
  assert.equal(captured(b), null);
  assert.equal(b.setFocus('s1', version('update', 1, 4), focus('B')).accepted, true);
  assert.equal(captured(b, 2).text, 'B');
});

test('A to B to A associations reject old same-Unit registrations and retirement', async () => {
  const { bindings: b } = setup();
  await b.setCurrent('s1', 'n1', 'surface', 1);
  b.setFocus('s1', version('register'), null);
  b.setFocus('s1', version('update', 1, 2), focus('A'));
  await b.setCurrent('s1', '', 'surface', 2);
  await b.setCurrent('s1', 'n1', 'surface', 3);
  for (const action of ['register', 'update', 'retire'])
    assert.equal(b.setFocus('s1', version(action, 99, 99), action === 'update' ? focus('A') : null).accepted, false);
  assert.equal(captured(b), null);
  b.setFocus('s1', version('register', 2, 1, { association: 3 }), null);
  b.setFocus('s1', version('update', 2, 2, { association: 3 }), focus('B'));
  assert.equal(captured(b, 2).text, 'B');
});

test('admitted B remains B after live C, retirement and a later unadmitted step has no focus fallback', async () => {
  const { bindings: b } = setup();
  await b.setCurrent('s1', 'n1', 'surface', 1);
  b.setFocus('s1', version('register'), null);
  b.setFocus('s1', version('update', 1, 2), focus('B'));
  b.admit('s1', 'queued-B');
  b.setFocus('s1', version('update', 1, 3), focus('C'));
  b.beginStep('s1', 1, [{ id: 'queued-B' }]);
  assert.equal(b.focusedTurn('s1').focus.text, 'B');
  b.setFocus('s1', version('retire', 1, 4), null);
  assert.equal(b.focusedTurn('s1').focus.text, 'B');
  b.endTurn('s1');
  b.beginStep('s1', 2, [{ id: 'unknown-or-discarded' }]);
  assert.throws(() => b.focusedTurn('s1'), /No document/);
});


test('steering uses its admitted target and conflicting queued targets fail closed', async () => {
  const { bindings: b } = setup();
  await b.setCurrent('s1', 'n1', 'surface', 1);
  b.setFocus('s1', version('register'), null);
  b.setFocus('s1', version('update', 1, 2), focus('B'));
  b.admit('s1', 'B');
  b.beginStep('s1', 1, [{ id: 'B' }]);
  b.setFocus('s1', version('update', 1, 3), focus('C'));
  b.admit('s1', 'steer-C');
  b.beginStep('s1', 1, [{ id: 'steer-C' }]);
  assert.equal(b.focusedTurn('s1').focus.text, 'C');
  b.admit('s1', 'queued-C');
  b.setFocus('s1', version('update', 1, 4), focus('D'));
  b.admit('s1', 'queued-D');
  b.beginStep('s1', 2, [{ id: 'queued-C' }, { id: 'queued-D' }]);
  assert.throws(() => b.focusedTurn('s1'), /没有有效/);
  b.admit('s1', 'discarded-D'); b.discard('s1', 'discarded-D');
  b.beginStep('s1', 3, [{ id: 'discarded-D' }]);
  assert.equal(b.currentFile('s1'), null);
});


test('identity clear retires its owner before a delayed RPC can create a new association', async () => {
  const { bindings: b } = setup();
  await b.setCurrent('s1', 'n1', 'surface', 1);
  b.clear();
  assert.equal((await b.setCurrent('s1', 'n1', 'surface', 99)).applied, false);
  assert.equal(b.claimOwner('surface').accepted, false);
  assert.equal(b.claimOwner('new-identity').accepted, true);
  assert.equal((await b.setCurrent('s1', 'n1', 'new-identity', 1)).applied, true);
  assert.equal(b.setFocus('s1', version('register', 99, 99), null).accepted, false);
});
