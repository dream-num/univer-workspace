import { describe, expect, it } from "vitest";

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
      import("../../client/src/features/editor/doc-features.js"),
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
      { getThreadCommentCollaborationPlugins },
    ] = await Promise.all([
      import("@univerjs-pro/thread-comment-datasource"),
      import("../../client/src/features/editor/thread-comment-features.js"),
    ]);

    expect(getThreadCommentCollaborationPlugins()).toEqual([
      UniverThreadCommentDataSourcePlugin,
    ]);
  }, 20_000);
});

function installBrowserShapeStubs(): void {
  Object.defineProperty(globalThis, "Path2D", {
    configurable: true,
    value: class Path2D {},
  });
}
