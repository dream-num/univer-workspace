import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import type { FileSystem } from "@deepseek-ai/dsh-fs";
import LocalFileSystem from "@deepseek-ai/dsh-fs-local";
import CodeRuntime, {
  type CodeJsonValue,
  type CodeRunRequest,
  type CodeRunResult,
} from "@deepseek-ai/dsh-code-runtime";
import {
  CredentialProvider,
  type CredentialInfo,
  type CredentialKey,
  type CredentialRecord,
  type CredentialRecordEntry,
  type CredentialRecordInfo,
  type CredentialRef,
  type ResolvedCredential,
} from "@deepseek-ai/dsh-credentials";
import { CallId, HarnessError } from "@deepseek-ai/dsh-llm";
import { Session, SessionId } from "@deepseek-ai/dsh-session";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime, {
  renderToolsSdk,
  type CodeDispatchEventData,
  type CodeDispatchStartEventData,
  type ToolRunContext,
} from "@deepseek-ai/dsh-tools";
import ApprovalService, { type ApprovalOutcome } from "@deepseek-ai/dsh-user-approval";
import {
  WorkspaceApplicationError,
  WorkspaceBlobFeature,
} from "@univerjs/univer-workspace-client-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountWorkspaceAuthentication } from "../src/authentication.js";
import {
  grantRecord,
  WorkspaceAuthenticationRequiredError,
  type AuthenticatedWorkspaceGrant,
} from "../src/authentication-state.js";
import {
  projectWorkspaceFileTransferDependencyFailure,
  requireLocal,
} from "../src/file-transfer.js";

const origin = "https://workspace.test";
const contexts: Context[] = [];
const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(contexts.splice(0).map(async (ctx) => await ctx.fiber.dispose()));
  await Promise.all(directories.splice(0).map(async (path) => await rm(path, { force: true, recursive: true })));
});

