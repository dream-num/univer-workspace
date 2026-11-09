import { createUnitLayoutLint, type UnitLayoutLintInput } from "@univer-cli/unit-layout-lint";
import {
  createUnitPdfPrinter,
  UnitPdfPrinterError,
  type UnitPdfPrintInput,
} from "@univer-cli/unit-pdf-printer";
import { createUnitScreenshot, type UnitScreenshotInput } from "@univer-cli/unit-screenshot";
import type {
  createUniverRenderRuntime,
  UniverTextMeasureInput,
} from "@univer-cli/univer-render-runtime";
import type {
  RendererOpName,
  RendererOpOutput,
  rendererOpSpecs,
} from "../shared/renderer-protocol.js";
import type { z } from "zod";

export type RenderRuntime = Awaited<ReturnType<typeof createUniverRenderRuntime>>;
type Input<K extends RendererOpName> = z.output<(typeof rendererOpSpecs)[K]["input"]>;
export interface OpResult<K extends RendererOpName> {
  readonly output: RendererOpOutput<K>;
  readonly bytes?: Uint8Array;
  readonly renderPages: number;
}
type Handler<K extends RendererOpName> = (
  runtime: RenderRuntime,
  input: Input<K>,
  signal: AbortSignal,
) => Promise<OpResult<K>>;

// The protocol schemas check the envelope; the render packages own the deep unit checks, so the
// parsed input is handed to them as the upstream input type.
export const handlers: { [K in RendererOpName]: Handler<K> } = {
  async screenshot(runtime, input, signal) {
    const result = await createUnitScreenshot({ runtime }).capture({
      ...input,
      signal,
    } as unknown as UnitScreenshotInput);
    let offset = 0;
    const images = result.images.map(({ bytes, ...metadata }) => {
      const image = { ...metadata, offset, size: bytes.length };
      offset += bytes.length;
      return image;
    }) as unknown as RendererOpOutput<"screenshot">["images"];
    return {
      output: { unitId: result.unitId, unitType: result.unitType, images },
      bytes: Buffer.concat(result.images.map((image) => image.bytes)),
      renderPages: images.length,
    };
  },
  async printPdf(runtime, input, signal) {
    if (input.unitType === "base")
      throw new UnitPdfPrinterError(
        "UNSUPPORTED_UNIT_TYPE",
        "Base Units do not support PDF printing.",
      );
    const printed = await createUnitPdfPrinter({ runtime }).print({
      ...input,
      signal,
    } as unknown as UnitPdfPrintInput);
    const { bytes, ...output } = printed;
    return { output, bytes, renderPages: printed.pageCount };
  },
  async lint(runtime, input, signal) {
    const report = await createUnitLayoutLint({ runtime }).lint({
      ...input,
      signal,
    } as unknown as UnitLayoutLintInput);
    return {
      output: report as unknown as RendererOpOutput<"lint">,
      renderPages: report.coverage.pages.length,
    };
  },
  async measureText(runtime, input, signal) {
    return {
      output: await runtime.measureText({ ...input, signal } as unknown as UniverTextMeasureInput),
      renderPages: 0,
    };
  },
};

export function runOp(
  name: RendererOpName,
  runtime: RenderRuntime,
  input: unknown,
  signal: AbortSignal,
): Promise<OpResult<RendererOpName>> {
  return (handlers[name] as unknown as Handler<RendererOpName>)(runtime, input as never, signal);
}
