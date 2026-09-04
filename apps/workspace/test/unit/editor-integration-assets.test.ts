import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const editorSources = {
  base: readEditorSource("base"),
  board: readEditorSource("board"),
  doc: readEditorSource("doc"),
  sheet: readEditorSource("sheet"),
  slide: readEditorSource("slide"),
};
const globalStyles = readFileSync(
  new URL("../../web/src/app/styles/global.css", import.meta.url),
  "utf8"
);

describe("editor integration assets", () => {
  it("loads shared styles before manual Plugin Mode product styles", () => {
    expect(globalStyles).toContain('@import "tailwindcss";');
    expect(globalStyles).toContain(
      '@import "@univer/unit-comparison-viewer/styles.css";'
    );
    expect(globalStyles.indexOf('@import "tailwindcss";')).toBeLessThan(
      globalStyles.indexOf(
        '@import "@univer/unit-comparison-viewer/styles.css";'
      )
    );
    expectImportsInOrder(editorSources.base, [
      "@univerjs/design/lib/index.css",
      "@univerjs/ui/lib/index.css",
      "@univerjs-pro/bases-ui/lib/index.css",
      "@univerjs-pro/bases-exchange-client/lib/index.css",
    ]);
    expectImportsInOrder(editorSources.slide, [
      "@univerjs/design/lib/index.css",
      "@univerjs/ui/lib/index.css",
      "@univerjs/docs-ui/lib/index.css",
      "@univerjs/drawing-ui/lib/index.css",
      "@univerjs-pro/chart-ui/lib/index.css",
      "@univerjs-pro/shape-editor-ui/lib/index.css",
      "@univerjs-pro/slides-ui/lib/index.css",
      "@univerjs-pro/slides-chart-ui/lib/index.css",
      "@univerjs-pro/slides-print/lib/index.css",
      "@univerjs-pro/slides-table-ui/lib/index.css",
    ]);
    expectImportsInOrder(editorSources.board, [
      "@univerjs/design/lib/index.css",
      "@univerjs/ui/lib/index.css",
      "@univerjs/docs-ui/lib/index.css",
      "@univerjs/drawing-ui/lib/index.css",
      "@univerjs-pro/chart-ui/lib/index.css",
      "@univerjs-pro/shape-editor-ui/lib/index.css",
      "@univerjs-pro/ink-ui/lib/index.css",
      "@univerjs-pro/docs-latex-ui/lib/index.css",
      "@univerjs-pro/boards-ui/lib/index.css",
      "@univerjs-pro/boards-chart-ui/lib/index.css",
      "@univerjs-pro/boards-mind-ui/lib/index.css",
      "@univerjs-pro/boards-print/lib/index.css",
      "@univerjs-pro/boards-table-ui/lib/index.css",
    ]);
  });

  it("loads shared Pro styles before Doc feature styles", () => {
    expectImportsInOrder(editorSources.doc, [
      "@univerjs/preset-docs-core/lib/index.css",
      "@univerjs/preset-docs-drawing/lib/index.css",
      "@univerjs/preset-docs-hyper-link/lib/index.css",
      "@univerjs/preset-docs-thread-comment/lib/index.css",
      "@univerjs-pro/chart-ui/lib/index.css",
      "@univerjs-pro/shape-editor-ui/lib/index.css",
      "@univerjs-pro/docs-callout-ui/lib/index.css",
      "@univerjs-pro/docs-chart-ui/lib/index.css",
      "@univerjs-pro/docs-code-ui/lib/index.css",
      "@univerjs-pro/docs-latex-ui/lib/index.css",
      "@univerjs-pro/docs-print/lib/index.css",
      "@univerjs-pro/docs-shape-ui/lib/index.css",
      "@univerjs-pro/docs-table-ui/lib/index.css",
    ]);
  });

  it("loads the public Facade entries for every installed editor feature", () => {
    expectImports(editorSources.doc, [
      "@univerjs-pro/chart-ui/facade",
      "@univerjs-pro/docs-callout/facade",
      "@univerjs-pro/docs-chart/facade",
      "@univerjs-pro/docs-code/facade",
      "@univerjs-pro/docs-exchange-client/facade",
      "@univerjs-pro/docs-latex/facade",
      "@univerjs-pro/docs-shape/facade",
      "@univerjs-pro/docs-table/facade",
      "@univerjs-pro/engine-chart/facade",
    ]);
    expectImports(editorSources.slide, [
      "@univerjs-pro/chart-ui/facade",
      "@univerjs-pro/engine-chart/facade",
      "@univerjs-pro/slides/facade",
      "@univerjs-pro/slides-chart/facade",
      "@univerjs-pro/slides-exchange-client/facade",
      "@univerjs-pro/slides-print/facade",
      "@univerjs-pro/slides-table/facade",
    ]);
    expectImports(editorSources.base, [
      "@univerjs-pro/bases/facade",
      "@univerjs-pro/bases-exchange-client/facade",
      "@univerjs-pro/bases-ui/facade",
    ]);
    expectImports(editorSources.board, [
      "@univerjs-pro/boards/facade",
      "@univerjs-pro/boards-chart/facade",
      "@univerjs-pro/boards-mind/facade",
      "@univerjs-pro/boards-table/facade",
      "@univerjs-pro/boards-ui/facade",
      "@univerjs-pro/chart-ui/facade",
      "@univerjs-pro/engine-chart/facade",
    ]);
  });

  it("keeps Base chrome out without clipping product content", () => {
    expect(editorSources.base).toContain("hideCollaborationStatus: true");
    expect(editorSources.base).toContain("toolbar: false");
    expect(editorSources.base).toContain("collaborationStatus: false");
    expect(editorSources.base).toContain("footer: false");
    expect(globalStyles).not.toContain('[id^="univer-base-"]');
    expect(globalStyles).not.toContain("margin-bottom: -36px");
  });

  it("registers the supported output plugins for each editor", () => {
    expect(editorSources.sheet).toContain("exchangeProvidedByPreset: true");
    expect(editorSources.doc).toContain(
      "exchangeFeaturePlugins: () => [UniverDocsExchangeClientPlugin]"
    );
    expect(editorSources.doc).toContain(
      "printFeaturePlugins: () => [UniverDocsPrintPlugin]"
    );
    expect(editorSources.slide).toContain(
      "exchangeFeaturePlugins: () => [UniverSlidesExchangeClientPlugin]"
    );
    expect(editorSources.slide).toContain(
      "printFeaturePlugins: () => [UniverSlidesPrintPlugin]"
    );
    expect(editorSources.base).toContain(
      "exchangeFeaturePlugins: () => [UniverBasesExchangeClientPlugin]"
    );
    expect(editorSources.board).toContain("exchangeEnabled: false");
    expect(editorSources.board).toContain(
      "printFeaturePlugins: () => [UniverBoardsPrintPlugin]"
    );
  });

  it("keeps Board chrome out and contains viewport overscroll", () => {
    expect(editorSources.board).toContain("hideCollaborationStatus: true");
    expect(editorSources.board).toContain("header: false");
    expect(editorSources.board).toContain("toolbar: false");
    expect(editorSources.board).toContain("footer: false");
    expect(globalStyles).toContain("overscroll-behavior: none");
    expect(globalStyles).toContain(".univer-editor-shell");
    expect(globalStyles).toContain("overflow: hidden");
  });
});

function readEditorSource(product: string): string {
  return readFileSync(
    new URL(`../../web/src/features/editor/${product}-editor.tsx`, import.meta.url),
    "utf8"
  );
}

function expectImports(source: string, specifiers: readonly string[]): void {
  for (const specifier of specifiers) {
    expect(source, `missing side-effect import: ${specifier}`).toContain(
      `import "${specifier}";`
    );
  }
}

function expectImportsInOrder(
  source: string,
  specifiers: readonly string[]
): void {
  expectImports(source, specifiers);
  const indexes = specifiers.map((specifier) =>
    source.indexOf(`import "${specifier}";`)
  );
  expect(indexes, `incorrect import order: ${specifiers.join(" -> ")}`).toEqual(
    [...indexes].sort((left, right) => left - right)
  );
}
