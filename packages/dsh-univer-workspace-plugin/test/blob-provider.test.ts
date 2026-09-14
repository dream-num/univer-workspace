import { Context } from "@deepseek-ai/cordis";
import { describe, expect, it, vi } from "vitest";
import { apply } from "../src/provider/service-provider.ts";

const root = "/tmp/dsh-blob-provider-tests";
const uploadInput = {
  spaceId: "space-1",
  parentNodeId: null,
  name: "file.txt",
  originalFilename: "file.txt",
  bytes: Buffer.from("edited"),
  idempotencyKey: "blob-upload-request-0001",
};
const blobNode = {
  id: "node-1",
  spaceId: "space-1",
  parentNodeId: null,
  name: "file.txt",
  accessRole: "editor",
  capabilities: { rename: true },
  resource: {
    id: "blob-1",
    kind: "blob",
    byteSize: 6,
    mediaType: "text/plain",
    availability: "ready",
    capabilities: { downloadContent: true },
  },
};
function uploadSession(state: string) {
  return Response.json({
    operation: {
      id: uploadInput.idempotencyKey,
      kind: "createBlobResource",
      state: state === "completed" ? "completed" : "pending",
    },
    upload: {
      id: "upload-1",
      operationId: uploadInput.idempotencyKey,
      nodeId: "node-1",
      resourceId: "blob-1",
      byteSize: 6,
      state,
    },
  });
}
function completedUpload() {
  return Response.json({
    operation: { id: uploadInput.idempotencyKey, kind: "createBlobResource", state: "completed" },
    node: blobNode,
  });
}

function setup() {
  const ctx = new Context();
  const runtime = { version: "initial" };
  const connection = { userId: "user-1", token: "test-session", switching: false };
  const request = vi.fn(async (_path: string, init?: RequestInit) => {
    const sent = new Request("https://workspace.test/api/blob-resources/blob-1/content", init);
    expect(sent.headers.has("cookie")).toBe(false); // The harness client owns credentials.
    expect(sent.headers.get("if-match")).toBe('"downloaded"');
    expect(await sent.text()).toBe("edited");
    return Response.json({
      operationId: "blob-replace-request-0001",
      resourceId: "blob-1",
      etag: '"new"',
    });
  });
  ctx.provide("workspaceRuntime", runtime);
  ctx.provide("workspaceAuth", {
    currentIdentity: () => ({ userId: connection.userId }),
    switching: () => connection.switching,
    currentClient: () => ({
      origin: "https://workspace.test",
      sessionToken: connection.token,
      request,
    }),
  });
  apply(ctx, { workspaceRoot: root, workerUrl: new URL("file:///unused-worker.js"), license: "" });
  const service = ctx.get("univerWorkspace")!;
  const replace = () =>
    service.replaceBlob("user-1", {
      resourceId: "blob-1",
      bytes: Buffer.from("edited"),
      etag: '"downloaded"',
      idempotencyKey: "blob-replace-request-0001",
    });
  return { runtime, connection, request, replace, service };
}

