import { expect, it, vi } from "vitest";
import {
  WorkspaceHttp,
  WorkspaceAssetFeature,
} from "@univerjs/univer-workspace-client-core/product";
import { LocalStagingStore } from "../src/gateway/staging/local.js";
import { assetDownloadTool } from "../src/gateway/tools/files/asset-download.js";
import { blobUploadTool } from "../src/gateway/tools/files/blob-upload.js";
import { blobDownloadTool } from "../src/gateway/tools/files/blob-download.js";
import { blobReplaceTool } from "../src/gateway/tools/files/blob-replace.js";
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

it("replaces and downloads an upstream file through a fork as a draft of its pull request", async () => {
  const store = new LocalStagingStore(testStagingDirectory(), "http://mcp.test/mcp");
  const resource = {
    id: "r9", kind: "blob", mediaType: "application/pdf", byteSize: 8, availability: "ready",
    capabilities: { downloadContent: true, editContent: false, openContent: true },
  };
  const node = {
    id: "n9", spaceId: "s1", name: "report.pdf", parentNodeId: null, hasChildren: false, accessRole: "viewer", resource, updatedAt: "2026-11-23T00:00:00Z",
    capabilities: { browseChildren: false, createChildren: false, move: false, rename: false, share: false, trash: false },
  };
  const fork = {
    createdAt: "2026-11-23T00:00:00.000Z", fullName: "agent/fix", id: "f1", name: "fix", owner: { id: "a1", username: "agent" }, state: "drafting",
    upstream: { accessRole: "viewer", capabilities: {}, description: "", fullName: "hana/team", id: "s1", name: "Team", owner: { id: "h1", username: "hana" }, publicRead: false, slug: "team", type: "team" },
    worktree: { id: "w1", name: "fix", number: 7, state: "draft", teamSpace: { id: "s1" } },
  };
  const draft = {
    id: "d1", author: { id: "a1", username: "agent" }, kind: "replace", page: false, state: "pending", spaceId: "s1", parentNodeId: null, name: "report.pdf",
    targetResourceId: "r9", baseEtag: '"v1"', byteSize: 3, createdAt: "2026-11-23T00:00:00Z", expiresAt: "2026-11-30T00:00:00Z", decidedAt: null,
    published: null, supersededBy: null, sourceWorktreeId: "w1", publishWhen: "merge",
  };
  const puts: { path: string; ifMatch: string | null; body: string }[] = [];
  const http = new WorkspaceHttp({
    origin: "http://workspace.test",
    cookie: "workspace_session=test",
    role: "client",
    fetcher: async (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname + new URL(request.url).search;
      if (path === "/api/resources/r9") return Response.json({ node, resource });
      if (path === "/api/forks/lookup?name=fix&owner=agent") return Response.json(fork);
      if (path === "/api/worktrees/w1/html-view-drafts") return Response.json({ drafts: puts.length ? [draft] : [] });
      if (path === "/api/html-view-drafts/d1/content") return new Response("abc", { headers: { "content-length": "3", "content-type": "application/octet-stream" } });
      if (path === "/api/blob-resources/r9/download") return new Response("upstream", { headers: { "content-length": "8", "content-type": "application/pdf", etag: '"v1"' } });
      if (path === "/api/forks/f1/blob-resources/r9/content" && request.method === "PUT") {
        puts.push({ path, ifMatch: request.headers.get("if-match"), body: await request.text() });
        return Response.json({ worktree: fork.worktree, draft }, { status: 201 });
      }
      throw new Error(`Unexpected request ${request.method} ${path}`);
    },
  });
  const context = {
    http, user: { id: "a1", name: "Agent" }, identityOrigin: "http://workspace.test", requestId: "fork-files",
    scopes: new Set<"read" | "publish">(["read", "publish"]), resources: () => { throw new Error("Unused catalog"); }, staging: store,
  };
  const download = async () => (await blobDownloadTool.run(context, { resource: "r9", worktree: "agent/fix" })).output as { etag: string; draft?: string; download: { size: number } };
  try {
    expect(await download()).toMatchObject({ etag: '"v1"', download: { size: 8 } });
    expect((await download()).draft).toBeUndefined();
    const { upload } = await store.createUpload("a1", { purpose: "blob", file_name: "report.pdf", media_type: "application/pdf", size: 3 });
    await store.handle(new Request(upload.upload_url, { method: "PUT", body: "abc", headers: { "content-length": "3" } }));
    const replaced = await blobReplaceTool.run(context, { resource: "r9", upload_id: upload.upload_id, etag: '"v1"', idempotency_key: "key-1", worktree: "agent/fix" });
    expect(replaced.output).toEqual({ draft: expect.objectContaining({ id: "d1", kind: "replace", state: "pending", sourceWorktreeId: "w1", publishWhen: "merge", previewUrl: "http://workspace.test/drafts/d1" }) });
    expect(blobReplaceTool.outputSchema.safeParse(replaced.output).success).toBe(true);
    expect(puts).toEqual([{ path: "/api/forks/f1/blob-resources/r9/content", ifMatch: '"v1"', body: "abc" }]);
    expect(await download()).toMatchObject({ etag: '"v1"', draft: "d1", download: { size: 3 } });

    const pull = blobReplaceTool.run(context, { resource: "r9", upload_id: upload.upload_id, etag: '"v1"', idempotency_key: "key-2", worktree: "w1" });
    await expect(pull).rejects.toThrow(/takes a fork address/);
  } finally {
    await store.close();
  }
});