describe("Workspace file-transfer tools", () => {
  it("registers four closed, operation-specific Native and Code schemas", async () => {
    const cwd = await temporaryDirectory();
    const { ctx } = await setup({ cwd, fetcher: vi.fn<typeof fetch>() });
    const schemas = transferSchemas(ctx);
    expect(schemas.map(({ name }) => name).sort()).toEqual([
      "workspace_asset_download",
      "workspace_blob_download",
      "workspace_blob_get",
      "workspace_blob_upload",
    ]);
    expect(schemas.every(({ parameters }) => parameters.additionalProperties === false)).toBe(true);
    expect(renderToolsSdk(schemas.map((schema) => ({
      ...schema,
      output: ctx.tools.get(schema.name)!.output.schema,
    })))).not.toMatch(/\b(?:cookie|password|origin|action|command|url|bytes|base64)\??:/i);
  });

  it("dispatches all four file tools through real Code Mode with paired events", async () => {
    const cwd = await temporaryDirectory();
    await writeFile(join(cwd, "payload.bin"), "abc");
    const fetcher = combinedTransferFetcher();
    const { approvalRequests, ctx, runtime } = await setupCodeMode(cwd, fetcher);
    runtime.dispatches = [
      { name: "workspace_blob_get", arguments: { resource_id: "resource-1" } },
      {
        name: "workspace_blob_upload",
        arguments: { source_path: "payload.bin", space_id: "space-1", idempotency_key: "code-key" },
      },
      {
        name: "workspace_blob_download",
        arguments: { resource_id: "resource-1", output_path: "code-blob.bin" },
      },
      {
        name: "workspace_asset_download",
        arguments: { worktree_id: "worktree-1", asset_id: "asset-1", output_path: "code-asset.bin" },
      },
    ];
    const agent = fakeAgent(cwd) as { readonly session: Session };
    const result = await ctx.tools.execute({
      arguments: { code: "return await transfer();", description: "Exercise Workspace file tools" },
      callId: CallId("file-transfer-code-mode"),
      name: "run_code",
      signal: new AbortController().signal,
      agent: agent as never,
    });
    expect(result).toMatchObject({ isError: false });
    const starts = agent.session.events.flatMap((event) => event.type === "tool/code-dispatch-start"
      ? [event.data as CodeDispatchStartEventData]
      : []);
    const settles = agent.session.events.flatMap((event) => event.type === "tool/code-dispatch"
      ? [event.data as CodeDispatchEventData]
      : []);
    expect(starts.map(({ name }) => name)).toEqual(runtime.dispatches.map(({ name }) => name));
    expect(settles.map(({ name, subCallId }) => ({ name, subCallId }))).toEqual(
      starts.map(({ name, subCallId }) => ({ name, subCallId })),
    );
    expect(settles.every(({ isError }) => !isError)).toBe(true);
    expect(approvalRequests).toEqual([
      "workspace_blob_upload",
      "workspace_blob_download",
      "workspace_asset_download",
    ]);
    expect(await readFile(join(cwd, "code-blob.bin"), "utf8")).toBe("blob");
    expect(await readFile(join(cwd, "code-asset.bin"), "utf8")).toBe("asset");
    expect(result.value).toMatchObject({
      result: [
        { resource: { resourceId: "resource-1" }, node: { nodeId: "node-1" } },
        { upload: { idempotencyKey: "code-key", uploadId: "upload-1", resourceId: "resource-1" } },
        { download: { resourceId: "resource-1", byteSize: 4 } },
        { download: { assetId: "asset-1", byteLength: 5, worktreeId: "worktree-1" } },
      ],
    });
  });

  it("keeps allowlisted and unlisted transfer failures secret-safe in Code Mode", async () => {
    const cwd = await temporaryDirectory();
    const sentinel = "password=cookie; Set-Cookie=code-private";
    const { ctx, runtime } = await setupCodeMode(cwd, vi.fn<typeof fetch>());
    vi.spyOn(WorkspaceBlobFeature.prototype, "get")
      .mockRejectedValueOnce(new WorkspaceApplicationError("FORBIDDEN", sentinel, { status: 403, cause: sentinel }))
      .mockRejectedValueOnce(new WorkspaceApplicationError("private-code", sentinel, { path: sentinel }));
    runtime.dispatches = [
      { name: "workspace_blob_get", arguments: { resource_id: "resource-1" } },
      { name: "workspace_blob_get", arguments: { resource_id: "resource-2" } },
    ];
    const agent = fakeAgent(cwd) as { readonly session: Session };
    const result = await ctx.tools.execute({
      arguments: { code: "return await transfer();", description: "Exercise transfer failures" },
      callId: CallId("file-transfer-code-failures"),
      name: "run_code",
      signal: new AbortController().signal,
      agent: agent as never,
    });
    const settles = agent.session.events.flatMap((event) => event.type === "tool/code-dispatch"
      ? [event.data as CodeDispatchEventData]
      : []);
    expect(result).toMatchObject({ isError: false, value: { result: [{ error: expect.any(String) }, { error: expect.any(String) }] } });
    expect(settles.map(({ isError }) => isError)).toEqual([true, true]);
    expect(JSON.stringify({ result, events: agent.session.events })).not.toContain(sentinel);
    expect(JSON.stringify(result)).toContain("FORBIDDEN");
    expect(JSON.stringify(result)).toContain("workspace-file-operation-failed");
  });

  it.each([
    ["workspace_blob_get", { resource_id: "resource-1", cookie: "secret" }],
    ["workspace_blob_download", { resource_id: "resource-1", output_path: "", force: false }],
    ["workspace_asset_download", { worktree_id: "worktree-1", asset_id: "asset-1", output_path: "out", force: "yes" }],
  ] as const)("rejects closed invalid arguments for %s without credential or HTTP", async (name, args) => {
    const cwd = await temporaryDirectory();
    const fetcher = vi.fn<typeof fetch>();
    const { approvalRequests, credentials, ctx } = await setup({ cwd, fetcher, approval: "allowed-once" });
    const result = await execute(ctx, name, args, fakeAgent(cwd));
    expect(result).toMatchObject({ isError: true, error: { info: { code: "workspace-argument-invalid" } } });
    expect(credentials.reads).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
    expect(approvalRequests).toEqual([]);
  });

  it("validates upload arguments before approval and every dependency", async () => {
    const cwd = await temporaryDirectory();
    const fetcher = vi.fn<typeof fetch>();
    const { approvalRequests, credentials, ctx } = await setup({
      cwd,
      fetcher,
      approval: "rejected",
    });
    const filesystem = ctx.get("fs")!;
    const resolve = vi.spyOn(filesystem, "resolve");
    const stat = vi.spyOn(filesystem, "stat");
    const processPath = vi.spyOn(filesystem, "processPath");

    for (const args of [
      { source_path: "source.bin", space_id: " " },
      { source_path: "source.bin", space_id: "space-1", unexpected: true },
      {
        source_path: "source.bin",
        space_id: "space-1",
        parent_node_id: "parent-1",
        name: "Report.bin",
        declared_media_type: " ",
      },
    ]) {
      expect(await execute(ctx, "workspace_blob_upload", args, fakeAgent(cwd))).toMatchObject({
        isError: true,
        error: { info: { code: "workspace-argument-invalid" } },
      });
    }

    expect(approvalRequests).toEqual([]);
    expect(credentials.reads).toBe(0);
    expect(resolve).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
    expect(processPath).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();

    expect(await execute(ctx, "workspace_blob_upload", {
      source_path: "source.bin",
      space_id: "space-1",
    }, fakeAgent(cwd))).toMatchObject({ isError: true });
    expect(approvalRequests).toEqual(["workspace_blob_upload"]);
    expect(credentials.reads).toBe(0);
    expect(resolve).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
    expect(processPath).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects non-enumerable and symbol keys at the direct body validator seam", async () => {
    const cwd = await temporaryDirectory();
    const { credentials, ctx } = await setup({ cwd, fetcher: vi.fn<typeof fetch>() });
    const definition = ctx.tools.get("workspace_blob_get")!;
    for (const key of ["hidden", Symbol("hidden")] as const) {
      const args = { resource_id: "resource-1" };
      Object.defineProperty(args, key, { enumerable: false, value: "secret" });
      await expect(definition.execute(args, directExecution("workspace_blob_get"))).rejects.toMatchObject({
        code: "workspace-argument-invalid",
      });
    }
    expect(credentials.reads).toBe(0);
  });

  it("rejects missing or broadened canonical output before rendering", async () => {
    const cwd = await temporaryDirectory();
    const { ctx } = await setup({ cwd, fetcher: vi.fn<typeof fetch>() });
    for (const name of [
      "workspace_blob_get",
      "workspace_blob_upload",
      "workspace_blob_download",
      "workspace_asset_download",
    ]) {
      const source = ctx.tools.get(name)!;
      const render = vi.fn(source.output.render);
      const fixtureName = `${name}_invalid_output`;
      const unregister = ctx.tools.register({
        ...source,
        name: fixtureName,
        execute: async () => ({ extra: "secret" }),
        output: { ...source.output, render },
      } as never);
      const result = await execute(ctx, fixtureName, {}, undefined);
      expect(result).toMatchObject({ isError: true, error: { info: { code: "INVALID_TOOL_OUTPUT" } } });
      expect(render).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain("secret");
      unregister();
    }
  });

  it("fails composition before any tool registration for a confining filesystem without policy", async () => {
    const cwd = await temporaryDirectory();
    const ctx = await baseContext();
    await ctx.plugin(ConfiningLocalFileSystem, { cwd });
    const fiber = ctx.plugin({
      name: "file-transfer-missing-policy",
      inject: ["credentials", "tools", "skills", "fs"],
      apply(child: Context) {
        mountWorkspaceAuthentication(child, { fetcher: vi.fn<typeof fetch>() });
      },
    });
    await expect(fiber).rejects.toThrow("requires sandboxPolicy");
    expect(ctx.tools.schemas().filter(({ name }) => name.startsWith("workspace_"))).toEqual([]);
  });

  it("denies read-only before provider identity, arguments, approval, credential, or HTTP", async () => {
    const cwd = await temporaryDirectory();
    const fetcher = vi.fn<typeof fetch>();
    const { approvalRequests, credentials, ctx } = await setup({
      cwd,
      fetcher,
      filesystem: "confining",
      policy: () => ({ mode: "read-only", workspaceRoot: cwd }),
      approval: "allowed-once",
    });
    const result = await execute(ctx, "workspace_blob_download", {
      resource_id: "resource-1",
      output_path: null,
      cookie: "secret",
    }, fakeAgent(cwd));
    expect(result).toMatchObject({ isError: true, error: { info: { code: "workspace-file-policy-denied" } } });
    expect(approvalRequests).toEqual([]);
    expect(credentials.reads).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("rejects an undefined-mode non-local provider before path or approval", async () => {
    const cwd = await temporaryDirectory();
    const resolve = vi.fn();
    const processPath = vi.fn();
    const contains = vi.fn();
    const fetcher = vi.fn<typeof fetch>();
    const { approvalRequests, credentials, ctx } = await setup({
      cwd,
      fetcher,
      filesystem: { sandboxMode: undefined, resolve, processPath, contains } as unknown as FileSystem,
      approval: "allowed-once",
    });
    const result = await execute(ctx, "workspace_asset_download", {
      worktree_id: "worktree-1",
      asset_id: "asset-1",
      output_path: "output.bin",
    }, fakeAgent(cwd));
    expect(result).toMatchObject({ isError: true, error: { info: { code: "workspace-local-filesystem-required" } } });
    expect(resolve).not.toHaveBeenCalled();
    expect(contains).not.toHaveBeenCalled();
    expect(processPath).not.toHaveBeenCalled();
    expect(approvalRequests).toEqual([]);
    expect(credentials.reads).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects paths outside the Session cwd before approval or remote work", async () => {
    const cwd = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const fetcher = vi.fn<typeof fetch>();
    const { approvalRequests, credentials, ctx } = await setup({ cwd, fetcher, approval: "allowed-once" });
    const result = await execute(ctx, "workspace_blob_download", {
      resource_id: "resource-1",
      output_path: join(outside, "output.bin"),
    }, fakeAgent(cwd));
    expect(result).toMatchObject({ isError: true, error: { info: { code: "workspace-file-path-outside-session" } } });
    expect(approvalRequests).toEqual([]);
    expect(credentials.reads).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("downloads exact Blob bytes through bare LocalFileSystem after one approval", async () => {
    const cwd = await temporaryDirectory();
    const outputPath = join(cwd, "blob.bin");
    const fetcher = vi.fn<typeof fetch>(async (request) => {
      const url = new URL(request instanceof Request ? request.url : String(request));
      if (url.pathname === "/api/resources/resource-1") {
        const resource = blobResource();
        return Response.json({ node: node(resource), resource });
      }
      if (url.pathname === "/api/blob-resources/resource-1/download") {
        return new Response("blob", {
          headers: { "content-length": "4", "content-type": "application/octet-stream" },
        });
      }
      return Response.json({ error: { code: "NOT_FOUND", message: "missing" } }, { status: 404 });
    });
    const { approvalRequests, ctx } = await setup({ cwd, fetcher, approval: "allowed-once" });
    const filesystem = ctx.get("fs")!;
    const canonicalOutputPath = filesystem.processPath(await filesystem.resolve("blob.bin", { cwd }));
    const result = await execute(ctx, "workspace_blob_download", {
      resource_id: "resource-1",
      output_path: "blob.bin",
    }, fakeAgent(cwd));
    expect(result).toMatchObject({
      isError: false,
      value: { download: { resourceId: "resource-1", nodeId: "node-1", outputPath: canonicalOutputPath, byteSize: 4 } },
    });
    expect(approvalRequests).toEqual(["workspace_blob_download"]);
    expect(await readFile(outputPath, "utf8")).toBe("blob");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects mismatched or unavailable Blob metadata before content download", async () => {
    for (const [kind, resource, code] of [
      ["identity", { ...blobResource(), id: "resource-other" }, "workspace-result-mismatch"],
      [
        "availability",
        { ...blobResource(), availability: "quarantined" },
        "workspace-blob-download-unavailable",
      ],
    ] as const) {
      const cwd = await temporaryDirectory();
      const fetcher = vi.fn<typeof fetch>(async () => Response.json({ node: node(resource), resource }));
      const { approvalRequests, ctx } = await setup({ cwd, fetcher, approval: "allowed-once" });
      const result = await execute(ctx, "workspace_blob_download", {
        resource_id: "resource-1",
        output_path: `${kind}.bin`,
      }, fakeAgent(cwd));
      expect(result).toMatchObject({ isError: true, error: { info: { code } } });
      expect(approvalRequests).toEqual(["workspace_blob_download"]);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(await readdir(cwd)).toEqual([]);
    }
  });

  it("protects an existing Blob output by default and atomically replaces it only with force", async () => {
    const cwd = await temporaryDirectory();
    const outputPath = join(cwd, "blob.bin");
    await writeFile(outputPath, "old");
    const fetcher = blobDownloadFetcher("blob");
    const { approvalRequests, ctx } = await setup({ cwd, fetcher, approval: "allowed-once" });
    const protectedResult = await execute(ctx, "workspace_blob_download", {
      resource_id: "resource-1",
      output_path: "blob.bin",
    }, fakeAgent(cwd));
    expect(protectedResult).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-blob-output-exists" } },
    });
    expect(await readFile(outputPath, "utf8")).toBe("old");

    const replaced = await execute(ctx, "workspace_blob_download", {
      resource_id: "resource-1",
      output_path: "blob.bin",
      force: true,
    }, fakeAgent(cwd));
    expect(replaced).toMatchObject({ isError: false, value: { download: { byteSize: 4 } } });
    expect(await readFile(outputPath, "utf8")).toBe("blob");
    expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
    expect((await readdir(cwd)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(approvalRequests).toEqual(["workspace_blob_download", "workspace_blob_download"]);
  });

  it("cancels a download stream, removes its temp, and preserves the existing destination", async () => {
    const cwd = await temporaryDirectory();
    const outputPath = join(cwd, "blob.bin");
    await writeFile(outputPath, "old");
    const blocked = deferred<void>();
    let pulls = 0;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/api/resources/resource-1") {
        const resource = blobResource(6);
        return Response.json({ node: node(resource), resource });
      }
      return new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          if (pulls === 1) controller.enqueue(Buffer.from("new"));
          else {
            blocked.resolve();
            return new Promise(() => undefined);
          }
        },
      }), { headers: { "content-length": "6", "content-type": "application/octet-stream" } });
    });
    const { ctx } = await setup({ cwd, fetcher, approval: "allowed-once" });
    const controller = new AbortController();
    const pending = execute(ctx, "workspace_blob_download", {
      resource_id: "resource-1",
      output_path: "blob.bin",
      force: true,
    }, fakeAgent(cwd), controller.signal);
    await blocked.promise;
    controller.abort(new Error("download cancelled"));
    const result = await pending;
    expect(result).toMatchObject({ isError: true, error: { info: { code: "workspace-operation-cancelled" } } });
    expect(await readFile(outputPath, "utf8")).toBe("old");
    expect((await readdir(cwd)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it.each(["rejected", "cancelled", "unavailable"] as const)(
    "stops transfer work when approval is %s",
    async (approval) => {
      const cwd = await temporaryDirectory();
      await writeFile(join(cwd, "payload.bin"), "abc");
      const fetcher = vi.fn<typeof fetch>();
      const { credentials, ctx } = await setup({ cwd, fetcher, approval });
      const result = await execute(ctx, "workspace_blob_upload", {
        source_path: "payload.bin",
        space_id: "space-1",
      }, fakeAgent(cwd));
      expect(result).toMatchObject({ isError: true });
      expect(credentials.reads).toBe(0);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("stops transfer work when no approval channel is mounted", async () => {
    const cwd = await temporaryDirectory();
    await writeFile(join(cwd, "payload.bin"), "abc");
    const fetcher = vi.fn<typeof fetch>();
    const { credentials, ctx } = await setup({ cwd, fetcher });
    const result = await execute(ctx, "workspace_blob_upload", {
      source_path: "payload.bin",
      space_id: "space-1",
    }, fakeAgent(cwd));
    expect(result).toMatchObject({ isError: true });
    expect(credentials.reads).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("downloads cross-origin Asset bytes without forwarding the Workspace cookie", async () => {
    const cwd = await temporaryDirectory();
    const outputPath = join(cwd, "asset.bin");
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === "/universer-api/worktrees/worktree-1/file/asset-1/sign-url") {
        expect(request.headers.get("cookie")).toBe("workspace_session=test");
        return Response.json({ error: { code: 1, message: "OK" }, url: "https://cdn.test/asset.bin" });
      }
      expect(url.origin).toBe("https://cdn.test");
      expect(request.headers.get("cookie")).toBeNull();
      return new Response("asset", {
        headers: { "content-length": "5", "content-type": "application/octet-stream" },
      });
    });
    const { approvalRequests, ctx } = await setup({ cwd, fetcher, approval: "allowed-once" });
    const result = await execute(ctx, "workspace_asset_download", {
      worktree_id: "worktree-1",
      asset_id: "asset-1",
      output_path: "asset.bin",
    }, fakeAgent(cwd));
    expect(result).toMatchObject({
      isError: false,
      value: { download: { assetId: "asset-1", byteLength: 5, worktreeId: "worktree-1" } },
    });
    expect(approvalRequests).toEqual(["workspace_asset_download"]);
    expect(await readFile(outputPath, "utf8")).toBe("asset");
  });

  it.each([
    ["malformed envelope", { error: { code: true, message: "invalid" } }],
    [
      "credential-bearing URL",
      { error: { code: 1, message: "OK" }, url: "https://user:password@cdn.test/asset" },
    ],
  ])("rejects Asset %s without fetching content", async (_case, envelope) => {
    const cwd = await temporaryDirectory();
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(envelope));
    const { ctx } = await setup({ cwd, fetcher, approval: "allowed-once" });
    const result = await execute(ctx, "workspace_asset_download", {
      worktree_id: "worktree-1",
      asset_id: "asset-1",
      output_path: "asset.bin",
    }, fakeAgent(cwd));
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-invalid-response" } },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await readdir(cwd)).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("password");
  });

  it("rejects a racing Blob destination without replacing it or leaving a temp", async () => {
    const cwd = await temporaryDirectory();
    const release = deferred<void>();
    const entered = deferred<void>();
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const pathname = new URL(input instanceof Request ? input.url : String(input)).pathname;
      if (pathname.startsWith("/api/resources/")) {
        const resource = blobResource();
        return Response.json({ node: node(resource), resource });
      }
      entered.resolve();
      await release.promise;
      return new Response("blob", {
        headers: { "content-length": "4", "content-type": "application/octet-stream" },
      });
    });
    const { ctx } = await setup({ cwd, fetcher, approval: "allowed-once" });
    const pending = execute(ctx, "workspace_blob_download", {
      resource_id: "resource-1",
      output_path: "raced.bin",
    }, fakeAgent(cwd));
    await entered.promise;
    await writeFile(join(cwd, "raced.bin"), "winner");
    release.resolve();
    const result = await pending;
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-blob-output-exists" } },
    });
    expect(await readFile(join(cwd, "raced.bin"), "utf8")).toBe("winner");
    expect((await readdir(cwd)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("reports a Blob response size failure and cleans the unfinished stream and temp", async () => {
    const cwd = await temporaryDirectory();
    let cancelled = false;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const pathname = new URL(input instanceof Request ? input.url : String(input)).pathname;
      if (pathname.startsWith("/api/resources/")) {
        const resource = blobResource();
        return Response.json({ node: node(resource), resource });
      }
      return new Response(new ReadableStream<Uint8Array>({
        cancel() { cancelled = true; },
        start(controller) { controller.enqueue(Buffer.from("oversize")); },
      }), { headers: { "content-length": "4", "content-type": "application/octet-stream" } });
    });
    const { ctx } = await setup({ cwd, fetcher, approval: "allowed-once" });
    const result = await execute(ctx, "workspace_blob_download", {
      resource_id: "resource-1",
      output_path: "oversize.bin",
    }, fakeAgent(cwd));
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-blob-size-mismatch" } },
    });
    expect(cancelled).toBe(true);
    expect(await readdir(cwd)).toEqual([]);
  });

  it("rechecks policy after approval and fails closed when it narrows to read-only", async () => {
    const cwd = await temporaryDirectory();
    let mode: "workspace-write" | "read-only" = "workspace-write";
    const asked = deferred<void>();
    const decision = deferred<ApprovalOutcome>();
    const fetcher = vi.fn<typeof fetch>();
    const { approvalRequests, credentials, ctx } = await setup({
      cwd,
      fetcher,
      filesystem: "confining",
      policy: () => ({ mode, workspaceRoot: cwd }),
      approval: async () => {
        asked.resolve();
        return await decision.promise;
      },
    });
    const pending = execute(ctx, "workspace_blob_download", {
      resource_id: "resource-1",
      output_path: "blob.bin",
    }, fakeAgent(cwd));
    await asked.promise;
    mode = "read-only";
    decision.resolve("allowed-once");
    const result = await pending;
    expect(result).toMatchObject({ isError: true, error: { info: { code: "workspace-file-policy-denied" } } });
    expect(approvalRequests).toEqual(["workspace_blob_download"]);
    expect(credentials.reads).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("re-resolves an approved output and rejects symlink drift outside the Session", async () => {
    const cwd = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const asked = deferred<void>();
    const decision = deferred<ApprovalOutcome>();
    const fetcher = vi.fn<typeof fetch>();
    const { credentials, ctx } = await setup({
      cwd,
      fetcher,
      approval: async () => {
        asked.resolve();
        return await decision.promise;
      },
    });
    const pending = execute(ctx, "workspace_blob_download", {
      resource_id: "resource-1",
      output_path: "drift.bin",
    }, fakeAgent(cwd));
    await asked.promise;
    await writeFile(join(outside, "target.bin"), "outside");
    await symlink(join(outside, "target.bin"), join(cwd, "drift.bin"));
    decision.resolve("allowed-once");
    const result = await pending;
    expect(result).toMatchObject({ isError: true, error: { info: { code: "workspace-file-path-outside-session" } } });
    expect(credentials.reads).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rechecks the public LocalFileSystem constructor after approval", async () => {
    const cwd = await temporaryDirectory();
    const asked = deferred<void>();
    const decision = deferred<ApprovalOutcome>();
    const fetcher = vi.fn<typeof fetch>();
    const { credentials, ctx } = await setup({
      cwd,
      fetcher,
      approval: async () => {
        asked.resolve();
        return await decision.promise;
      },
    });
    const filesystem = ctx.get("fs")!;
    const prototype = Object.getPrototypeOf(filesystem) as object;
    const pending = execute(ctx, "workspace_asset_download", {
      worktree_id: "worktree-1",
      asset_id: "asset-1",
      output_path: "asset.bin",
    }, fakeAgent(cwd));
    await asked.promise;
    Object.setPrototypeOf(filesystem, Object.prototype);
    decision.resolve("allowed-once");
    const result = await pending.finally(() => Object.setPrototypeOf(filesystem, prototype));
    expect(result).toMatchObject({ isError: true, error: { info: { code: "workspace-local-filesystem-required" } } });
    expect(credentials.reads).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requires workspace-write outputs to remain inside both policy root and Session cwd", async () => {
    const cwd = await temporaryDirectory();
    const policyRoot = join(cwd, "allowed");
    await mkdir(policyRoot);
    const fetcher = vi.fn<typeof fetch>();
    const { approvalRequests, credentials, ctx } = await setup({
      cwd,
      fetcher,
      filesystem: "confining",
      policy: () => ({ mode: "workspace-write", workspaceRoot: policyRoot }),
      approval: "rejected",
    });
    const outsidePolicy = await execute(ctx, "workspace_blob_download", {
      resource_id: "resource-1",
      output_path: "outside-policy.bin",
    }, fakeAgent(cwd));
    expect(outsidePolicy).toMatchObject({ isError: true, error: { info: { code: "workspace-file-path-outside-session" } } });
    expect(approvalRequests).toEqual([]);

    const insideBoth = await execute(ctx, "workspace_blob_download", {
      resource_id: "resource-1",
      output_path: "allowed/inside.bin",
    }, fakeAgent(cwd));
    expect(insideBoth).toMatchObject({ isError: true });
    expect(approvalRequests).toEqual(["workspace_blob_download"]);
    expect(credentials.reads).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps danger-full-access downloads inside the Session cwd", async () => {
    const cwd = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const { approvalRequests, credentials, ctx } = await setup({
      cwd,
      fetcher: vi.fn<typeof fetch>(),
      filesystem: "confining",
      policy: () => ({ mode: "danger-full-access", workspaceRoot: outside }),
      approval: "rejected",
    });
    const rejected = await execute(ctx, "workspace_blob_download", {
      resource_id: "resource-1",
      output_path: join(outside, "outside.bin"),
    }, fakeAgent(cwd));
    expect(rejected).toMatchObject({ isError: true, error: { info: { code: "workspace-file-path-outside-session" } } });
    expect(approvalRequests).toEqual([]);
    const eligible = await execute(ctx, "workspace_blob_download", {
      resource_id: "resource-1",
      output_path: "inside.bin",
    }, fakeAgent(cwd));
    expect(eligible).toMatchObject({ isError: true });
    expect(approvalRequests).toEqual(["workspace_blob_download"]);
    expect(credentials.reads).toBe(0);
  });

  it("rechecks a changed workspace-write root in the approved body", async () => {
    const cwd = await temporaryDirectory();
    const narrowedRoot = join(cwd, "narrowed");
    await mkdir(narrowedRoot);
    let workspaceRoot = cwd;
    const asked = deferred<void>();
    const decision = deferred<ApprovalOutcome>();
    const fetcher = vi.fn<typeof fetch>();
    const { credentials, ctx } = await setup({
      cwd,
      fetcher,
      filesystem: "confining",
      policy: () => ({ mode: "workspace-write", workspaceRoot }),
      approval: async () => { asked.resolve(); return await decision.promise; },
    });
    const pending = execute(ctx, "workspace_blob_download", {
      resource_id: "resource-1",
      output_path: "outside-new-root.bin",
    }, fakeAgent(cwd));
    await asked.promise;
    workspaceRoot = narrowedRoot;
    decision.resolve("allowed-once");
    const result = await pending;
    expect(result).toMatchObject({ isError: true, error: { info: { code: "workspace-file-path-outside-session" } } });
    expect(credentials.reads).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("allows policy widening after approval without widening the immutable Session path", async () => {
    const cwd = await temporaryDirectory();
    const policyRoot = join(cwd, "allowed");
    await mkdir(policyRoot);
    let mode: "workspace-write" | "danger-full-access" = "workspace-write";
    const asked = deferred<void>();
    const decision = deferred<ApprovalOutcome>();
    const { ctx } = await setup({
      cwd,
      fetcher: blobDownloadFetcher("blob"),
      filesystem: "confining",
      policy: () => ({ mode, workspaceRoot: policyRoot }),
      approval: async () => { asked.resolve(); return await decision.promise; },
    });
    const pending = execute(ctx, "workspace_blob_download", {
      resource_id: "resource-1",
      output_path: "allowed/widened.bin",
    }, fakeAgent(cwd));
    await asked.promise;
    mode = "danger-full-access";
    decision.resolve("allowed-once");
    await expect(pending).resolves.toMatchObject({ isError: false });
    expect(await readFile(join(policyRoot, "widened.bin"), "utf8")).toBe("blob");
  });

  it("requires an Agent Session cwd and a regular upload source", async () => {
    const cwd = await temporaryDirectory();
    const fetcher = vi.fn<typeof fetch>();
    const { approvalRequests, credentials, ctx } = await setup({ cwd, fetcher, approval: "allowed-once" });
    const agentless = await execute(ctx, "workspace_blob_download", {
      resource_id: "resource-1",
      output_path: "blob.bin",
    }, undefined);
    expect(agentless).toMatchObject({ isError: true, error: { info: { code: "workspace-session-cwd-required" } } });
    expect(approvalRequests).toEqual([]);

    const missing = await execute(ctx, "workspace_blob_upload", {
      source_path: "missing.bin",
      space_id: "space-1",
    }, fakeAgent(cwd));
    expect(missing).toMatchObject({ isError: true, error: { info: { code: "workspace-blob-source-unavailable" } } });
    const directory = await execute(ctx, "workspace_blob_upload", {
      source_path: ".",
      space_id: "space-1",
    }, fakeAgent(cwd));
    expect(directory).toMatchObject({ isError: true, error: { info: { code: "workspace-blob-source-invalid" } } });
    expect(approvalRequests).toEqual(["workspace_blob_upload", "workspace_blob_upload"]);
    expect(credentials.reads).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uploads one local file through the canonical reserve, PUT, status, and complete workflow", async () => {
    const cwd = await temporaryDirectory();
    await writeFile(join(cwd, "payload.bin"), "abc");
    const requests: string[] = [];
    let idempotencyKey: string | null = null;
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      const pathname = new URL(request.url).pathname;
      requests.push(`${request.method} ${pathname}`);
      if (pathname === "/api/blob-upload-sessions") {
        idempotencyKey = request.headers.get("idempotency-key");
        expect(idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
        return Response.json(uploadEnvelope("waitingForUpload", true, "Report.bin"));
      }
      if (pathname.endsWith("/content")) {
        expect(Buffer.from(await request.arrayBuffer()).toString()).toBe("abc");
        return new Response(null, { status: 204 });
      }
      if (pathname === "/api/blob-upload-sessions/upload-1") {
        return Response.json(uploadEnvelope("uploaded", false, "Report.bin"));
      }
      if (pathname.endsWith("/complete")) {
        const resource = blobResource(3);
        return Response.json({
          operation: operation("completed"),
          node: { ...node(resource), name: "Report.bin", parentNodeId: "parent-1" },
        });
      }
      throw new Error("unexpected request");
    });
    const { approvalRequests, ctx } = await setup({ cwd, fetcher, approval: "allowed-once" });
    const result = await execute(ctx, "workspace_blob_upload", {
      source_path: "payload.bin",
      space_id: "space-1",
      parent_node_id: "parent-1",
      name: "Report.bin",
      declared_media_type: "application/octet-stream",
    }, fakeAgent(cwd));
    expect(result.isError, result.error?.message).toBe(false);
    expect(result).toMatchObject({
      isError: false,
      value: {
        upload: {
          idempotencyKey,
          uploadId: "upload-1",
          operationId: "operation-1",
          nodeId: "node-1",
          resourceId: "resource-1",
          name: "Report.bin",
        },
      },
    });
    expect(approvalRequests).toEqual(["workspace_blob_upload"]);
    expect(requests).toEqual([
      "POST /api/blob-upload-sessions",
      "PUT /api/blob-upload-sessions/upload-1/content",
      "GET /api/blob-upload-sessions/upload-1",
      "POST /api/blob-upload-sessions/upload-1/complete",
    ]);
  });

  it("rejects mismatched and terminal Blob identities without a shell retry", async () => {
    for (const [kind, envelope, code] of [
      [
        "identity",
        {
          ...uploadEnvelope("waitingForUpload", true),
          operation: { ...operation("pending"), kind: "otherOperation" },
        },
        "workspace-result-mismatch",
      ],
      ["terminal", uploadEnvelope("failed"), "workspace-blob-upload-terminal"],
    ] as const) {
      const cwd = await temporaryDirectory();
      await writeFile(join(cwd, "payload.bin"), "abc");
      const fetcher = vi.fn<typeof fetch>(async () => Response.json(envelope));
      const { ctx } = await setup({ cwd, fetcher, approval: "allowed-once" });
      const result = await execute(ctx, "workspace_blob_upload", {
        source_path: "payload.bin",
        space_id: "space-1",
      }, fakeAgent(cwd));
      expect(result).toMatchObject({ isError: true, error: { info: { code } } });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it("keeps Blob recovery bounded and does not add a ToolRuntime retry", async () => {
    const cwd = await temporaryDirectory();
    await writeFile(join(cwd, "payload.bin"), "abc");
    const requests: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      const pathname = new URL(request.url).pathname;
      requests.push(`${request.method} ${pathname}`);
      if (pathname === "/api/blob-upload-sessions") {
        return Response.json(uploadEnvelope("waitingForUpload", true));
      }
      if (pathname.endsWith("/content")) {
        await request.arrayBuffer();
        return new Response(null, { status: 204 });
      }
      return Response.json(uploadEnvelope("waitingForUpload", true));
    });
    const { ctx } = await setup({ cwd, fetcher, approval: "allowed-once" });
    const result = await execute(ctx, "workspace_blob_upload", {
      source_path: "payload.bin",
      space_id: "space-1",
      idempotency_key: "bounded-key",
    }, fakeAgent(cwd));
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-result-unknown" } },
    });
    expect(requests).toEqual([
      "POST /api/blob-upload-sessions",
      "PUT /api/blob-upload-sessions/upload-1/content",
      "GET /api/blob-upload-sessions/upload-1",
      "PUT /api/blob-upload-sessions/upload-1/content",
      "GET /api/blob-upload-sessions/upload-1",
      "PUT /api/blob-upload-sessions/upload-1/content",
      "GET /api/blob-upload-sessions/upload-1",
    ]);
    expect(result.content.at(-1)).toMatchObject({
      type: "text",
      text: expect.stringContaining("Never retry the upload automatically"),
    });
  });

  it.each(["nested", "direct"] as const)(
    "preserves a complete public upload intent with null media type in %s result-unknown detail",
    async (shape) => {
      const cwd = await temporaryDirectory();
      await writeFile(join(cwd, "payload.bin"), "abc");
      const fetcher = vi.fn<typeof fetch>(async (input) => {
        const pathname = new URL(input instanceof Request ? input.url : String(input)).pathname;
        if (pathname === "/api/blob-upload-sessions" && shape === "direct") {
          return Response.json(uploadEnvelope("completed"));
        }
        throw new Error("password=cookie; Set-Cookie=unknown");
      });
      const { ctx } = await setup({ cwd, fetcher, approval: "allowed-once" });
      const result = await execute(ctx, "workspace_blob_upload", {
        source_path: "payload.bin",
        space_id: "space-1",
        idempotency_key: "blob-key",
      }, fakeAgent(cwd));
      expect(result).toMatchObject({
        isError: true,
        error: { info: { code: "workspace-result-unknown" } },
      });
      const envelope = parseFailureEnvelope(result.error!.message) as {
        readonly detail: Record<string, unknown>;
      };
      const intent = shape === "nested"
        ? envelope.detail["request"] as Record<string, unknown>
        : envelope.detail;
      expect(intent).toMatchObject({
        idempotencyKey: "blob-key",
        sourcePath: expect.stringMatching(/payload\.bin$/),
        spaceId: "space-1",
        parentNodeId: null,
        name: "payload.bin",
        originalFilename: "payload.bin",
        byteSize: 3,
        declaredMediaType: null,
      });
      if (shape === "direct") expect(envelope.detail).toMatchObject({ uploadId: "upload-1", state: "completed" });
      expect(JSON.stringify(result)).not.toContain("Set-Cookie");
    },
  );

  it("preserves known Upload Session identity and stops after caller cancellation races PUT", async () => {
    const cwd = await temporaryDirectory();
    await writeFile(join(cwd, "payload.bin"), "abc");
    const entered = deferred<void>();
    const release = deferred<void>();
    const requests: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      const pathname = new URL(request.url).pathname;
      requests.push(`${request.method} ${pathname}`);
      if (pathname === "/api/blob-upload-sessions") {
        return Response.json(uploadEnvelope("waitingForUpload", true));
      }
      entered.resolve();
      await release.promise;
      return new Response(null, { status: 204 });
    });
    const { ctx } = await setup({ cwd, fetcher, approval: "allowed-once" });
    const controller = new AbortController();
    const resultPromise = execute(ctx, "workspace_blob_upload", {
      source_path: "payload.bin",
      space_id: "space-1",
      idempotency_key: "blob-key",
    }, fakeAgent(cwd), controller.signal);
    await entered.promise;
    controller.abort(new Error("password=cookie; Set-Cookie=cancelled"));
    release.resolve();
    const result = await resultPromise;
    expect(result).toMatchObject({ isError: true, error: { info: { code: "workspace-result-unknown" } } });
    const envelope = parseFailureEnvelope(result.error!.message) as {
      readonly detail: Record<string, unknown>;
    };
    expect(envelope.detail).toMatchObject({
      idempotencyKey: "blob-key",
      declaredMediaType: null,
      uploadId: "upload-1",
      state: "waitingForUpload",
    });
    expect(requests).toEqual([
      "POST /api/blob-upload-sessions",
      "PUT /api/blob-upload-sessions/upload-1/content",
    ]);
    expect(JSON.stringify(result)).not.toContain("Set-Cookie");
    expect(result.content.at(-1)).toMatchObject({
      type: "text",
      text: expect.stringContaining("Never retry the upload automatically"),
    });
  });

  it.each(["caller", "owner"] as const)(
    "classifies a confirmed late Blob upload success by %s cancellation source",
    async (source) => {
      const cwd = await temporaryDirectory();
      await writeFile(join(cwd, "payload.bin"), "abc");
      const entered = deferred<void>();
      const release = deferred<void>();
      const fetcher = gatedSuccessfulUploadFetcher(entered, release);
      const { ctx, fiber } = await setup({ cwd, fetcher, approval: "allowed-once" });
      const controller = new AbortController();
      const pending = execute(ctx, "workspace_blob_upload", {
        source_path: "payload.bin",
        space_id: "space-1",
        idempotency_key: "blob-key",
      }, fakeAgent(cwd), controller.signal);
      await entered.promise;
      let disposal: Promise<void> | undefined;
      if (source === "caller") controller.abort(new Error("late caller cancellation"));
      else disposal = fiber.dispose();
      release.resolve();
      const result = await pending;
      if (source === "caller") {
        expect(result).toMatchObject({ isError: true, error: { info: { code: "ABORTED" } } });
        expect(result.content.at(-1)).toMatchObject({
          type: "text",
          text: expect.stringContaining("Never retry the upload automatically"),
        });
      } else {
        expect(result).toMatchObject({ isError: false, value: { upload: { uploadId: "upload-1" } } });
        await disposal;
      }
    },
  );

  it("preserves the frozen transfer code allowlist and maps unlisted Core errors", async () => {
    const cwd = await temporaryDirectory();
    const { ctx } = await setup({ cwd, fetcher: vi.fn<typeof fetch>() });
    for (const code of [
      "workspace-argument-invalid",
      "workspace-invalid-response",
      "workspace-result-mismatch",
      "workspace-result-unknown",
      "workspace-origin-mismatch",
      "workspace-authentication-required",
      "workspace-request-invalid",
      "workspace-redirect-refused",
      "workspace-resource-kind-mismatch",
      "workspace-blob-source-unavailable",
      "workspace-blob-source-invalid",
      "workspace-blob-size-mismatch",
      "workspace-blob-download-unavailable",
      "workspace-blob-upload-terminal",
      "workspace-blob-output-exists",
      "workspace-blob-output-unavailable",
      "workspace-blob-output-invalid-state",
      "workspace-blob-download-write-failed",
      "workspace-asset-size-mismatch",
      "workspace-asset-output-exists",
      "workspace-asset-output-unavailable",
      "workspace-asset-output-invalid-state",
      "workspace-asset-download-write-failed",
      "UNAUTHENTICATED",
      "INVALID_INPUT",
      "FORBIDDEN",
      "NOT_FOUND",
      "CONFLICT",
      "PAYLOAD_TOO_LARGE",
      "INTERNAL_ERROR",
    ]) {
      const failure = new WorkspaceApplicationError(code, "password=cookie; Set-Cookie=private", {
        path: "/safe/path",
        status: 409,
        cause: "password=cookie",
      });
      expect(projectWorkspaceFileTransferDependencyFailure(failure)).toEqual({
        code,
        detail: { path: "/safe/path", status: 409 },
      });
      const spy = vi.spyOn(WorkspaceBlobFeature.prototype, "get").mockRejectedValueOnce(
        failure,
      );
      const result = await execute(ctx, "workspace_blob_get", { resource_id: "resource-1" }, fakeAgent(cwd));
      expect(result).toMatchObject({ isError: true, error: { info: { code } } });
      expect(JSON.stringify(result)).not.toMatch(/password|cookie|Set-Cookie/);
      spy.mockRestore();
    }

    vi.spyOn(WorkspaceBlobFeature.prototype, "get").mockRejectedValueOnce(
      new WorkspaceApplicationError(
        "private-provider-code",
        "password=cookie; Set-Cookie=private",
        { path: "/safe/path" },
      ),
    );
    const hidden = await execute(ctx, "workspace_blob_get", { resource_id: "resource-1" }, fakeAgent(cwd));
    expect(hidden).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-file-operation-failed" } },
    });
    expect(JSON.stringify(hidden)).not.toMatch(/private-provider-code|password|cookie|Set-Cookie/);
  });

  it("projects only exact file-transfer dependency constructors and owner errors", () => {
    expect(projectWorkspaceFileTransferDependencyFailure(
      new WorkspaceAuthenticationRequiredError(),
    )).toEqual({ code: "workspace-authentication-required" });
    expect(projectWorkspaceFileTransferDependencyFailure(
      new HarnessError("counterfeit", "FORBIDDEN"),
    )).toBeUndefined();
    expect(projectWorkspaceFileTransferDependencyFailure(
      new WorkspaceApplicationError("private-provider-code", "secret"),
    )).toBeUndefined();

    let localFailure: unknown;
    try {
      requireLocal({} as FileSystem, "blob download");
    } catch (error) {
      localFailure = error;
    }
    expect(projectWorkspaceFileTransferDependencyFailure(localFailure)).toEqual({
      code: "workspace-local-filesystem-required",
    });
  });

  it("projects exact safe transfer detail, including nested identities and null fields", async () => {
    const cwd = await temporaryDirectory();
    const sentinel = "password=cookie; Set-Cookie=grant";
    const { ctx } = await setup({ cwd, fetcher: vi.fn<typeof fetch>() });
    vi.spyOn(WorkspaceBlobFeature.prototype, "get").mockRejectedValueOnce(
      new WorkspaceApplicationError("workspace-result-mismatch", sentinel, {
        path: "/safe/path",
        resourceId: "resource-1",
        expectedByteSize: 3,
        actualByteSize: 4,
        requested: {
          spaceId: "space-1",
          parentNodeId: null,
          declaredMediaType: null,
          byteSize: 3,
          cookie: sentinel,
        },
        actual: { resourceId: "resource-2", kind: "blob", unknown: sentinel },
        cause: sentinel,
        headers: { "Set-Cookie": sentinel },
        unknown: sentinel,
      }),
    );
    const result = await execute(ctx, "workspace_blob_get", { resource_id: "resource-1" }, fakeAgent(cwd));
    const envelope = parseFailureEnvelope(result.error!.message);
    expect(envelope).toEqual({
      code: "workspace-result-mismatch",
      detail: {
        path: "/safe/path",
        resourceId: "resource-1",
        expectedByteSize: 3,
        actualByteSize: 4,
        requested: {
          spaceId: "space-1",
          parentNodeId: null,
          declaredMediaType: null,
          byteSize: 3,
        },
        actual: { resourceId: "resource-2", kind: "blob" },
      },
    });
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });

  it("sanitizes pre-execute policy failures and caller abort reasons", async () => {
    const cwd = await temporaryDirectory();
    const sentinel = "password=cookie; Set-Cookie=grant";
    const { ctx } = await setup({
      cwd,
      fetcher: vi.fn<typeof fetch>(),
      filesystem: "confining",
      policy: () => { throw new Error(sentinel); },
    });
    const result = await execute(ctx, "workspace_blob_download", {
      resource_id: "resource-1",
      output_path: "blob.bin",
    }, fakeAgent(cwd));
    expect(result).toMatchObject({ isError: true, error: { info: { code: "workspace-file-operation-failed" } } });
    expect(JSON.stringify(result)).not.toContain(sentinel);

    const controller = new AbortController();
    controller.abort(new Error(sentinel));
    const aborted = await execute(ctx, "workspace_blob_download", {
      resource_id: "resource-1",
      output_path: "blob.bin",
    }, fakeAgent(cwd), controller.signal);
    expect(aborted).toMatchObject({ isError: true });
    expect(JSON.stringify(aborted)).not.toContain(sentinel);
  });

  it("sanitizes caller cancellation while a download path preflight is in flight", async () => {
    const cwd = await temporaryDirectory();
    const sentinel = "password=cookie; Set-Cookie=preflight";
    const { approvalRequests, ctx } = await setup({
      cwd,
      fetcher: vi.fn<typeof fetch>(),
      approval: "allowed-once",
    });
    const filesystem = ctx.get("fs")!;
    const originalResolve = filesystem.resolve.bind(filesystem);
    const entered = deferred<void>();
    const release = deferred<void>();
    vi.spyOn(filesystem, "resolve").mockImplementation(async (path, options) => {
      entered.resolve();
      await release.promise;
      return await originalResolve(path, options);
    });
    const controller = new AbortController();
    const agent = fakeAgent(cwd) as { readonly session: Session };
    const pending = execute(ctx, "workspace_blob_download", {
      resource_id: "resource-1",
      output_path: "blob.bin",
    }, agent, controller.signal);
    await entered.promise;
    controller.abort(new Error(sentinel));
    release.resolve();
    const result = await pending;
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-operation-cancelled" } },
    });
    expect(approvalRequests).toEqual([]);
    expect(JSON.stringify({ result, events: agent.session.events })).not.toContain(sentinel);
  });

  it.each(["caller", "owner"] as const)(
    "classifies %s cancellation before a download writes any bytes",
    async (source) => {
      const cwd = await temporaryDirectory();
      const entered = deferred<void>();
      const release = deferred<void>();
      const requests: string[] = [];
      const fetcher = vi.fn<typeof fetch>(async (input) => {
        const pathname = new URL(input instanceof Request ? input.url : String(input)).pathname;
        requests.push(pathname);
        entered.resolve();
        await release.promise;
        const resource = blobResource();
        return Response.json({ node: node(resource), resource });
      });
      const { ctx, fiber } = await setup({ cwd, fetcher, approval: "allowed-once" });
      const controller = new AbortController();
      const pending = execute(ctx, "workspace_blob_download", {
        resource_id: "resource-1",
        output_path: "cancelled-before-write.bin",
      }, fakeAgent(cwd), controller.signal);
      await entered.promise;
      let disposal: Promise<void> | undefined;
      if (source === "caller") controller.abort(new Error("caller secret"));
      else disposal = fiber.dispose();
      release.resolve();
      const result = await pending;
      expect(result).toMatchObject({
        isError: true,
        error: {
          info: {
            code: source === "caller"
              ? "workspace-operation-cancelled"
              : "workspace-plugin-disposing",
          },
        },
      });
      expect(requests).toEqual(["/api/resources/resource-1"]);
      expect(await readdir(cwd)).toEqual([]);
      await disposal;
    },
  );

  it.each(["caller", "owner"] as const)(
    "classifies a confirmed late local commit by %s cancellation source",
    async (source) => {
      const cwd = await temporaryDirectory();
      const committed = deferred<void>();
      const release = deferred<void>();
      const caller = new AbortController();
      const fetcher = vi.fn<typeof fetch>(async (input) => {
        const pathname = new URL(input instanceof Request ? input.url : String(input)).pathname;
        if (pathname.startsWith("/api/resources/")) {
          const resource = blobResource();
          return Response.json({ node: node(resource), resource });
        }
        const response = new Response("blob", {
          headers: { "content-length": "4", "content-type": "application/octet-stream" },
        });
        const cancel = response.body!.cancel.bind(response.body);
        vi.spyOn(response.body!, "cancel").mockImplementation(async (reason) => {
          committed.resolve();
          await release.promise;
          await cancel(reason);
        });
        return response;
      });
      const { ctx, fiber } = await setup({ cwd, fetcher, approval: "allowed-once" });
      const pending = execute(ctx, "workspace_blob_download", {
        resource_id: "resource-1",
        output_path: "published.bin",
      }, fakeAgent(cwd), caller.signal);
      await committed.promise;
      expect(await readFile(join(cwd, "published.bin"), "utf8")).toBe("blob");
      let disposal: Promise<void> | undefined;
      if (source === "caller") caller.abort(new Error("late caller cancellation"));
      else disposal = fiber.dispose();
      release.resolve();
      const result = await pending;
      if (source === "caller") {
        expect(result).toMatchObject({ isError: true, error: { info: { code: "ABORTED" } } });
        expect(result.content.at(-1)).toMatchObject({
          type: "text",
          text: expect.stringMatching(/destination.*Never retry/i),
        });
      } else {
        expect(result).toMatchObject({ isError: false, value: { download: { byteSize: 4 } } });
        await disposal;
      }
      expect((await readdir(cwd)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    },
  );

  it("unregisters file tools, aborts an accepted read, and drains before disposal settles", async () => {
    const cwd = await temporaryDirectory();
    const entered = deferred<void>();
    const release = deferred<void>();
    const fetcher = vi.fn<typeof fetch>(async () => {
      entered.resolve();
      await release.promise;
      const resource = blobResource();
      return Response.json({ node: node(resource), resource });
    });
    const { ctx, fiber } = await setup({ cwd, fetcher });
    const pending = execute(ctx, "workspace_blob_get", { resource_id: "resource-1" }, fakeAgent(cwd));
    await entered.promise;
    let disposed = false;
    const disposal = fiber.dispose().then(() => { disposed = true; });
    await expect.poll(() => ctx.tools.get("workspace_blob_get")).toBeUndefined();
    expect(disposed).toBe(false);
    release.resolve();
    await expect(pending).resolves.toMatchObject({
      isError: true,
      error: { info: { code: "workspace-plugin-disposing" } },
    });
    await disposal;
    expect(disposed).toBe(true);
  });

  it("cancels an accepted transfer stream, cleans its temp, and drains owner disposal", async () => {
    const cwd = await temporaryDirectory();
    const pulling = deferred<void>();
    const cancelled = deferred<void>();
    const releaseCleanup = deferred<void>();
    let pulls = 0;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const pathname = new URL(input instanceof Request ? input.url : String(input)).pathname;
      if (pathname.startsWith("/api/resources/")) {
        const resource = blobResource(4);
        return Response.json({ node: node(resource), resource });
      }
      return new Response(new ReadableStream<Uint8Array>({
        cancel() {
          cancelled.resolve();
          return releaseCleanup.promise;
        },
        pull(controller) {
          pulls += 1;
          if (pulls === 1) controller.enqueue(Buffer.from("bl"));
          else {
            pulling.resolve();
            return new Promise(() => undefined);
          }
        },
      }), { headers: { "content-length": "4", "content-type": "application/octet-stream" } });
    });
    const { ctx, fiber } = await setup({ cwd, fetcher, approval: "allowed-once" });
    const pending = execute(ctx, "workspace_blob_download", {
      resource_id: "resource-1",
      output_path: "disposing.bin",
    }, fakeAgent(cwd));
    await pulling.promise;
    let disposed = false;
    const disposal = fiber.dispose().then(() => { disposed = true; });
    await cancelled.promise;
    expect(ctx.tools.get("workspace_blob_download")).toBeUndefined();
    expect(disposed).toBe(false);
    releaseCleanup.resolve();
    await expect(pending).resolves.toMatchObject({
      isError: true,
      error: { info: { code: "workspace-plugin-disposing" } },
    });
    await disposal;
    expect(disposed).toBe(true);
    expect(await readdir(cwd)).toEqual([]);
  });
});

