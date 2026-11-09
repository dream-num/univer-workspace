import { workspaceError } from "@univerjs/univer-workspace-client-core/product";
import type { z } from "zod";
import type { printPdfInput } from "../../shared/renderer-protocol.js";
import type { Handler } from "../context.js";
import { loadRenderUnit } from "./scope.js";

export const renderPrintPdf: Handler<"render.printPdf"> = async (ctx, input) => {
  if (!ctx.renderer) throw new Error("The executor was built without a renderer client.");
  const unit = await loadRenderUnit(ctx, input.scope, input.unitId);
  if (unit.unitType === "base")
    throw workspaceError(
      "workspace-print-pdf-type-unsupported",
      "Base Units do not support PDF printing.",
    );
  // The renderer gets the loaded unit only: no grant, cookie or Workspace URL.
  const { output, bytes, meta } = await ctx.renderer.call(
    "printPdf",
    unit as unknown as z.input<typeof printPdfInput>,
  );
  ctx.usage.unitType = output.unitType;
  ctx.usage.cost.render_pages += meta.cost.render_pages;
  return { output, bytes };
};
