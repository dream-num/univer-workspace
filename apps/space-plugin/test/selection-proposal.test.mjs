import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Real Host implementation and public stream assembler; only model delivery and
// the authorized Workspace lookup are controlled.
const directory = await mkdtemp(join(tmpdir(), 'space-selection-proposal-'));
const compiled = await build({
  entryPoints: ['src/selection-proposal.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'same-application-dependencies', setup(bundler) {
    bundler.onResolve({ filter: /^\.\/(workspace|doc-focus)\.js$/ }, args => ({
      path: fileURLToPath(new URL('../lib/' + args.path.slice(2), import.meta.url)), external: true,
    }));
    bundler.onResolve({ filter: /^@/ }, args => ({ path: fileURLToPath(import.meta.resolve(args.path)), external: true }));
  } }],
});
const entry = join(directory, 'proposal.mjs');
await writeFile(entry, compiled.outputFiles[0].contents);
const { selectionProposal } = await import(pathToFileURL(entry));
test.after(() => rm(directory, { recursive: true, force: true }));
const focus = {
  id: 'selection-request', channel: 'view', kind: 'selection', segmentId: '',
  text: 'TARGET', start: 14, end: 20, startOffset: 14, endOffset: 20,
  paragraphs: [{ id: 'para_source', text: 'Alpha marker: TARGET. Beta marker: keep-beta. Gamma marker: keep-gamma.' }],
  nodeId: 'node', resourceId: 'resource', unitId: 'unit',
};
function fixture(reply, { finish = 'stop', blocks, editable = true, candidate, target = focus, sessionId, model } = {}) {
  const calls = [];
  const ctx = {
    agents: { get(id) { assert.equal(id, sessionId); return model ? { model: { current: () => model } } : undefined; } },
    agentDefaultModel: { currentSelection: () => ({ provider: 'provider', model: 'model' }) },
    llm: { async prepareCall(config) {
      return { config, async *stream(options) {
        calls.push(options);
        const request = JSON.parse(options.messages[0].content[0].text);
        const text = typeof reply === 'function' ? reply(request) : reply;
        for (const [index, value] of (blocks ?? [text]).entries()) {
          yield { type: 'block-start', index, blockType: 'text' };
          yield { type: 'text-delta', index, text: value };
          yield { type: 'block-end', index, block: { type: 'text', text: value } };
        }
        if (finish) yield { type: 'finish', reason: { kind: finish } };
      } };
    } },
  };
  const workspace = { identitySignal: new AbortController().signal, async open(nodeId) {
    assert.equal(nodeId, focus.nodeId);
    return { type: 'doc', name: 'Private document name', resourceId: focus.resourceId, unitId: focus.unitId,
      node: { resource: { capabilities: { editContent: editable } } } };
  } };
  return { calls, run: (signal = new AbortController().signal) => selectionProposal(ctx, workspace,
    { focus: target, sessionId, instruction: 'Replace the selection with CHANGED; leave everything else unchanged.', candidate }, signal) };
}
const frame = (r, replacement) => JSON.stringify({ selectionId: r.selectionId, resultText: r.context.before + replacement + r.context.after });
const valid = r => frame(r, 'CHANGED');

test('Ask uses the selected Agent model through the public current route', async () => {
  const model = { provider: 'session-provider', model: 'session-model', reasoningEffort: 'high' };
  const f = fixture(valid, { sessionId: 'native-session', model });
  assert.deepEqual(await f.run(), { text: 'CHANGED' });
  assert.equal(f.calls[0].provider, model.provider);
  assert.equal(f.calls[0].model, model.model);
  assert.equal(f.calls[0].reasoningEffort, model.reasoningEffort);
});
test('Ask falls back to the Host default when the native Agent has no selected route', async () => {
  const f = fixture(valid, { sessionId: 'native-session' });
  assert.deepEqual(await f.run(), { text: 'CHANGED' });
  assert.equal(f.calls[0].provider, 'provider');
  assert.equal(f.calls[0].model, 'model');
});

test('model receives readonly neighbors separately from the unique editable selection', async () => {
  const f = fixture(valid);
  assert.deepEqual(await f.run(), { text: 'CHANGED' });
  const request = f.calls[0], data = JSON.parse(request.messages[0].content[0].text);
  assert.equal(data.selectedText, focus.text);
  assert.equal(data.selectionId, focus.id);
  assert.deepEqual(data.context, { before: 'Alpha marker: ', after: '. Beta marker: keep-beta. Gamma marker: keep-gamma.', originalSelectedText: focus.text });
  assert.equal(request.messages.length, 1);
  assert.equal(request.tools, undefined);
});

