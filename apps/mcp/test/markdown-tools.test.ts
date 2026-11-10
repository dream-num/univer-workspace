import { compileTypstTool } from "../src/gateway/tools/files/compile-typst.js";
import { compileSvgTool } from "../src/gateway/tools/files/compile-svg.js";
import { expect, it, vi } from "vitest";
import { WorkspaceHttp } from "@univerjs/univer-workspace-client-core/product";
import { LocalStagingStore } from "../src/gateway/staging/local.js";
import { compileMarkdownTool } from "../src/gateway/tools/files/compile-markdown.js";
import { exportMarkdownTool } from "../src/gateway/tools/files/export-markdown.js";
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

it("rejects a foreign or wrong-purpose assets upload before the executor", async () => {
  const store = new LocalStagingStore(testStagingDirectory(), "http://mcp.test/mcp");
  const fetcher = vi.spyOn(globalThis, "fetch");
  try {
    const foreign = await store.createUpload("foreign", {
      purpose: "markdown-assets",
      file_name: "assets.zip",
      media_type: "application/zip",
    });
    const wrong = await store.createUpload("owner", {
      purpose: "svg-assets",
      file_name: "assets.zip",
      media_type: "application/zip",
    });
    await store.handle(
      new Request(wrong.upload.upload_url, { method: "PUT", body: new Uint8Array([1]) }),
    );
    for (const [upload, code] of [
      [foreign.upload, "workspace-upload-not-found"],
      [wrong.upload, "workspace-upload-purpose-mismatch"],
    ] as const)
      await expect(
        compileMarkdownTool.run(context(store), {
          markdown: "Hello",
          assets_upload_id: upload.upload_id,
        }),
      ).rejects.toMatchObject({ code });
    await expect(
      compileMarkdownTool.run(context(store), { markdown: "Hello", apply: false, worktree: "wt" }),
    ).rejects.toThrow(/require apply/);
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    fetcher.mockRestore();
    await store.close();
  }
});
it("sends a ready assets ZIP as binary, retains it for retries and counts transfer bytes", async () => {
  const store = new LocalStagingStore(testStagingDirectory(), "http://mcp.test/mcp");
  const bytes = new Uint8Array([0, 255, 128]);
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
    const frame = decodeFrame(Buffer.from(await new Response(options?.body).arrayBuffer()));
    expect(frame.header).toMatchObject({ op: "markdown.compile", input: { markdown: "Hello" } });
    expect(new Uint8Array(frame.payload)).toEqual(bytes);
    return new Response(
      new Uint8Array(
        encodeFrame({
          ok: true,
          output: {
            committed: false,
            targetUnitId: "doc",
            diagnostics: [],
            sourceMap: [],
            javascript: "program",
          },
          meta: { executor: "none", cost: { ...zeroCost } },
        }),
      ),
    );
  });
  try {
    const { upload } = await store.createUpload("owner", {
      purpose: "markdown-assets",
      file_name: "assets.zip",
      media_type: "application/zip",
    });
    expect(
      (await store.handle(new Request(upload.upload_url, { method: "PUT", body: bytes }))).status,
    ).toBe(204);
    const ctx = context(store);
    for (let count = 0; count < 2; count += 1)
      expect(
        (
          await compileMarkdownTool.run(ctx, {
            markdown: "Hello",
            assets_upload_id: upload.upload_id,
          })
        ).output,
      ).toMatchObject({ committed: false });
    expect(ctx.usage?.snapshot().cost.upload_bytes).toBe(2 * bytes.length);
    expect((await store.requireUpload("owner", upload.upload_id, "markdown-assets")).state).toBe(
      "ready",
    );
  } finally {
    fetcher.mockRestore();
    await store.close();
  }
});
it("stages every exported asset and returns links with no inline data", async () => {
  const store = new LocalStagingStore(testStagingDirectory(), "http://mcp.test/mcp");
  const bytes = new Uint8Array([0, 255, 128, 42]);
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      new Uint8Array(
        encodeFrame(
          {
            ok: true,
            output: {
              formatVersion: 1,
              unitId: "doc",
              blockIds: ["intro"],
              revision: 7,
              markdown: "![Image](a.png)",
              sourceMap: [],
              diagnostics: [],
              assets: [
                { path: "a.png", mimeType: "image/png", offset: 0, size: 3 },
                { path: "b.svg", mimeType: "image/svg+xml", offset: 3, size: 1 },
              ],
            },
            meta: { executor: "warm", cost: { ...zeroCost } },
          },
          bytes,
        ),
      ),
    ),
  );
  try {
    const ctx = context(store);
    const result = await exportMarkdownTool.run(ctx, {
      worktree: "wt",
      unit: "doc",
      source_map: [],
      blocks: ["intro"],
    });
    const output = exportMarkdownTool.outputSchema.parse(result.output);
    expect(JSON.stringify(output)).not.toContain('"data"');
    const assets = output["assets"] as { path: string; download: { url: string } }[];
    expect(assets.map((asset) => asset.path)).toEqual(["a.png", "b.svg"]);
    const downloaded = [];
    for (const asset of assets)
      downloaded.push(
        new Uint8Array(await (await store.handle(new Request(asset.download.url))).arrayBuffer()),
      );
    expect(downloaded).toEqual([bytes.subarray(0, 3), bytes.subarray(3)]);
    expect(ctx.usage?.snapshot().cost.export_bytes).toBe(4);
  } finally {
    fetcher.mockRestore();
    await store.close();
  }
});

