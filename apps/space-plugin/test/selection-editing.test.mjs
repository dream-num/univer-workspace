import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Univer, UniverInstanceType, CustomRangeType, TextXActionType } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import { UniverDocsPlugin } from '@univerjs/docs';
import { UniverRenderEnginePlugin } from '@univerjs/engine-render';
import '@univerjs/docs/facade';
import { SelectionEditing } from '../lib/selection-editing.js';
import { EditorInputGate } from '../lib/editor-input-gate.js';
import { captureDocTarget } from '../lib/doc-focus.js';
import { selectionEditActions, selectionProjection } from '../lib/selection-projection.js';

// These checks exercise Accept with a real SDK document/commands/history. UI
// registration and projection rendering are excluded; they need the Web check.
class AcceptCheck extends SelectionEditing {
  set(state) { this.state = state; }
  clearProjection() { this.preview = false; }
  showProjection() { this.preview = true; }
}

function fixture({ text = 'Alpha red kite. Link', candidate = 'Alpha blue kite. Link', metadata, flush = async () => {} } = {}) {
  const univer = new Univer();
  univer.registerPlugin(UniverRenderEnginePlugin);
  univer.registerPlugin(UniverDocsPlugin);
  const data = { id: 'selection-correctness', documentStyle: {}, body: {
    dataStream: `${text}\r\n`,
    paragraphs: [{ startIndex: text.length, paragraphId: 'p1' }],
    sectionBreaks: [{ startIndex: text.length + 1 }],
    textRuns: [{ st: 0, ed: 5, ts: { bl: 1 } }],
    customRanges: text.endsWith('Link') ? [{ startIndex: text.length - 4, endIndex: text.length - 1, rangeId: 'link', rangeType: CustomRangeType.HYPERLINK, properties: { url: 'https://example.test/' } }] : [],
  } };
  univer.createUnit(UniverInstanceType.UNIVER_DOC, data);
  const api = FUniver.newAPI(univer);
  const doc = api.getDocument(data.id);
  const uiFreeAPI = new Proxy(api, { get(target, key) {
    return key === 'registerComponent' ? () => ({ dispose() {} }) : Reflect.get(target, key);
  } });
  const target = captureDocTarget(doc, [{ startOffset: 0, endOffset: text.length }]);
  assert.ok(target);
  const editor = new AcceptCheck(univer, uiFreeAPI, { unitId: data.id, nodeId: 'node', resourceId: 'resource' }, {
    metadata: metadata ?? (async () => ({ node: { resource: { id: 'resource', capabilities: { editContent: true } } } })),
  }, () => {}, flush);
  editor.set({ phase: 'reviewing', target, candidate });
  editor.revision = doc.getDocumentDataModel().getMutationRevision();
  editor.preview = true;
  return { editor, doc, text, candidate, dispose() { editor.dispose(); univer.dispose(); } };
}

test('Accept uses SDK changed spans, preserving unchanged Bold/Link and native Undo/Redo', async () => {
  const f = fixture();
  try {
    const before = structuredClone(f.doc.getDocumentDataModel().getSnapshot());
    const preview = selectionProjection(before, 0, f.text.length, f.candidate);
    assert.equal(preview.body.textRuns.find(run => run.st === 0).ts.bl, 1);
    await f.editor.accept();
    assert.equal(f.editor.getSnapshot().syncState, 'complete');
    const body = f.doc.getDocumentDataModel().getSnapshot().body;
    assert.equal(body.dataStream, `${f.candidate}\r\n`);
    assert.deepEqual(body.textRuns, before.body.textRuns);
    assert.deepEqual(body.customRanges, [{ ...before.body.customRanges[0], startIndex: 17, endIndex: 20 }]);
    assert.equal(f.doc.undo(), true);
    assert.equal(f.doc.getDocumentDataModel().getBody().dataStream, `${f.text}\r\n`);
    assert.deepEqual(f.doc.getDocumentDataModel().getBody().textRuns, before.body.textRuns);
    assert.deepEqual(f.doc.getDocumentDataModel().getBody().customRanges, before.body.customRanges);
    assert.equal(f.doc.redo(), true);
    assert.equal(f.doc.getDocumentDataModel().getBody().dataStream, `${f.candidate}\r\n`);
  } finally { f.dispose(); }
});

test('insertion, deletion, unchanged candidate and emoji use SDK text actions', async () => {
  for (const [text, candidate] of [['Alpha red', 'Alpha red kite'], ['Alpha red kite', 'Alpha kite'], ['Alpha red', 'Alpha red'], ['Alpha 😀 kite', 'Alpha 😃 kite']]) {
    const f = fixture({ text, candidate });
    try {
      const revision = f.editor.revision;
      await f.editor.accept();
      assert.equal(f.doc.getDocumentDataModel().getBody().dataStream, `${candidate}\r\n`);
      assert.equal(f.doc.getDocumentDataModel().getBody().textRuns[0].ts.bl, 1);
      if (text === candidate) assert.equal(f.doc.getDocumentDataModel().getMutationRevision(), revision);
    } finally { f.dispose(); }
  }
  const f = fixture({ text: 'Alpha 😀 kite', candidate: 'Alpha 😃 kite' });
  try {
    const edits = selectionEditActions(f.doc.getDocumentDataModel(), 0, f.text.length, f.candidate);
    assert.equal(edits.find(edit => edit.t === TextXActionType.DELETE).len, 2);
    assert.equal(edits.find(edit => edit.t === TextXActionType.INSERT).body.dataStream, '😃');
  } finally { f.dispose(); }
});

