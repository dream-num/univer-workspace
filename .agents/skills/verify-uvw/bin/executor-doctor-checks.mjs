import assert from 'node:assert/strict';

export function assertWorkerCount(count) {
  assert(Number.isInteger(count) && count > 0, 'at least one live worker must be inspected');
}

export function assertLogsExclude(logs, secrets) {
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length > 0) assert(!logs.includes(secret), 'logs exclude credentials and license values');
  }
}
