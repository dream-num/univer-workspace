import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerApiTool } from '../lib/api-tool.js';

test('original Univer API tool returns version-matched Facade reference entries', async () => {
  let definition;
  registerApiTool({ tools: { register(value) { definition = value; return () => {}; } } });
  const result = await definition.execute({ action: 'show', queries: ['FRange.setValue'] });
  assert.equal(result.ok, true);
  assert.equal(result.operation, 'api');
  assert.equal(result.result[0].status, 'found');
  await assert.rejects(definition.execute({ action: 'find', queries: [] }), /non-empty query/);
});