class ConfiningLocalFileSystem extends LocalFileSystem {
  public override get sandboxMode(): "workspace-write" { return "workspace-write"; }
}

class ControlledCodeRuntime extends CodeRuntime {
  public readonly isolation = "dsh-univer-work-file-transfer";
  public readonly language = "typescript";
  public dispatches: Array<{ readonly name: string; readonly arguments: Record<string, unknown> }> = [];

  public override async run(request: CodeRunRequest): Promise<CodeRunResult> {
    const tools = request.bindings.find(({ global }) => global === "tools")?.functions;
    if (tools === undefined) return { logs: [], error: { kind: "exception", message: "missing tools" } };
    const value: CodeJsonValue[] = [];
    for (const dispatch of this.dispatches) {
      try {
        value.push(await tools[dispatch.name]!(dispatch.arguments));
      } catch (error) {
        value.push({ error: error instanceof Error ? error.message : "tool failed" });
      }
    }
    return { logs: [], value };
  }
}

async function setup(options: {
  readonly cwd: string;
  readonly fetcher: typeof fetch;
  readonly approval?: ApprovalOutcome | (() => Promise<ApprovalOutcome>);
  readonly filesystem?: "confining" | FileSystem;
  readonly policy?: () => { readonly mode: "read-only" | "workspace-write" | "danger-full-access"; readonly workspaceRoot: string };
}): Promise<{
  readonly approvalRequests: string[];
  readonly credentials: MemoryCredentials;
  readonly ctx: Context;
  readonly fiber: { dispose(): Promise<void> };
}> {
  const ctx = await baseContext();
  if (options.filesystem === undefined) await ctx.plugin(LocalFileSystem, { cwd: options.cwd });
  else if (options.filesystem === "confining") await ctx.plugin(ConfiningLocalFileSystem, { cwd: options.cwd });
  else ctx.provide("fs", options.filesystem);
  if (options.policy !== undefined) {
    ctx.provide("sandboxPolicy", { resolve: options.policy } as unknown as Context["sandboxPolicy"]);
  }
  const approvalRequests: string[] = [];
  if (options.approval !== undefined) {
    await ctx.plugin(ApprovalService);
    ctx.on("approval/request", (request) => {
      approvalRequests.push(request.toolName);
      return typeof options.approval === "function"
        ? options.approval()
        : Promise.resolve(options.approval!);
    });
  }
  const fiber = ctx.plugin({
    name: "dsh-univer-work-file-transfer-test",
    inject: ["credentials", "tools", "skills", "fs"],
    apply(child: Context) {
      mountWorkspaceAuthentication(child, { fetcher: options.fetcher });
    },
  });
  await fiber;
  const credentials = ctx.credentials as MemoryCredentials;
  credentials.seed(grantRecord(authenticated()));
  return { approvalRequests, credentials, ctx, fiber };
}

