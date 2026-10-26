import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentEditing } from '../lib/editing.js';
import { ToolBindings } from '../lib/tools.js';
function setup() {
  let currentUser = 'a',
    canEdit = true,
    finish;
  const calls = [],
    writes = [];
  const workspace = {
    endpoint: 'http://localhost',
    status: async () => ({
      state: 'connected',
      endpoint: 'http://localhost',
      user: { id: currentUser },
    }),
    json: async (path, init) => {
      calls.push({ path, ...init });
      if (path.startsWith('/api/nodes/')) {
        const id = path.split('/').at(-1);
        return {
          node: {
            id,
            name: id,
            resource: {
              kind: 'univer',
              id: `r-${id}`,
              unitId: `u-${id}`,
              unitType: 'doc',
              capabilities: { openContent: true, editContent: canEdit },
            },
          },
        };
      }
      if (path === '/api/worktrees') return { id: 'draft' };
      return {
        worktree: { state: path.endsWith('/merge') ? 'merged' : 'ready' },
      };
    },
    executeDraft: async (file, worktreeId, code) => {
      writes.push({ file, worktreeId, code });
      if (finish) await finish.promise;
      return { committed: true, revision: 2, value: null };
    },
  };
  const bindings = new ToolBindings(workspace),
    editing = new AgentEditing(workspace, bindings);
  async function admit(node, seq) {
    await bindings.setCurrent('s', node, 'surface', seq);
    bindings.admit('s', `m${seq}`);
    bindings.beginStep('s', seq, [{ id: `m${seq}` }]);
  }
  return {
    workspace,
    bindings,
    editing,
    calls,
    writes,
    admit,
    permission: (v) => (canEdit = v),
    user: (v) => (currentUser = v),
    defer() {
      let resolve;
      const promise = new Promise((r) => (resolve = r));
      finish = { promise, resolve };
      return finish;
    },
  };
}
test('a queued write retains the admitted document after current Page switches', async () => {
  const f = setup();
  await f.admit('one', 1);
  await f.bindings.setCurrent('s', 'two', 'surface', 2);
  await f.editing.edit(
    's',
    { mode: 'write', code: 'doc.appendParagraph("one")' },
    new AbortController().signal,
  );
  assert.equal(f.writes[0].file.nodeId, 'one');
  assert.equal(
    JSON.parse(f.calls.find((x) => x.path.endsWith('/units')).body).resourceId,
    'r-one',
  );
  await assert.rejects(
    f.editing.edit(
      's',
      { mode: 'write', unitId: 'u-two', code: 'anything' },
      new AbortController().signal,
    ),
    /different document/,
  );
  assert.equal(f.writes.length, 1);
});
test('Viewer and revoked members are denied before content execution; identity changes invalidate grants', async () => {
  const f = setup();
  await f.admit('one', 1);
  f.permission(false);
  await assert.rejects(
    f.editing.edit(
      's',
      { mode: 'write', code: 'x' },
      new AbortController().signal,
    ),
    /permission/,
  );
  assert.equal(f.writes.length, 0);
  f.permission(true);
  await f.editing.worktree(
    's',
    { action: 'create' },
    new AbortController().signal,
  );
  f.user('b');
  await assert.rejects(
    f.editing.edit(
      's',
      { mode: 'write', code: 'x' },
      new AbortController().signal,
    ),
    /Associate/,
  );
  assert.equal(f.writes.length, 0);
});
test('cancel waits for an in-flight draft commit, discards it and blocks further calls from the same turn', async () => {
  const f = setup();
  await f.admit('one', 1);
  const hold = f.defer();
  const controller = new AbortController(),
    work = f.editing.edit('s', { mode: 'write', code: 'x' }, controller.signal);
  while (!f.writes.length)
    await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  hold.resolve();
  await assert.rejects(work, /canceled/);
  assert.equal((await f.editing.status('s', 'one')).phase, 'canceled');
  assert.equal(f.calls.filter((x) => x.path.endsWith('/discard')).length, 1);
  assert.equal(f.calls.filter((x) => x.path.endsWith('/merge')).length, 0);
  await assert.rejects(
    f.editing.worktree('s', { action: 'ready' }, new AbortController().signal),
    /ended/,
  );
});
test('Agent merge and unreviewed UI Apply fail closed', async () => {
  const f = setup();
  await f.admit('one', 1);
  await assert.rejects(
    f.editing.worktree('s', { action: 'merge' }, new AbortController().signal),
    /Review controls/,
  );
  await f.editing.worktree(
    's',
    { action: 'create' },
    new AbortController().signal,
  );
  await f.editing.edit(
    's',
    { mode: 'write', code: 'x' },
    new AbortController().signal,
  );
  await f.editing.worktree(
    's',
    { action: 'ready' },
    new AbortController().signal,
  );
  const p = await f.editing.status('s', 'one');
  await assert.rejects(
    f.editing.action('s', 'one', 'apply', p.id, 'unreviewed'),
    /Review/,
  );
  assert.equal(f.calls.filter((x) => x.path.endsWith('/merge')).length, 0);
});

test('new Worktree Tool output is lossless JSON before a first content revision exists', async () => {
  const f = setup();
  await f.admit('one', 1);
  const result = await f.editing.worktree(
    's',
    { action: 'create' },
    new AbortController().signal,
  );
  assert.deepEqual(result, JSON.parse(JSON.stringify(result)));
});
