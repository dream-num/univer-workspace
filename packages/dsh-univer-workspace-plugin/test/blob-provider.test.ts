import { Context } from "@deepseek-ai/cordis";
import { describe, expect, it, vi } from "vitest";
import { apply } from "../src/provider/service-provider.ts";

const root = "/tmp/dsh-blob-provider-tests";

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