async function baseContext(): Promise<Context> {
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolRuntime);
  await ctx.plugin(SkillRegistry);
  await ctx.plugin(MemoryCredentials);
  return ctx;
}

async function setupCodeMode(cwd: string, fetcher: typeof fetch): Promise<{
  readonly approvalRequests: string[];
  readonly ctx: Context;
  readonly runtime: ControlledCodeRuntime;
}> {
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ControlledCodeRuntime);
  await ctx.plugin(ToolRuntime, { mode: "code" });
  await ctx.plugin(SkillRegistry);
  await ctx.plugin(MemoryCredentials);
  await ctx.plugin(LocalFileSystem, { cwd });
  await ctx.plugin(ApprovalService);
  const approvalRequests: string[] = [];
  ctx.on("approval/request", (request) => {
    approvalRequests.push(request.toolName);
    return Promise.resolve<ApprovalOutcome>("allowed-once");
  });
  const fiber = ctx.plugin({
    name: "dsh-univer-work-file-transfer-code-test",
    inject: ["credentials", "tools", "skills", "fs"],
    apply(child: Context) { mountWorkspaceAuthentication(child, { fetcher }); },
  });
  await fiber;
  (ctx.credentials as MemoryCredentials).seed(grantRecord(authenticated()));
  return { approvalRequests, ctx, runtime: ctx.codeRuntime as ControlledCodeRuntime };
}

