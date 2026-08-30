import { measureCanonicalJson } from "@univerjs/univer-workspace-client-core";

export const MAX_RENDER_CANONICAL_BYTES = 8_388_608;
export const MAX_RENDER_CANONICAL_DEPTH = 64;

export function validateWorkspaceRenderResultBudget(
  value: unknown,
  malformed: () => Error,
  limitExceeded: (kind: string, limit: number, actual: number) => Error,
): void {
  let measurement: ReturnType<typeof measureCanonicalJson>;
  try {
    measurement = measureCanonicalJson(value);
  } catch {
    throw malformed();
  }
  if (measurement.depth > MAX_RENDER_CANONICAL_DEPTH) {
    throw limitExceeded("render-result-depth", MAX_RENDER_CANONICAL_DEPTH, measurement.depth);
  }
  if (measurement.bytes > MAX_RENDER_CANONICAL_BYTES) {
    throw limitExceeded("render-result-bytes", MAX_RENDER_CANONICAL_BYTES, measurement.bytes);
  }
}
