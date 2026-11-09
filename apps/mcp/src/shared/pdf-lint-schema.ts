import { z } from "zod";
import { unitType } from "./screenshot-schema.js";

// Shared by the renderer and executor protocols, which cannot import each other.
export const printPdfOutput = z.object({
  unitId: z.string(),
  unitType,
  name: z.string(),
  mediaType: z.literal("application/pdf"),
  pageCount: z.int().nonnegative(),
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
