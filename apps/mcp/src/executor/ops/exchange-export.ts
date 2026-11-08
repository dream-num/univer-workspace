import type { Handler } from "../context.js";
import { exchangeFeature } from "./exchange.js";

export const exchangeExport: Handler<"exchange.export"> = async (ctx, input) => {
  const { bytes, format: _format, ...output } = await exchangeFeature(ctx).exportBuffer(input);
  ctx.usage.unitType = output.type;
  return { output, bytes };
};
