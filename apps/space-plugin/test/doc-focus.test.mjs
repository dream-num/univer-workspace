import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureDocTarget, resolveDocTarget } from '../lib/doc-focus.js';

function documentFixture() {
  const rows = [
    { id: 'p1', text: '第一段', startOffset: 0, endOffset: 3, getInfo() { return this; }, getId() { return this.id; }, getText() { return this.text; } },
    { id: 'p2', text: '第二段', startOffset: 4, endOffset: 7, getInfo() { return this; }, getId() { return this.id; }, getText() { return this.text; } },
  ];
  return {
    getParagraphs: () => rows,
    getParagraph: id => rows.find(row => row.id === id) ?? null,
    getTextRange: (start, end) => ({
      getText: () => rows.flatMap(row => [...row.text]).slice(start, end).join(''),
      setText: () => true,
    }),
  };
}

test('caret captures the containing paragraph and selection captures exact text', () => {
  const doc = documentFixture();
  const caret = captureDocTarget(doc, [{ startOffset: 1, endOffset: 1 }]);
  assert.equal(caret.kind, 'paragraph');
  assert.equal(caret.paragraphs[0].id, 'p1');
  assert.equal(caret.text, '第一段');
  const selection = captureDocTarget(doc, [{ startOffset: 1, endOffset: 3 }]);
  assert.equal(selection.kind, 'selection');
  assert.equal(selection.text, '一段');
});

test('stale paragraph identity is rejected instead of relocating by quote', () => {
  const doc = documentFixture();
  const focus = captureDocTarget(doc, [{ startOffset: 1, endOffset: 1 }]);
  assert.throws(() => resolveDocTarget({
    ...doc,
    getParagraphs: () => [{ id: 'p1', text: '已被修改', startOffset: 0, endOffset: 4, getInfo() { return this; }, getId() { return this.id; }, getText() { return this.text; } }, doc.getParagraphs()[1]],
  }, focus), /目标段落已更改/);
});
