import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  navigationHost,
  supportsHostNavigation,
  installHostNavigation,
} from '../lib/host-layout.js';
const known = () => ({
  release: { version: navigationHost.version, commit: navigationHost.commit },
  entries: [
    { id: '@deepseek-ai/dsh-client-ui-sidebar', rev: 'opaque-cache-revision' },
    { id: '@deepseek-ai/dsh-client-ui-layout', rev: 'another-cache-revision' },
  ],
});
test('Module cache revisions may change without changing the supported release', () => {
  const graph = known();
  graph.entries.forEach((entry) => {
    entry.rev = 'after-cold-restart';
  });
  assert.equal(supportsHostNavigation(graph), true);
});
test('Desktop full commit and Web short commit identify the same exact supported release', () => {
  const graph = known();
  graph.release.commit = navigationHost.fullCommit;
  assert.equal(supportsHostNavigation(graph), true);
  graph.release.commit = navigationHost.commit + '-unrelated-build';
  assert.equal(supportsHostNavigation(graph), false);
});
test('Host integration fails closed before DOM access on unknown release or missing module metadata', () => {
  assert.equal(supportsHostNavigation(known()), true);
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
        {
          closest() {
            throw Error('Unknown Host must never be queried or patched');
          },
        },
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
