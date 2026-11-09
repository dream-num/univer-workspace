import { expect, it, vi } from "vitest";
import {
  WorkspaceHttp,
  WorkspaceAssetFeature,
} from "@univerjs/univer-workspace-client-core/product";
import { LocalStagingStore } from "../src/gateway/staging/local.js";
import { assetDownloadTool } from "../src/gateway/tools/files/asset-download.js";
import { blobUploadTool } from "../src/gateway/tools/files/blob-upload.js";
import { UsageAccumulator } from "../src/shared/usage.js";
import { testStagingDirectory } from "./staging-directory.js";

it.each([
  { name: "gateway.txt", fails: false },
  { name: undefined, fails: false },
  { name: undefined, fails: true },
])(
  "uses the upload file name by default and counts bytes once on success ($name, $fails)",
  async ({ name, fails }) => {
    const publishedName = name ?? "original.txt";
    const store = new LocalStagingStore(testStagingDirectory(), "http://mcp.test/mcp");
    const date = "2026-11-08T00:00:00Z";
    const resource = {
      id: "resource",
      kind: "blob",
      mediaType: "text/plain",
      byteSize: 3,
      availability: "ready",
      capabilities: { downloadContent: true, editContent: false, openContent: false },
    };
    const node = {
      id: "node",
      spaceId: "space",
      name: publishedName,
      parentNodeId: null,
      hasChildren: false,
      accessRole: "owner",
      capabilities: {
        browseChildren: false,
        createChildren: false,
        move: true,
        rename: true,
        share: true,
        trash: true,
      },
      resource,
      updatedAt: date,
    };
    const http = new WorkspaceHttp({
      origin: "http://workspace.test",
      cookie: "workspace_session=test",
      role: "client",
      fetcher: async (input) => {
        const path = new URL(input instanceof Request ? input.url : input.toString()).pathname;
        if (path === "/api/spaces/space")
          return Response.json({
            id: "space",
            name: "Team",
            type: "team",
            fullName: "owner/team",
            slug: "team",
            owner: { id: "owner", username: "owner" },
            accessRole: "owner",
            affiliation: "owner",
            publicRead: false,
          });
        if (path === "/api/resources/resource") return Response.json({ node, resource });
        if (path === "/api/blob-upload-sessions") {
          if (fails)
            return Response.json(
              { error: { code: "FORBIDDEN", message: "Refused." } },
              { status: 403 },
            );
          return Response.json({
            operation: {
              id: "key",
              kind: "createBlobResource",
              state: "completed",
              createdAt: date,
              updatedAt: date,
              error: null,
              result: { resourceId: "resource" },
            },
            upload: {
              id: "session",
              operationId: "key",
              nodeId: "node",
              resourceId: "resource",
              state: "completed",
              name: publishedName,
              originalFilename: "original.txt",
              byteSize: 3,
              receivedSize: 3,
              detectedMediaType: "text/plain",
              sha256: null,
              expiresAt: date,
              createdAt: date,
              updatedAt: date,
            },
            uploadTarget: null,
          });
        }
        throw new Error(`Unexpected request ${path}`);
      },
    });
    try {
      const { upload } = await store.createUpload("owner", {
        purpose: "blob",
        file_name: "original.txt",
        media_type: "text/plain",
        size: 3,
      });
      await store.handle(
        new Request(upload.upload_url, {
          method: "PUT",
          body: "abc",
          headers: { "content-length": "3" },
        }),
      );
      const usage = new UsageAccumulator();
      const call = blobUploadTool.run(
        {
          http,
          user: { id: "owner", name: "Owner" },
          identityOrigin: "http://workspace.test",
          requestId: "file-tools",
          scopes: new Set(["publish"]),
          skillDataRoot: "unused",
          resources: () => {
            throw new Error("Unused catalog");
          },
          staging: store,
          usage,
        },
        {
          upload_id: upload.upload_id,
          space: "space",
          ...(name === undefined ? {} : { name }),
          idempotency_key: "key",
        },
      );
      if (fails) {
        await expect(call).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(usage.snapshot().cost.upload_bytes).toBe(0);
        return;
      }
      const result = await call;
      expect(result.output).toMatchObject({
        upload: {
          resourceId: "resource",
          originalFilename: "original.txt",
          url: "http://workspace.test/nodes/node",
          node: { url: "http://workspace.test/nodes/node" },
        },
      });
      expect(blobUploadTool.outputSchema.safeParse(result.output).success).toBe(true);
      expect(usage.snapshot()).toMatchObject({ executor: "none", cost: { upload_bytes: 3 } });
    } finally {
      await store.close();
    }
  },
);

it.each([
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "application/pdf",
  "application/octet-stream",
])("adds an Asset extension for %s", async (mediaType) => {
  const store = new LocalStagingStore(testStagingDirectory(), "http://mcp.test/mcp");
  const close = vi.fn(async () => {});
  const spy = vi.spyOn(WorkspaceAssetFeature.prototype, "downloadStream").mockResolvedValue({
    content: (async function* () {
      yield Buffer.from("abc");
    })(),
    mediaType,
    size: 3,
    etag: null,
    fileName: "asset-id",
    close,
  });
  try {
    const context = {
      http: new WorkspaceHttp({
        origin: "http://workspace.test",
        cookie: "workspace_session=test",
        role: "client",
      }),
      user: { id: "owner", name: "Owner" },
      identityOrigin: "http://workspace.test",
      requestId: "asset-test",
      scopes: new Set<"read">(["read"]),
      skillDataRoot: "unused",
      resources: () => {
        throw new Error("Unused");
      },
      staging: store,
    };
    const result = await assetDownloadTool.run(context, { id: "asset-id", worktree: "wt" });
    const extension = {
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/svg+xml": ".svg",
      "application/pdf": ".pdf",
      "application/octet-stream": ".bin",
    }[mediaType];
    expect(result.output).toMatchObject({ download: { file_name: `asset-id${extension}` } });
    expect(close).toHaveBeenCalledOnce();
  } finally {
    spy.mockRestore();
    await store.close();
  }
});
