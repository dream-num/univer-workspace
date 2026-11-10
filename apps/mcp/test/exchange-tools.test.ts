import { expect, it, vi } from "vitest";
import { WorkspaceHttp } from "@univerjs/univer-workspace-client-core/product";
import { LocalStagingStore } from "../src/gateway/staging/local.js";
import { importTool } from "../src/gateway/tools/core/import.js";
import { exportTool } from "../src/gateway/tools/core/export.js";
import { createExecutorLinks } from "../src/gateway/tools/executor-tool.js";
import type { ToolContext } from "../src/gateway/tools/definition.js";
import { UsageAccumulator, zeroCost } from "../src/shared/usage.js";
import { encodeFrame, decodeFrame } from "../src/shared/frame.js";
import { testStagingDirectory } from "./staging-directory.js";

const user = { id: "owner", name: "Owner" };
function context(store: LocalStagingStore): ToolContext {
  const usage = new UsageAccumulator();
  const http = new WorkspaceHttp({
    origin: "http://workspace.test",
    role: "client",
    cookie: "workspace_session=test",
  });
  return {
    staging: store,
    usage,
    http,
    user,
    identityOrigin: http.origin,
    requestId: "exchange-test",
    resources: () => {
      throw new Error("unused");
    },
    scopes: new Set(["read", "write"]),
    executor: createExecutorLinks({
      urls: ["http://executor.test"],
      executorToken: "executor-token-".repeat(4),
    })(
      {
        authKind: "dev",
        session: "session",
        obtainedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        user,
        scopes: new Set(["read", "write"]),
        clientId: "dev",
      },
      user,
      "exchange-test",
      Date.now() + 30_000,
      usage,
    ),
  };
}

it("checks upload ownership and purpose before contacting the executor", async () => {
  const store = new LocalStagingStore(testStagingDirectory(), "http://mcp.test/mcp");
  const fetcher = vi.spyOn(globalThis, "fetch");
  try {
    const foreign = await store.createUpload("another-user", {
      purpose: "office-import",
      file_name: "foreign.xlsx",
      size: 1,
      media_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const wrong = await store.createUpload("owner", {
      purpose: "blob",
      file_name: "blob.txt",
      size: 1,
      media_type: "text/plain",
    });
    await store.handle(
      new Request(wrong.upload.upload_url, {
        method: "PUT",
        body: new Uint8Array([255]),
        headers: { "content-length": "1" },
      }),
    );
    for (const [upload_id, code] of [
      [foreign.upload.upload_id, "workspace-upload-not-found"],
      [wrong.upload.upload_id, "workspace-upload-purpose-mismatch"],
    ])
      await expect(
        importTool.run(context(store), {
          upload_id,
          worktree: "wt",
          space: "space",
          idempotency_key: "valid-retry-key-123",
        }),
      ).rejects.toMatchObject({ code });
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    fetcher.mockRestore();
    await store.close();
  }
});

it("stages executor export bytes with attachment headers and records byte usage", async () => {
  const store = new LocalStagingStore(testStagingDirectory(), "http://mcp.test/mcp");
  const bytes = new Uint8Array([0, 255, 1, 128]);
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
    const frame = decodeFrame(Buffer.from(await new Response(options?.body).arrayBuffer()));
    expect(frame.header).toMatchObject({
      op: "exchange.export",
      input: { unitId: "unit", worktreeId: "wt", format: "xlsx" },
    });
    return new Response(
      new Uint8Array(
        encodeFrame(
          {
            ok: true,
            output: { name: "Annual report", type: "sheet", unitId: "unit", worktreeId: "wt" },
            meta: { executor: "cold_start", cost: { ...zeroCost } },
          },
          bytes,
        ),
      ),
    );
  });
  try {
    const ctx = context(store);
    const result = await exportTool.run(ctx, { worktree: "wt", unit: "unit", format: "xlsx" });
    const output = exportTool.outputSchema.parse(result.output);
    const download = output["download"] as { url: string };
    const response = await store.handle(new Request(download.url));
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(response.headers.get("content-disposition")).toContain("Annual%20report.xlsx");
    expect(response.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(ctx.usage?.snapshot()).toMatchObject({ cost: { export_bytes: bytes.length } });
  } finally {
    fetcher.mockRestore();
    await store.close();
  }
});

it.each([undefined, 10])(
  "imports actual binary bytes with optional size upper bound %s and returns CLI fields plus a pull URL",
  async (size) => {
    const store = new LocalStagingStore(testStagingDirectory(), "http://mcp.test/mcp");
    const bytes = new Uint8Array([0, 255, 128, 80, 75]);
    const imported = {
      committed: true,
      name: "Imported",
      nodeId: "node",
      resourceId: "res",
      sourcePath: "book.xlsx",
      type: "sheet",
      unitId: "unit",
      worktreeId: "wt",
    };
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
      const path = new URL(url instanceof Request ? url.url : url.toString()).pathname;
      if (path === "/rpc/v1/exchange.import") {
        const frame = decodeFrame(Buffer.from(await new Response(options?.body).arrayBuffer()));
        expect(frame.payload).toEqual(Buffer.from(bytes));
        expect(frame.header).toMatchObject({
          input: { idempotencyKey: "valid-retry-key-123", spaceId: "space", fileName: "book.xlsx" },
        });
        return new Response(
          new Uint8Array(
            encodeFrame({
              ok: true,
              output: imported,
              meta: {
                executor: "cold_start",
                unitType: "sheet",
                repo: "space",
                cost: { ...zeroCost, committed_revisions: 1 },
              },
            }),
          ),
        );
      }
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
      if (path === "/api/worktrees/wt")
        return Response.json({
          worktree: {
            id: "wt",
            name: "Import",
            state: "draft",
            number: 3,
            summary: null,
            kind: "team",
            visibility: "private",
            teamSpace: { id: "space", name: "Team" },
            creator: { id: "owner", username: "owner", displayName: "Owner" },
            createdAt: "2026-11-08T00:00:00Z",
            updatedAt: "2026-11-08T00:00:00Z",
            units: [],
          },
        });
      throw new Error(`Unexpected ${path}`);
    });
    try {
      const { upload } = await store.createUpload("owner", {
        purpose: "office-import",
        file_name: "book.xlsx",
        media_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ...(size === undefined ? {} : { size }),
      });
      expect(
        (
          await store.handle(
            new Request(upload.upload_url, {
              method: "PUT",
              body: bytes,
              headers: { "content-length": String(bytes.length) },
            }),
          )
        ).status,
      ).toBe(204);
      const ctx = context(store);
      const result = await importTool.run(ctx, {
        upload_id: upload.upload_id,
        space: "space",
        worktree: "wt",
        idempotency_key: "valid-retry-key-123",
      });
      expect(result.output).toEqual({
        ...imported,
        url: "http://workspace.test/spaces/space/pulls/3?unit=unit",
      });
      expect(importTool.outputSchema.safeParse(result.output).success).toBe(true);
      expect(ctx.usage?.snapshot()).toMatchObject({
        cost: { upload_bytes: bytes.length, committed_revisions: 1 },
      });
      expect((await store.requireUpload("owner", upload.upload_id, "office-import")).state).toBe(
        "ready",
      );
    } finally {
      fetcher.mockRestore();
      await store.close();
    }
  },
);
