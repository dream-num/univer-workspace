import { expect, it, vi } from "vitest";
import { WorkspaceHttp } from "@univerjs/univer-workspace-client-core/product";
import { ToolJobs } from "../src/gateway/jobs/store.js";
import { LocalStagingStore } from "../src/gateway/staging/local.js";
import { exportTool } from "../src/gateway/tools/core/export.js";
import { importTool } from "../src/gateway/tools/core/import.js";
import { createExecutorLinks } from "../src/gateway/tools/executor-tool.js";
import type { ToolContext } from "../src/gateway/tools/definition.js";
import { UsageAccumulator, zeroCost } from "../src/shared/usage.js";
import { encodeFrame } from "../src/shared/frame.js";
import { testStagingDirectory } from "./staging-directory.js";

const user = { id: "owner", name: "Owner" };
const xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const key = "valid-retry-key-123";
function context(store: LocalStagingStore): ToolContext {
  const usage = new UsageAccumulator();
  const http = new WorkspaceHttp({
    origin: "http://workspace.test",
    role: "client",
    cookie: "workspace_session=test",
  });
  return {
    staging: store,
    jobs: new ToolJobs(store, 1000),
    usage,
    http,
    user,
    identityOrigin: http.origin,
    requestId: "conflict-test",
    skillDataRoot: "unused",
    resources: () => {
      throw new Error("unused");
    },
    scopes: new Set(["read", "write"]),
    executor: createExecutorLinks({
      urls: ["http://executor.test"],
      internalToken: "internal-token-".repeat(4),
    })(
      {
        authKind: "dev",
        session: "session",
        obtainedAt: Date.now(),
        expiresAt: Date.now() + 600_000,
        user,
        scopes: new Set(["read", "write"]),
        clientId: "dev",
      },
      user,
      "conflict-test",
      Date.now() + 30_000,
      usage,
    ),
  };
}
const ok = (output: object, bytes?: Uint8Array) =>
  new Response(
    new Uint8Array(
      encodeFrame(
        {
          ok: true,
          output,
          meta: { executor: "cold_start", unitType: "sheet", repo: "space", cost: { ...zeroCost } },
        },
        bytes,
      ),
    ),
  );
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
function worktree(id: string) {
  return Response.json({
    worktree: {
      id,
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
}
function space() {
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
}

it("rejects a reused export key with different arguments and starts nothing", async () => {
  const store = new LocalStagingStore(testStagingDirectory(), "http://mcp.test/mcp");
  const calls = vi.fn();
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    calls();
    return ok(
      { name: "Book", type: "sheet", unitId: "unit", worktreeId: "wt" },
      new Uint8Array([1, 2]),
    );
  });
  try {
    const ctx = context(store);
    const args = { worktree: "wt", unit: "unit", format: "xlsx", idempotency_key: key };
    const first = await exportTool.run(ctx, args);
    for (const changed of [{ format: "docx" }, { worktree: "other" }, { unit: "other" }])
      await expect(exportTool.run(ctx, { ...args, ...changed })).rejects.toMatchObject({
        code: "workspace-idempotency-conflict",
      });
    expect(calls).toHaveBeenCalledTimes(1);
    const replay = await exportTool.run(ctx, {
      idempotency_key: key,
      ...{ format: "xlsx", unit: "unit", worktree: "wt" },
    });
    expect(replay.output).toEqual(first.output);
    expect(calls).toHaveBeenCalledTimes(1);
  } finally {
    fetcher.mockRestore();
    await store.close();
  }
});

it("rejects a reused import key with a different upload, worktree or type and starts nothing", async () => {
  const store = new LocalStagingStore(testStagingDirectory(), "http://mcp.test/mcp");
  const conversions = vi.fn();
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const path = new URL(url instanceof Request ? url.url : url.toString()).pathname;
    if (path === "/rpc/v1/exchange.import") {
      conversions();
      return ok(imported);
    }
    if (path === "/api/spaces/space") return space();
    if (path.startsWith("/api/worktrees/")) return worktree(path.split("/").pop()!);
    throw new Error(`Unexpected ${path}`);
  });
  try {
    const upload = async (name: string) => {
      const { upload } = await store.createUpload("owner", {
        purpose: "office-import",
        file_name: name,
        media_type: xlsx,
      });
      await store.handle(
        new Request(upload.upload_url, {
          method: "PUT",
          body: new Uint8Array([80, 75]),
          headers: { "content-length": "2" },
        }),
      );
      return upload.upload_id;
    };
    const [a, b] = [await upload("a.xlsx"), await upload("b.xlsx")];
    const ctx = context(store);
    const args = { upload_id: a, worktree: "wt", space: "space", idempotency_key: key };
    const first = await importTool.run(ctx, args);
    for (const changed of [{ upload_id: b }, { worktree: "other" }, { type: "doc" }])
      await expect(importTool.run(ctx, { ...args, ...changed })).rejects.toMatchObject({
        code: "workspace-idempotency-conflict",
      });
    expect(conversions).toHaveBeenCalledTimes(1);
    expect((await importTool.run(ctx, args)).output).toEqual(first.output);
    expect(conversions).toHaveBeenCalledTimes(1);
    expect((await store.requireUpload("owner", b, "office-import")).state).toBe("ready");
  } finally {
    fetcher.mockRestore();
    await store.close();
  }
});
