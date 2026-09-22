import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";

/** Resolve each target independently. HTML access does not confer Unit access. */
export async function openNativeUnit(unitId: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const resolved = await api.GET("/api/unit-resources/{unitId}", {
    params: { path: { unitId } }, signal,
  });
  if (resolved.error) throw apiError(resolved.error);
  const opened = await api.POST("/api/resources/{resourceId}/open", {
    params: { path: { resourceId: resolved.data.resource.id } }, signal,
  });
  if (opened.error) throw apiError(opened.error);
  signal.throwIfAborted();
  const resource = opened.data.resource;
  if (resource.kind !== "univer" || resource.unitId !== unitId ||
      (resource.unitType !== "sheet" && resource.unitType !== "doc" && resource.unitType !== "slide"))
    throw new Error("This resource does not support native preview.");
  return { nodeId: resolved.data.node.id, name: resolved.data.node.name, resource };
}
