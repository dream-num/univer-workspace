import type { IDocumentData } from "@univerjs/core";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceSvgTextMeasurer } from "../src/index.js";

describe("Workspace SVG text measurer", () => {
  it("maps styled SVG runs into one unbounded Univer document line", async () => {
    const measureText = vi.fn(async ({ doc }: { readonly doc: IDocumentData }) => ({
      actualHeight: 24,
      actualWidth: 91,
      firstLineAscent: 18,
      firstLineDescent: 6,
      lineCount: 1,
      doc,
    }));
    const measurer = createWorkspaceSvgTextMeasurer({ measureText });

    await expect(
      measurer.measureLine({
        runs: [
          {
            bold: true,
            fontFamily: "Inter",
            fontSizePx: 20,
            italic: false,
            text: "A😀",
          },
          { bold: false, fontSizePx: 16, italic: true, text: " 世界" },
        ],
      }),
    ).resolves.toEqual({ ascent: 18, descent: 6, width: 91 });

    expect(measureText).toHaveBeenCalledOnce();
    expect(measureText.mock.calls[0]?.[0].doc).toMatchObject({
      body: {
        dataStream: "A😀 世界\r\n",
        paragraphs: [{ paragraphId: "svg-facade-measure-p0", startIndex: 6 }],
        textRuns: [
          { ed: 3, st: 0, ts: { bl: 1, ff: "Inter", fs: 15 } },
          { ed: 6, st: 3, ts: { fs: 12, it: 1 } },
        ],
      },
      documentStyle: {
        marginBottom: 0,
        marginLeft: 0,
        marginRight: 0,
        marginTop: 0,
        pageSize: { height: 1_000_000, width: 1_000_000 },
      },
    });
  });
});
