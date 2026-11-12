import { describe, expect, it, vi } from "vitest";

describe("Workspace Doc feature plugins", () => {
  it("keeps the browser replay surface aligned with the server", async () => {
    installBrowserShapeStubs();
    const [
      {
        ICommandService,
        LocaleType,
        LogLevel,
        Univer,
        UniverInstanceType,
        getDocsEmptySnapshot,
      },
      { UniverDocsPlugin },
      { SetDocsCalloutConfigMutation, UniverDocsCalloutPlugin },
      { UniverDocsCalloutUIPlugin },
      { SetDocChartDataSourceMutation, UniverDocsChartPlugin },
      { UniverDocsChartUIPlugin },
      { SetDocsCodeConfigMutation, UniverDocsCodePlugin },
      { UniverDocsCodeUIPlugin },
      { InsertDocColumnGroupCommand, UniverDocsColumnPlugin },
      { UniverDocsColumnUIPlugin },
      { UniverDocsLatexPlugin },
      { UniverDocsLatexUIPlugin },
      { DocsListInsertCommand, UniverDocsListPlugin },
      { UniverDocsListUIPlugin },
      { DocsQuoteInsertCommand, UniverDocsQuotePlugin },
      { UniverDocsQuoteUIPlugin },
      { InsertDocShapeMutation, UniverDocsShapePlugin },
      { UniverDocsShapeUIPlugin },
      { DocsTableInsertTableCommand, UniverDocsTablePlugin },
      { UniverDocsTableUIPlugin },
      { UniverProFormulaEnginePlugin },
      {
        getDocAuthoringUIPlugins,
        getDocReplayCompatibilityPlugins,
      },
    ] = await Promise.all([
      import("@univerjs/core"),
      import("@univerjs/docs"),
      import("@univerjs-pro/docs-callout"),
      import("@univerjs-pro/docs-callout-ui"),
      import("@univerjs-pro/docs-chart"),
      import("@univerjs-pro/docs-chart-ui"),
      import("@univerjs-pro/docs-code"),
      import("@univerjs-pro/docs-code-ui"),
      import("@univerjs-pro/docs-column"),
      import("@univerjs-pro/docs-column-ui"),
      import("@univerjs-pro/docs-latex"),
      import("@univerjs-pro/docs-latex-ui"),
      import("@univerjs-pro/docs-list"),
      import("@univerjs-pro/docs-list-ui"),
      import("@univerjs-pro/docs-quote"),
      import("@univerjs-pro/docs-quote-ui"),
      import("@univerjs-pro/docs-shape"),
      import("@univerjs-pro/docs-shape-ui"),
      import("@univerjs-pro/docs-table"),
      import("@univerjs-pro/docs-table-ui"),
      import("@univerjs-pro/engine-formula"),
      import("../../web/src/features/editor/units/doc/doc-features.js"),
    ]);
    const expectedPlugins = [
      UniverDocsCalloutPlugin,
      UniverDocsChartPlugin,
      UniverDocsCodePlugin,
      UniverDocsColumnPlugin,
      UniverDocsLatexPlugin,
      UniverDocsListPlugin,
      UniverDocsQuotePlugin,
      UniverDocsShapePlugin,
      UniverDocsTablePlugin,
    ];
    expect(getDocReplayCompatibilityPlugins()).toEqual(expectedPlugins);
    expect(getDocAuthoringUIPlugins()).toEqual([
      UniverProFormulaEnginePlugin,
      UniverDocsCalloutUIPlugin,
      UniverDocsChartUIPlugin,
      UniverDocsCodeUIPlugin,
      UniverDocsColumnUIPlugin,
      UniverDocsLatexUIPlugin,
      UniverDocsListUIPlugin,
      UniverDocsQuoteUIPlugin,
      UniverDocsShapeUIPlugin,
      UniverDocsTableUIPlugin,
    ]);

    const univer = new Univer({
      locale: LocaleType.EN_US,
      logLevel: LogLevel.SILENT,
    });
    try {
      univer.registerPlugin(UniverDocsPlugin);
      for (const plugin of expectedPlugins) {
        univer.registerPlugin(plugin);
      }
      univer.createUnit(
        UniverInstanceType.UNIVER_DOC,
        getDocsEmptySnapshot("doc-feature-runtime-test")
      );

      const commandService = univer.__getInjector().get(ICommandService);
      for (const command of [
        SetDocsCalloutConfigMutation,
        SetDocChartDataSourceMutation,
        SetDocsCodeConfigMutation,
        InsertDocColumnGroupCommand,
        { id: "docs-latex.mutation.set-formula" },
        DocsListInsertCommand,
        DocsQuoteInsertCommand,
        InsertDocShapeMutation,
        DocsTableInsertTableCommand,
      ]) {
        expect(commandService.hasCommand(command.id), command.id).toBe(true);
      }
    } finally {
      univer.dispose();
    }
  }, 20_000);

  it("uses the browser comment datasource instead of the server resource plugin", async () => {
    installBrowserShapeStubs();
    const [
      { UniverThreadCommentDataSourcePlugin },
      {
        getThreadCommentCollaborationPlugins,
      },
      {
        UniverWorkspaceDocsThreadCommentDataSourcePlugin,
        deleteDocRootCommentBody,
        getDocThreadCommentCollaborationPlugins,
      },
      { DeleteDocCommentComment },
    ] = await Promise.all([
      import("@univerjs-pro/thread-comment-datasource"),
      import("../../web/src/features/editor/features/thread-comment-features.js"),
      import(
        "../../web/src/features/editor/workarounds/doc-thread-comment-delete.js"
      ),
      import("@univerjs/docs-thread-comment-ui"),
    ]);

    expect(getThreadCommentCollaborationPlugins()).toEqual([
      UniverThreadCommentDataSourcePlugin,
    ]);
    expect(getDocThreadCommentCollaborationPlugins()).toEqual([
      UniverWorkspaceDocsThreadCommentDataSourcePlugin,
    ]);

    const deleteComment = vi.fn(async () => true);
    const rootComment = {
      id: "comment-1",
      threadId: "thread-1",
    };
    const getComment = vi.fn(() => rootComment);

    await expect(
      deleteDocRootCommentBody(
        {
          id: DeleteDocCommentComment.id,
          params: {
            unitId: "doc-1",
            commentId: rootComment.id,
          },
        },
        {
          dataSource: { deleteComment },
          model: { getComment },
        }
      )
    ).resolves.toBe(true);
    expect(deleteComment).toHaveBeenCalledWith(
      "doc-1",
      "default_doc",
      "thread-1",
      "comment-1"
    );

    getComment.mockReturnValueOnce({
      ...rootComment,
      parentId: "comment-parent",
    });
    await expect(
      deleteDocRootCommentBody(
        {
          id: DeleteDocCommentComment.id,
          params: {
            unitId: "doc-1",
            commentId: rootComment.id,
          },
        },
        {
          dataSource: { deleteComment },
          model: { getComment },
        }
      )
    ).resolves.toBe(false);
    expect(deleteComment).toHaveBeenCalledTimes(1);
  }, 20_000);
});

