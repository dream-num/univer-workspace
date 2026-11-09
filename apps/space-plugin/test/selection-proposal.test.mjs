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
function fixture(reply, { finish = 'stop', blocks, editable = true, candidate } = {}) {
  const calls = [];
  const ctx = {
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
    { focus, instruction: 'Replace the selection with CHANGED; leave everything else unchanged.', candidate }, signal) };
}
const valid = request => JSON.stringify({ selectionId: request.selectionId, replacementText: 'CHANGED' });

test('model receives one editable selection, never surrounding document text or identity', async () => {
  const f = fixture(valid);
  assert.deepEqual(await f.run(), { text: 'CHANGED' });
  const request = f.calls[0], data = JSON.parse(request.messages[0].content[0].text);
  assert.equal(data.selectedText, focus.text);
  assert.equal(data.selectionId, focus.id);
  assert.equal(request.messages.length, 1);
  assert.equal(request.tools, undefined);
  for (const outside of ['keep-beta', 'keep-gamma', 'Private document name', 'originalSelectedText'])
    assert.ok(!JSON.stringify(request).includes(outside), outside);
  assert.equal('context' in data, false);
});

test('legacy whole-paragraph text response is rejected rather than projected, trimmed or returned', async () => {
  const f = fixture(JSON.stringify({ text: focus.paragraphs[0].text.replace('TARGET', 'CHANGED') }));
  await assert.rejects(f.run(), error => error.status === 502);
});
for (const [name, reply] of [
  ['wrong selection basis', () => JSON.stringify({ selectionId: 'another-selection', replacementText: 'CHANGED' })],
  ['extra document field', r => JSON.stringify({ selectionId: r.selectionId, replacementText: 'CHANGED', document: 'whole document' })],
  ['mixed old and new response', r => JSON.stringify({ selectionId: r.selectionId, replacementText: 'CHANGED', text: 'ambiguous' })],
  ['array envelope', r => JSON.stringify([r.selectionId, 'CHANGED'])],
  ['null envelope', () => 'null'],
  ['non-text replacement', r => JSON.stringify({ selectionId: r.selectionId, replacementText: { text: 'CHANGED' } })],
  ['document control', r => JSON.stringify({ selectionId: r.selectionId, replacementText: 'bad\u0000text' })],
  ['prose outside JSON', r => 'Here is the edit: ' + valid(r)],
]) test(`unverified candidate is rejected: ${name}`, async () => {
  await assert.rejects(fixture(reply).run(), error => error.status === 502);
});
test('refinement uses only the pending replacement as its model input', async () => {
  const f = fixture(valid, { candidate: 'Earlier suggestion' });
  assert.deepEqual(await f.run(), { text: 'CHANGED' });
  const data = JSON.parse(f.calls[0].messages[0].content[0].text);
  assert.equal(data.selectedText, 'Earlier suggestion');
  assert.ok(!JSON.stringify(data).includes('TARGET'));
});
test('an explicitly verified empty replacement is a valid deletion', async () => {
  const f = fixture(r => JSON.stringify({ selectionId: r.selectionId, replacementText: '' }));
  assert.deepEqual(await f.run(), { text: '' });
});
for (const finish of ['length', null]) test(`incomplete generation cannot become a candidate: ${finish ?? 'missing finish'}`, async () => {
  await assert.rejects(fixture(valid, { finish }).run(), error => error.status === 502);
});
test('separate text blocks cannot be concatenated into an apparently valid response', async () => {
  const text = valid({ selectionId: focus.id });
  await assert.rejects(fixture('', { blocks: [text.slice(0, 20), text.slice(20)] }).run(), error => error.status === 502);
});
test('revoked editing permission prevents model dispatch', async () => {
  const f = fixture(valid, { editable: false });
  await assert.rejects(f.run(), error => error.status === 403);
  assert.equal(f.calls.length, 0);
});
