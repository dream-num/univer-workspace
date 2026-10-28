import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectionProjection } from '../lib/selection-projection.js';

test('pending projection keeps the authoritative model bytes intact', () => {
  const data = { id: 'selection-doc', documentStyle: {}, body: { dataStream: 'Alpha marker: red kite.\r\n', paragraphs: [{ startIndex: 23, paragraphId: 'p1' }], sectionBreaks: [{ startIndex: 24 }] } };
  const before = JSON.stringify(data);
  const projection = selectionProjection(data, 0, 23, 'Alpha marker: blue kite.');
  assert.equal(JSON.stringify(data), before);
  assert.equal(projection.body.dataStream, 'Alpha marker: redblue kite.\r\n');
  assert.equal(projection.body.paragraphs[0].paragraphId, 'p1');
  assert.ok(projection.body.textRuns.some(run => run.ts.cl?.rgb === '#8f8f8f'));
  assert.ok(projection.body.textRuns.some(run => run.ts.cl?.rgb === '#2c67c5'));
});

test('multi-line candidates shift downstream metadata without writing the source', () => {
  const data = { id: 'doc', documentStyle: {}, body: { dataStream: 'red\rTail\r\n', paragraphs: [{ startIndex: 3, paragraphId: 'p1' }, { startIndex: 8, paragraphId: 'p2' }], sectionBreaks: [{ startIndex: 9 }] } };
  const projection = selectionProjection(data, 0, 3, 'blue\rsky');
  assert.equal(data.body.dataStream, 'red\rTail\r\n');
  assert.equal(projection.body.dataStream, 'redblue\rsky\rTail\r\n');
  assert.equal(projection.body.paragraphs.at(-1).paragraphId, 'p2');
  assert.equal(projection.body.paragraphs.at(-1).startIndex, 16);
});