it("reports compile-only connection loss as a retryable read and apply loss as unknown", async () => {
  const store = new LocalStagingStore(testStagingDirectory(), "http://mcp.test/mcp");
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new TypeError("connection lost after delivery"));
  try {
    await expect(
      compileMarkdownTool.run(context(store), { markdown: "Hello" }),
    ).rejects.toMatchObject({
      wire: { code: "workspace-executor-timeout", detail: { retryable: true } },
    });
    await expect(
      compileMarkdownTool.run(context(store), {
        markdown: "Hello",
        unit: "doc",
        worktree: "wt",
        source_map: [],
        blocks: ["intro"],
      }),
    ).rejects.toMatchObject({ wire: { code: "workspace-result-unknown" } });
  } finally {
    fetcher.mockRestore();
    await store.close();
  }
});

it.each([
  { name: "typst", purpose: "typst-bundle" as const, tool: compileTypstTool, args: { idempotency_key: "compile-only-key-123" } },
  {
    name: "svg",
    purpose: "svg-assets" as const,
    tool: compileSvgTool,
    args: { svg: "<svg/>", estimate_text_size: true, page: 1 },
  },
])(
  "checks $name upload ownership/purpose and transfers ready ZIP bytes",
  async ({ name, purpose, tool, args }) => {
    const store = new LocalStagingStore(testStagingDirectory(), "http://mcp.test/mcp");
    const bytes = new Uint8Array([1, 2, 3]);
    const withUpload = (id: string) =>
      name === "typst" ? { ...args, bundle_upload_id: id } : { ...args, assets_upload_id: id };
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
      const frame = decodeFrame(Buffer.from(await new Response(options?.body).arrayBuffer()));
      expect(frame.header).toMatchObject({ op: `${name}.compile`, input: { apply: false } });
      expect(new Uint8Array(frame.payload)).toEqual(bytes);
      return new Response(
        new Uint8Array(
          encodeFrame({
            ok: true,
            output:
              name === "typst"
                ? {
                    committed: false,
                    compiledTargetUnitId: "doc",
                    javascript: "program",
                    diagnostics: [],
                    previews: [],
                  }
                : {
                    code: "program",
                    lints: [],
                    warnings: [],
                    mode: "replace",
                    textMeasure: "builtin-estimate",
                    viewport: { width: 100, height: 100 },
                  },
            meta: { executor: "none", cost: { ...zeroCost } },
          }),
        ),
      );
    });
    try {
      const foreign = await store.createUpload("foreign", {
        purpose,
        file_name: "bundle.zip",
        media_type: "application/zip",
      });
      const wrong = await store.createUpload("owner", {
        purpose: "markdown-assets",
        file_name: "bundle.zip",
        media_type: "application/zip",
      });
      await store.handle(new Request(wrong.upload.upload_url, { method: "PUT", body: bytes }));
      await expect(
        tool.run(context(store), withUpload(foreign.upload.upload_id)),
      ).rejects.toMatchObject({ code: "workspace-upload-not-found" });
      await expect(
        tool.run(context(store), withUpload(wrong.upload.upload_id)),
      ).rejects.toMatchObject({ code: "workspace-upload-purpose-mismatch" });
      expect(fetcher).not.toHaveBeenCalled();
      const { upload } = await store.createUpload("owner", {
        purpose,
        file_name: "bundle.zip",
        media_type: "application/zip",
      });
      await store.handle(new Request(upload.upload_url, { method: "PUT", body: bytes }));
      const ctx = context(store);
      await tool.run(ctx, withUpload(upload.upload_id));
      expect(ctx.usage?.snapshot().cost.upload_bytes).toBe(bytes.length);
      expect((await store.requireUpload("owner", upload.upload_id, purpose)).state).toBe("ready");
    } finally {
      fetcher.mockRestore();
      await store.close();
    }
  },
);
it("advertises no idempotency key on compile_svg and the real-font default", () => {
  expect(compileSvgTool.inputSchema.shape).not.toHaveProperty("idempotency_key");
  expect(compileSvgTool.description).toContain("inspect before retrying");
  expect(compileSvgTool.description).not.toContain("Pass estimate_text_size: true");
});
it.each([
  { label: "Typst", tool: compileTypstTool, args: { bundle_upload_id: "missing", worktree: "wt" } },
  {
    label: "SVG",
    tool: compileSvgTool,
    args: { svg: "<svg/>", estimate_text_size: true, worktree: "wt" },
  },
])("rejects $label targets with explicit apply: false before consuming uploads", async ({ tool, args }) => {
  const store = new LocalStagingStore(testStagingDirectory(), "http://mcp.test/mcp");
  try {
    await expect(tool.run(context(store), { ...args, apply: false })).rejects.toThrow(/require apply/);
  } finally {
    await store.close();
  }
});
it("uses read failure semantics for SVG compilation and unknown-result semantics for SVG apply", async () => {
  const store = new LocalStagingStore(testStagingDirectory(), "http://mcp.test/mcp");
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new TypeError("connection lost after delivery"));
  try {
    const args = { svg: "<svg/>", estimate_text_size: true };
    await expect(compileSvgTool.run(context(store), args)).rejects.toMatchObject({
      wire: { code: "workspace-executor-timeout", detail: { retryable: true } },
    });
    await expect(
      compileSvgTool.run(context(store), {
        ...args,
        page: 1,
        worktree: "wt",
        unit: "slide",
      }),
    ).rejects.toMatchObject({ wire: { code: "workspace-result-unknown" } });
  } finally {
    fetcher.mockRestore();
    await store.close();
  }
});

