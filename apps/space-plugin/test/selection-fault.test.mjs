import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { config } from 'rxjs';
import { Univer, UniverInstanceType } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import { UniverDocsPlugin, DocSelectionManagerService } from '@univerjs/docs';
import { UniverRenderEnginePlugin } from '@univerjs/engine-render';
import { IMenuManagerService } from '@univerjs/ui';
import '@univerjs/docs/facade';
import { SelectionEditing } from '../lib/selection-editing.js';
import { captureDocTarget } from '../lib/doc-focus.js';

function fixture(ids) {
  const univer = new Univer();
  univer.__getInjector().add([IMenuManagerService, { useValue: { mergeMenu() {} } }]);
  univer.registerPlugin(UniverRenderEnginePlugin);
  univer.registerPlugin(UniverDocsPlugin);
  univer.createUnit(UniverInstanceType.UNIVER_DOC, { id: 'selection-fault', body: {
    dataStream: 'Alpha\rBeta\r\n', paragraphs: ids.map((id, i) => ({ startIndex: i ? 10 : 5, ...(id === undefined ? {} : { paragraphId: id }) })),
    sectionBreaks: [{ startIndex: 11 }],
  } });
  const api = FUniver.newAPI(univer), doc = api.getDocument('selection-fault');
  const uiFree = new Proxy(api, { get(target, key) { return key === 'registerComponent' ? () => ({ dispose() {} }) : Reflect.get(target, key); } });
  const service = univer.__getInjector().get(DocSelectionManagerService);
  const select = (start = 0, end = 3) => {
    service.__TEST_ONLY_setCurrentSelection({ unitId: 'selection-fault', subUnitId: 'selection-fault' });
    service.__replaceTextRangesWithNoRefresh({ textRanges: [{ startOffset: start, endOffset: end, collapsed: start === end }], rectRanges: [], segmentId: '', segmentPage: -1, isEditing: false }, { unitId: 'selection-fault', subUnitId: 'selection-fault' });
  };
  return { univer, api, doc, select, create: () => new SelectionEditing(univer, uiFree,
    { unitId: 'selection-fault', nodeId: 'node', resourceId: 'resource' }, {}, () => {}, async () => {}),
  };
}

for (const ids of [['para_1', 'para_2'], [undefined, undefined], ['para_1', 'para_1'], ['para_1', undefined]]) {
  test(`real SDK initial and consecutive selection events stay bounded: ${JSON.stringify(ids)}`, async t => {
    const unhandled = [];
    const previous = config.onUnhandledError;
    config.onUnhandledError = error => unhandled.push(error);
    t.after(() => { config.onUnhandledError = previous; });
    const f = fixture(ids);
    let editor;
    try {
      const before = structuredClone(f.doc.getDocumentDataModel().getSnapshot());
      f.select(); // The subscriber also receives the cached initial selection.
      editor = f.create();
      for (let i = 0; i < 30; i++) f.select(i % 2, 3 + i % 2);
      await setTimeout(10); // RxJS schedules observer errors outside subscribe().
      assert.deepEqual(unhandled, []);
      assert.deepEqual(f.doc.getDocumentDataModel().getSnapshot(), before);
      if (ids[0] === 'para_1' && ids[1] === 'para_2') assert.equal(editor.getSnapshot().phase, 'selected');
      else {
        assert.equal(editor.getSnapshot().phase, 'idle');
        assert.equal(editor.getSnapshot().target, undefined);
        assert.match(editor.getSnapshot().error, /paragraph IDs/);
      }
      // A text mutation does not use the optional selection identity path.
      assert.equal(f.doc.getTextRange(0, 5).setText('Other'), true);
      assert.equal(f.doc.getDocumentDataModel().getBody().dataStream, 'Other\rBeta\r\n');
    } finally { editor?.dispose(); f.univer.dispose(); }
  });
}

test('failed current-focus capture clears the previous target and recovers on a later valid selection', () => {
  const source = readFileSync(new URL('../src/collaborative-editor.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('      const publishDocFocus = () => {');
  const end = source.indexOf('\n      if (selectionService)', start);
  assert.ok(start >= 0 && end > start);
  let fault = true, active = true, focus = { old: true }, error = '';
  const row = { getId: () => 'para_1', getInfo: () => ({ startOffset: 0, endOffset: 5 }), getText: () => 'Alpha' };
  const env = { ownsView: () => active, selectionService: {
    __getCurrentSelection: () => ({ unitId: 'doc', subUnitId: 'doc' }),
    getSelectionInfo: () => ({ textRanges: [{ startOffset: 0, endOffset: 3 }], rectRanges: [] }),
  }, api: { getDocument: () => ({
    getParagraphs() { if (fault) throw new Error('injected getInfo failure'); return [row]; },
    getTextRange: () => ({ getText: () => 'Alp' }),
  }) }, file: { unitId: 'doc', nodeId: 'node', resourceId: 'resource' }, focusChannel: 'owner', captureDocTarget, crypto,
  face: { updateDocFocus(value, channel) { focus = value; if (!value) assert.equal(channel, 'owner'); } }, setFocusError(value) { error = value; } };
  const publish = new Function('env', `with (env) { ${source.slice(start, end)}; return publishDocFocus; }`)(env);
  publish(); assert.equal(focus, null); assert.match(error, /injected/);
  fault = false; publish(); assert.equal(focus.text, 'Alp'); assert.equal(error, '');
  active = false; const retained = focus; publish(); assert.equal(focus, retained);
});
