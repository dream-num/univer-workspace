import { Context } from "@deepseek-ai/cordis";
import type { FileSystem } from "@deepseek-ai/dsh-fs";
import LocalFileSystem from "@deepseek-ai/dsh-fs-local";
import SandboxedFileSystem from "@deepseek-ai/dsh-fs-sandbox";
import CodeRuntime, {
  type CodeJsonValue,
  type CodeRunRequest,
  type CodeRunResult,
} from "@deepseek-ai/dsh-code-runtime";
import { CallId } from "@deepseek-ai/dsh-llm";
import { Session, SessionId } from "@deepseek-ai/dsh-session";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime, { renderToolsSdk } from "@deepseek-ai/dsh-tools";
import ApprovalService, { type ApprovalOutcome } from "@deepseek-ai/dsh-user-approval";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  measureCanonicalJson,
  WorkspaceApplicationError,
  type WorkspaceApplySvgInput,
  type WorkspaceApplySvgResult,
  type WorkspaceCompileSvgInput,
  type WorkspaceCompileSvgResult,
} from "@univerjs/univer-workspace-client-core";
import {
  MAX_SVG_ARGUMENT_BYTES,
  MAX_SVG_ASSET_BYTES,
  MAX_SVG_CANONICAL_BYTES,
  MAX_SVG_GENERATED_CODE_BYTES,
  MAX_SVG_JSON_DEPTH,
  MAX_SVG_SOURCE_BYTES,
  projectWorkspaceSvgDependencyFailure,
  registerWorkspaceSvgToolFoundation,
  registerWorkspaceSvgTools,
  workspaceSvgApplyParameters,
  workspaceSvgCompileParameters,
  type WorkspaceSvgApplyArgs,
  type WorkspaceSvgCompileArgs,
  type WorkspaceSvgToolOperations,
} from "../src/svg-tools.js";
import { WorkspaceToolOwner } from "../src/tool-owner.js";

const contexts: Context[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async (ctx) => await ctx.fiber.dispose()));
  await Promise.all(directories.splice(0).map(async (path) => await rm(path, { force: true, recursive: true })));
});

