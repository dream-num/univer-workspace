import assert from 'node:assert/strict';
import test from 'node:test';
import { LocaleService, LocaleType } from '@univerjs/core';
import { bindEditorLanguage, editorLocale } from '../src/editor-language.ts';

function language(active = 'en') {
  let snapshot = { active }, listener, stopped = 0;
  return {
    getSnapshot: () => snapshot,
    subscribe(fn) { listener = fn; return () => { stopped++; }; },
    change(value) { snapshot = value; listener?.(); },
    lateNotification() { listener?.(); },
    get stopped() { return stopped; },
  };
}

test('editor language uses supported packs and the source-declared fallback chain', () => {
  for (const active of ['en', 'en-US']) assert.equal(editorLocale({ active }), LocaleType.EN_US);
  for (const active of ['zh', 'zh-CN', 'zh-Hans']) assert.equal(editorLocale({ active }), LocaleType.ZH_CN);
  assert.equal(editorLocale({ active: 'fr', locales: [{ id: 'fr', fallback: 'zh' }] }), LocaleType.ZH_CN);
  assert.equal(editorLocale({ active: 'zh-Hant', locales: [{ id: 'zh-Hant', fallback: 'en' }] }), LocaleType.EN_US);
  assert.equal(editorLocale({ active: 'unknown' }), LocaleType.EN_US);
  assert.equal(editorLocale({ active: 'a', locales: [{ id: 'a', fallback: 'b' }, { id: 'b', fallback: 'a' }] }), LocaleType.EN_US);
});

test('published SDK LocaleService updates dictionaries in place, deduplicates registry notifications and stops after cleanup', () => {
  const sdk = new LocaleService(), source = language(), changed = [];
  sdk.load({ [LocaleType.EN_US]: { test: { label: 'Home' } }, [LocaleType.ZH_CN]: { test: { label: '开始' } } });
  const target = { getCurrentLocale: () => sdk.getCurrentLocale(), setLocale(value) { changed.push(value); sdk.setLocale(value); } };
  const stop = bindEditorLanguage(target, source);
  assert.equal(sdk.t('test.label'), 'Home');
  source.change({ active: 'zh' });
  assert.equal(sdk.t('test.label'), '开始');
  source.change({ active: 'zh', revision: 10 });
  assert.equal(changed.length, 2);
  stop(); stop();
  assert.equal(source.stopped, 1);
  source.change({ active: 'en' });
  source.lateNotification();
  assert.equal(sdk.t('test.label'), '开始');
  sdk.dispose();
});

test('switch during SDK initialization is read after subscribing without a Unit reload', () => {
  const source = language('en'); let active = LocaleType.EN_US;
  const originalSubscribe = source.subscribe;
  source.subscribe = fn => { const stop = originalSubscribe(fn); source.change({ active: 'zh' }); return stop; };
  const calls = [];
  const stop = bindEditorLanguage({ getCurrentLocale: () => active, setLocale(value) { active = value; calls.push(value); } }, source);
  assert.equal(active, LocaleType.ZH_CN);
  assert.deepEqual(calls, [LocaleType.ZH_CN]);
  stop();
});
