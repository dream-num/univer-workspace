import { opSpecs } from "../shared/executor-protocol.js";
import { RESULT_LIMIT } from "./paging.js";

export function truncateHtmlViewDraft(output: unknown) {
  const result = opSpecs["htmlView.draft"].output.safeParse(output);
  if (!result.success) return undefined;
  const fitted = { ...result.data, bindings: result.data.bindings.slice(), truncated: true as const };
  while (fitted.bindings.length > 0 && JSON.stringify(fitted).length > RESULT_LIMIT) {
    fitted.bindings.pop();
  }
  return fitted;
}
