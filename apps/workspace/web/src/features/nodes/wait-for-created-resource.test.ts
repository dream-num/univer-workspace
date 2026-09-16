import { afterEach, describe, expect, it, vi } from "vitest";
import type { components } from "../../../../generated/http/schema.js";
import { api } from "../../shared/api/client";
import { waitForCreatedResource } from "./wait-for-created-resource.js";

vi.mock("../../shared/api/client", () => ({ api: { GET: vi.fn() } }));

const messages = { failed: "Creation failed", continuing: "Still creating" };
const pending: components["schemas"]["OperationView"] = {
  id: "operation-1",
  kind: "createResource",
  state: "pending",
  createdAt: "2026-09-16T00:00:00Z",
  updatedAt: "2026-09-16T00:00:00Z",
  result: null,
  error: null,
};

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("waitForCreatedResource", () => {
  it("opens the returned Node for an immediately completed creation", async () => {
    const result = {
      operation: { ...pending, state: "completed" },
      node: { id: "node-1" },
    } as components["schemas"]["ResourceCreateResponse"];
    await expect(waitForCreatedResource(result, messages)).resolves.toBe("node-1");
    expect(api.GET).not.toHaveBeenCalled();
  });

  it("waits through pending responses before returning the completed Node", async () => {
    vi.useFakeTimers();
    vi.mocked(api.GET)
      .mockResolvedValueOnce({ data: pending } as never)
      .mockResolvedValueOnce({
        data: { ...pending, state: "completed", result: { nodeId: "node-2" } },
      } as never);
    const result = waitForCreatedResource({ operation: pending }, messages);
    const assertion = expect(result).resolves.toBe("node-2");
    await vi.runAllTimersAsync();
    await assertion;
    expect(api.GET).toHaveBeenCalledTimes(2);
    expect(api.GET).toHaveBeenCalledWith("/api/operations/{operationId}", {
      params: { path: { operationId: "operation-1" } },
    });
  });

  it("reports a failed operation instead of returning a Node", async () => {
    await expect(
      waitForCreatedResource(
        {
          operation: {
            ...pending,
            state: "failed",
            error: { code: "FAILED", message: "Cannot create" },
          },
        },
        messages,
      ),
    ).rejects.toThrow("Cannot create");
  });

  it("rejects a completed operation without a Node ID", async () => {
    await expect(
      waitForCreatedResource({ operation: { ...pending, state: "completed" } }, messages),
    ).rejects.toThrow(messages.failed);
  });

  it("bounds polling and reports that creation is continuing", async () => {
    vi.useFakeTimers();
    vi.mocked(api.GET).mockResolvedValue({ data: pending } as never);
    const assertion = expect(
      waitForCreatedResource({ operation: pending }, messages),
    ).rejects.toThrow(messages.continuing);
    await vi.runAllTimersAsync();
    await assertion;
    expect(api.GET).toHaveBeenCalledTimes(60);
  });

  it("propagates polling errors without returning a Node", async () => {
    vi.useFakeTimers();
    vi.mocked(api.GET).mockResolvedValue({
      error: { error: { message: "Access denied" } },
    } as never);
    const assertion = expect(
      waitForCreatedResource({ operation: pending }, messages),
    ).rejects.toThrow("Access denied");
    await vi.runAllTimersAsync();
    await assertion;
  });
});