async function execute(
  ctx: Context,
  name: string,
  arguments_: unknown,
  agent: unknown | undefined,
  signal = new AbortController().signal,
) {
  return await ctx.tools.execute({
    arguments: arguments_,
    callId: CallId(`${name}-${Math.random()}`),
    name,
    signal,
    ...(agent === undefined ? {} : { agent: agent as never }),
  });
}

function fakeAgent(cwd: string): unknown {
  const id = SessionId(`file-transfer-${Math.random()}`);
  const session = Session.create(id, [], {
    version: 0,
    id,
    createdAt: 0,
    cwd,
  });
  session.append("turn/start", { turn: 1 });
  session.append("step/start", { turn: 1, step: 1 });
  return { session };
}

function directExecution(name: string): ToolRunContext {
  return {
    arguments: {},
    callId: CallId(`direct-${name}`),
    rootCallId: CallId(`direct-${name}`),
    name,
    signal: new AbortController().signal,
    token: Symbol(name) as never,
    deferContext() {},
    concludeTurn() {},
  };
}

function authenticated(): AuthenticatedWorkspaceGrant {
  return {
    state: "authenticated",
    cookie: "workspace_session=test",
    origin,
    subject: { id: "user-1", name: "Alice" },
  };
}

function blobResource(byteSize = 4): Record<string, unknown> {
  return {
    availability: "ready",
    byteSize,
    capabilities: { downloadContent: true, editContent: false, openContent: false },
    id: "resource-1",
    kind: "blob",
    mediaType: "application/octet-stream",
  };
}

