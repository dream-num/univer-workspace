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
      { UniverDocsLatexPlugin },
      { UniverDocsLatexUIPlugin },
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
      import("@univerjs-pro/docs-latex"),
      import("@univerjs-pro/docs-latex-ui"),
      import("@univerjs-pro/docs-shape"),
      import("@univerjs-pro/docs-shape-ui"),
      import("@univerjs-pro/docs-table"),
      import("@univerjs-pro/docs-table-ui"),
      import("@univerjs-pro/engine-formula"),
      import("../../web/src/features/editor/doc-features.js"),
    ]);
    const expectedPlugins = [
      UniverDocsCalloutPlugin,
      UniverDocsChartPlugin,
      UniverDocsCodePlugin,
      UniverDocsLatexPlugin,
      UniverDocsShapePlugin,
      UniverDocsTablePlugin,
    ];
    expect(getDocReplayCompatibilityPlugins()).toEqual(expectedPlugins);
    expect(getDocAuthoringUIPlugins()).toEqual([
      UniverProFormulaEnginePlugin,
      UniverDocsCalloutUIPlugin,
      UniverDocsChartUIPlugin,
      UniverDocsCodeUIPlugin,
      UniverDocsLatexUIPlugin,
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
        { id: "docs-latex.mutation.set-formula" },
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
        UniverWorkspaceDocsThreadCommentDataSourcePlugin,
        deleteDocRootCommentBody,
        getDocThreadCommentCollaborationPlugins,
        getThreadCommentCollaborationPlugins,
      },
      { DeleteDocCommentComment },
    ] = await Promise.all([
      import("@univerjs-pro/thread-comment-datasource"),
      import("../../web/src/features/editor/thread-comment-features.js"),
      import("@univerjs/docs-thread-comment-ui"),
    ]);

    expect(getThreadCommentCollaborationPlugins()).toEqual([
      UniverThreadCommentDataSourcePlugin,
    ]);
    expect(getThreadCommentCollaborationPlugins(false)).toEqual([]);
    expect(getDocThreadCommentCollaborationPlugins()).toEqual([
      UniverWorkspaceDocsThreadCommentDataSourcePlugin,
    ]);
    expect(getDocThreadCommentCollaborationPlugins(false)).toEqual([]);

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

function installBrowserShapeStubs(): void {
  Object.defineProperty(globalThis, "Path2D", {
    configurable: true,
    value: class Path2D {},
  });
}