it.each([
  { tool: compileMarkdownTool, args: { markdown: "Hello", worktree: "wt", space: "space" },
    input: { markdown: "Hello", worktreeId: "wt", spaceId: "space", apply: true },
    output: { committed: true, targetUnitId: "doc", diagnostics: [], sourceMap: [] } },
  { tool: compileMarkdownTool, args: { markdown: "Hello", worktree: "wt", unit: "doc", source_map: [], blocks: ["intro"] },
    input: { markdown: "Hello", worktreeId: "wt", unitId: "doc", sourceMap: [], blockIds: ["intro"], apply: true },
    output: { committed: true, targetUnitId: "doc", diagnostics: [], sourceMap: [] } },
  { tool: compileTypstTool, args: { worktree: "wt", space: "space" },
    input: { worktreeId: "wt", spaceId: "space", apply: true },
    output: { committed: true, compiledTargetUnitId: "doc", diagnostics: [], previews: [] } },
  { tool: compileSvgTool, args: { svg: "<svg/>", page: 1, worktree: "wt", unit: "slide" },
    input: { svg: "<svg/>", page: 1, worktreeId: "wt", unitId: "slide", apply: true },
    output: { code: "program", lints: [], warnings: [], mode: "replace", page: 1,
      textMeasure: "builtin-estimate", viewport: { width: 100, height: 100 }, applied: { committed: true, revision: 2 } } },
])("$tool.name applies to a destination when apply is omitted", async ({ tool, args, input, output }) => {
  const store = new LocalStagingStore(testStagingDirectory(), "http://mcp.test/mcp");
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
    const frame = decodeFrame(Buffer.from(await new Response(options?.body).arrayBuffer()));
    expect(frame.header).toMatchObject({ input });
    return new Response(new Uint8Array(encodeFrame({
      ok: true, output, meta: { executor: "warm", cost: { ...zeroCost, committed_revisions: 1 } },
    })));
  });
  try {
    const { upload } = await store.createUpload("owner", {
      purpose: "typst-bundle", file_name: "bundle.zip", media_type: "application/zip",
    });
    await store.handle(new Request(upload.upload_url, { method: "PUT", body: new Uint8Array([1]) }));
    const ctx = context(store);
    const result = await tool.run(ctx, tool === compileTypstTool ? { ...args, bundle_upload_id: upload.upload_id } : args);
    expect(result.output).toEqual(output);
    expect(ctx.usage?.snapshot().cost.committed_revisions).toBe(1);
    expect(fetcher).toHaveBeenCalledOnce();
  } finally {
    fetcher.mockRestore();
    await store.close();
  }
});
