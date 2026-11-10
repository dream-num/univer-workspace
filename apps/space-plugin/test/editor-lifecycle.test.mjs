import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EditorResources,
  disposeEditorResources,
} from '../lib/editor-lifecycle.js';

test('a stale same-node cleanup cannot release the replacement editor', async () => {
  const resources = new EditorResources();
  const flushed = [];
  const oldRelease = resources.bind('node', {
    flush: async () => flushed.push('old'),
    isSaved: () => true,
  });
  const release = resources.bind('node', {
    flush: async () => flushed.push('new'),
    isSaved: () => true,
  });
  oldRelease();
  await resources.current.flush();
  assert.deepEqual(flushed, ['new']);
  release();
  release();
  assert.equal(resources.current, null);
});
test('all runtime resources are released after an SDK disposer throws', () => {
  const released = [],
    failures = [];
  disposeEditorResources(
    [
      () => released.push('listener'),
      () => {
        throw new Error('SDK');
      },
      () => released.push('worker'),
    ],
    (e) => failures.push(e),
  );
  assert.deepEqual(released, ['listener', 'worker']);
  assert.equal(failures.length, 1);
});
