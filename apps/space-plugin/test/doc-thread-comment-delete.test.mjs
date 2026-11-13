import assert from 'node:assert/strict';
import test from 'node:test';
import { DeleteDocCommentComment } from '@univerjs/docs-thread-comment-ui';
import { deleteDocRootCommentBody } from '../src/workarounds/doc-thread-comment-delete.ts';

const OTHER_COMMAND_ID = 'docs.command.not-the-delete-comment';

const CASES = [
  {
    name: 'returns false without touching the model when the command id is not the delete comment command',
    commandId: 'other',
    params: { unitId: 'unit-1', commentId: 'param-comment-1' },
    expected: { resolves: false, modelCalls: 0, dataSourceCalls: 0 },
  },
  {
    name: 'returns false when the command params are missing',
    commandId: 'target',
    params: undefined,
    expected: { resolves: false, modelCalls: 0, dataSourceCalls: 0 },
  },
  {
    name: 'returns false when the command params are null',
    commandId: 'target',
    params: null,
    expected: { resolves: false, modelCalls: 0, dataSourceCalls: 0 },
  },
  {
    name: 'returns false when the unit id is missing',
    commandId: 'target',
    params: { commentId: 'param-comment-1' },
    expected: { resolves: false, modelCalls: 0, dataSourceCalls: 0 },
  },
  {
    name: 'returns false when the comment id is missing',
    commandId: 'target',
    params: { unitId: 'unit-1' },
    expected: { resolves: false, modelCalls: 0, dataSourceCalls: 0 },
  },
  {
    name: 'returns false when the unit id is not a string',
    commandId: 'target',
    params: { unitId: 1, commentId: 'param-comment-1' },
    expected: { resolves: false, modelCalls: 0, dataSourceCalls: 0 },
  },
  {
    name: 'returns false when the comment id is not a string',
    commandId: 'target',
    params: { unitId: 'unit-1', commentId: 1 },
    expected: { resolves: false, modelCalls: 0, dataSourceCalls: 0 },
  },
  {
    name: 'looks the comment up with empty string params instead of rejecting them',
    commandId: 'target',
    params: { unitId: '', commentId: '' },
    model: { returns: undefined },
    expected: {
      resolves: false,
      modelCalls: 1,
      modelArgs: [['', 'default_doc', '']],
      dataSourceCalls: 0,
    },
  },
  {
    name: 'deletes the comment returned by the model for empty string params',
    commandId: 'target',
    params: { unitId: '', commentId: '' },
    model: { returns: { id: 'model-comment-1', threadId: 'model-thread-1' } },
    dataSource: { returns: true },
    expected: {
      resolves: true,
      modelCalls: 1,
      modelArgs: [['', 'default_doc', '']],
      dataSourceCalls: 1,
      dataSourceArgs: [['', 'default_doc', 'model-thread-1', 'model-comment-1']],
    },
  },
  {
    name: 'returns false when the model cannot find the comment',
    commandId: 'target',
    params: { unitId: 'unit-1', commentId: 'param-comment-1' },
    model: { returns: undefined },
    expected: {
      resolves: false,
      modelCalls: 1,
      modelArgs: [['unit-1', 'default_doc', 'param-comment-1']],
      dataSourceCalls: 0,
    },
  },
  {
    name: 'deletes a root comment with the thread id and comment id reported by the model',
    commandId: 'target',
    params: { unitId: 'unit-1', commentId: 'param-comment-1' },
    model: { returns: { id: 'model-comment-1', threadId: 'model-thread-1' } },
    dataSource: { returns: true },
    expected: {
      resolves: true,
      modelCalls: 1,
      modelArgs: [['unit-1', 'default_doc', 'param-comment-1']],
      dataSourceCalls: 1,
      dataSourceArgs: [['unit-1', 'default_doc', 'model-thread-1', 'model-comment-1']],
    },
  },
  {
    name: 'treats an empty parent id as a root comment',
    commandId: 'target',
    params: { unitId: 'unit-1', commentId: 'param-comment-1' },
    model: {
      returns: {
        id: 'model-comment-1',
        threadId: 'model-thread-1',
        parentId: '',
      },
    },
    dataSource: { returns: true },
    expected: {
      resolves: true,
      modelCalls: 1,
      modelArgs: [['unit-1', 'default_doc', 'param-comment-1']],
      dataSourceCalls: 1,
      dataSourceArgs: [['unit-1', 'default_doc', 'model-thread-1', 'model-comment-1']],
    },
  },
  {
    name: 'skips a reply comment that carries a truthy parent id',
    commandId: 'target',
    params: { unitId: 'unit-1', commentId: 'param-comment-1' },
    model: {
      returns: {
        id: 'model-comment-2',
        threadId: 'model-thread-1',
        parentId: 'model-parent-1',
      },
    },
    expected: {
      resolves: false,
      modelCalls: 1,
      modelArgs: [['unit-1', 'default_doc', 'param-comment-1']],
      dataSourceCalls: 0,
    },
  },
  {
    name: 'resolves false when the datasource refuses the deletion',
    commandId: 'target',
    params: { unitId: 'unit-1', commentId: 'param-comment-1' },
    model: { returns: { id: 'model-comment-1', threadId: 'model-thread-1' } },
    dataSource: { returns: false },
    expected: {
      resolves: false,
      modelCalls: 1,
      modelArgs: [['unit-1', 'default_doc', 'param-comment-1']],
      dataSourceCalls: 1,
      dataSourceArgs: [['unit-1', 'default_doc', 'model-thread-1', 'model-comment-1']],
    },
  },
  {
    name: 'propagates a datasource rejection',
    commandId: 'target',
    params: { unitId: 'unit-1', commentId: 'param-comment-1' },
    model: { returns: { id: 'model-comment-1', threadId: 'model-thread-1' } },
    dataSource: { throws: new Error('datasource rejected the deletion') },
    expected: {
      rejectsMessage: 'datasource rejected the deletion',
      modelCalls: 1,
      modelArgs: [['unit-1', 'default_doc', 'param-comment-1']],
      dataSourceCalls: 1,
      dataSourceArgs: [['unit-1', 'default_doc', 'model-thread-1', 'model-comment-1']],
    },
  },
  {
    name: 'propagates a model exception',
    commandId: 'target',
    params: { unitId: 'unit-1', commentId: 'param-comment-1' },
    model: { throws: new Error('model lookup failed') },
    expected: {
      rejectsMessage: 'model lookup failed',
      modelCalls: 1,
      modelArgs: [['unit-1', 'default_doc', 'param-comment-1']],
      dataSourceCalls: 0,
    },
  },
];