describe("Workspace SVG local policy and approval", () => {
  it("denies read-only output and non-local providers before approval or feature work", async () => {
    const readOnly = await setupProduction({
      filesystem: "confining",
      policy: () => ({ mode: "read-only" as const }),
    });
    await writeFile(join(readOnly.cwd, "page.svg"), "<svg/>");
    await expect(executeWithAgent(readOnly.ctx, readOnly.cwd, "workspace_svg_compile", {
      output_path: "program.js",
      page: 1,
      source_path: "page.svg",
    })).resolves.toMatchObject({
      isError: true,
      error: { info: { code: "workspace-file-policy-denied" } },
    });
    expect(readOnly.approvals).toEqual([]);
    expect(readOnly.createFeature).not.toHaveBeenCalled();

    const remote = await setupProduction({ filesystem: remoteFilesystem() });
    await expect(executeWithAgent(remote.ctx, remote.cwd, "workspace_svg_apply", {
      page: 1,
      source_path: "page.svg",
      unit_id: "slide-1",
      worktree_id: "wt-1",
    })).resolves.toMatchObject({
      isError: true,
      error: { info: { code: "workspace-local-filesystem-required" } },
    });
    expect(remote.approvals).toEqual([]);
    expect(remote.createFeature).not.toHaveBeenCalled();
  });

  it("passes the current per-call policy to the real sandboxed output provider", async () => {
    const harness = await setupProduction({
      filesystem: "sandboxed",
      policy: (cwd, request) => request?.session === undefined
        ? { mode: "read-only" as const }
        : { mode: "workspace-write" as const, workspaceRoot: cwd },
    });
    await writeFile(join(harness.cwd, "page.svg"), "<svg/>");
    await expect(executeWithAgent(harness.ctx, harness.cwd, "workspace_svg_compile", {
      output_path: "program.js",
      page: 1,
      source_path: "page.svg",
    })).resolves.toMatchObject({ isError: false });
    expect(await readFile(join(harness.cwd, "program.js"), "utf8")).toBe("page-1-replace();\n");
  });

  it("rejects missing cwd, traversal, and symlink escape before approval or Host conversion", async () => {
    const harness = await setupProduction();
    const outside = await temporaryDirectory();
    await writeFile(join(outside, "outside.svg"), "<svg/>");
    await symlink(join(outside, "outside.svg"), join(harness.cwd, "escape.svg"));

    await expect(execute(harness.ctx, "workspace_svg_apply", {
      page: 1,
      source_path: "page.svg",
      unit_id: "slide-1",
      worktree_id: "wt-1",
    })).resolves.toMatchObject({ isError: true });
    for (const source_path of ["../outside.svg", "escape.svg"]) {
      await expect(executeWithAgent(harness.ctx, harness.cwd, "workspace_svg_compile", {
        output_path: "program.js",
        page: 1,
        source_path,
      })).resolves.toMatchObject({ isError: true });
      await expect(executeWithAgent(harness.ctx, harness.cwd, "workspace_svg_apply", {
        page: 1,
        source_path,
        unit_id: "slide-1",
        worktree_id: "wt-1",
      })).resolves.toMatchObject({ isError: true });
    }
    expect(harness.approvals).toEqual([]);
    expect(harness.createFeature).not.toHaveBeenCalled();
  });

  it("starts no source/browser/credential/Workspace effect before approval and rechecks policy drift", async () => {
    let mode: "read-only" | "workspace-write" = "workspace-write";
    const asked = deferred<void>();
    const decision = deferred<ApprovalOutcome>();
    const harness = await setupProduction({
      approval: async () => {
        asked.resolve();
        return await decision.promise;
      },
      filesystem: "confining",
      policy: (cwd) => ({ mode, workspaceRoot: cwd }),
    });
    await writeFile(join(harness.cwd, "page.svg"), "<svg/>");
    const pending = executeWithAgent(harness.ctx, harness.cwd, "workspace_svg_apply", {
      output_path: "program.js",
      page: 1,
      source_path: "page.svg",
      unit_id: "slide-1",
      worktree_id: "wt-1",
    });
    await asked.promise;
    expect(harness.createFeature).not.toHaveBeenCalled();
    expect(harness.compile).not.toHaveBeenCalled();
    expect(harness.apply).not.toHaveBeenCalled();
    mode = "read-only";
    decision.resolve("allowed-once");
    await expect(pending).resolves.toMatchObject({ isError: true });
    expect(harness.createFeature).not.toHaveBeenCalled();
  });

  it.each(["rejected", "cancelled", "unavailable"] as const)(
    "performs zero body work when combined apply approval is %s",
    async (approval) => {
      const harness = await setupProduction({ approval });
      await writeFile(join(harness.cwd, "page.svg"), "<svg/>");
      const result = await executeWithAgent(harness.ctx, harness.cwd, "workspace_svg_apply", {
        page: 1,
        source_path: "page.svg",
        unit_id: "slide-1",
        worktree_id: "wt-1",
      });
      expect(result).toMatchObject({ isError: true });
      expect(harness.approvals).toEqual(["workspace_svg_apply"]);
      expect(harness.createFeature).not.toHaveBeenCalled();
    },
  );

  it("replaces approved compile output and saves the exact apply program before one execution", async () => {
    const order: string[] = [];
    let cwd = "";
    const harness = await setupProduction({
      apply: async (input) => {
        order.push("apply");
        expect(await readFile(join(cwd, "program.js"), "utf8")).toBe(`${input.compiled.code}\n`);
        return { ...input.compiled, applied: { committed: false, value: null } };
      },
      compile: async (input) => {
        order.push("compile");
        expect(input.localRoot).toBe(cwd);
        expect(input.file).toBe(join(cwd, "page.svg"));
        return compiledForCore(input.page, input.add);
      },
    });
    cwd = harness.cwd;
    await writeFile(join(harness.cwd, "page.svg"), "<svg/>");
    await writeFile(join(harness.cwd, "program.js"), "old");

    const compile = await executeWithAgent(harness.ctx, harness.cwd, "workspace_svg_compile", {
      output_path: "program.js",
      page: 1,
      source_path: "page.svg",
    });
    expect(compile).toMatchObject({
      isError: false,
      value: { generated: { kind: "file", location: "program.js" } },
    });
    expect(await readFile(join(harness.cwd, "program.js"), "utf8")).toBe("page-1-replace();\n");

    order.length = 0;
    const apply = await executeWithAgent(harness.ctx, harness.cwd, "workspace_svg_apply", {
      output_path: "program.js",
      page: 1,
      source_path: "page.svg",
      unit_id: "slide-1",
      worktree_id: "wt-1",
    });
    expect(apply).toMatchObject({ isError: false });
    expect(order).toEqual(["compile", "apply"]);
    expect(harness.approvals).toEqual(["workspace_svg_compile", "workspace_svg_apply"]);
    expect(harness.apply).toHaveBeenCalledOnce();
  });

  it("starts no remote apply when approved output publication fails", async () => {
    const harness = await setupProduction();
    await writeFile(join(harness.cwd, "page.svg"), "<svg/>");
    await mkdir(join(harness.cwd, "program.js"));
    const result = await executeWithAgent(harness.ctx, harness.cwd, "workspace_svg_apply", {
      output_path: "program.js",
      page: 1,
      source_path: "page.svg",
      unit_id: "slide-1",
      worktree_id: "wt-1",
    });
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-svg-output-failed" } },
    });
    expect(harness.compile).toHaveBeenCalledOnce();
    expect(harness.apply).not.toHaveBeenCalled();
    expect(harness.approvals).toEqual(["workspace_svg_apply"]);
  });

  it.each([
    ["workspace-result-unknown", "unknown"],
    ["workspace-content-partial-side-effect", "partial"],
    ["workspace-content-limit-exceeded", "failed"],
  ] as const)("preserves one confirmed file around sanitized %s content identity", async (code, state) => {
    const sentinel = `private-${code}-sentinel`;
    const harness = await setupProduction({
      apply: async () => {
        throw new WorkspaceApplicationError(code, sentinel, {
          cause: sentinel,
          confirmedUploadCount: 1,
          contentCommitted: false,
          target: { unitId: "slide-1", worktreeId: "wt-1", secret: sentinel },
        });
      },
    });
    await writeFile(join(harness.cwd, "page.svg"), "<svg/>");
    const result = await executeWithAgent(harness.ctx, harness.cwd, "workspace_svg_apply", {
      output_path: "program.js",
      page: 1,
      source_path: "page.svg",
      unit_id: "slide-1",
      worktree_id: "wt-1",
    });
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-svg-apply-partial" } },
    });
    const visible = JSON.stringify(result);
    expect(visible).toContain(`\\"state\\":\\"${state}\\"`);
    expect(visible).toContain(`\\"causeCode\\":\\"${code}\\"`);
    expect(visible).toContain("program.js");
    expect(visible).toContain("slide-1");
    expect(visible).not.toContain(sentinel);
    expect(await readFile(join(harness.cwd, "program.js"), "utf8")).toBe("page-1-replace();\n");
    expect(harness.compile).toHaveBeenCalledOnce();
    expect(harness.apply).toHaveBeenCalledOnce();
  });

  it("maps unlisted post-file failures to a closed failed partial without leaking sentinels", async () => {
    const sentinel = "private-svg-code-path-credential-license-browser-sentinel";
    const harness = await setupProduction({
      apply: async () => { throw new Error(sentinel, { cause: new Error(sentinel) }); },
    });
    await writeFile(join(harness.cwd, "page.svg"), `<svg>${sentinel}</svg>`);
    const result = await executeWithAgent(harness.ctx, harness.cwd, "workspace_svg_apply", {
      output_path: "program.js",
      page: 1,
      source_path: "page.svg",
      unit_id: "slide-1",
      worktree_id: "wt-1",
    });
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-svg-apply-partial" } },
    });
    const visible = JSON.stringify(result);
    expect(visible).toContain('\\"state\\":\\"failed\\"');
    expect(visible).toContain('\\"causeCode\\":\\"workspace-svg-operation-failed\\"');
    expect(visible).not.toContain(sentinel);
    expect(harness.compile).toHaveBeenCalledOnce();
    expect(harness.apply).toHaveBeenCalledOnce();
  });

  it("preserves sanitized content uncertainty without manufacturing a file partial", async () => {
    const harness = await setupProduction({
      apply: async () => {
        throw new WorkspaceApplicationError("workspace-result-unknown", "private-unknown-message", {
          target: { unitId: "slide-1", worktreeId: "wt-1" },
        });
      },
    });
    await writeFile(join(harness.cwd, "page.svg"), "<svg/>");
    const result = await executeWithAgent(harness.ctx, harness.cwd, "workspace_svg_apply", {
      page: 1,
      source_path: "page.svg",
      unit_id: "slide-1",
      worktree_id: "wt-1",
    });
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-result-unknown" } },
    });
    expect(JSON.stringify(result)).not.toContain("private-unknown-message");
    expect(harness.apply).toHaveBeenCalledOnce();
  });

  it("does not trust malformed confirmed apply identity after file publication", async () => {
    const sentinel = "private-malformed-status-sentinel";
    const harness = await setupProduction({
      apply: async (input) => ({
        ...input.compiled,
        applied: { committed: true, revision: 1, status: sentinel, value: null },
      }),
    });
    await writeFile(join(harness.cwd, "page.svg"), "<svg/>");
    const result = await executeWithAgent(harness.ctx, harness.cwd, "workspace_svg_apply", {
      output_path: "program.js",
      page: 1,
      source_path: "page.svg",
      unit_id: "slide-1",
      worktree_id: "wt-1",
    });
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-svg-apply-partial" } },
    });
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });

  it("returns file-confirmed not-dispatched partial when the body observes cancellation after save", async () => {
    const controller = new AbortController();
    const harness = await setupProduction({
      afterWrite: () => controller.abort(new Error("private-post-file-abort-sentinel")),
    });
    await writeFile(join(harness.cwd, "page.svg"), "<svg/>");
    const result = await executeWithAgent(harness.ctx, harness.cwd, "workspace_svg_apply", {
      output_path: "program.js",
      page: 1,
      source_path: "page.svg",
      unit_id: "slide-1",
      worktree_id: "wt-1",
    }, controller.signal);
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-svg-apply-partial" } },
    });
    const visible = JSON.stringify(result);
    expect(visible).toContain('\\"state\\":\\"not-dispatched\\"');
    expect(visible).toContain('\\"causeCode\\":\\"workspace-operation-cancelled\\"');
    expect(visible).not.toContain("private-post-file-abort-sentinel");
    expect(harness.apply).not.toHaveBeenCalled();
    expect(await readFile(join(harness.cwd, "program.js"), "utf8")).toBe("page-1-replace();\n");
  });

  it("leaves confirmed compile publication to registry ABORTED and fixed file guidance", async () => {
    const controller = new AbortController();
    const harness = await setupProduction({
      afterWrite: () => controller.abort(new Error("private-compile-publish-abort-sentinel")),
    });
    await writeFile(join(harness.cwd, "page.svg"), "<svg/>");
    const result = await executeWithAgent(harness.ctx, harness.cwd, "workspace_svg_compile", {
      output_path: "program.js",
      page: 1,
      source_path: "page.svg",
    }, controller.signal);
    expect(result).toMatchObject({ isError: true, error: { info: { code: "ABORTED" } } });
    const visible = JSON.stringify(result);
    expect(visible).toContain("Inspect the approved output location");
    expect(visible).not.toContain("private-compile-publish-abort-sentinel");
    expect(await readFile(join(harness.cwd, "program.js"), "utf8")).toBe("page-1-replace();\n");
  });

  it("leaves a confirmed body return to registry ABORTED with fixed non-fabricating guidance", async () => {
    const controller = new AbortController();
    const harness = await setupProduction({
      apply: async (input) => {
        queueMicrotask(() => controller.abort(new Error("private-registry-abort-sentinel")));
        return { ...input.compiled, applied: { committed: false, value: null } };
      },
    });
    await writeFile(join(harness.cwd, "page.svg"), "<svg/>");
    const result = await executeWithAgent(harness.ctx, harness.cwd, "workspace_svg_apply", {
      output_path: "program.js",
      page: 1,
      source_path: "page.svg",
      unit_id: "slide-1",
      worktree_id: "wt-1",
    }, controller.signal);
    expect(result).toMatchObject({ isError: true, error: { info: { code: "ABORTED" } } });
    const visible = JSON.stringify(result);
    expect(visible).toContain("Inspect the approved output location and Worktree Unit");
    expect(visible).not.toContain("private-registry-abort-sentinel");
    expect(visible).not.toContain("workspace-svg-apply-partial");
    expect(harness.apply).toHaveBeenCalledOnce();
  });

  it("settles pending approval execution before disposal and starts no body afterward", async () => {
    const asked = deferred<void>();
    const decision = deferred<ApprovalOutcome>();
    const harness = await setupProduction({
      approval: async () => { asked.resolve(); return await decision.promise; },
    });
    await writeFile(join(harness.cwd, "page.svg"), "<svg/>");
    const order: string[] = [];
    const pending = executeWithAgent(harness.ctx, harness.cwd, "workspace_svg_apply", {
      page: 1,
      source_path: "page.svg",
      unit_id: "slide-1",
      worktree_id: "wt-1",
    }).finally(() => { order.push("execution"); });
    await asked.promise;
    const disposal = (async () => {
      harness.owner.stopAccepting();
      harness.registration.stopAccepting();
      harness.registration.unregister();
      harness.owner.abort();
      await Promise.all([harness.owner.drain(), harness.registration.drain()]);
      harness.registration.dispose();
    })().finally(() => { order.push("dispose"); });
    await expect(pending).resolves.toMatchObject({
      isError: true,
      error: { info: { code: "workspace-plugin-disposing" } },
    });
    await disposal;
    expect(order).toEqual(["execution", "dispose"]);
    expect(harness.createFeature).not.toHaveBeenCalled();
    expect(harness.ctx.tools.schemas().some(({ name }) => name.startsWith("workspace_svg_"))).toBe(false);
    decision.resolve("allowed-once");
  });

  it("drains an owner-only disposal without aborting the registry caller or replaying apply", async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const caller = new AbortController();
    const harness = await setupProduction({
      apply: async (input) => {
        entered.resolve();
        await release.promise;
        return { ...input.compiled, applied: { committed: false, value: null } };
      },
    });
    await writeFile(join(harness.cwd, "page.svg"), "<svg/>");
    const pending = executeWithAgent(harness.ctx, harness.cwd, "workspace_svg_apply", {
      output_path: "program.js",
      page: 1,
      source_path: "page.svg",
      unit_id: "slide-1",
      worktree_id: "wt-1",
    }, caller.signal);
    await entered.promise;
    let disposed = false;
    const disposal = (async () => {
      harness.owner.stopAccepting();
      harness.registration.stopAccepting();
      harness.registration.unregister();
      harness.owner.abort();
      await Promise.all([harness.owner.drain(), harness.registration.drain()]);
      harness.registration.dispose();
    })().finally(() => { disposed = true; });
    await Promise.resolve();
    expect(disposed).toBe(false);
    expect(caller.signal.aborted).toBe(false);
    release.resolve();
    await expect(pending).resolves.toMatchObject({ isError: false });
    await disposal;
    expect(harness.apply).toHaveBeenCalledOnce();
    expect(caller.signal.aborted).toBe(false);
  });

  it("keeps registry pre-dispatch cancellation and performs no SVG body work", async () => {
    const harness = await setupProduction();
    const controller = new AbortController();
    controller.abort(new Error("private-pre-dispatch-sentinel"));
    const result = await executeWithAgent(harness.ctx, harness.cwd, "workspace_svg_apply", {
      page: 1,
      source_path: "page.svg",
      unit_id: "slide-1",
      worktree_id: "wt-1",
    }, controller.signal);
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "ABORTED_BEFORE_DISPATCH" } },
    });
    expect(JSON.stringify(result)).not.toContain("private-pre-dispatch-sentinel");
    expect(harness.createFeature).not.toHaveBeenCalled();
  });
});

