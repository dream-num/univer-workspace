import { z } from "zod";

const localizedText = z.object({ en: z.string(), zh: z.string() });
const styleCatalogSchema = z.object({
  default: z.string(),
  styles: z.array(z.object({ id: z.string(), name: localizedText, mood: localizedText })),
});
const styleOutputSchema = z.object({
  isError: z.boolean().optional(),
  structuredContent: styleCatalogSchema,
});
export type HtmlViewStyles = z.infer<typeof styleCatalogSchema>;

export function htmlViewStylesResult(tool: string, output: unknown): HtmlViewStyles | null {
  if (tool !== "html_view_styles") return null;
  const parsed = styleOutputSchema.safeParse(output);
  return parsed.success && !parsed.data.isError ? parsed.data.structuredContent : null;
}
