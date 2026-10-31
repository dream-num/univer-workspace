import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { disposeEditorResources, EditorResources } from '../lib/editor-lifecycle.js';

// Execute the actual effect cleanup body with instrumented SDK/Host boundaries.
// This covers the outer call site that helper-only tests cannot exercise.
function cleanupBody(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const start = source.search(/    return \(\) => \{\n(?:      if \(canceled\) return;\n)?      canceled = true;/);
  const end = source.indexOf('\n    };\n  },', start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start + '    return () => {'.length, end);
}
const body = cleanupBody('../src/collaborative-editor.tsx');

for (const failure of [undefined, 'selection', 'disposable', 'subscription', 'runtime', 'worker', 'abort', 'flush']) {
  test(`editor unmount preserves flush order and completes cleanup: ${failure ?? 'normal'}`, async t => {
    const calls = [], errors = [];
    t.mock.method(console, 'error', (...args) => errors.push(args));
    const action = name => () => { calls.push(name); if (failure === name) throw new Error(`injected ${name}`); };
    const resources = new EditorResources();
    const env = {
      canceled: false, cancelingLoad: false, startup: Promise.resolve(), closingEditor: undefined,
      selectionEditingBinding: { dispose: action('selection') }, setSelectionEditing: action('state'),
      face: { updateDocFocus: action('focus'), update: action('cache-notice') }, focusChannel: 'channel',
      publishComments: action('comments'), publishMembers: action('members'),
      releaseEditor: resources.bind('node', { flush: async () => {}, isSaved: () => true }),
      transport: { drainWrites: action('writes'), drain: action('drain') },
      docState: { flushPendingChanges: action('doc-flush') }, needsFlush: async () => true,
      runtime: { univerAPI: { getCollaboration: () => ({ flush: action('flush') }), disposeUnit: action('unit') },
        univer: { dispose: action('runtime'), __getInjector: () => ({ get: () => ({ exhaustSavingTask: async () => action('cache')() }) }) } },
      ILocalCacheService: {}, matchesView: () => true, file: { unitId: 'unit' },
      disposables: [{ dispose: action('disposable') }], subscriptions: [{ unsubscribe: action('subscription') }],
      embedProducts: { dispose: action('embed') }, editorWorker: { terminate: action('worker') },
      abort: { abort: action('abort') }, beforeUnload() {},
      window: { removeEventListener: action('beforeunload') }, disposeEditorResources,
    };
    const cleanup = new Function('env', `with (env) { return () => {${body}\n}; }`)(env);
    cleanup();
    assert.equal(resources.current, null);
    const barrier = env.closingEditor;
    cleanup();
    assert.equal(env.closingEditor, barrier);
    await barrier;
    assert.deepEqual(calls, ['selection', 'state', 'focus', 'comments', 'members', 'writes', 'doc-flush', 'flush',
      ...(failure === 'flush' ? ['cache', 'cache-notice'] : []), 'disposable', 'unit', 'abort', 'drain',
      'beforeunload', 'subscription', 'embed', 'runtime', 'worker']);
    assert.equal(errors.length, failure && failure !== 'flush' ? 1 : 0);
    const release = resources.bind('node', { flush: async () => {}, isSaved: () => true });
    assert.ok(resources.current); release();
  });
}

test('detached Viewer releases observers, frame and runtime after a lifecycle disposer throws', async t => {
  const calls = [], errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args));
  const body = cleanupBody('../src/viewer.tsx');
  const env = { canceled: false, timer: 1, fitFrame: 2,
    clearTimeout: () => calls.push('timer'), cancelAnimationFrame: () => calls.push('frame'),
    lifecycle: { dispose() { calls.push('lifecycle'); throw new Error('injected lifecycle'); } },
    steadyLifecycle: { dispose: () => calls.push('steady') }, fitObserver: { disconnect: () => calls.push('observer') },
    runtime: { univer: { dispose: () => calls.push('runtime') } }, disposeEditorResources,
  };
  const cleanup = new Function('env', `with (env) { return () => {${body}\n}; }`)(env);
  cleanup(); cleanup(); await Promise.resolve();
  assert.deepEqual(calls, ['timer', 'lifecycle', 'steady', 'observer', 'frame', 'runtime']);
  assert.equal(errors.length, 1);
});