describe("Workspace SVG closed tools", () => {
  it("projects only the frozen SVG application codes and drops unsafe detail", async () => {
    const sentinel = "private-svg-error-detail-sentinel";
    expect(projectWorkspaceSvgDependencyFailure(new WorkspaceApplicationError(
      "workspace-svg-limit-exceeded",
      sentinel,
      { actual: 11, kind: "source", limit: 10, path: sentinel },
    ))).toEqual({
      code: "workspace-svg-limit-exceeded",
      detail: { actual: 11, kind: "source", limit: 10 },
    });
    expect(projectWorkspaceSvgDependencyFailure(new WorkspaceApplicationError(
      "BROWSER_UNAVAILABLE",
      sentinel,
    ))).toBeUndefined();
    expect(projectWorkspaceSvgDependencyFailure({
      code: "SVG_FACADE_COMPILE_FAILED",
      message: sentinel,
      name: "SvgFacadeError",
    })).toBeUndefined();

    const harness = await setup({
      compile: async () => {
        throw new WorkspaceApplicationError("workspace-svg-source-unavailable", sentinel, { path: sentinel });
      },
    });
    const result = await execute(harness.ctx, "workspace_svg_compile", { source_path: "page.svg" });
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-svg-source-unavailable" } },
    });
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });

  it("registers exactly two recursively closed schemas without authority or inline SVG inputs", async () => {
    const harness = await setup();
    const schemas = harness.ctx.tools.schemas().filter(({ name }) => name.startsWith("workspace_svg_"));

    expect(schemas.map(({ name }) => name).sort()).toEqual([
      "workspace_svg_apply",
      "workspace_svg_compile",
    ]);
    for (const schema of schemas) {
      expectObjectsClosed(schema.parameters);
      expectObjectsClosed(harness.ctx.tools.get(schema.name)!.output.schema);
    }
    expect(Object.keys(workspaceSvgCompileParameters).sort()).toEqual([
      "add", "estimate_text_size", "output_path", "page", "source_path",
    ]);
    expect(Object.keys(workspaceSvgApplyParameters).sort()).toEqual([
      "add", "estimate_text_size", "output_path", "page", "source_path", "unit_id", "worktree_id",
    ]);
    const sdk = renderToolsSdk(schemas.map((schema) => ({
      ...schema,
      output: harness.ctx.tools.get(schema.name)!.output.schema,
    })));
    expect(sdk).not.toMatch(/\b(?:origin|credential|license|unit_type|raw_svg|inline_svg|render_path)\??:/u);
  });

  it.each([
    ["workspace_svg_compile", { source_path: "page.svg", unknown: true }],
    ["workspace_svg_compile", { add: true, source_path: "page.svg" }],
    ["workspace_svg_compile", { output_path: "program.js", source_path: "page.svg" }],
    ["workspace_svg_compile", { page: 0, source_path: "page.svg" }],
    ["workspace_svg_apply", { page: 1, source_path: "page.svg", unit_id: "", worktree_id: "wt-1" }],
  ] as const)("rejects invalid exact/cross-field arguments for %s before operations", async (name, args) => {
    const harness = await setup();
    await expect(execute(harness.ctx, name, args)).resolves.toMatchObject({
      isError: true,
      error: { info: { code: "workspace-svg-argument-invalid" } },
    });
    expect(harness.compile).not.toHaveBeenCalled();
    expect(harness.saveProgram).not.toHaveBeenCalled();
    expect(harness.apply).not.toHaveBeenCalled();
  });

  it("enforces the complete canonical argument budget before operations", async () => {
    const harness = await setup();
    const source_path = "x".repeat(MAX_SVG_ARGUMENT_BYTES);
    const result = await execute(harness.ctx, "workspace_svg_compile", { source_path });
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-svg-limit-exceeded" } },
    });
    expect(harness.compile).not.toHaveBeenCalled();
  });

  it("returns lossless raw/page replace/add outcomes with fixed Core limits", async () => {
    const harness = await setup();
    const raw = await execute(harness.ctx, "workspace_svg_compile", {
      estimate_text_size: true,
      source_path: "nested/page.svg",
    });
    expect(raw).toMatchObject({
      isError: false,
      value: {
        generated: { code: "raw();", kind: "inline" },
        kind: "workspace-svg-compile",
        lints: ["lint"],
        mode: "replace",
        textMeasure: "builtin-estimate",
        viewport: { height: 540, width: 960 },
        warnings: ["warning"],
      },
    });
    expect((raw as { readonly value: Record<string, unknown> }).value).not.toHaveProperty("page");

    const page = await execute(harness.ctx, "workspace_svg_compile", {
      add: true,
      page: 2,
      source_path: "nested/page.svg",
    });
    expect(page).toMatchObject({
      isError: false,
      value: {
        generated: { code: "page-2-add();", kind: "inline" },
        mode: "add",
        page: 2,
        textMeasure: "univer-render-runtime",
      },
    });
    expect(harness.compile).toHaveBeenNthCalledWith(1, expect.objectContaining({
      maxAssetBytes: MAX_SVG_ASSET_BYTES,
      maxSourceBytes: MAX_SVG_SOURCE_BYTES,
    }));
  });

  it("returns compile/apply inline and file generated unions and saves before applying once", async () => {
    const order: string[] = [];
    const harness = await setup({
      apply: async ({ compiled }) => {
        order.push("apply");
        expect(compiled.code).toMatch(/^page-[13]-(?:add|replace)\(\);$/u);
        return { ...compiled, applied: { committed: true, revision: 9, status: "committed", value: null } };
      },
      saveProgram: async ({ code }) => {
        order.push("save");
        expect(code).toBe("page-3-replace();");
        return "generated/program.js";
      },
    });
    const compiled = await execute(harness.ctx, "workspace_svg_compile", {
      output_path: "generated/program.js",
      page: 3,
      source_path: "page.svg",
    });
    expect(compiled).toMatchObject({
      isError: false,
      value: { generated: { kind: "file", location: "generated/program.js" } },
    });

    order.length = 0;
    const applied = await execute(harness.ctx, "workspace_svg_apply", {
      output_path: "generated/program.js",
      page: 3,
      source_path: "page.svg",
      unit_id: "slide-1",
      worktree_id: "wt-1",
    });
    expect(order).toEqual(["save", "apply"]);
    expect(harness.apply).toHaveBeenCalledOnce();
    expect(applied).toMatchObject({
      isError: false,
      value: {
        applied: { committed: true, revision: 9, status: "committed", value: null },
        generated: { kind: "file", location: "generated/program.js" },
        kind: "workspace-svg-apply",
        page: 3,
      },
    });

    const inline = await execute(harness.ctx, "workspace_svg_apply", {
      add: true,
      page: 1,
      source_path: "page.svg",
      unit_id: "slide-1",
      worktree_id: "wt-1",
    });
    expect(inline).toMatchObject({
      isError: false,
      value: { generated: { code: "page-1-add();", kind: "inline" }, mode: "add" },
    });
  });

  it("passes the exact serialized apply-value allowance and depth to shared execution", async () => {
    let received: { readonly args: WorkspaceSvgApplyArgs; readonly compiled: WorkspaceCompileSvgResult; readonly maxValueBytes: number; readonly maxValueDepth: number; readonly signal: AbortSignal } | undefined;
    const harness = await setup({
      apply: async (input) => {
        received = input;
        return { ...input.compiled, applied: { committed: false, value: null } };
      },
    });
    const result = await execute(harness.ctx, "workspace_svg_apply", {
      page: 1,
      source_path: "page.svg",
      unit_id: "slide-1",
      worktree_id: "wt-1",
    });
    expect(result).toMatchObject({ isError: false });
    expect(received?.maxValueDepth).toBe(MAX_SVG_JSON_DEPTH - 2);
    const envelope = (result as { readonly value: unknown }).value;
    const committedEnvelope = {
      ...(envelope as Record<string, unknown>),
      applied: {
        committed: true,
        revision: Number.MAX_SAFE_INTEGER,
        status: "committed",
        value: null,
      },
    };
    const fixedBytes = Math.max(
      measureCanonicalJson(envelope).bytes,
      measureCanonicalJson(committedEnvelope).bytes,
    ) - Buffer.byteLength("null");
    expect(received?.maxValueBytes).toBe(MAX_SVG_CANONICAL_BYTES - fixedBytes);
  });

  it("fits a worst-case committed value at the exact boundary and rejects one byte more before commit", async () => {
    let commits = 0;
    const boundary = await setup({
      apply: async (input) => {
        const value = "x".repeat(input.maxValueBytes - 2);
        commits += 1;
        return {
          ...input.compiled,
          applied: {
            committed: true,
            revision: Number.MAX_SAFE_INTEGER,
            status: "committed",
            value,
          },
        };
      },
    });
    const boundaryResult = await execute(boundary.ctx, "workspace_svg_apply", {
      page: 1,
      source_path: "page.svg",
      unit_id: "slide-1",
      worktree_id: "wt-1",
    });
    expect(boundaryResult).toMatchObject({ isError: false });
    expect(measureCanonicalJson((boundaryResult as { readonly value: unknown }).value).bytes)
      .toBe(MAX_SVG_CANONICAL_BYTES);
    expect(commits).toBe(1);

    let overageCommits = 0;
    const overage = await setup({
      apply: async (input) => {
        const value = "x".repeat(input.maxValueBytes - 1);
        const actual = measureCanonicalJson(value).bytes;
        if (actual > input.maxValueBytes) {
          throw new WorkspaceApplicationError("workspace-content-limit-exceeded", "Value exceeds limit.", {
            actual,
            kind: "execute-value",
            limit: input.maxValueBytes,
          });
        }
        overageCommits += 1;
        return {
          ...input.compiled,
          applied: {
            committed: true,
            revision: Number.MAX_SAFE_INTEGER,
            status: "committed",
            value,
          },
        };
      },
    });
    await expect(execute(overage.ctx, "workspace_svg_apply", {
      page: 1,
      source_path: "page.svg",
      unit_id: "slide-1",
      worktree_id: "wt-1",
    })).resolves.toMatchObject({
      error: { info: { code: "workspace-content-limit-exceeded" } },
      isError: true,
    });
    expect(overageCommits).toBe(0);
  });

  it("rejects generated-code and complete-result overages before save or apply", async () => {
    const oversizedCode = await setup({
      compile: async (input) => compiledFor(input.args, "x".repeat(MAX_SVG_GENERATED_CODE_BYTES + 1)),
    });
    await expect(execute(oversizedCode.ctx, "workspace_svg_compile", {
      output_path: "program.js",
      page: 1,
      source_path: "page.svg",
    })).resolves.toMatchObject({
      isError: true,
      error: { info: { code: "workspace-svg-limit-exceeded" } },
    });
    expect(oversizedCode.saveProgram).not.toHaveBeenCalled();

    const oversizedResult = await setup({
      compile: async (input) => ({
        ...compiledFor(input.args),
        warnings: ["x".repeat(MAX_SVG_CANONICAL_BYTES)],
      }),
    });
    await expect(execute(oversizedResult.ctx, "workspace_svg_apply", {
      page: 1,
      source_path: "page.svg",
      unit_id: "slide-1",
      worktree_id: "wt-1",
    })).resolves.toMatchObject({
      isError: true,
      error: { info: { code: "workspace-svg-limit-exceeded" } },
    });
    expect(oversizedResult.apply).not.toHaveBeenCalled();
  });

  it("fails closed for malformed compile and apply dependency results", async () => {
    const malformedCompile = await setup({
      compile: async (input) => ({ ...compiledFor(input.args), extra: "unsafe" }) as WorkspaceCompileSvgResult,
    });
    await expect(execute(malformedCompile.ctx, "workspace_svg_compile", {
      source_path: "page.svg",
    })).resolves.toMatchObject({
      isError: true,
      error: { info: { code: "workspace-svg-operation-failed" } },
    });

    const malformedApply = await setup({
      apply: async ({ compiled }) => ({
        ...compiled,
        applied: { committed: false, value: undefined as never },
      }),
    });
    await expect(execute(malformedApply.ctx, "workspace_svg_apply", {
      page: 1,
      source_path: "page.svg",
      unit_id: "slide-1",
      worktree_id: "wt-1",
    })).resolves.toMatchObject({
      isError: true,
      error: { info: { code: "workspace-svg-operation-failed" } },
    });
  });

  it("preserves the same canonical values through installed Code Mode dispatch", async () => {
    const harness = await setup({ codeMode: true });
    harness.codeRuntime!.dispatches = [{
      arguments: { page: 2, source_path: "page.svg" },
      name: "workspace_svg_compile",
    }];
    const result = await harness.ctx.tools.execute({
      agent: fakeAgent() as never,
      arguments: { code: "return await svg();", description: "Compile SVG" },
      callId: CallId("svg-code-mode"),
      name: "run_code",
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      isError: false,
      value: { result: [{ generated: { code: "page-2-replace();", kind: "inline" }, page: 2 }] },
    });
  });
});

