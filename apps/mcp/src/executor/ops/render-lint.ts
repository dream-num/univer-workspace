import type { z } from "zod";
import type { lintInput as rendererLintInput } from "../../shared/renderer-protocol.js";
import type { Handler } from "../context.js";
import { lintInput } from "./lint-input.js";
import { attributeRepo } from "./scope.js";

export const renderLint: Handler<"render.lint"> = async (ctx, input) => {
  if (!ctx.renderer) throw new Error("The executor was built without a renderer client.");
  await attributeRepo(ctx, { kind: "worktree", worktreeId: input.worktreeId });
  const built = await lintInput(ctx, input);
  ctx.usage.unitType = "slide";
  // The renderer gets the loaded Slide and page selectors only: no grant, cookie or Workspace URL.
  const { output, meta } = await ctx.renderer.call(
    "lint",
    built as unknown as z.input<typeof rendererLintInput>,
  );
  ctx.usage.cost.render_pages += meta.cost.render_pages;
  return { output };
};
