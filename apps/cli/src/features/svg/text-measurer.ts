import type { IDocumentData } from "@univerjs/core";
import type { SvgLineMeasureRun, SvgTextMeasurer } from "@univer-cli/svg-facade";
import type { UniverTextMeasureInput, UniverTextMetrics } from "@univer-cli/univer-render-runtime";

export interface WorkspaceSvgTextMeasurePort {
  measureText(input: UniverTextMeasureInput): Promise<UniverTextMetrics>;
}

export function createWorkspaceSvgTextMeasurer(
  runtime: WorkspaceSvgTextMeasurePort,
): SvgTextMeasurer {
  return {
    source: "univer-render-runtime",
    measureLine: async ({ runs }) => {
      const dataStream = runs.map((run) => run.text).join("");
      let offset = 0;
      const textRuns = runs.map((run) => {
        const start = offset;
        offset += run.text.length;
        return { st: start, ed: offset, ts: textStyle(run) };
      });
      const doc = {
        id: "svg-facade-measure",
        body: {
          dataStream: `${dataStream}\r\n`,
          paragraphs: [{ paragraphId: "svg-facade-measure-p0", startIndex: dataStream.length }],
          textRuns,
        },
        documentStyle: {
          marginBottom: 0,
          marginLeft: 0,
          marginRight: 0,
          marginTop: 0,
          pageSize: { height: 1_000_000, width: 1_000_000 },
        },
      } as unknown as IDocumentData;
      const metrics = await runtime.measureText({ doc });
      return {
        ascent: metrics.firstLineAscent,
        descent: metrics.firstLineDescent,
        width: metrics.actualWidth,
      };
    },
  };
}

function textStyle(run: SvgLineMeasureRun): Record<string, unknown> {
  return {
    fs: run.fontSizePx * 0.75,
    ...(run.bold ? { bl: 1 } : {}),
    ...(run.italic ? { it: 1 } : {}),
    ...(run.fontFamily === undefined ? {} : { ff: run.fontFamily }),
  };
}