type RootComment = { id: string; threadId: string; parentId?: string };

type MatrixCase = {
  name: string;
  commandId: "target" | "other";
  params: unknown;
  model?: { returns: RootComment | undefined; throws?: Error };
  dataSource?: { returns?: boolean; throws?: Error };
  expected: {
    resolves?: boolean;
    rejectsMessage?: string;
    modelCalls: number;
    modelArgs?: unknown[][];
    dataSourceCalls: number;
    dataSourceArgs?: unknown[][];
  };
};

const DOC_COMMENT_DELETE_CASES: MatrixCase[] = [
  {
    name: "returns false without touching the model when the command id is not the delete comment command",
    commandId: "other",
    params: { unitId: "unit-1", commentId: "param-comment-1" },
    expected: { resolves: false, modelCalls: 0, dataSourceCalls: 0 },
  },
  {
    name: "returns false when the command params are missing",
    commandId: "target",
    params: undefined,
    expected: { resolves: false, modelCalls: 0, dataSourceCalls: 0 },
  },
  {
    name: "returns false when the command params are null",
    commandId: "target",
    params: null,
    expected: { resolves: false, modelCalls: 0, dataSourceCalls: 0 },
  },
  {
    name: "returns false when the unit id is missing",
    commandId: "target",
    params: { commentId: "param-comment-1" },
    expected: { resolves: false, modelCalls: 0, dataSourceCalls: 0 },
  },
  {
    name: "returns false when the comment id is missing",
    commandId: "target",
    params: { unitId: "unit-1" },
    expected: { resolves: false, modelCalls: 0, dataSourceCalls: 0 },
  },
  {
    name: "returns false when the unit id is not a string",
    commandId: "target",
    params: { unitId: 1, commentId: "param-comment-1" },
    expected: { resolves: false, modelCalls: 0, dataSourceCalls: 0 },
  },
  {
    name: "returns false when the comment id is not a string",
    commandId: "target",
    params: { unitId: "unit-1", commentId: 1 },
    expected: { resolves: false, modelCalls: 0, dataSourceCalls: 0 },
  },
  {
    name: "looks the comment up with empty string params instead of rejecting them",
    commandId: "target",
    params: { unitId: "", commentId: "" },
    model: { returns: undefined },
    expected: {
      resolves: false,
      modelCalls: 1,
      modelArgs: [["", "default_doc", ""]],
      dataSourceCalls: 0,
    },
  },
  {
    name: "deletes the comment returned by the model for empty string params",
    commandId: "target",
    params: { unitId: "", commentId: "" },
    model: { returns: { id: "model-comment-1", threadId: "model-thread-1" } },
    dataSource: { returns: true },
    expected: {
      resolves: true,
      modelCalls: 1,
      modelArgs: [["", "default_doc", ""]],
      dataSourceCalls: 1,
      dataSourceArgs: [["", "default_doc", "model-thread-1", "model-comment-1"]],
    },
  },
  {
    name: "returns false when the model cannot find the comment",
    commandId: "target",
    params: { unitId: "unit-1", commentId: "param-comment-1" },
    model: { returns: undefined },
    expected: {
      resolves: false,
      modelCalls: 1,
      modelArgs: [["unit-1", "default_doc", "param-comment-1"]],
      dataSourceCalls: 0,
    },
  },
  {
    name: "deletes a root comment with the thread id and comment id reported by the model",
    commandId: "target",
    params: { unitId: "unit-1", commentId: "param-comment-1" },
    model: { returns: { id: "model-comment-1", threadId: "model-thread-1" } },
    dataSource: { returns: true },
    expected: {
      resolves: true,
      modelCalls: 1,
      modelArgs: [["unit-1", "default_doc", "param-comment-1"]],
      dataSourceCalls: 1,
      dataSourceArgs: [
        ["unit-1", "default_doc", "model-thread-1", "model-comment-1"],
      ],
    },
  },
  {
    name: "treats an empty parent id as a root comment",
    commandId: "target",
    params: { unitId: "unit-1", commentId: "param-comment-1" },
    model: {
      returns: {
        id: "model-comment-1",
        threadId: "model-thread-1",
        parentId: "",
      },
    },
    dataSource: { returns: true },
    expected: {
      resolves: true,
      modelCalls: 1,
      modelArgs: [["unit-1", "default_doc", "param-comment-1"]],
      dataSourceCalls: 1,
      dataSourceArgs: [
        ["unit-1", "default_doc", "model-thread-1", "model-comment-1"],
      ],
    },
  },
  {
    name: "skips a reply comment that carries a truthy parent id",
    commandId: "target",
    params: { unitId: "unit-1", commentId: "param-comment-1" },
    model: {
      returns: {
        id: "model-comment-2",
        threadId: "model-thread-1",
        parentId: "model-parent-1",
      },
    },
    expected: {
      resolves: false,
      modelCalls: 1,
      modelArgs: [["unit-1", "default_doc", "param-comment-1"]],
      dataSourceCalls: 0,
    },
  },
  {
    name: "resolves false when the datasource refuses the deletion",
    commandId: "target",
    params: { unitId: "unit-1", commentId: "param-comment-1" },
    model: { returns: { id: "model-comment-1", threadId: "model-thread-1" } },
    dataSource: { returns: false },
    expected: {
      resolves: false,
      modelCalls: 1,
      modelArgs: [["unit-1", "default_doc", "param-comment-1"]],
      dataSourceCalls: 1,
      dataSourceArgs: [
        ["unit-1", "default_doc", "model-thread-1", "model-comment-1"],
      ],
    },
  },
  {
    name: "propagates a datasource rejection",
    commandId: "target",
    params: { unitId: "unit-1", commentId: "param-comment-1" },
    model: { returns: { id: "model-comment-1", threadId: "model-thread-1" } },
    dataSource: { throws: new Error("datasource rejected the deletion") },
    expected: {
      rejectsMessage: "datasource rejected the deletion",
      modelCalls: 1,
      modelArgs: [["unit-1", "default_doc", "param-comment-1"]],
      dataSourceCalls: 1,
      dataSourceArgs: [
        ["unit-1", "default_doc", "model-thread-1", "model-comment-1"],
      ],
    },
  },
  {
    name: "propagates a model exception",
    commandId: "target",
    params: { unitId: "unit-1", commentId: "param-comment-1" },
    model: { returns: undefined, throws: new Error("model lookup failed") },
    expected: {
      rejectsMessage: "model lookup failed",
      modelCalls: 1,
      modelArgs: [["unit-1", "default_doc", "param-comment-1"]],
      dataSourceCalls: 0,
    },
  },
];