function blobDownloadFetcher(content: string): typeof fetch {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/api/resources/resource-1") {
      const resource = blobResource(Buffer.byteLength(content));
      return Response.json({ node: node(resource), resource });
    }
    if (url.pathname === "/api/blob-resources/resource-1/download") {
      return new Response(content, {
        headers: {
          "content-length": String(Buffer.byteLength(content)),
          "content-type": "application/octet-stream",
        },
      });
    }
    throw new Error("unexpected request");
  });
}

function combinedTransferFetcher(): typeof fetch {
  return vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === "/api/resources/resource-1") {
      const resource = blobResource();
      return Response.json({ node: node(resource), resource });
    }
    if (url.pathname === "/api/blob-resources/resource-1/download") {
      return new Response("blob", { headers: { "content-length": "4", "content-type": "application/octet-stream" } });
    }
    if (url.pathname === "/universer-api/worktrees/worktree-1/file/asset-1/sign-url") {
      return Response.json({ error: { code: 1, message: "OK" }, url: "https://cdn.test/asset-1" });
    }
    if (url.origin === "https://cdn.test") {
      return new Response("asset", { headers: { "content-length": "5", "content-type": "application/octet-stream" } });
    }
    if (url.pathname === "/api/blob-upload-sessions") {
      expect(request.headers.get("idempotency-key")).toBe("code-key");
      return Response.json(uploadEnvelope("waitingForUpload", true));
    }
    if (url.pathname.endsWith("/content")) return new Response(null, { status: 204 });
    if (url.pathname === "/api/blob-upload-sessions/upload-1") return Response.json(uploadEnvelope("uploaded"));
    if (url.pathname.endsWith("/complete")) {
      const resource = blobResource(3);
      return Response.json({ operation: operation("completed"), node: { ...node(resource), name: "payload.bin" } });
    }
    throw new Error(`unexpected transfer request ${request.method} ${url.pathname}`);
  });
}

