import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertInternalOnly, assertUnreachable } from './renderer-doctor-checks.mjs';

test('renderer network must be a single internal network', () => {
  assertInternalOnly({ render: { Internal: true } });
  assert.throws(() => assertInternalOnly({ render: { Internal: false } }));
  assert.throws(() => assertInternalOnly({ render: { Internal: true }, default: { Internal: false } }));
  assert.throws(() => assertInternalOnly({}));
});
test('every renderer probe must be blocked', () => {
  assertUnreachable({ internet: 'blocked', workspace: 'blocked' });
  assert.throws(() => assertUnreachable({ internet: 'blocked', workspace: 'reached 200' }));
  assert.throws(() => assertUnreachable({}));
});