describe("Doc root comment delete workaround behavior", () => {
  it.each(DOC_COMMENT_DELETE_CASES)(
    "$name",
    async (testCase) => {
      const { DeleteDocCommentComment, deleteDocRootCommentBody } =
        await loadDocCommentDeleteWorkaround();

      const modelCalls: unknown[][] = [];
      const dataSourceCalls: unknown[][] = [];

      const getComment = vi.fn(
        (unitId: string, subUnitId: string, commentId: string) => {
          modelCalls.push([unitId, subUnitId, commentId]);
          const modelCase = testCase.model;
          if (modelCase?.throws) {
            throw modelCase.throws;
          }
          return modelCase?.returns;
        }
      );
      const deleteComment = vi.fn((...args: unknown[]) => {
        dataSourceCalls.push(args);
        const dataSourceCase = testCase.dataSource;
        if (dataSourceCase?.throws) {
          return Promise.reject(dataSourceCase.throws);
        }
        return Promise.resolve(dataSourceCase?.returns ?? false);
      });

      const commandInfo = {
        id:
          testCase.commandId === "target"
            ? DeleteDocCommentComment.id
            : "docs.command.not-the-delete-comment",
        params: testCase.params,
      } as unknown as Parameters<typeof deleteDocRootCommentBody>[0];
      const dependencies = {
        dataSource: { deleteComment },
        model: { getComment },
      };

      const pending = deleteDocRootCommentBody(commandInfo, dependencies);

      if (testCase.expected.rejectsMessage) {
        await expect(pending).rejects.toThrow(testCase.expected.rejectsMessage);
      } else {
        await expect(pending).resolves.toBe(testCase.expected.resolves);
      }

      expect(modelCalls).toHaveLength(testCase.expected.modelCalls);
      if (testCase.expected.modelArgs) {
        expect(modelCalls).toEqual(testCase.expected.modelArgs);
      }
      expect(dataSourceCalls).toHaveLength(testCase.expected.dataSourceCalls);
      if (testCase.expected.dataSourceArgs) {
        expect(dataSourceCalls).toEqual(testCase.expected.dataSourceArgs);
      }
    },
    20_000
  );
});

async function loadDocCommentDeleteWorkaround() {
  installBrowserShapeStubs();
  const [{ DeleteDocCommentComment }, { deleteDocRootCommentBody }] =
    await Promise.all([
      import("@univerjs/docs-thread-comment-ui"),
      import(
        "../../web/src/features/editor/workarounds/doc-thread-comment-delete.js"
      ),
    ]);
  return { DeleteDocCommentComment, deleteDocRootCommentBody };
}

function installBrowserShapeStubs(): void {
  Object.defineProperty(globalThis, "Path2D", {
    configurable: true,
    value: class Path2D {},
  });
}