async function setup(overrides: {
  readonly apply?: WorkspaceSvgToolOperations["apply"];
  readonly codeMode?: boolean;
  readonly compile?: WorkspaceSvgToolOperations["compile"];
  readonly saveProgram?: WorkspaceSvgToolOperations["saveProgram"];
} = {}) {
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(SystemPrompt);
  let codeRuntime: ControlledCodeRuntime | undefined;
  if (overrides.codeMode === true) {
    await ctx.plugin(ControlledCodeRuntime);
    codeRuntime = ctx.codeRuntime as ControlledCodeRuntime;
    await ctx.plugin(ToolRuntime, { mode: "code" });
  } else {
    await ctx.plugin(ToolRuntime);
  }
  const compile = vi.fn(overrides.compile ?? (async (input) => compiledFor(input.args)));
  const saveProgram = vi.fn(overrides.saveProgram ?? (async ({ args }) => args.output_path ?? "program.js"));
  const apply = vi.fn(overrides.apply ?? (async ({ compiled }) => ({
    ...compiled,
    applied: { committed: false, value: null },
  })));
  const unregister = registerWorkspaceSvgToolFoundation(ctx, { apply, compile, saveProgram });
  ctx.effect(() => () => {
    for (const dispose of [...unregister].reverse()) dispose();
  });
  return { apply, codeRuntime, compile, ctx, saveProgram };
}