function gatedSuccessfulUploadFetcher(
  entered: ReturnType<typeof deferred<void>>,
  release: ReturnType<typeof deferred<void>>,
): typeof fetch {
  return vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    const pathname = new URL(request.url).pathname;
    if (pathname === "/api/blob-upload-sessions") {
      return Response.json(uploadEnvelope("waitingForUpload", true));
    }
    if (pathname.endsWith("/content")) return new Response(null, { status: 204 });
    if (pathname === "/api/blob-upload-sessions/upload-1") {
      return Response.json(uploadEnvelope("uploaded"));
    }
    if (pathname.endsWith("/complete")) {
      entered.resolve();
      await release.promise;
      const resource = blobResource(3);
      return Response.json({
        operation: operation("completed"),
        node: { ...node(resource), name: "payload.bin" },
      });
    }
    throw new Error("unexpected request");
  });
}

function operation(state: "pending" | "completed"): Record<string, unknown> {
  return {
    createdAt: "2026-08-29T00:00:00.000Z",
    error: null,
    id: "operation-1",
    kind: "createBlobResource",
    result: state === "completed" ? { resourceId: "resource-1" } : null,
    state,
    updatedAt: "2026-08-29T00:00:00.000Z",
  };
}

function uploadEnvelope(
  state: "waitingForUpload" | "uploaded" | "completed" | "failed",
  uploadTarget = false,
  name = "payload.bin",
): Record<string, unknown> {
  return {
    operation: operation(state === "completed" ? "completed" : "pending"),
    upload: {
      byteSize: 3,
      createdAt: "2026-08-29T00:00:00.000Z",
      detectedMediaType: state === "completed" ? "application/octet-stream" : null,
      expiresAt: "2026-08-30T00:00:00.000Z",
      id: "upload-1",
      name,
      nodeId: "node-1",
      operationId: "operation-1",
      originalFilename: "payload.bin",
      receivedSize: state === "waitingForUpload" ? null : 3,
      resourceId: "resource-1",
      sha256: null,
      state,
      updatedAt: "2026-08-29T00:00:00.000Z",
    },
    uploadTarget: uploadTarget
      ? { contentUrl: "/api/blob-upload-sessions/upload-1/content", method: "PUT" }
      : null,
  };
}