for (const testCase of CASES) {
  test(testCase.name, async () => {
    const modelCalls = [];
    const dataSourceCalls = [];

    const model = {
      getComment(unitId, subUnitId, commentId) {
        modelCalls.push([unitId, subUnitId, commentId]);
        if (testCase.model?.throws) throw testCase.model.throws;
        return testCase.model?.returns;
      },
    };
    const dataSource = {
      deleteComment(...args) {
        dataSourceCalls.push(args);
        if (testCase.dataSource?.throws) {
          return Promise.reject(testCase.dataSource.throws);
        }
        return Promise.resolve(testCase.dataSource?.returns ?? false);
      },
    };

    const commandInfo = {
      id:
        testCase.commandId === 'target'
          ? DeleteDocCommentComment.id
          : OTHER_COMMAND_ID,
      params: testCase.params,
    };

    const pending = deleteDocRootCommentBody(commandInfo, { dataSource, model });

    if (testCase.expected.rejectsMessage) {
      await assert.rejects(pending, new RegExp(testCase.expected.rejectsMessage));
    } else {
      assert.equal(await pending, testCase.expected.resolves);
    }

    assert.equal(modelCalls.length, testCase.expected.modelCalls);
    if (testCase.expected.modelArgs) {
      assert.deepEqual(modelCalls, testCase.expected.modelArgs);
    }
    assert.equal(dataSourceCalls.length, testCase.expected.dataSourceCalls);
    if (testCase.expected.dataSourceArgs) {
      assert.deepEqual(dataSourceCalls, testCase.expected.dataSourceArgs);
    }
  });
}