async function setupProduction(overrides: {
  readonly apply?: (input: WorkspaceApplySvgInput) => Promise<WorkspaceApplySvgResult>;
  readonly afterWrite?: () => void;
  readonly approval?: ApprovalOutcome | (() => Promise<ApprovalOutcome>);
  readonly compile?: (input: WorkspaceCompileSvgInput) => Promise<WorkspaceCompileSvgResult>;
  readonly filesystem?: "confining" | "sandboxed" | FileSystem;
  readonly policy?: (cwd: string, request?: { readonly session?: unknown }) => {
    readonly mode: "danger-full-access" | "read-only" | "workspace-write";
    readonly workspaceRoot?: string;
  };
} = {}) {
  const cwd = await temporaryDirectory();
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolRuntime);
  if (overrides.policy !== undefined) {
    ctx.provide("sandboxPolicy", {
      defaultMode: "read-only",
      resolve: (request?: { readonly session?: unknown }) => overrides.policy!(cwd, request),
    } as never);
  }
  if (overrides.filesystem === undefined) await ctx.plugin(LocalFileSystem, { cwd });
  else if (overrides.filesystem === "confining") await ctx.plugin(ConfiningLocalFileSystem, { cwd });
  else if (overrides.filesystem === "sandboxed") await ctx.plugin(SandboxedFileSystem, { cwd });
  else ctx.provide("fs", overrides.filesystem);
  if (overrides.afterWrite !== undefined) {
    const filesystem = ctx.get("fs")!;
    const writeText = filesystem.writeText.bind(filesystem);
    filesystem.writeText = async (...args) => {
      const result = await writeText(...args);
      overrides.afterWrite!();
      return result;
    };
  }
  const approvals: string[] = [];
  await ctx.plugin(ApprovalService);
  ctx.on("approval/request", (request) => {
    approvals.push(request.toolName);
    return typeof overrides.approval === "function"
      ? overrides.approval()
      : Promise.resolve(overrides.approval ?? "allowed-once");
  });
  const compile = vi.fn(overrides.compile ?? (async (input) => compiledForCore(input.page, input.add)));
  const apply = vi.fn(overrides.apply ?? (async (input) => ({
    ...input.compiled,
    applied: { committed: false, value: null },
  })));
  const createFeature = vi.fn(() => ({ apply, compile }));
  const owner = new WorkspaceToolOwner();
  const registration = registerWorkspaceSvgTools(ctx, { createFeature, owner });
  ctx.effect(() => async () => {
    owner.stopAccepting();
    registration.stopAccepting();
    registration.unregister();
    owner.abort();
    await Promise.all([owner.drain(), registration.drain()]);
    registration.dispose();
  });
  return { apply, approvals, compile, createFeature, ctx, cwd, owner, registration };
}

