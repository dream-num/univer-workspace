import { afterEach, expect, it, vi } from "vitest";
import { uploadBlob } from "../src/provider/blob-api.ts";
import type { WorkspaceHttpClient } from "../src/provider/workspace-contract.ts";

afterEach(() => vi.useRealTimers());
const input = {
  bytes: new Uint8Array([0, 255, 128, 0, 13, 10]),
  declaredMediaType: "application/octet-stream",
  name: "attachment.bin",
  originalFilename: "original.bin",
  spaceId: "space",
  idempotencyKey: "same-key",
};
function fixture(
  options: { lostContent?: boolean; lostComplete?: boolean; completed?: boolean } = {},
) {
  vi.useFakeTimers();
  let state = options.completed ? "completed" : "waitingForUpload";
  let lostContent = options.lostContent;
  let lostComplete = options.lostComplete;
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith("/content")) {
      state = "uploaded";
      if (lostContent) {
        lostContent = false;
        throw new TypeError("connection lost");
      }
      return new Response(null, { status: 204 });
    }
    if (path.endsWith("/complete")) {
      state = "completed";
      if (lostComplete) {
        lostComplete = false;
        throw new TypeError("connection lost");
      }
      return Response.json({ node: { id: "node", resource: { id: "resource", kind: "blob" } } });
    }
    return Response.json({
      upload: {
        id: "upload",
        nodeId: "node",
        resourceId: "resource",
        state,
        name: input.name,
        originalFilename: input.originalFilename,
        byteSize: input.bytes.length,
      },
    });
  });
  const client: WorkspaceHttpClient = {
    origin: "https://workspace.test",
    sessionToken: "unused",
    request,
  };
  return { client, request };
}
it("publishes binary files through the existing authenticated client", async () => {
  const { client, request } = fixture();
  const pending = uploadBlob(client, input);
  await vi.runAllTimersAsync();
  await expect(pending).resolves.toEqual({
    nodeId: "node",
    resourceId: "resource",
    workspaceUrl: "https://workspace.test/nodes/node",
  });
  const reserve = request.mock.calls[0]![1]!;
  expect(reserve.headers).toMatchObject({ "Idempotency-Key": "same-key" });
  expect(JSON.parse(reserve.body as string)).toMatchObject({
    parentNodeId: null,
    declaredMediaType: "application/octet-stream",
    originalFilename: "original.bin",
    byteSize: 6,
  });
  expect(request.mock.calls.find(([path]) => path.endsWith("/content"))![1]!.body).toEqual(
    input.bytes,
  );
});
it("recovers lost upload and completion responses without creating a second reservation", async () => {
  const { client, request } = fixture({ lostContent: true, lostComplete: true });
  const pending = uploadBlob(client, input);
  await vi.runAllTimersAsync();
  await expect(pending).resolves.toMatchObject({ nodeId: "node" });
  expect(request.mock.calls.filter(([path]) => path === "/api/blob-upload-sessions")).toHaveLength(
    1,
  );
  expect(request.mock.calls.filter(([path]) => path.endsWith("/content"))).toHaveLength(1);
});
it("replays an already completed upload without resending bytes", async () => {
  const { client, request } = fixture({ completed: true });
  await expect(uploadBlob(client, input)).resolves.toMatchObject({ nodeId: "node" });
  expect(request.mock.calls.some(([path]) => path.endsWith("/content"))).toBe(false);
});
it("stops on access rejection or a malformed upload identity", async () => {
  const { client, request } = fixture();
  request.mockResolvedValueOnce(Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 }));
  await expect(uploadBlob(client, input)).rejects.toMatchObject({ status: 403 });
  expect(request).toHaveBeenCalledTimes(1);
  request.mockResolvedValueOnce(Response.json({ upload: { id: "wrong" } }));
  await expect(uploadBlob(client, input)).rejects.toMatchObject({ code: "MALFORMED_UPLOAD" });
});
it("rejects malformed JSON without retrying it as a transport failure", async () => {
  const { client, request } = fixture();
  request.mockResolvedValueOnce(new Response("not-json", { status: 200 }));
  await expect(uploadBlob(client, input)).rejects.toMatchObject({ code: "MALFORMED_UPLOAD" });
  expect(request).toHaveBeenCalledTimes(1);
});
it("forwards cancellation and stops an in-flight upload without retrying", async () => {
  const { client, request } = fixture();
  const abort = new AbortController();
  request.mockImplementationOnce(
    async (_path, init) =>
      new Promise<Response>((_, reject) => {
        init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
      }),
  );
  const pending = uploadBlob(client, { ...input, signal: abort.signal });
  const rejected = expect(pending).rejects.toThrow("cancelled by user");
  abort.abort(new Error("cancelled by user"));
  await rejected;
  expect(request).toHaveBeenCalledTimes(1);
  await expect(uploadBlob(client, { ...input, signal: abort.signal })).rejects.toThrow(
    "cancelled by user",
  );
  expect(request).toHaveBeenCalledTimes(1);
});
it("retries a lost reservation response with the same key and content", async () => {
  const { client, request } = fixture({ completed: true });
  request.mockRejectedValueOnce(new Error("connection reset"));
  const pending = uploadBlob(client, input);
  await vi.runAllTimersAsync();
  await expect(pending).resolves.toMatchObject({ nodeId: "node" });
  const calls = request.mock.calls.filter(([path]) => path === "/api/blob-upload-sessions");
  expect(calls).toHaveLength(2);
  expect(calls[0]![1]!.body).toBe(calls[1]![1]!.body);
  expect(calls[0]![1]!.headers).toEqual(calls[1]![1]!.headers);
});
