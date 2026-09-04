import {
  UniverInstanceType,
  type IDocumentData,
  type ITextRun,
} from "@univerjs/core";
import { DocsUnitComparisonAdapter } from "@univerjs-pro/docs-history";
import type { IUnitComparisonItem } from "@univerjs-pro/edit-history";
import { describe, expect, it } from "vitest";
import { structuralDiffItemsFromResult } from "../../web/src/features/worktrees/comparison-presentation.js";
import { decorateDocumentComparisonSide } from "../../web/src/features/worktrees/document-comparison-decoration.js";
import { decorateWorkbookComparisonSide } from "../../web/src/features/worktrees/workbook-comparison-decoration.js";

function document(text: string): IDocumentData {
  return {
    id: "doc-1",
    documentStyle: {},
    body: {
      dataStream: `${text}\r\0`,
      paragraphs: [
        { startIndex: text.length, paragraphId: "paragraph-1" },
        { startIndex: text.length + 1, paragraphId: "paragraph-end" },
      ],
    },
  };
}

function renderDocumentSide(
  current: IDocumentData,
  peer: IDocumentData,
  side: "left" | "right"
): IDocumentData {
  const result = new DocsUnitComparisonAdapter().compare({
    unitId: "doc-1",
    leftData: side === "left" ? current : peer,
    rightData: side === "right" ? current : peer,
    leftChangesets: [],
    rightChangesets: [],
  });
  if (result.productContext?.type !== UniverInstanceType.UNIVER_DOC) {
    throw new Error("Expected Doc comparison context");
  }
  return decorateDocumentComparisonSide(current, peer, side, {
    items: structuralDiffItemsFromResult(result.items),
    alignment: result.productContext.paragraphAlignment,
  });
}

function coloredText(data: IDocumentData) {
  const stream = data.body?.dataStream ?? "";
  return (data.body?.textRuns ?? []).flatMap((run: ITextRun) => {
    const color = run.ts?.bg?.rgb;
    return color === undefined
      ? []
      : [{ text: stream.slice(run.st, run.ed), color }];
  });
}

describe("comparison canvas decoration", () => {
  it("uses SDK character segments to paint document replacements", () => {
    const left = renderDocumentSide(
      document("Ship in August"),
      document("Ship in September"),
      "left"
    );
    const right = renderDocumentSide(
      document("Ship in September"),
      document("Ship in August"),
      "right"
    );

    expect(coloredText(left)).toContainEqual({
      text: "August",
      color: "rgba(37, 99, 235, 0.22)",
    });
    expect(coloredText(right)).toContainEqual({
      text: "September",
      color: "rgba(37, 99, 235, 0.22)",
    });
  });

  it("paints Sheet cells without mutating the comparison packet", () => {
    const source = {
      id: "sheet-1",
      sheets: {
        page: { cellData: { 1: { 1: { v: 5.5 } } } },
      },
    };
    const item = {
      id: "cell:page:update:B2",
      stableId: "B2",
      parentStableId: "page",
      scope: { entityType: "worksheet", stableId: "page" },
      kind: "update",
      entityType: "cell",
      path: ["cell", "page", "B2"],
      moved: false,
      changes: [],
      locations: {
        left: { path: [], stableId: "B2" },
        right: { path: [], stableId: "B2" },
      },
    } as IUnitComparisonItem;

    const decorated = decorateWorkbookComparisonSide(source, "left", [item]);
    const sheets = decorated.sheets as {
      page: {
        cellData: Record<
          number,
          Record<number, { s: { bg: { rgb: string } } }>
        >;
      };
    };
    expect(sheets.page.cellData[1]![1]!.s.bg.rgb).toBe(
      "rgba(37, 99, 235, 0.24)"
    );
    expect(source.sheets.page.cellData[1][1]).toEqual({ v: 5.5 });
  });
});