describe("Blob provider", () => {
  it("gets Blob metadata and permissions without downloading content", async () => {
    const { service, request } = setup();
    request.mockResolvedValueOnce(Response.json({ node: blobNode, resource: blobNode.resource }));
    await expect(service.getBlob("user-1", "blob-1")).resolves.toMatchObject({
      nodeId: "node-1",
      resourceId: "blob-1",
      name: "file.txt",
      byteSize: 6,
      mediaType: "text/plain",
      nodeCapabilities: { rename: true },
      resourceCapabilities: { downloadContent: true },
    });
    expect(request).toHaveBeenCalledExactlyOnceWith("/api/resources/blob-1", undefined);
  });

  it("rejects non-Blob metadata", async () => {
    const { service, request } = setup();
    request.mockResolvedValueOnce(
      Response.json({ node: { ...blobNode, resource: { id: "blob-1", kind: "univer" } } }),
    );
    await expect(service.getBlob("user-1", "blob-1")).rejects.toMatchObject({
      code: "INVALID_RESOURCE_KIND",
    });
  });

  it("reserves, sends bytes, and completes an upload through the authenticated client", async () => {
    const { service, request } = setup();
    request
      .mockResolvedValueOnce(uploadSession("waitingForUpload"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(completedUpload());
    await expect(service.uploadBlob("user-1", uploadInput)).resolves.toEqual({
      operationId: uploadInput.idempotencyKey,
      uploadId: "upload-1",
      nodeId: "node-1",
      resourceId: "blob-1",
    });
    expect(request.mock.calls.map(([path, init]) => [path, init?.method])).toEqual([
      ["/api/blob-upload-sessions", "POST"],
      ["/api/blob-upload-sessions/upload-1/content", "PUT"],
      ["/api/blob-upload-sessions/upload-1/complete", "POST"],
    ]);
    const reserve = new Request("https://workspace.test/upload", request.mock.calls[0]![1]);
    expect(reserve.headers.get("idempotency-key")).toBe(uploadInput.idempotencyKey);
    expect(reserve.headers.has("cookie")).toBe(false);
    expect(await reserve.json()).toEqual({
      spaceId: "space-1",
      parentNodeId: null,
      name: "file.txt",
      originalFilename: "file.txt",
      byteSize: 6,
    });
    const content = new Request("https://workspace.test/content", request.mock.calls[1]![1]);
    expect(content.headers.get("content-length")).toBe("6");
    expect(await content.text()).toBe("edited");
  });

  it("resumes already uploaded bytes without repeating the PUT", async () => {
    const { service, request } = setup();
    request
      .mockResolvedValueOnce(uploadSession("uploaded"))
      .mockResolvedValueOnce(completedUpload());
    await service.uploadBlob("user-1", uploadInput);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[0]).toBe("/api/blob-upload-sessions/upload-1/complete");
  });

  it("replays a completed upload after its completion response was lost", async () => {
    const { service, request } = setup();
    request
      .mockResolvedValueOnce(uploadSession("waitingForUpload"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(uploadSession("completed"));
    await expect(service.uploadBlob("user-1", uploadInput)).rejects.toMatchObject({
      code: "WORKSPACE_RESULT_UNKNOWN",
      message: expect.stringContaining(uploadInput.idempotencyKey),
    });
    await expect(service.uploadBlob("user-1", uploadInput)).resolves.toMatchObject({
      resourceId: "blob-1",
      uploadId: "upload-1",
    });
    expect(request).toHaveBeenCalledTimes(4);
    expect(request.mock.calls[3]).toEqual(request.mock.calls[0]);
  });

  it.each(["verifying", "failed", "expired", "aborted"])(
    "does not publish an upload in state %s",
    async (state) => {
      const { service, request } = setup();
      request.mockResolvedValueOnce(uploadSession(state));
      await expect(service.uploadBlob("user-1", uploadInput)).rejects.toMatchObject({
        code: state === "verifying" ? "WORKSPACE_UPLOAD_PENDING" : "WORKSPACE_UPLOAD_FAILED",
      });
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it("stops an upload when the connection changes after reservation", async () => {
    const { service, request, connection } = setup();
    request.mockImplementationOnce(async () => {
      connection.token = "new-session";
      return uploadSession("waitingForUpload");
    });
    await expect(service.uploadBlob("user-1", uploadInput)).rejects.toMatchObject({
      code: "WORKSPACE_RESULT_UNKNOWN",
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("replaces Blob bytes through the existing authenticated client", async () => {
    const { replace, request } = setup();
    await expect(replace()).resolves.toMatchObject({ etag: '"new"' });
    expect(request).toHaveBeenCalledWith(
      "/api/blob-resources/blob-1/content",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("downloads Blob bytes and their ETag through the existing authenticated client", async () => {
    const { service, request } = setup();
    request.mockResolvedValueOnce(
      new Response("original", { headers: { "content-type": "text/plain", etag: '"downloaded"' } }),
    );
    const result = await service.downloadBlob("user-1", "blob-1");
    expect(Buffer.from(result.bytes).toString()).toBe("original");
    expect(result.etag).toBe('"downloaded"');
    expect(request).toHaveBeenCalledWith("/api/blob-resources/blob-1/download", undefined);
  });

  it.each([
    { state: "completed", kind: "replaceBlobContent", code: null },
    { state: "failed", kind: "replaceBlobContent", code: "PRECONDITION_FAILED" },
    { state: "pending", kind: "replaceBlobContent", code: "WORKSPACE_RESULT_UNKNOWN" },
    { state: "completed", kind: "createBlobResource", code: "MALFORMED_OPERATION" },
  ])(
    "resolves a lost response as $state / $code without repeating the PUT",
    async ({ state, kind, code }) => {
      const { request, replace } = setup();
      request.mockRejectedValueOnce(new Error("response lost"));
      request.mockResolvedValueOnce(
        Response.json({
          id: "blob-replace-request-0001",
          kind,
          state,
          result:
            state === "completed"
              ? { operationId: "blob-replace-request-0001", resourceId: "blob-1", etag: '"new"' }
              : null,
          error:
            state === "failed"
              ? { code: "PRECONDITION_FAILED", message: "Blob content has changed" }
              : null,
        }),
      );
      if (code === null) await expect(replace()).resolves.toMatchObject({ etag: '"new"' });
      else await expect(replace()).rejects.toMatchObject({ code });
      expect(request).toHaveBeenCalledTimes(2);
      expect(request.mock.calls[1]?.[0]).toBe("/api/operations/blob-replace-request-0001");
    },
  );

  it.each(["generation", "identity"])(
    "rejects an obsolete %s before sending bytes",
    async (change) => {
      const { runtime, connection, request, replace } = setup();
      if (change === "generation") runtime.version = "next";
      else connection.userId = "other-user";
      await expect(replace()).rejects.toThrow(/connection is unavailable/);
      expect(request).not.toHaveBeenCalled();
    },
  );

  it.each(["generation", "token", "switching"])(
    "stops recovery requests after %s changes",
    async (change) => {
      const { runtime, connection, request, replace } = setup();
      request.mockImplementationOnce(async (_path, init) => {
        await new Request("https://workspace.test/content", init).text();
        if (change === "generation") runtime.version = "next";
        if (change === "token") connection.token = "new-session";
        if (change === "switching") connection.switching = true;
        throw new Error("response lost while connection changed");
      });
      await expect(replace()).rejects.toMatchObject({ code: "WORKSPACE_RESULT_UNKNOWN" });
      expect(request).toHaveBeenCalledTimes(1);
    },
  );
});