test('two separated changes retain unchanged Bold and Link inside the selection', async () => {
  const f = fixture({ text: 'Alpha red Bold Link red tail', candidate: 'Alpha blue Bold Link green tail' });
  try {
    const body = f.doc.getDocumentDataModel().getBody();
    const boldStart = f.text.indexOf('Bold');
    const linkStart = f.text.indexOf('Link');
    body.textRuns.push({ st: boldStart, ed: boldStart + 4, ts: { bl: 1 } });
    body.customRanges.push({ startIndex: linkStart, endIndex: linkStart + 3, rangeId: 'middle-link', rangeType: CustomRangeType.HYPERLINK, properties: { url: 'https://example.test/' } });
    await f.editor.accept();
    const next = f.doc.getDocumentDataModel().getBody();
    assert.equal(next.dataStream, `${f.candidate}\r\n`);
    assert.ok(next.textRuns.some(run => run.st === f.candidate.indexOf('Bold') && run.ed === f.candidate.indexOf('Bold') + 4 && run.ts.bl === 1));
    assert.equal(next.customRanges[0].rangeId, 'middle-link');
    assert.equal(next.customRanges[0].startIndex, f.candidate.indexOf('Link'));
    assert.equal(next.customRanges[0].properties.url, 'https://example.test/');
    assert.equal(f.doc.undo(), true); // All hunks are one native history entry.
    assert.equal(f.doc.getDocumentDataModel().getBody().dataStream, `${f.text}\r\n`);
  } finally { f.dispose(); }
});

test('metadata failure retains a reviewable candidate without applying', async () => {
  const f = fixture({ metadata: async () => { throw new Error('metadata unavailable'); } });
  try {
    await f.editor.accept();
    assert.equal(f.editor.getSnapshot().phase, 'reviewing');
    assert.equal(f.editor.getSnapshot().candidate, f.candidate);
    assert.match(f.editor.getSnapshot().error, /metadata unavailable/);
    assert.equal(f.doc.getDocumentDataModel().getBody().dataStream, `${f.text}\r\n`);
  } finally { f.dispose(); }
});

test('SDK rejected/no-op edit restores the candidate', async () => {
  const f = fixture();
  try {
    f.doc.getDocumentDataModel().getSnapshot().disabled = true;
    await f.editor.accept();
    assert.equal(f.editor.getSnapshot().phase, 'reviewing');
    assert.equal(f.editor.getSnapshot().candidate, f.candidate);
    assert.equal(f.editor.preview, true);
    assert.equal(f.doc.getDocumentDataModel().getBody().dataStream, `${f.text}\r\n`);
  } finally { f.dispose(); }
});

test('sync failure never applies twice; Retry sync only drains existing writes', async () => {
  let calls = 0;
  const f = fixture({ flush: async () => { if (++calls === 1) throw new Error('sync timeout'); } });
  try {
    await f.editor.accept();
    assert.equal(f.editor.getSnapshot().phase, 'applied');
    assert.equal(f.editor.getSnapshot().syncState, 'failed');
    assert.equal(f.editor.getSnapshot().candidate, undefined);
    const revision = f.doc.getDocumentDataModel().getMutationRevision();
    await f.editor.accept();
    assert.equal(calls, 1);
    await f.editor.retrySync();
    assert.equal(calls, 2);
    assert.equal(f.editor.getSnapshot().syncState, 'complete');
    assert.equal(f.doc.getDocumentDataModel().getMutationRevision(), revision);
  } finally { f.dispose(); }
});

test('a downstream exception after mutation never restores a repeatable Apply', async () => {
  const f = fixture();
  try {
    const api = f.editor.api;
    f.editor.api = new Proxy(api, { get(target, key) {
      if (key !== 'syncExecuteCommand') return Reflect.get(target, key);
      return (...args) => { target.syncExecuteCommand(...args); throw new Error('downstream failure'); };
    } });
    await f.editor.accept();
    assert.equal(f.editor.getSnapshot().phase, 'applied');
    assert.equal(f.editor.getSnapshot().syncState, 'failed');
    assert.match(f.editor.getSnapshot().warning, /downstream failure/);
    const revision = f.doc.getDocumentDataModel().getMutationRevision();
    await f.editor.accept();
    assert.equal(f.doc.getDocumentDataModel().getMutationRevision(), revision);
    assert.equal(f.doc.getDocumentDataModel().getBody().dataStream, `${f.candidate}\r\n`);
  } finally { f.dispose(); }
});

test('document mutation during metadata wait invalidates the pending Apply', async () => {
  let release;
  const f = fixture({ metadata: () => new Promise(resolve => { release = resolve; }) });
  try {
    const accepting = f.editor.accept();
    f.doc.getTextRange(0, 5).setText('Other');
    release({ node: { resource: { id: 'resource', capabilities: { editContent: true } } } });
    await accepting;
    assert.equal(f.editor.getSnapshot().phase, 'idle');
    assert.equal(f.doc.getDocumentDataModel().getBody().dataStream, 'Other red kite. Link\r\n');
  } finally { f.dispose(); }
});

test('single input owner retains either reason through save/status and projection removal', () => {
  const element = { inert: false };
  const gate = new EditorInputGate(element);
  gate.setProjectionBlocked(true);
  gate.setConnectionBlocked(false); // Saving / Saved cannot release Review.
  assert.equal(element.inert, true);
  gate.setConnectionBlocked(true);
  gate.setProjectionBlocked(false); // Undo cannot release an offline/denied gate.
  assert.equal(element.inert, true);
  gate.setConnectionBlocked(false);
  assert.equal(element.inert, false);
});
