import type { components } from "../../../../generated/http/schema.js";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";

/** Resolve a usable Node only after resource creation has completed. */
export async function waitForCreatedResource(
  result:
    | components["schemas"]["ResourceCreateResponse"]
    | components["schemas"]["OperationEnvelope"],
  messages: { readonly failed: string; readonly continuing: string },
): Promise<string> {
  if ("node" in result) return result.node.id;

  let operation = result.operation;
  for (let attempt = 0; ; attempt += 1) {
    if (operation.state === "failed") {
      throw new Error(operation.error?.message || messages.failed);
    }
    if (operation.state === "completed") {
      const nodeId = operation.result?.nodeId;
      if (typeof nodeId !== "string" || !nodeId) throw new Error(messages.failed);
      return nodeId;
    }
    // Stop waiting after two minutes; the server continues its durable operation.
    if (attempt >= 60) throw new Error(messages.continuing);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const { data, error } = await api.GET("/api/operations/{operationId}", {
      params: { path: { operationId: operation.id } },
    });
    if (error) throw apiError(error);
    operation = data;
  }
}
