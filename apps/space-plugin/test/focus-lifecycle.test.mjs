import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { ToolBindings } from '../lib/tools.js';

// Exercise the actual Face mount closure with a manually delivered RPC carrier.
// No timers: registration acknowledgements and updates are explicitly reordered.
const source = readFileSync(new URL('../src/client.tsx', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('  function mountDocFocus('), source.indexOf('  const removedContexts'));
const compiled = transformSync(body, { loader: 'ts', target: 'es2022' }).code;
const clearBody = transformSync(source.slice(source.indexOf('  async function clearCurrent('), source.indexOf('  const workKey')), { loader: 'ts', target: 'es2022' }).code;
const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture() {
  const b = new ToolBindings({
    status: async () => ({ state: 'connected', endpoint: 'http://local', user: { id: 'user' } }),
    json: async () => ({ node: { id: 'n', name: 'Doc', resource: { id: 'r', unitId: 'u', unitType: 'doc', capabilities: { openContent: true } } } }),
  });
  b.claimOwner('owner'); await b.setCurrent('s', 'n', 'owner', 1);
  const calls = [], file = { nodeId: 'n', resourceId: 'r', unitId: 'u' };
  const env = { liveFocus: undefined, focusGeneration: 0, disposed: false, contextOwner: 'owner', contextSequence: 1,
    view: { content: file, contentLoadId: 1, sessionId: 's', context: { state: 'linked' } },
    update(patch) { Object.assign(env.view, patch); },
    ensureOwner: async () => {}, unblock() {},
    api(operation, payload) { assert.ok(['focus', 'current'].includes(operation)); return new Promise((resolve, reject) => calls.push({ operation, payload, resolve, reject })); },
  };
  const mount = new Function('env', `with (env) { ${compiled}; return mountDocFocus; }`)(env);
  const clearCurrent = new Function('env', `with (env) { ${clearBody}; return clearCurrent; }`)(env);
  const deliver = async call => { const p = call.payload; const result = call.operation === 'focus' ? b.setFocus(p.sessionId, p, p.focus) : await b.setCurrent(p.sessionId, p.nodeId, p.owner, p.sequence); call.resolve(result); await tick(); return result; };
  const target = text => ({ id: text, channel: 'sdk', nodeId: 'n', resourceId: 'r', unitId: 'u', text });
  let turn = 0;
  const captured = () => { b.admit('s', 'm'); b.beginStep('s', ++turn, [{ id: 'm' }]); return b.activeTurn('s').focus; };
  return { b, env, calls, file, mount, clearCurrent, deliver, target, captured };
}

test('selection produced while register is in flight publishes the latest selection after acknowledgement', async () => {
  const f = await fixture(), editor = f.mount(f.file, 1);
  editor.update(f.target('A')); editor.update(f.target('B'));
  assert.equal(f.calls.length, 1);
  await f.deliver(f.calls[0]);
  assert.equal(f.calls[1].payload.focus.text, 'B');
  await f.deliver(f.calls[1]);
  assert.equal(f.captured().text, 'B');
  editor.update(f.target('C'));
  await f.deliver(f.calls[2]);
  assert.equal(f.b.activeTurn('s').focus.text, 'B');
});

test('same-Unit remount retires old register even when clear reaches Host first', async () => {
  const f = await fixture(), old = f.mount(f.file, 1);
  old.update(f.target('A'));
  const current = f.mount(f.file, 1);
  current.update(f.target('B'));
  assert.ok(f.calls[2].payload.generation > f.calls[0].payload.generation);
  await f.deliver(f.calls[1]); // retire old before its registration
  assert.equal((await f.deliver(f.calls[0])).accepted, false);
  await f.deliver(f.calls[2]); await f.deliver(f.calls[3]);
  assert.equal(f.captured().text, 'B');
  const count = f.calls.length;
  old.update(f.target('old')); old.dispose();
  assert.equal(f.calls.length, count);
  current.dispose(); await f.deliver(f.calls.at(-1));
  assert.equal(f.captured(), null);
});

test('reverse updates cannot roll back focus and old rejected receipts do not report a current failure', async () => {
  const f = await fixture(), editor = f.mount(f.file, 1);
  await f.deliver(f.calls[0]); await f.deliver(f.calls[1]);
  editor.update(f.target('A')); editor.update(f.target('B'));
  await f.deliver(f.calls[3]);
  assert.equal((await f.deliver(f.calls[2])).accepted, false);
  assert.equal(f.env.view.error, undefined);
  assert.equal(f.captured().text, 'B');
});

test('register timeout followed by dispose cannot publish a late snapshot or revive a retired mount', async () => {
  const f = await fixture(), editor = f.mount(f.file, 1);
  editor.update(f.target('A')); f.calls[0].reject(new Error('timeout')); await tick();
  assert.match(f.env.view.error, /同步/);
  editor.dispose(); await f.deliver(f.calls[1]);
  assert.equal((await f.deliver(f.calls[0])).accepted, false);
  assert.equal(f.captured(), null);
});


test('Space departure invalidates linked client state before a returning editor can register', async () => {
  const f = await fixture(), old = f.mount(f.file, 1);
  await f.deliver(f.calls[0]); await f.deliver(f.calls[1]);
  const departure = f.clearCurrent();
  assert.equal(f.env.view.context, null);
  old.dispose();
  const count = f.calls.length, returning = f.mount(f.file, 1);
  returning.update(f.target('B'));
  assert.equal(f.calls.length, count);
  await tick();
  await f.deliver(f.calls.find(call => call.operation === 'current'));
  await departure;
  const association = ++f.env.contextSequence;
  await f.b.setCurrent('s', 'n', 'owner', association);
  f.env.view.context = { state: 'linked' };
  returning.connect('s', association);
  await f.deliver(f.calls.at(-1)); await f.deliver(f.calls.at(-1));
  assert.equal(f.env.view.error, undefined);
  assert.equal(f.captured().text, 'B');
});

test('only the latest successful current focus update clears its own sync warning', async () => {
  const f = await fixture(), editor = f.mount(f.file, 1);
  await f.deliver(f.calls[0]); await f.deliver(f.calls[1]);
  editor.update(f.target('A')); const old = f.calls.at(-1);
  editor.update(f.target('B')); f.calls.at(-1).resolve({ accepted: false }); await tick();
  assert.match(f.env.view.error, /同步/);
  await f.deliver(old); assert.match(f.env.view.error, /同步/);
  editor.update(f.target('C')); await f.deliver(f.calls.at(-1));
  assert.equal(f.env.view.error, ''); assert.equal(f.captured().text, 'C');
  f.env.view.error = 'Independent save failure';
  editor.update(f.target('D')); await f.deliver(f.calls.at(-1));
  assert.equal(f.env.view.error, 'Independent save failure');
});

test('clearing another Session does not erase the visible document association', async () => {
  const f = await fixture(), linked = f.env.view.context;
  const pending = f.clearCurrent('other');
  assert.equal(f.env.view.context, linked);
  await tick(); await f.deliver(f.calls.at(-1)); await pending;
  assert.equal(f.env.view.context, linked);
});
