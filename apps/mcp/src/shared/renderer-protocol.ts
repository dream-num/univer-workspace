import { z } from "zod";
import { PROTOCOL_VERSION } from "./executor-protocol.js";
import { box, screenshotImage, screenshotOutput, unitType } from "./screenshot-schema.js";

export { responseHeaderSchema } from "./executor-protocol.js";
export { screenshotImage, screenshotOutput };

// The renderer receives no grant: it has no route to Workspace and holds no user credentials.
const MiB = 1024 * 1024;
// Univer owns the deep unit shape; the render packages reject malformed data with INVALID_INPUT.
const unitData = z.record(z.string(), z.unknown());
const embeddedUnit = z.object({ unitType, unitData });
export const renderUnitSchema = z.object({
  unitType,
  unitData,
  embeddedUnits: z.array(embeddedUnit).optional(),
  formulaReferenceUnits: z
    .array(z.object({ unitType: z.enum(["sheet", "base"]), unitData }))
    .optional(),
});

const scale = z.number().positive().optional();
const screenshotTarget = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("sheet-viewport"), scale }),
  z.strictObject({
    kind: z.literal("sheet-range"),
    range: z.string().min(1),
    scale,
    sheetName: z.string().optional(),
  }),
  z.strictObject({ kind: z.literal("doc-pages"), pages: z.array(z.int()).optional(), scale }),
  z.strictObject({
    kind: z.literal("slide-pages"),
    pages: z.array(z.union([z.number(), z.string()])).optional(),
    scale,
    contactSheet: z
      .strictObject({
        tile: z.strictObject({ columns: z.int().positive(), rows: z.int().positive() }).optional(),
      })
      .optional(),
  }),
  z.strictObject({
    kind: z.literal("board-content"),
    elementIds: z.array(z.string()).optional(),
    padding: z.number().optional(),
    region: box.optional(),
    scale,
  }),
  z.strictObject({ kind: z.literal("base-view"), scale }),
]);

export const screenshotInput = renderUnitSchema.extend({ target: screenshotTarget.optional() });

export const printPdfInput = renderUnitSchema;
export const printPdfOutput = z.object({
  unitId: z.string(),
  unitType,
  name: z.string(),
  mediaType: z.literal("application/pdf"),
  pageCount: z.int().nonnegative(),
});

export const lintInput = z.object({
  unitType: z.literal("slide"),
  unitData,
  formulaReferenceUnits: renderUnitSchema.shape.formulaReferenceUnits,
  pages: z.array(z.union([z.number(), z.string()])).optional(),
});
export const lintOutput = z.object({
  kind: z.literal("unit-layout-lint"),
  unitId: z.string(),
  unitType: z.literal("slide"),
  coverage: z.object({
    pages: z.array(z.object({ page: z.number(), pageId: z.string() })),
    rules: z.array(z.string()),
  }),
  findings: z.array(z.json()),
});

export const measureTextInput = z.object({
  doc: unitData,
  wrapWidth: z.number().positive().optional(),
});
export const measureTextOutput = z.object({
  actualHeight: z.number(),
  actualWidth: z.number(),
  firstLineAscent: z.number(),
  firstLineDescent: z.number(),
  lineCount: z.number(),
});

export interface RendererOpSpec<
  I extends z.ZodType = z.ZodType,
  O extends z.ZodObject = z.ZodObject,
  P extends "none" | "response" = "none" | "response",
> {
  readonly name: string;
  readonly payload: P;
  readonly limits: {
    readonly requestBytes: number;
    readonly responseBytes: number;
    readonly budgetMs: number;
  };
  readonly input: I;
  readonly output: O;
}
function defineOp<I extends z.ZodType, O extends z.ZodObject, const P extends "none" | "response">(
  spec: RendererOpSpec<I, O, P>,
): RendererOpSpec<I, O, P> {
  return spec;
}

export const rendererOpSpecs = {
  screenshot: defineOp({
    name: "screenshot",
    payload: "response",
    limits: { requestBytes: 64 * MiB, responseBytes: 64 * MiB, budgetMs: 30_000 },
    input: screenshotInput,
    output: screenshotOutput,
  }),
  printPdf: defineOp({
    name: "printPdf",
    payload: "response",
    limits: { requestBytes: 64 * MiB, responseBytes: 128 * MiB, budgetMs: 30_000 },
    input: printPdfInput,
    output: printPdfOutput,
  }),
  lint: defineOp({
    name: "lint",
    payload: "none",
    limits: { requestBytes: 64 * MiB, responseBytes: 8 * MiB, budgetMs: 30_000 },
    input: lintInput,
    output: lintOutput,
  }),
  measureText: defineOp({
    name: "measureText",
    payload: "none",
    limits: { requestBytes: 4 * MiB, responseBytes: 16 * 1024, budgetMs: 10_000 },
    input: measureTextInput,
    output: measureTextOutput,
  }),
} as const;
export type RendererOpName = keyof typeof rendererOpSpecs;
export function isRendererOpName(name: string): name is RendererOpName {
  return Object.hasOwn(rendererOpSpecs, name);
}

export const rendererRequestHeaderSchema = z
  .object({
    v: z.literal(PROTOCOL_VERSION),
    op: z.string(),
    requestId: z.string().regex(/^[a-zA-Z0-9._-]{1,128}$/),
    deadlineMs: z.int().positive(),
    input: z.unknown(),
  })
  .refine(
    (header) =>
      isRendererOpName(header.op) &&
      header.deadlineMs <= rendererOpSpecs[header.op].limits.budgetMs,
    "Deadline exceeds the operation budget",
  );
export type RendererRequestHeader = z.infer<typeof rendererRequestHeaderSchema>;
export type RendererOpOutput<K extends RendererOpName> = z.output<
  (typeof rendererOpSpecs)[K]["output"]
>;