function parseFailureEnvelope(message: string): unknown {
  return JSON.parse(message.slice(message.indexOf("{")));
}

function node(resource: Record<string, unknown>): Record<string, unknown> {
  return {
    accessRole: "owner",
    capabilities: {
      browseChildren: false,
      createChildren: false,
      move: true,
      rename: true,
      share: true,
      trash: true,
    },
    hasChildren: false,
    id: "node-1",
    name: "blob.bin",
    parentNodeId: null,
    resource,
    spaceId: "space-1",
    updatedAt: "2026-08-29T00:00:00.000Z",
  };
}

function transferSchemas(ctx: Context) {
  return ctx.tools.schemas().filter(({ name }) =>
    name.startsWith("workspace_blob_") || name === "workspace_asset_download");
}

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "dsh-univer-work-transfer-"));
  directories.push(path);
  return path;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

class MemoryCredentials extends CredentialProvider {
  private record: CredentialRecord | undefined;
  public reads = 0;

  public seed(record: CredentialRecord | undefined): void { this.record = record; }
  public override readRecord(_key: CredentialKey): Promise<CredentialRecord | undefined> {
    this.reads += 1;
    return Promise.resolve(this.record);
  }
  public override async modifyRecord(
    _key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    this.record = await mutate(this.record);
    return this.record;
  }
  public override deleteRecord(_key: CredentialKey): Promise<void> { this.record = undefined; return Promise.resolve(); }
  public override resolve(_ref: CredentialRef): Promise<ResolvedCredential | undefined> { return Promise.resolve(undefined); }
  public override describe(_ref: CredentialRef): Promise<CredentialInfo> { return Promise.resolve({ configured: false, writable: true }); }
  public override set(_ref: CredentialRef, _value: string): Promise<void> { return Promise.resolve(); }
  public override unset(_ref: CredentialRef): Promise<void> { return Promise.resolve(); }
  public override describeRecord(_key: CredentialKey): Promise<CredentialRecordInfo> {
    return Promise.resolve(this.record === undefined
      ? { configured: false, writable: true }
      : { configured: true, kind: this.record.kind, writable: true });
  }
  public override listRecords(): Promise<readonly CredentialRecordEntry[]> { return Promise.resolve([]); }
}
