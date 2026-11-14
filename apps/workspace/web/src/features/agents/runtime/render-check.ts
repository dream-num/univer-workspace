import type { ToolSet } from "ai";
import { z } from "zod";
import type { CheckHtmlViewDraft, HtmlViewRenderCheck } from "../../html-views/render-check";

const draftResult = z.object({
  isError: z.boolean().optional(),
  structuredContent: z.object({ draft: z.object({ id: z.string().min(1) }).passthrough() }).passthrough(),
}).passthrough();

export function withRenderCheck(tools: ToolSet, check?: CheckHtmlViewDraft): ToolSet {
  return Object.fromEntries(Object.entries(tools).map(([name, tool]) => {
    if (!check || !["html_view_create", "html_view_replace"].includes(name) || !tool.execute) return [name, tool];
    const execute = tool.execute;
    return [name, { ...tool, async execute(input, options) {
      const output: unknown = await execute(input, options);
      const parsed = draftResult.safeParse(output);
      if (!parsed.success || parsed.data.isError) return output;
      const startedAt = Date.now();
      let renderCheck: HtmlViewRenderCheck;
      try { renderCheck = await check(parsed.data.structuredContent.draft.id, options.abortSignal); }
      catch (error) { renderCheck = { status: "failed", issues: [], durationMs: Date.now() - startedAt,
        reason: (error instanceof Error ? error.message : String(error)).trim().slice(0, 300) || "Render check could not run." }; }
      return { ...parsed.data, structuredContent: { ...parsed.data.structuredContent, renderCheck } };
    } } satisfies ToolSet[string]];
  }));
}