function compiledForCore(
  page: number | undefined,
  add: boolean | undefined,
): WorkspaceCompileSvgResult {
  return {
    code: page === undefined ? "raw();" : `page-${String(page)}-${add === true ? "add" : "replace"}();`,
    lints: ["lint"],
    mode: add === true ? "add" : "replace",
    page,
    textMeasure: "builtin-estimate",
    viewport: { height: 540, width: 960 },
    warnings: ["warning"],
  };
}

async function executeWithAgent(
  ctx: Context,
  cwd: string,
  name: string,
  arguments_: unknown,
  signal = new AbortController().signal,
) {
  return await ctx.tools.execute({
    agent: fakeAgent(cwd) as never,
    arguments: arguments_,
    callId: CallId(`svg-local-${String(Math.random())}`),
    name,
    signal,
  });
}

async function temporaryDirectory(): Promise<string> {
  const path = await realpath(await mkdtemp(join(tmpdir(), "dsh-univer-work-svg-")));
  directories.push(path);
  return path;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function remoteFilesystem(): FileSystem {
  return {
    contains: vi.fn(),
    processPath: vi.fn(),
    resolve: vi.fn(),
    sandboxMode: undefined,
  } as unknown as FileSystem;
}

class ConfiningLocalFileSystem extends LocalFileSystem {
  public override get sandboxMode(): "workspace-write" { return "workspace-write"; }
}

function compiledFor(
  args: WorkspaceSvgApplyArgs | WorkspaceSvgCompileArgs,
  code = args.page === undefined ? "raw();" : `page-${String(args.page)}-${args.add === true ? "add" : "replace"}();`,
): WorkspaceCompileSvgResult {
  return {
    code,
    lints: ["lint"],
    mode: args.add === true ? "add" : "replace",
    page: args.page,
    textMeasure: args.estimate_text_size === true ? "builtin-estimate" : "univer-render-runtime",
    viewport: { height: 540, width: 960 },
    warnings: ["warning"],
  };
}

async function execute(ctx: Context, name: string, arguments_: unknown) {
  return await ctx.tools.execute({
    arguments: arguments_,
    callId: CallId(`svg-${String(Math.random())}`),
    name,
    signal: new AbortController().signal,
  });
}

function fakeAgent(cwd = process.cwd()) {
  const id = SessionId(`svg-${String(Math.random())}`);
  const session = Session.create(id, [], { version: 0, createdAt: 0, cwd, id });
  session.append("turn/start", { turn: 1 });
  session.append("step/start", { turn: 1, step: 1 });
  return { session };
}

function expectObjectsClosed(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) expectObjectsClosed(item);
    return;
  }
  const record = value as Record<string, unknown>;
  if (record["type"] === "object") expect(record["additionalProperties"]).toBe(false);
  for (const item of Object.values(record)) expectObjectsClosed(item);
}

class ControlledCodeRuntime extends CodeRuntime {
  public readonly isolation = "svg-tools-test";
  public readonly language = "typescript";
  public dispatches: Array<{ readonly arguments: Record<string, unknown>; readonly name: string }> = [];

  public override async run(request: CodeRunRequest): Promise<CodeRunResult> {
    const tools = request.bindings.find(({ global }) => global === "tools")?.functions;
    if (tools === undefined) return { logs: [], error: { kind: "exception", message: "missing tools" } };
    const value: CodeJsonValue[] = [];
    for (const dispatch of this.dispatches) value.push(await tools[dispatch.name]!(dispatch.arguments));
    return { logs: [], value };
  }
}
