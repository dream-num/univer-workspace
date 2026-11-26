import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  supportsHostNavigation,
  installHostNavigation,
} from '../lib/host-layout.js';
const rc1 = { version: '0.2.2-rc.1', commit: 'c59d10a' };
const rc5 = { version: '0.2.2-rc.5', commit: '3f85d88' };
const known = (release = rc1) => ({
  release: { ...release },
  entries: [
    { id: '@deepseek-ai/dsh-client-ui-sidebar', rev: 'opaque-cache-revision' },
    { id: '@deepseek-ai/dsh-client-ui-layout', rev: 'another-cache-revision' },
  ],
});
test('Module cache revisions may change without changing the supported release', () => {
  for (const release of [rc1, rc5]) {
    const graph = known(release);
    graph.entries.forEach((entry) => { entry.rev = 'after-cold-restart'; });
    assert.equal(supportsHostNavigation(graph), true);
  }
});
test('only the observed version and commit pairs select a sidebar adapter', () => {
  for (const [release, other] of [[rc1, rc5], [rc5, rc1]]) {
    assert.equal(supportsHostNavigation(known(release)), true);
    for (const commit of [other.commit, release.commit + '-unrelated-build',
      '66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db']) {
      assert.equal(supportsHostNavigation(known({ ...release, commit })), false);
    }
    for (const entry of known(release).entries)
      assert.equal(supportsHostNavigation({ release, entries: [entry] }), false);
  }
});
test('Host integration fails closed before DOM access on unknown release or missing module metadata', () => {
  const wrongRelease = known();
  wrongRelease.release.version = '0.2.2';
  const wrongCommit = known();
  wrongCommit.release.commit = 'other';
  const wrongArtifact = known();
  wrongArtifact.entries[0].id = 'other';
  for (const graph of [
    undefined,
    null,
    {},
    wrongRelease,
    wrongCommit,
    wrongArtifact,
    { release: known().release, entries: [null] },
    { ...known(), entries: [] },
  ]) {
    assert.equal(supportsHostNavigation(graph), false);
    assert.equal(
      installHostNavigation(
        new Proxy({}, { get() { throw Error('Unknown Host must never be queried or patched'); } }),
        {
          graph,
          active: () => null,
          toggle() {
            throw Error('Must not toggle Host');
          },
          collapsed() {},
        },
      ),
      null,
    );
  }
});
