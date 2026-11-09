import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertWorkerCount, assertLogsExclude } from './executor-doctor-checks.mjs';

test('worker inspection fails closed when none are inspected', () => {
  for (const count of [0, -1, NaN]) assert.throws(() => assertWorkerCount(count));
  assertWorkerCount(1);
});
test('log inspection rejects license or token leaks', () => {
  for (const secret of ['license-value', 'license-key', 'executor-token']) {
    assert.throws(() => assertLogsExclude('prefix ' + secret, [secret]));
  }
  assertLogsExclude('safe metadata', ['license-value', 'license-key', '', undefined]);
});
