import type { z } from "zod";
import type { screenshotInput } from "../../shared/renderer-protocol.js";
import type { Handler } from "../context.js";
import { loadRenderUnit } from "./scope.js";
import { screenshotTarget } from "./screenshot-target.js";

export const renderScreenshot: Handler<"render.screenshot"> = async (ctx, input) => {
  if (!ctx.renderer) throw new Error("The executor was built without a renderer client.");
  const unit = await loadRenderUnit(ctx, input.scope, input.unitId);
  const target = await screenshotTarget(unit, input.options);
  // The renderer gets the loaded unit and target only: no grant, cookie or Workspace URL. The
  // protocol schema checks the envelope; the render packages own the deep unit shape.
  const { output, bytes, meta } = await ctx.renderer.call("screenshot", {
    ...unit,
    ...(target === undefined ? {} : { target }),
  } as unknown as z.input<typeof screenshotInput>);
  ctx.usage.cost.render_pages += meta.cost.render_pages;
  return { output, bytes };
};
