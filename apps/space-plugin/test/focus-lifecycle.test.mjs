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
    api(operation, payload) { assert.equal(operation, 'focus'); return new Promise((resolve, reject) => calls.push({ payload, resolve, reject })); },
  };
  const mount = new Function('env', `with (env) { ${compiled}; return mountDocFocus; }`)(env);
  const deliver = async call => { const p = call.payload; const result = b.setFocus(p.sessionId, p, p.focus); call.resolve(result); await tick(); return result; };
  const target = text => ({ id: text, channel: 'sdk', nodeId: 'n', resourceId: 'r', unitId: 'u', text });
  let turn = 0;
  const captured = () => { b.admit('s', 'm'); b.beginStep('s', ++turn, [{ id: 'm' }]); return b.activeTurn('s').focus; };
  return { b, env, calls, file, mount, deliver, target, captured };
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
