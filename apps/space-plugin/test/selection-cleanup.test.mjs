import assert from 'node:assert/strict';
import test from 'node:test';
import { ICommandService, IUniverInstanceService } from '@univerjs/core';
import { DocSelectionManagerService } from '@univerjs/docs';
import { IMenuManagerService } from '@univerjs/ui';
import { SelectionEditing } from '../lib/selection-editing.js';

function fixture(failure) {
  const calls = [], callbacks = {};
  const action = name => () => {
    calls.push(name);
    if (name === failure) throw new Error(`injected ${name}`);
  };
  const observable = name => ({ subscribe(callback) {
    callbacks[name] = callback;
    return { unsubscribe: action(name) };
  } });
  const model = {};
  let registrations = 0;
  const services = new Map([
    [ICommandService, { registerCommand: () => ({ dispose: action(++registrations === 1 ? 'accept-command' : 'begin-command') }) }],
    [IMenuManagerService, { mergeMenu() {} }],
    [DocSelectionManagerService, { textSelection$: observable('selection') }],
    [IUniverInstanceService, { focused$: observable('focus') }],
  ]);
  const api = {
    getDocument: () => ({ getDocumentDataModel: () => model }),
    registerComponent: () => ({ dispose: action('component') }),
    Event: { BeforeCommandExecute: 'before-command' },
    addEvent: (_event, callback) => {
      callbacks.command = callback;
      return { dispose: action('command-listener') };
    },
  };
  const editor = new SelectionEditing({ __getInjector: () => ({ get: key => services.get(key) }) }, api,
    { unitId: 'unit' }, {}, action('input-gate'), async () => {});
  editor.request = { abort: action('abort') };
  editor.projection = { registration: { dispose: action('presentation') }, model: { dispose: action('projection-model') } };
  editor.popup = { dispose: action('popup') };
  editor.state = { phase: 'reviewing', target: {}, candidate: 'candidate' };
  editor.renderer = () => ({ render: { mainComponent: { makeDirty: action('render-dirty') } }, skeleton: {
    getViewModel: () => ({ reset: action('restore-model') }),
    getSkeleton: () => ({ makeDirty: action('skeleton-dirty') }),
    recalculate: action('recalculate'),
  } });
  editor.menuHidden.next = action('hide-menu');
  editor.menuHidden.complete = action('complete-menu');
  editor.listeners.add(action('notify'));
  return { editor, calls, callbacks };
}

const expected = ['abort', 'presentation', 'restore-model', 'skeleton-dirty', 'recalculate', 'render-dirty',
  'projection-model', 'input-gate', 'selection', 'focus', 'command-listener', 'accept-command', 'begin-command',
  'hide-menu', 'complete-menu', 'popup', 'component'];

for (const failure of [undefined, 'abort', 'presentation', 'restore-model', 'projection-model', 'selection', 'command-listener', 'popup']) {
  test(`Selection cleanup finishes independent releases: ${failure ?? 'normal'}`, t => {
    const errors = [];
    t.mock.method(console, 'error', (...args) => errors.push(args));
    const f = fixture(failure);
    assert.doesNotThrow(() => f.editor.dispose());
    const skipped = failure === 'restore-model' ? ['skeleton-dirty', 'recalculate', 'render-dirty'] : [];
    assert.deepEqual(f.calls, expected.filter(name => !skipped.includes(name)));
    assert.equal(errors.length, failure ? 1 : 0);
    if (failure) assert.match(errors[0][1].message, new RegExp(`injected ${failure}`));
    assert.equal(f.editor.listeners.size, 0);
    assert.equal(f.editor.projection, undefined);
    assert.equal(f.editor.popup, undefined);
    f.editor.dispose();
    assert.deepEqual(f.calls, expected.filter(name => !skipped.includes(name)));
  });
}

test('retained selection, focus, command and popup callbacks cannot touch a disposed editor', async () => {
  const f = fixture();
  f.editor.request = { abort: () => { f.calls.push('abort'); f.callbacks.focus('another-unit'); } };
  f.editor.dispose();
  const before = [...f.calls];
  f.editor.api.getDocument = () => { throw new Error('accessed disposed model'); };
  f.editor.clearProjection = () => { throw new Error('accessed disposed renderer'); };
  f.editor.captureSelection = () => { throw new Error('accessed disposed selection'); };
  f.callbacks.selection({ unitId: 'unit', subUnitId: 'unit' });
  f.callbacks.focus('another-unit');
  f.callbacks.command({ type: 2, params: { unitId: 'unit' } });
  f.editor.begin(); f.editor.cancel(); f.editor.undo();
  await f.editor.accept(); await f.editor.retrySync();
  f.editor.state = { phase: 'instruction', target: {} };
  await f.editor.submit('late request');
  f.editor.subscribe(() => { throw new Error('late listener'); })();
  assert.equal(f.editor.listeners.size, 0);
  assert.deepEqual(f.calls, before);
});
