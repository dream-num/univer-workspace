import { writeFile, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WorkspaceAssetFeature,
  WorkspaceBlobFeature,
  WorkspaceHttp,
  resolveWorkspaceAssetContent,
  type AuthenticatedWorkspaceHttp,
} from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (path) => await rm(path, { force: true, recursive: true })),
  );
});

describe("Workspace application feature parity", () => {
  it("validates Blob upload input before acquiring authenticated HTTP", async () => {
    const provider = vi.fn<AuthenticatedWorkspaceHttp>();
    const feature = new WorkspaceBlobFeature(provider);

    await expect(
      feature.upload({ filePath: "missing.bin", spaceId: "space-1" }),
    ).rejects.toMatchObject({ code: "workspace-blob-source-unavailable" });
    expect(provider).not.toHaveBeenCalled();
  });

  it("retries an unknown Blob reservation with one exact stable intent", async () => {
    const directory = await temporaryDirectory();
    const sourcePath = join(directory, "payload.bin");
    await writeFile(sourcePath, "abc");
    const requests: Request[] = [];
    const feature = new WorkspaceBlobFeature(
      authFor(async (input, init) => {
        requests.push(new Request(input, init));
        throw new Error("reserve response lost");
      }),
    );

    await expect(
      feature.upload({ filePath: sourcePath, idempotencyKey: "blob-key", spaceId: "space-1" }),
    ).rejects.toMatchObject({
      code: "workspace-result-unknown",
      detail: { request: { idempotencyKey: "blob-key", sourcePath } },
    });
    expect(requests).toHaveLength(3);
    expect(requests.map((request) => request.headers.get("idempotency-key"))).toEqual([
      "blob-key",
      "blob-key",
      "blob-key",
    ]);
    await expect(Promise.all(requests.map(async (request) => await request.json()))).resolves.toEqual(
      Array.from({ length: 3 }, () => ({
        byteSize: 3,
        name: "payload.bin",
        originalFilename: "payload.bin",
        parentNodeId: null,
        spaceId: "space-1",
      })),
    );
  });

  it("recovers Blob PUT and completion without replaying a confirmed write", async () => {
    const directory = await temporaryDirectory();
    const sourcePath = join(directory, "payload.bin");
    await writeFile(sourcePath, "abc");
    let putCount = 0;
    let statusCount = 0;
    let completeCount = 0;
    const feature = new WorkspaceBlobFeature(
      authFor(async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        if (url.pathname === "/api/blob-upload-sessions" && init?.method === "POST") {
          return jsonResponse(uploadEnvelope("waitingForUpload", { uploadTarget: true }));
        }
        if (url.pathname.endsWith("/content") && init?.method === "PUT") {
          putCount += 1;
          throw new Error("upload response lost");
        }
        if (url.pathname.endsWith("/complete") && init?.method === "POST") {
          completeCount += 1;
          throw new Error("completion response lost");
        }
        if (url.pathname === "/api/blob-upload-sessions/upload-1") {
          statusCount += 1;
          return jsonResponse(uploadEnvelope(statusCount === 1 ? "uploaded" : "completed"));
        }
        if (url.pathname === "/api/resources/resource-1") {
          const owningNode = node({
            id: "node-1",
            name: "payload.bin",
            resource: blobResource(),
          });
          return jsonResponse({ node: owningNode, resource: owningNode.resource });
        }
        throw new Error(`unexpected request ${init?.method ?? "GET"} ${url.pathname}`);
      }),
    );

    await expect(
      feature.upload({ filePath: sourcePath, idempotencyKey: "blob-key", spaceId: "space-1" }),
    ).resolves.toMatchObject({
      idempotencyKey: "blob-key",
      nodeId: "node-1",
      operationId: "operation-1",
      resourceId: "resource-1",
      uploadId: "upload-1",
    });
    expect({ completeCount, putCount, statusCount }).toEqual({
      completeCount: 1,
      putCount: 1,
      statusCount: 2,
    });
  });

  it("rejects a replaced Blob identity after completion recovery before another complete", async () => {
    const directory = await temporaryDirectory();
    const sourcePath = join(directory, "payload.bin");
    await writeFile(sourcePath, "abc");
    let completeCount = 0;
    let resourceCount = 0;
    let statusCount = 0;
    const feature = new WorkspaceBlobFeature(
      authFor(async (input, init) => {
        const pathname = new URL(input instanceof Request ? input.url : input.toString()).pathname;
        if (pathname === "/api/blob-upload-sessions" && init?.method === "POST") {
          return jsonResponse(uploadEnvelope("uploaded"));
        }
        if (pathname.endsWith("/complete") && init?.method === "POST") {
          completeCount += 1;
          throw new Error("completion response lost");
        }
        if (pathname === "/api/blob-upload-sessions/upload-1") {
          statusCount += 1;
          if (statusCount === 1) return jsonResponse(uploadEnvelope("uploaded"));
          const replaced = uploadEnvelope("uploaded");
          return jsonResponse({
            ...replaced,
            operation: {
              ...(replaced["operation"] as Record<string, unknown>),
              id: "operation-2",
            },
            upload: {
              ...(replaced["upload"] as Record<string, unknown>),
              nodeId: "node-2",
              operationId: "operation-2",
              resourceId: "resource-2",
            },
          });
        }
        resourceCount += 1;
        throw new Error(`unexpected Resource read-back ${pathname}`);
      }),
    );

    await expect(
      feature.upload({ filePath: sourcePath, idempotencyKey: "blob-key", spaceId: "space-1" }),
    ).rejects.toMatchObject({
      code: "workspace-result-mismatch",
      detail: {
        actual: { nodeId: "node-2", operationId: "operation-2", resourceId: "resource-2" },
        expected: {
          nodeId: "node-1",
          operationId: "operation-1",
          resourceId: "resource-1",
        },
      },
    });
    expect({ completeCount, resourceCount, statusCount }).toEqual({
      completeCount: 1,
      resourceCount: 0,
      statusCount: 2,
    });
  });

  it("preserves stable public upload identity when completed Resource read-back is unknown", async () => {
    const directory = await temporaryDirectory();
    const sourcePath = join(directory, "payload.bin");
    await writeFile(sourcePath, "abc");
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const pathname = new URL(input instanceof Request ? input.url : input.toString()).pathname;
      if (pathname === "/api/blob-upload-sessions") {
        return jsonResponse(uploadEnvelope("completed"));
      }
      throw new Error("resource response lost");
    });

    await expect(
      new WorkspaceBlobFeature(authFor(fetcher)).upload({
        filePath: sourcePath,
        idempotencyKey: "blob-key",
        spaceId: "space-1",
      }),
    ).rejects.toMatchObject({
      code: "workspace-result-unknown",
      message: "The Workspace request result is unknown because the network request failed.",
      detail: {
        byteSize: 3,
        cause: "resource response lost",
        declaredMediaType: null,
        idempotencyKey: "blob-key",
        name: "payload.bin",
        originalFilename: "payload.bin",
        parentNodeId: null,
        sourcePath,
        spaceId: "space-1",
        state: "completed",
        uploadId: "upload-1",
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects a published Blob that differs from its reserved intent", async () => {
    const directory = await temporaryDirectory();
    const sourcePath = join(directory, "payload.bin");
    await writeFile(sourcePath, "abc");
    const feature = new WorkspaceBlobFeature(
      authFor(async (input) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        if (url.pathname === "/api/blob-upload-sessions") {
          return jsonResponse(uploadEnvelope("completed"));
        }
        const wrongNode = node({ id: "node-1", name: "different.bin", resource: blobResource() });
        return jsonResponse({ node: wrongNode, resource: wrongNode.resource });
      }),
    );

    await expect(
      feature.upload({ filePath: sourcePath, spaceId: "space-1" }),
    ).rejects.toMatchObject({
      code: "workspace-result-mismatch",
    });
  });

  it.each(["failed", "expired", "aborted"] as const)(
    "rejects terminal Blob upload state %s without another write",
    async (state) => {
      const directory = await temporaryDirectory();
      const sourcePath = join(directory, "payload.bin");
      await writeFile(sourcePath, "abc");
      const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(uploadEnvelope(state)));

      await expect(
        new WorkspaceBlobFeature(authFor(fetcher)).upload({
          filePath: sourcePath,
          spaceId: "space-1",
        }),
      ).rejects.toMatchObject({
        code: "workspace-blob-upload-terminal",
        detail: { sourcePath, state, uploadId: "upload-1" },
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it("bounds a Blob upload that remains waiting", async () => {
    const directory = await temporaryDirectory();
    const sourcePath = join(directory, "payload.bin");
    await writeFile(sourcePath, "abc");
    const requests: string[] = [];
    const feature = new WorkspaceBlobFeature(
      authFor(async (input, init) => {
        const request = new Request(input, init);
        const pathname = new URL(request.url).pathname;
        requests.push(`${request.method} ${pathname}`);
        return pathname === "/api/blob-upload-sessions"
          ? jsonResponse(uploadEnvelope("waitingForUpload", { uploadTarget: true }))
          : pathname.endsWith("/content")
            ? new Response(null)
            : jsonResponse(uploadEnvelope("waitingForUpload", { uploadTarget: true }));
      }),
    );

    await expect(feature.upload({ filePath: sourcePath, spaceId: "space-1" })).rejects.toMatchObject(
      {
        code: "workspace-result-unknown",
        detail: { state: "waitingForUpload", uploadId: "upload-1" },
      },
    );
    expect(requests).toEqual([
      "POST /api/blob-upload-sessions",
      "PUT /api/blob-upload-sessions/upload-1/content",
      "GET /api/blob-upload-sessions/upload-1",
      "PUT /api/blob-upload-sessions/upload-1/content",
      "GET /api/blob-upload-sessions/upload-1",
      "PUT /api/blob-upload-sessions/upload-1/content",
      "GET /api/blob-upload-sessions/upload-1",
    ]);
  });

  it("rejects mismatched Blob Operation and Upload identities before content upload", async () => {
    const directory = await temporaryDirectory();
    const sourcePath = join(directory, "payload.bin");
    await writeFile(sourcePath, "abc");
    for (const envelope of [
      {
        ...uploadEnvelope("waitingForUpload", { uploadTarget: true }),
        operation: {
          ...(uploadEnvelope("waitingForUpload").operation as Record<string, unknown>),
          kind: "otherOperation",
        },
      },
      {
        ...uploadEnvelope("waitingForUpload", { uploadTarget: true }),
        upload: {
          ...(uploadEnvelope("waitingForUpload").upload as Record<string, unknown>),
          operationId: "operation-other",
        },
      },
    ]) {
      const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(envelope));
      await expect(
        new WorkspaceBlobFeature(authFor(fetcher)).upload({
          filePath: sourcePath,
          spaceId: "space-1",
        }),
      ).rejects.toMatchObject({ code: "workspace-result-mismatch" });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it("keeps the reserved Blob identity bound across status refresh", async () => {
    const directory = await temporaryDirectory();
    const sourcePath = join(directory, "payload.bin");
    await writeFile(sourcePath, "abc");
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const pathname = new URL(input instanceof Request ? input.url : input.toString()).pathname;
      if (pathname === "/api/blob-upload-sessions") {
        return jsonResponse(uploadEnvelope("waitingForUpload", { uploadTarget: true }));
      }
      if (pathname.endsWith("/content")) return new Response(null);
      const refreshed = uploadEnvelope("uploaded");
      return jsonResponse({
        ...refreshed,
        upload: {
          ...(refreshed["upload"] as Record<string, unknown>),
          nodeId: "node-other",
        },
      });
    });

    await expect(
      new WorkspaceBlobFeature(authFor(fetcher)).upload({ filePath: sourcePath, spaceId: "space-1" }),
    ).rejects.toMatchObject({ code: "workspace-result-mismatch" });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("downloads Blob bytes only when HTTP metadata matches Resource metadata", async () => {
    const directory = await temporaryDirectory();
    const outputPath = join(directory, "blob.bin");
    const feature = new WorkspaceBlobFeature(
      authFor(async (input) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        if (url.pathname === "/api/resources/resource-1") {
          const owningNode = node({ id: "node-1", name: "payload.bin", resource: blobResource() });
          return jsonResponse({ node: owningNode, resource: owningNode.resource });
        }
        return new Response("abc", {
          headers: {
            "content-length": "3",
            "content-type": "application/octet-stream",
            etag: "v1",
          },
        });
      }),
    );

    await expect(feature.download({ outputPath, resourceId: "resource-1" })).resolves.toMatchObject(
      {
        byteSize: 3,
        etag: "v1",
        mediaType: "application/octet-stream",
        nodeId: "node-1",
        outputPath,
        resourceId: "resource-1",
      },
    );
    expect(await readFile(outputPath, "utf8")).toBe("abc");

    const missingMetadata = new WorkspaceBlobFeature(
      authFor(async (input) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        if (url.pathname.startsWith("/api/resources/")) {
          const owningNode = node({ resource: blobResource() });
          return jsonResponse({ node: owningNode, resource: owningNode.resource });
        }
        return new Response(new Uint8Array([97, 98, 99]));
      }),
    );
    await expect(
      missingMetadata.download({
        outputPath: join(directory, "invalid.bin"),
        resourceId: "resource-1",
      }),
    ).rejects.toMatchObject({ code: "workspace-invalid-response" });
  });

  it("rejects unavailable and mismatched Blob metadata before content download", async () => {
    const directory = await temporaryDirectory();
    const outputPath = join(directory, "blob.bin");
    for (const owningNode of [
      node({ resource: { ...blobResource(), availability: "quarantined" } }),
      node({ resource: { ...blobResource(), id: "resource-other" } }),
    ]) {
      const fetcher = vi.fn<typeof fetch>(async () =>
        jsonResponse({ node: owningNode, resource: owningNode["resource"] }),
      );
      await expect(
        new WorkspaceBlobFeature(authFor(fetcher)).download({
          outputPath,
          resourceId: "resource-1",
        }),
      ).rejects.toMatchObject({
        code:
          (owningNode["resource"] as Record<string, unknown>)["availability"] === "quarantined"
            ? "workspace-blob-download-unavailable"
            : "workspace-result-mismatch",
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it("validates Asset sign envelopes and downloads the exact signed response", async () => {
    const directory = await temporaryDirectory();
    const outputPath = join(directory, "asset.bin");
    let contentCookie: string | null = "not-called";
    const feature = new WorkspaceAssetFeature(
      authFor(async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        if (url.pathname.endsWith("/sign-url")) {
          return jsonResponse({ error: { code: 1, message: "" }, url: "https://cdn.test/file-1" });
        }
        contentCookie = new Headers(init?.headers).get("cookie");
        return new Response("asset", {
          headers: {
            "content-length": "5",
            "content-type": "application/octet-stream",
            etag: "asset-v1",
          },
        });
      }),
    );

    await expect(
      feature.download({ assetId: "file-1", outputPath, worktreeId: "wt-1" }),
    ).resolves.toMatchObject({
      assetId: "file-1",
      byteLength: 5,
      etag: "asset-v1",
      outputPath,
      worktreeId: "wt-1",
    });
    expect(await readFile(outputPath, "utf8")).toBe("asset");
    expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
    expect(contentCookie).toBeNull();

    const invalid = new WorkspaceAssetFeature(
      authFor(async () => jsonResponse({ error: { code: true, message: "invalid" } })),
    );
    await expect(
      invalid.download({
        assetId: "file-1",
        outputPath: join(directory, "bad.bin"),
        worktreeId: "wt-1",
      }),
    ).rejects.toMatchObject({ code: "workspace-invalid-response" });
  });

  it.each([
    ["missing", undefined],
    ["non-http", "file:///tmp/asset"],
    ["credentials", "https://user:secret@cdn.test/asset"],
  ])("rejects an invalid Asset content URL (%s) before content fetch", async (_case, url) => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      jsonResponse({ error: { code: 1, message: "" }, ...(url === undefined ? {} : { url }) }),
    );
    const http = new WorkspaceHttp({
      cookie: "workspace_session=test",
      fetcher,
      origin: "https://workspace.test",
      role: "client",
    });

    await expect(
      resolveWorkspaceAssetContent(http, { assetId: "file-1", worktreeId: "wt-1" }),
    ).rejects.toMatchObject({ code: "workspace-invalid-response" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps Workspace credentials on same-origin Asset content only", async () => {
    for (const [contentUrl, expectedCookie] of [
      ["/content/file-1", "workspace_session=test"],
      ["https://cdn.test/content/file-1", null],
    ] as const) {
      const cookies: Array<string | null> = [];
      const http = new WorkspaceHttp({
        cookie: "workspace_session=test",
        fetcher: async (_input, init) => {
          cookies.push(new Headers(init?.headers).get("cookie"));
          return cookies.length === 1
            ? jsonResponse({ error: { code: 1, message: "" }, url: contentUrl })
            : new Response("asset", { headers: { "content-type": "application/octet-stream" } });
        },
        origin: "https://workspace.test",
        role: "client",
      });

      await expect(
        resolveWorkspaceAssetContent(http, { assetId: "file-1", worktreeId: "wt-1" }),
      ).resolves.toBeInstanceOf(Response);
      expect(cookies).toEqual(["workspace_session=test", expectedCookie]);
    }
  });

  it("refuses an Asset content redirect and leaves no output", async () => {
    const directory = await temporaryDirectory();
    const outputPath = join(directory, "redirect.bin");
    const feature = new WorkspaceAssetFeature(
      authFor(async (input) =>
        new URL(input instanceof Request ? input.url : input.toString()).pathname.endsWith(
          "/sign-url",
        )
          ? jsonResponse({ error: { code: 1, message: "" }, url: "https://cdn.test/file-1" })
          : new Response(null, { headers: { location: "https://other.test/file-1" }, status: 302 }),
      ),
    );

    await expect(
      feature.download({ assetId: "file-1", outputPath, worktreeId: "wt-1" }),
    ).rejects.toMatchObject({ code: "workspace-redirect-refused" });
    expect(await readdir(directory)).toEqual([]);
  });

  it.each([
    [
      "missing media type",
      new Response(Buffer.from("asset"), { headers: { "content-length": "5" } }),
    ],
    [
      "short stream",
      new Response("asset", {
        headers: { "content-length": "6", "content-type": "application/octet-stream" },
      }),
    ],
  ])("rejects invalid Asset content metadata or bytes: %s", async (_case, response) => {
    const directory = await temporaryDirectory();
    const outputPath = join(directory, "invalid-asset.bin");
    const feature = new WorkspaceAssetFeature(
      authFor(async (input) =>
        new URL(input instanceof Request ? input.url : input.toString()).pathname.endsWith(
          "/sign-url",
        )
          ? jsonResponse({ error: { code: 1, message: "" }, url: "https://cdn.test/file-1" })
          : response,
      ),
    );

    await expect(
      feature.download({ assetId: "file-1", outputPath, worktreeId: "wt-1" }),
    ).rejects.toMatchObject({
      code:
        _case === "missing media type"
          ? "workspace-invalid-response"
          : "workspace-asset-size-mismatch",
    });
    expect(await readdir(directory)).toEqual([]);
  });

  it("does not call the Asset sign endpoint when a non-force output already exists", async () => {
    const directory = await temporaryDirectory();
    const outputPath = join(directory, "existing.bin");
    await writeFile(outputPath, "keep");
    let requests = 0;
    const authenticatedHttp = vi.fn(
      authFor(async () => {
        requests += 1;
        return jsonResponse({});
      }),
    );
    const feature = new WorkspaceAssetFeature(authenticatedHttp);
    await expect(
      feature.download({ assetId: "file-1", outputPath, worktreeId: "wt-1" }),
    ).rejects.toMatchObject({ code: "workspace-asset-output-exists" });
    expect(requests).toBe(0);
    expect(authenticatedHttp).toHaveBeenCalledTimes(1);
    expect(await readFile(outputPath, "utf8")).toBe("keep");
  });

});

function authFor(fetcher: typeof fetch): AuthenticatedWorkspaceHttp {
  const http = new WorkspaceHttp({
    cookie: "workspace_session=test",
    fetcher,
    origin: "https://workspace.test",
    role: "client",
  });
  return async () => http;
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function node(
  overrides: {
    readonly hasChildren?: boolean;
    readonly id?: string;
    readonly name?: string;
    readonly parentNodeId?: string | null;
    readonly resource?: Record<string, unknown> | null;
  } = {},
): Record<string, unknown> {
  return {
    accessRole: "owner",
    capabilities: {
      browseChildren: true,
      createChildren: true,
      move: true,
      rename: true,
      share: true,
      trash: true,
    },
    hasChildren: overrides.hasChildren ?? false,
    id: overrides.id ?? "node-1",
    name: overrides.name ?? "Folder",
    parentNodeId: overrides.parentNodeId ?? null,
    resource: overrides.resource ?? null,
    spaceId: "space-1",
    updatedAt: "2026-08-05T00:00:00.000Z",
  };
}

function blobResource(): Record<string, unknown> {
  return {
    availability: "ready",
    byteSize: 3,
    capabilities: { downloadContent: true, editContent: false, openContent: false },
    id: "resource-1",
    kind: "blob",
    mediaType: "application/octet-stream",
  };
}

function uploadEnvelope(
  state:
    | "waitingForUpload"
    | "uploaded"
    | "verifying"
    | "completed"
    | "failed"
    | "expired"
    | "aborted",
  options: { readonly uploadTarget?: boolean } = {},
): Record<string, unknown> {
  return {
    operation: {
      createdAt: "2026-08-05T00:00:00.000Z",
      error: null,
      id: "operation-1",
      kind: "createBlobResource",
      result: state === "completed" ? { resourceId: "resource-1" } : null,
      state: state === "completed" ? "completed" : "pending",
      updatedAt: "2026-08-05T00:00:00.000Z",
    },
    upload: {
      byteSize: 3,
      createdAt: "2026-08-05T00:00:00.000Z",
      detectedMediaType: state === "completed" ? "application/octet-stream" : null,
      expiresAt: "2026-08-06T00:00:00.000Z",
      id: "upload-1",
      name: "payload.bin",
      nodeId: "node-1",
      operationId: "operation-1",
      originalFilename: "payload.bin",
      receivedSize: state === "waitingForUpload" ? null : 3,
      resourceId: "resource-1",
      sha256: null,
      state,
      updatedAt: "2026-08-05T00:00:00.000Z",
    },
    uploadTarget:
      options.uploadTarget === true
        ? { contentUrl: "/api/blob-upload-sessions/upload-1/content", method: "PUT" }
        : null,
  };
}

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "workspace-app-features-"));
  temporaryDirectories.push(path);
  return path;
}
