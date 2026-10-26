import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workspaceReferenceRule } from '../lib/file-reference.js';
import { referenceText, nodeKind, contentKinds } from '../lib/model.js';
test('file renderer recognizes exact stable wire identity without altering surrounding message', () => {
  const file = {
    name: 'Release plan',
    nodeId: 'node-1',
    resourceId: 'resource-1',
    unitId: 'unit-1',
  };
  const text = `Before ${referenceText(file)} after`,
    node = workspaceReferenceRule.match(text, 0);
  assert.equal(text.slice(node.start, node.end), referenceText(file));
  assert.deepEqual(node.data, {
    label: file.name,
    nodeId: file.nodeId,
    resourceId: file.resourceId,
    unitId: file.unitId,
  });
  assert.equal(workspaceReferenceRule.match(text, node.end), undefined);
});
test('malformed, foreign and incomplete references stay ordinary visible text', () => {
  for (const text of [
    '[x](https://example.com/?nodeId=a&unitId=b)',
    '[x](workspace-file://r?nodeId=a)',
    '[x](workspace-file://r?nodeId=&unitId=b)',
    '[x](workspace-file://a:r@host?nodeId=a&unitId=b)',
    '[x](workspace-file://%ZZ?nodeId=a&unitId=b)',
  ])
    assert.equal(workspaceReferenceRule.match(text, 0), undefined);
});
test('content categories keep HTML Views distinct from Docs, folders and ordinary HTML', () => {
  assert.equal(contentKinds.length, 6);
  assert.equal(
    nodeKind({ resource: { kind: 'univer', unitType: 'doc' } }),
    'doc',
  );
  assert.equal(
    nodeKind({ resource: { kind: 'blob', mediaType: 'text/html' } }),
    'file',
  );
  assert.equal(
    nodeKind({
      resource: { kind: 'blob', mediaType: 'text/html', htmlView: true },
    }),
    'site',
  );
  assert.equal(nodeKind({ resource: null }), 'folder');
  for (const unitType of ['doc', 'sheet', 'slide', 'board', 'base'])
    assert.equal(
      nodeKind({ resource: { kind: 'univer', unitType } }),
      unitType,
    );
});

test('file reference labels preserve brackets and backslashes without breaking identity recognition', () => {
  const file = {
    name: 'Plan [draft] \\ final',
    nodeId: 'n',
    resourceId: 'r',
    unitId: 'u',
  };
  assert.equal(
    workspaceReferenceRule.match(referenceText(file), 0).data.label,
    file.name,
  );
});
