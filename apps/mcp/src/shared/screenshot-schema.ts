import { z } from "zod";

// Shared by the renderer and executor protocols, which cannot import each other.
export const unitType = z.enum(["sheet", "doc", "slide", "board", "base"]);
export const box = z.object({
  left: z.number(),
  top: z.number(),
  width: z.number(),
  height: z.number(),
});
export const screenshotImage = z.object({
  name: z.string(),
  mediaType: z.literal("image/png"),
  width: z.number(),
  height: z.number(),
  offset: z.int().nonnegative(),
  size: z.int().nonnegative(),
  page: z.number().optional(),
  pageId: z.string().optional(),
  range: z.string().optional(),
  role: z.enum(["board-content", "contact-slide"]).optional(),
  scale: z.number().optional(),
  sheetName: z.string().optional(),
  tiles: z.number().optional(),
  padding: z.number().optional(),
  contentBounds: box.optional(),
  boardSelector: z.json().optional(),
  layoutAnalysis: z.json().optional(),
});
export const screenshotOutput = z.object({
  unitId: z.string(),
  unitType,
  images: z.array(screenshotImage),
});
