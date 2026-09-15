import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceBlobFeature, WorkspaceHttp } from "../src/index.js";

const directories: string[] = [];
const intent = { resourceId: "resource/1", etag: '"v1"', idempotencyKey: "replace/1" };
const result = { resourceId: intent.resourceId, operationId: intent.idempotencyKey, etag: '"v2"' };

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function source(bytes = "new bytes"): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "blob-replace-"));
  directories.push(directory);
  const path = join(directory, "edited.bin");
  await writeFile(path, bytes);
  return path;
}

function feature(fetcher: typeof fetch): WorkspaceBlobFeature {
  return new WorkspaceBlobFeature(
    async () =>
      new WorkspaceHttp({
        origin: "https://workspace.test",
        cookie: "session=test",
        role: "client",
        fetcher,
      }),
  );
}

function operation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: intent.idempotencyKey,
    kind: "replaceBlobContent",
    state: "completed",
    createdAt: "2026-09-15T00:00:00Z",
    updatedAt: "2026-09-15T00:00:00Z",
    error: null,
    result,
    ...overrides,
  };
}

describe("Blob content replacement", () => {
  it.each(["new bytes", ""])("streams exact bytes with the downloaded ETag (%j)", async (bytes) => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      expect(request.url).toBe("https://workspace.test/api/blob-resources/resource%2F1/content");
      expect(request.method).toBe("PUT");
      expect(request.headers.get("if-match")).toBe(intent.etag);
      expect(request.headers.get("idempotency-key")).toBe(intent.idempotencyKey);
      expect(request.headers.get("content-length")).toBe(String(Buffer.byteLength(bytes)));
      expect(request.headers.get("content-type")).toBe("application/octet-stream");
      expect(request.headers.get("cookie")).toBe("session=test");
      expect(request.headers.get("origin")).toBe("https://workspace.test");
      expect(await request.text()).toBe(bytes);
      return Response.json(result);
    });
    await expect(
      feature(fetcher).replace({ ...intent, filePath: await source(bytes) }),
    ).resolves.toEqual(result);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(["", "v1", "*", 'W/"v1"', '"a", "b"', '"a\nb"', `"${"a".repeat(200)}"`])(
    "rejects an invalid ETag %j before authentication",
    async (etag) => {
      const auth = vi.fn();
      await expect(
        new WorkspaceBlobFeature(auth).replace({ ...intent, etag, filePath: "missing" }),
      ).rejects.toMatchObject({ code: "workspace-argument-invalid" });
      expect(auth).not.toHaveBeenCalled();
    },
  );

  it("rejects missing identities and unavailable sources before authentication", async () => {
    const auth = vi.fn();
    for (const overrides of [{ resourceId: " " }, { idempotencyKey: " " }]) {
      await expect(
        new WorkspaceBlobFeature(auth).replace({ ...intent, ...overrides, filePath: "missing" }),
      ).rejects.toMatchObject({ code: "workspace-argument-invalid" });
    }
    await expect(
      new WorkspaceBlobFeature(auth).replace({ ...intent, filePath: "missing" }),
    ).rejects.toMatchObject({ code: "workspace-blob-source-unavailable" });
    expect(auth).not.toHaveBeenCalled();
  });

  it.each([403, 409, 412])(
    "preserves HTTP %s without retrying or querying a new ETag",
    async (status) => {
      const fetcher = vi.fn<typeof fetch>(async (input, init) => {
        await new Request(input, init).arrayBuffer();
        return Response.json(
          {
            error: { code: status === 412 ? "PRECONDITION_FAILED" : "DENIED", message: "Rejected" },
          },
          { status },
        );
      });
      await expect(
        feature(fetcher).replace({ ...intent, filePath: await source() }),
      ).rejects.toMatchObject({ detail: { status } });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["network", "body"])(
    "recovers a lost %s response using the same Operation",
    async (failure) => {
      const fetcher = vi.fn<typeof fetch>(async (input, init) => {
        const request = new Request(input, init);
        if (request.method === "PUT") {
          await request.arrayBuffer();
          if (failure === "network") throw new Error("lost response");
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new Error("lost body"));
              },
            }),
          );
        }
        expect(request.url).toBe("https://workspace.test/api/operations/replace%2F1");
        return Response.json(operation());
      });
      await expect(
        feature(fetcher).replace({ ...intent, filePath: await source() }),
      ).resolves.toEqual(result);
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    [operation({ state: "pending", result: null }), "workspace-result-unknown"],
    [
      operation({
        state: "failed",
        result: null,
        error: { code: "PRECONDITION_FAILED", message: "Changed" },
      }),
      "PRECONDITION_FAILED",
    ],
    [operation({ id: "other" }), "workspace-result-mismatch"],
    [operation({ kind: "createBlobResource" }), "workspace-result-mismatch"],
    [operation({ state: "other" }), "workspace-invalid-response"],
    [operation({ result: { ...result, resourceId: "other" } }), "workspace-result-mismatch"],
    [operation({ result: { ...result, etag: "invalid" } }), "workspace-invalid-response"],
  ])("handles an unconfirmed or invalid Operation %# without replaying", async (body, code) => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      if (request.method === "PUT") {
        await request.arrayBuffer();
        throw new Error("lost");
      }
      return Response.json(body);
    });
    await expect(
      feature(fetcher).replace({ ...intent, filePath: await source() }),
    ).rejects.toMatchObject({ code });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([404, 503])(
    "keeps recovery identity when status lookup returns HTTP %s",
    async (status) => {
      const filePath = await source();
      const fetcher = vi.fn<typeof fetch>(async (input, init) => {
        const request = new Request(input, init);
        if (request.method === "PUT") {
          await request.arrayBuffer();
          throw new Error("lost");
        }
        return new Response(null, { status });
      });
      await expect(feature(fetcher).replace({ ...intent, filePath })).rejects.toMatchObject({
        code: "workspace-result-unknown",
        detail: {
          ...intent,
          operationId: intent.idempotencyKey,
          sourcePath: filePath,
          byteSize: 9,
        },
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    [{ ...result, operationId: "other" }, "workspace-result-mismatch"],
    [{ ...result, resourceId: "other" }, "workspace-result-mismatch"],
    [{ ...result, etag: 'W/"v2"' }, "workspace-invalid-response"],
  ])("rejects an invalid success response %#", async (body, code) => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      await new Request(input, init).arrayBuffer();
      return Response.json(body);
    });
    await expect(
      feature(fetcher).replace({ ...intent, filePath: await source() }),
    ).rejects.toMatchObject({ code });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