for (const [name, transform] of [
  ['prefix', r => ({ ...r, context: { ...r.context, before: 'Changed prefix' } })],
  ['suffix', r => ({ ...r, context: { ...r.context, after: 'Changed suffix' } })],
]) test(`changed readonly ${name} is rejected`, async () => {
  await assert.rejects(fixture(r => valid(transform(r))).run(), error => error.status === 502);
});
test('replacement-only result is rejected, never guessed into a complete fragment', async () => {
  await assert.rejects(fixture(r => JSON.stringify({ selectionId: r.selectionId, resultText: 'CHANGED' })).run(), error => error.status === 502);
});
test('a full edited paragraph is decoded by declared boundaries without duplicating context', async () => {
  assert.deepEqual(await fixture(valid).run(), { text: 'CHANGED' });
});
test('legacy whole-paragraph text response is rejected rather than projected, trimmed or returned', async () => {
  const f = fixture(JSON.stringify({ text: focus.paragraphs[0].text.replace('TARGET', 'CHANGED') }));
  await assert.rejects(f.run(), error => error.status === 502);
});
for (const [name, reply] of [
  ['wrong selection basis', () => JSON.stringify({ selectionId: 'another-selection', resultText: 'CHANGED' })],
  ['extra document field', r => JSON.stringify({ selectionId: r.selectionId, resultText: 'CHANGED', document: 'whole document' })],
  ['mixed old and new response', r => JSON.stringify({ selectionId: r.selectionId, resultText: 'CHANGED', text: 'ambiguous' })],
  ['array envelope', r => JSON.stringify([r.selectionId, 'CHANGED'])],
  ['null envelope', () => 'null'],
  ['non-text replacement', r => JSON.stringify({ selectionId: r.selectionId, resultText: { text: 'CHANGED' } })],
  ['document control', r => JSON.stringify({ selectionId: r.selectionId, resultText: 'bad\u0000text' })],
  ['prose outside JSON', r => 'Here is the edit: ' + valid(r)],
]) test(`unverified candidate is rejected: ${name}`, async () => {
  await assert.rejects(fixture(reply).run(), error => error.status === 502);
});
test('refinement uses only the pending replacement as its model input', async () => {
  const f = fixture(valid, { candidate: 'Earlier suggestion' });
  assert.deepEqual(await f.run(), { text: 'CHANGED' });
  const data = JSON.parse(f.calls[0].messages[0].content[0].text);
  assert.equal(data.selectedText, 'Earlier suggestion');
  assert.equal(data.context.originalSelectedText, focus.text);
  assert.ok(data.context.after.includes('keep-beta'));
});
test('an explicitly verified empty replacement is a valid deletion', async () => {
  const f = fixture(r => frame(r, ''));
  assert.deepEqual(await f.run(), { text: '' });
});
for (const finish of ['length', null]) test(`incomplete generation cannot become a candidate: ${finish ?? 'missing finish'}`, async () => {
  await assert.rejects(fixture(valid, { finish }).run(), error => error.status === 502);
});
test('separate text blocks cannot be concatenated into an apparently valid response', async () => {
  const text = valid({ selectionId: focus.id, context: { before: 'Alpha marker: ', after: '. Beta marker: keep-beta. Gamma marker: keep-gamma.' } });
  await assert.rejects(fixture('', { blocks: [text.slice(0, 20), text.slice(20)] }).run(), error => error.status === 502);
});
test('revoked editing permission prevents model dispatch', async () => {
  const f = fixture(valid, { editable: false });
  await assert.rejects(f.run(), error => error.status === 403);
  assert.equal(f.calls.length, 0);
});

test('multi-paragraph framing uses exact captured offsets', async () => {
  const target = { ...focus, text: 'tail\rSecond', start: 6, end: 6,
    paragraphs: [{ id: 'para_first', text: 'First tail' }, { id: 'para_last', text: 'Second head' }] };
  const f = fixture(valid, { target });
  assert.deepEqual(await f.run(), { text: 'CHANGED' });
  const data = JSON.parse(f.calls[0].messages[0].content[0].text);
  assert.deepEqual(data.context, { before: 'First ', after: ' head', originalSelectedText: target.text });
});
test('repeated context is not located by quote or similarity', async () => {
  const target = { ...focus, start: 8, end: 14,
    paragraphs: [{ id: 'para_repeat', text: 'TARGET--TARGET--TARGET' }] };
  assert.deepEqual(await fixture(valid, { target }).run(), { text: 'CHANGED' });
});
