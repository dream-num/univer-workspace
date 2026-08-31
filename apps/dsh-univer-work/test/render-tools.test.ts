import { Context } from "@deepseek-ai/cordis";
import type { FileSystem, FsTarget } from "@deepseek-ai/dsh-fs";
import LocalFileSystem from "@deepseek-ai/dsh-fs-local";
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
import { access, mkdir, mkdtemp, readFile, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WorkspaceApplicationError,
  WorkspaceHttp,
  type WorkspaceContentRuntime,
  type WorkspaceContentRuntimeOptions,
  type WorkspaceRuntimeTarget,
} from "@univerjs/univer-workspace-client-core";
import {
  MAX_LAYOUT_PAGE_SELECTORS,
  MAX_RENDER_ARGUMENT_BYTES,
  MAX_RENDER_CANONICAL_BYTES,
  MAX_RENDER_CANONICAL_DEPTH,
  MAX_SCREENSHOT_PAGES,
  MAX_SCREENSHOT_PIXELS,
  registerWorkspaceRenderTools,
  registerWorkspaceRenderToolFoundation,
  validateWorkspaceLayoutLintArgs,
  validateWorkspaceLayoutLintResult,
  validateWorkspaceScreenshotArgs,
  validateWorkspaceScreenshotCapture,
  validateWorkspaceScreenshotResultBudget,
  workspaceLayoutLintParameters,
  workspaceScreenshotParameters,
  type WorkspaceRenderToolOperations,
  type WorkspaceScreenshotArgs,
  type WorkspaceScreenshotValue,
} from "../src/render-tools.js";
import { WorkspaceContentRuntimeGenerations } from "../src/content-runtime-generation.js";
import { WorkspaceToolOwner } from "../src/tool-owner.js";

const contexts: Context[] = [];
const contextCwds = new WeakMap<Context, string>();
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async (ctx) => await ctx.fiber.dispose()));
  await Promise.all(directories.splice(0).map(async (path) => await rm(path, { force: true, recursive: true })));
});

describe("Workspace render closed contracts", () => {
  it("publishes exactly two recursively closed schemas without authority or byte inputs", async () => {
    const harness = await setup();
    const schemas = harness.ctx.tools.schemas().filter(({ name }) => name.startsWith("workspace_") && (name.includes("screenshot") || name.includes("layout_lint")));
    expect(schemas.map(({ name }) => name).sort()).toEqual(["workspace_layout_lint", "workspace_screenshot"]);
    for (const schema of schemas) {
      expect(schema.parameters.additionalProperties).toBe(false);
      expectObjectsClosed(schema.parameters);
      expectObjectsClosed(harness.ctx.tools.get(schema.name)!.output.schema);
    }
    expect(Object.keys(workspaceScreenshotParameters).sort()).toEqual([
      "output_directory", "scope", "target", "unit_id", "worktree_id",
    ]);
    expect(Object.keys(workspaceLayoutLintParameters).sort()).toEqual(["pages", "unit_id", "worktree_id"]);
    const sdk = renderToolsSdk(schemas.map((schema) => ({
      ...schema,
      output: harness.ctx.tools.get(schema.name)!.output.schema,
    })));
    expect(sdk).not.toMatch(/\b(?:origin|revision|unit_type|unitData|license|browser|renderPage|bytes)\??:/u);
  });

  it("orders screenshot preflight as policy, local proof, pure arguments, then Session containment", async () => {
    const readOnly = await setup({
      filesystem: "confining",
      policy: (cwd) => ({ mode: "read-only", workspaceRoot: cwd }),
    });
    await expect(execute(readOnly.ctx, "workspace_screenshot", { scope: null, unit_id: "sheet-view" }))
      .resolves.toMatchObject({ isError: true, error: { info: { code: "workspace-file-policy-denied" } } });
    expect(readOnly.approvals).toEqual([]);
    expect(readOnly.processPath).not.toHaveBeenCalled();
    expect(readOnly.probeTarget).not.toHaveBeenCalled();

    const nonLocalProcessPath = vi.fn();
    const nonLocal = await setup({
      filesystem: {
        sandboxMode: undefined,
        contains: vi.fn(),
        processPath: nonLocalProcessPath,
        resolve: vi.fn(),
      } as unknown as FileSystem,
    });
    await expect(execute(nonLocal.ctx, "workspace_screenshot", { scope: null, unit_id: "sheet-view" }))
      .resolves.toMatchObject({ isError: true, error: { info: { code: "workspace-local-filesystem-required" } } });
    expect(nonLocal.approvals).toEqual([]);
    expect(nonLocalProcessPath).not.toHaveBeenCalled();

    const invalid = await setup();
    await expect(execute(invalid.ctx, "workspace_screenshot", { scope: null, unit_id: "sheet-view" }))
      .resolves.toMatchObject({ isError: true, error: { info: { code: "workspace-render-argument-invalid" } } });
    expect(invalid.approvals).toEqual([]);
    expect(invalid.processPath).not.toHaveBeenCalled();

    const noCwd = await setup();
    await expect(executeWithoutAgent(noCwd.ctx, "workspace_screenshot", { scope: "trunk", unit_id: "sheet-view" }))
      .resolves.toMatchObject({ isError: true, error: { info: { code: "workspace-session-cwd-required" } } });
    expect(noCwd.approvals).toEqual([]);
    expect(noCwd.processPath).not.toHaveBeenCalled();

    const escape = await setup();
    const outside = await temporaryDirectory();
    await expect(execute(escape.ctx, "workspace_screenshot", {
      output_directory: outside,
      scope: "trunk",
      unit_id: "sheet-view",
    })).resolves.toMatchObject({ isError: true, error: { info: { code: "workspace-file-path-outside-session" } } });
    expect(escape.approvals).toEqual([]);
    expect(escape.probeTarget).not.toHaveBeenCalled();
  });

  it("asks once, defaults to screenshots, and keeps every generated basename in the approved directory", async () => {
    const asked = deferred<void>();
    const decision = deferred<ApprovalOutcome>();
    const harness = await setup({
      approval: async () => { asked.resolve(); return await decision.promise; },
      owner: new WorkspaceToolOwner(),
    });
    const pending = execute(harness.ctx, "workspace_screenshot", { scope: "trunk", unit_id: "sheet-view" });
    await asked.promise;
    expect(harness.processPath).not.toHaveBeenCalled();
    expect(harness.stat).not.toHaveBeenCalled();
    expect(harness.probeTarget).not.toHaveBeenCalled();
    expect(harness.captureScreenshot).not.toHaveBeenCalled();
    expect(harness.publishScreenshots).not.toHaveBeenCalled();
    decision.resolve("allowed-once");
    const result = await pending;
    const directory = join(harness.cwd, "screenshots");
    expect(result).toMatchObject({
      isError: false,
      value: { outputs: [{ location: join(directory, "sheet.png"), name: "sheet.png" }] },
    });
    expect(harness.approvals).toEqual(["workspace_screenshot"]);
    expect(harness.approvalReasons).toEqual([
      "Workspace screenshot writes PNG files to a Host-local Session directory.",
    ]);
    expect(harness.stat).toHaveBeenCalledOnce();
    expect(harness.processPath).toHaveBeenCalledOnce();
    expect(harness.publishScreenshots).toHaveBeenCalledWith(expect.objectContaining({ directory }));
    const outputs = (result as { readonly value: WorkspaceScreenshotValue }).value.outputs;
    expect(outputs.every(({ location, name }) => location === join(directory, name))).toBe(true);
  });

  it.each(["rejected", "cancelled", "unavailable"] as const)(
    "starts no screenshot body work when approval is %s",
    async (approval) => {
      const harness = await setup({ approval, owner: new WorkspaceToolOwner() });
      const result = await execute(harness.ctx, "workspace_screenshot", { scope: "trunk", unit_id: "sheet-view" });
      expect(result).toMatchObject({ isError: true });
      expect(harness.approvals).toEqual(["workspace_screenshot"]);
      expect(harness.stat).not.toHaveBeenCalled();
      expect(harness.processPath).not.toHaveBeenCalled();
      expect(harness.probeTarget).not.toHaveBeenCalled();
      expect(harness.captureScreenshot).not.toHaveBeenCalled();
      expect(harness.publishScreenshots).not.toHaveBeenCalled();
    },
  );

  it("keeps the rc.2 fixed denial identity when no approval service is composed", async () => {
    const harness = await setup({
      approvalService: false,
      owner: new WorkspaceToolOwner(),
    });
    const result = await execute(harness.ctx, "workspace_screenshot", {
      scope: "trunk",
      unit_id: "sheet-view",
    });
    expect(result).toMatchObject({ isError: true });
    expect(JSON.stringify(result)).toContain(
      "Workspace screenshot writes PNG files to a Host-local Session directory.",
    );
    expect(harness.approvals).toEqual([]);
    expect(harness.stat).not.toHaveBeenCalled();
    expect(harness.probeTarget).not.toHaveBeenCalled();
  });

  it.each([
    ["preflight", { output_directory: "../outside", scope: "trunk", unit_id: "sheet-view" }],
    ["denied", { scope: "trunk", unit_id: "sheet-view" }],
    ["success", { scope: "trunk", unit_id: "sheet-view" }],
    ["body failure", { scope: "trunk", unit_id: "sheet-view" }],
  ] as const)("releases the execution token after %s", async (outcome, args) => {
    const harness = await setup({
      approval: outcome === "denied" ? "rejected" : "allowed-once",
      ...(outcome === "body failure"
        ? { captureScreenshot: vi.fn(async () => { throw new Error("body-failure-secret"); }) }
        : {}),
      owner: new WorkspaceToolOwner(),
    });
    await execute(harness.ctx, "workspace_screenshot", args);
    harness.registration.stopAccepting();
    harness.registration.unregister();
    await expect(harness.registration.drain()).resolves.toBeUndefined();
    harness.registration.dispose();
  });

  it("keeps approval reason fixed and path-free", async () => {
    const sentinel = "private-output-path-sentinel";
    const harness = await setup({ approval: "rejected" });
    await execute(harness.ctx, "workspace_screenshot", {
      output_directory: sentinel,
      scope: "trunk",
      unit_id: "sheet-view",
    });
    expect(harness.approvalReasons).toEqual([
      "Workspace screenshot writes PNG files to a Host-local Session directory.",
    ]);
    expect(harness.approvalReasons.join(" ")).not.toContain(sentinel);
  });

  it("preserves ABORTED_BEFORE_DISPATCH during preflight resolution and pending approval", async () => {
    const resolving = await setup();
    const filesystem = resolving.ctx.get("fs")!;
    const entered = deferred<void>();
    const release = deferred<void>();
    vi.mocked(filesystem.resolve).mockImplementationOnce(async (path, options) => {
      const target = await resolving.resolveProvider(path, options);
      entered.resolve();
      await release.promise;
      options?.signal?.throwIfAborted();
      return target;
    });
    const resolveAbort = new AbortController();
    const resolvePending = execute(
      resolving.ctx,
      "workspace_screenshot",
      { scope: "trunk", unit_id: "sheet-view" },
      resolveAbort.signal,
    );
    await entered.promise;
    resolveAbort.abort(new Error("private-resolve-abort-sentinel"));
    release.resolve();
    await expect(resolvePending).resolves.toMatchObject({
      isError: true,
      error: { info: { code: "ABORTED_BEFORE_DISPATCH" } },
    });
    expect(resolving.approvals).toEqual([]);
    expect(resolving.stat).not.toHaveBeenCalled();
    expect(resolving.processPath).not.toHaveBeenCalled();
    expect(resolving.probeTarget).not.toHaveBeenCalled();
    expect(resolving.publishScreenshots).not.toHaveBeenCalled();

    const asked = deferred<void>();
    const decision = deferred<ApprovalOutcome>();
    const approving = await setup({
      approval: async () => { asked.resolve(); return await decision.promise; },
      owner: new WorkspaceToolOwner(),
    });
    const approvalAbort = new AbortController();
    const approvalPending = execute(
      approving.ctx,
      "workspace_screenshot",
      { scope: "trunk", unit_id: "sheet-view" },
      approvalAbort.signal,
    );
    await asked.promise;
    approvalAbort.abort(new Error("private-approval-abort-sentinel"));
    await expect(approvalPending).resolves.toMatchObject({
      isError: true,
      error: { info: { code: "ABORTED_BEFORE_DISPATCH" } },
    });
    decision.resolve("allowed-once");
    expect(approving.approvals).toEqual(["workspace_screenshot"]);
    expect(approving.stat).not.toHaveBeenCalled();
    expect(approving.processPath).not.toHaveBeenCalled();
    expect(approving.probeTarget).not.toHaveBeenCalled();
    expect(approving.publishScreenshots).not.toHaveBeenCalled();
  });

  it("rechecks policy root, provider identity, and symlink containment after approval", async () => {
    let mode: "read-only" | "workspace-write" = "workspace-write";
    const policyAsked = deferred<void>();
    const policyDecision = deferred<ApprovalOutcome>();
    const policy = await setup({
      approval: async () => { policyAsked.resolve(); return await policyDecision.promise; },
      filesystem: "confining",
      policy: (cwd) => ({ mode, workspaceRoot: cwd }),
    });
    const policyPending = execute(policy.ctx, "workspace_screenshot", { scope: "trunk", unit_id: "sheet-view" });
    await policyAsked.promise;
    mode = "read-only";
    policyDecision.resolve("allowed-once");
    await expect(policyPending).resolves.toMatchObject({
      isError: true,
      error: { info: { code: "workspace-file-policy-denied" } },
    });
    expect(policy.probeTarget).not.toHaveBeenCalled();

    let narrowed = false;
    const rootAsked = deferred<void>();
    const rootDecision = deferred<ApprovalOutcome>();
    const root = await setup({
      approval: async () => { rootAsked.resolve(); return await rootDecision.promise; },
      filesystem: "confining",
      policy: (cwd) => ({ mode: "workspace-write", workspaceRoot: narrowed ? join(cwd, "allowed") : cwd }),
    });
    await mkdir(join(root.cwd, "allowed"));
    const rootPending = execute(root.ctx, "workspace_screenshot", { scope: "trunk", unit_id: "sheet-view" });
    await rootAsked.promise;
    narrowed = true;
    rootDecision.resolve("allowed-once");
    await expect(rootPending).resolves.toMatchObject({
      isError: true,
      error: { info: { code: "workspace-file-path-outside-session" } },
    });
    expect(root.probeTarget).not.toHaveBeenCalled();

    const providerAsked = deferred<void>();
    const providerDecision = deferred<ApprovalOutcome>();
    const provider = await setup({
      approval: async () => { providerAsked.resolve(); return await providerDecision.promise; },
    });
    const providerFilesystem = provider.ctx.get("fs")!;
    const prototype = Object.getPrototypeOf(providerFilesystem) as object;
    const providerPending = execute(provider.ctx, "workspace_screenshot", { scope: "trunk", unit_id: "sheet-view" });
    await providerAsked.promise;
    Object.setPrototypeOf(providerFilesystem, Object.prototype);
    providerDecision.resolve("allowed-once");
    const providerResult = await providerPending.finally(() => Object.setPrototypeOf(providerFilesystem, prototype));
    expect(providerResult).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-local-filesystem-required" } },
    });
    expect(provider.probeTarget).not.toHaveBeenCalled();

    const outside = await temporaryDirectory();
    const symlinkAsked = deferred<void>();
    const symlinkDecision = deferred<ApprovalOutcome>();
    const symlinkHarness = await setup({
      approval: async () => { symlinkAsked.resolve(); return await symlinkDecision.promise; },
    });
    const symlinkPending = execute(symlinkHarness.ctx, "workspace_screenshot", {
      output_directory: "out",
      scope: "trunk",
      unit_id: "sheet-view",
    });
    await symlinkAsked.promise;
    await symlink(outside, join(symlinkHarness.cwd, "out"));
    symlinkDecision.resolve("allowed-once");
    await expect(symlinkPending).resolves.toMatchObject({
      isError: true,
      error: { info: { code: "workspace-file-path-outside-session" } },
    });
    expect(symlinkHarness.probeTarget).not.toHaveBeenCalled();
  });

  it("does not ask or write for read-only layout lint", async () => {
    const harness = await setup({ approval: "rejected" });
    const result = await execute(harness.ctx, "workspace_layout_lint", {
      unit_id: "slide-1",
      worktree_id: "wt-1",
    });
    expect(result).toMatchObject({ isError: false, value: { kind: "unit-layout-lint" } });
    expect(harness.approvals).toEqual([]);
    expect(harness.processPath).not.toHaveBeenCalled();
    expect(harness.captureScreenshot).not.toHaveBeenCalled();
    expect(harness.publishScreenshots).not.toHaveBeenCalled();
  });

  it("rejects root/nested unknown keys and accessors without invoking them or any operation", async () => {
    let getterCalls = 0;
    const accessor = Object.defineProperty({ scope: "trunk", unit_id: "sheet-1" }, "origin", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "secret-origin";
      },
    });
    expect(() => validateWorkspaceScreenshotArgs(accessor)).toThrowError(expect.objectContaining({ code: "workspace-render-argument-invalid" }));
    expect(getterCalls).toBe(0);

    for (const args of [
      { scope: "trunk", unit_id: "sheet-1", revision: 7 },
      { scope: "trunk", target: { kind: "sheet-viewport", pages: [1] }, unit_id: "sheet-1" },
      { scope: "worktree", target: { kind: "slide-pages", contact_sheet: { tile: { columns: 1, rows: 1, extra: true } } }, unit_id: "slide-1", worktree_id: "wt-1" },
    ]) {
      const harness = await setup();
      const result = await execute(harness.ctx, "workspace_screenshot", args);
      expect(result).toMatchObject({ isError: true, error: { info: { code: "workspace-render-argument-invalid" } } });
      expect(harness.probeTarget).not.toHaveBeenCalled();
      expect(harness.processPath).not.toHaveBeenCalled();
    }
  });

  it("enforces scope cross-fields, beta.2 target semantics, and fixed limit ordering", () => {
    for (const value of [
      { scope: "trunk", unit_id: "u", worktree_id: "wt" },
      { scope: "worktree", unit_id: "u" },
      { scope: "trunk", target: { kind: "sheet-range", range: "B2:A1" }, unit_id: "u" },
      { scope: "trunk", target: { kind: "doc-pages", pages: [0] }, unit_id: "u" },
      { scope: "trunk", target: { kind: "slide-pages", pages: [1, ""] }, unit_id: "u" },
      { scope: "trunk", target: { kind: "slide-pages", pages: [1, 2], contact_sheet: { tile: { columns: 1, rows: 1 } } }, unit_id: "u" },
      { scope: "trunk", target: { kind: "board-content", element_ids: ["a"], region: { left: 0, top: 0, width: 1, height: 1 } }, unit_id: "u" },
      { scope: "trunk", target: { kind: "board-content", scale: 2 }, unit_id: "u" },
      { scope: "trunk", target: { kind: "board-content", region: { left: 0, top: 0, width: 0, height: 1 } }, unit_id: "u" },
      { scope: "trunk", target: { kind: "base-view", scale: 4.1 }, unit_id: "u" },
    ]) expect(() => validateWorkspaceScreenshotArgs(value)).toThrowError(expect.objectContaining({ code: "workspace-render-argument-invalid" }));

    expect(() => validateWorkspaceScreenshotArgs({
      scope: "trunk",
      target: { kind: "doc-pages", pages: Array.from({ length: MAX_SCREENSHOT_PAGES + 1 }, (_, index) => index + 1) },
      unit_id: "u",
    })).toThrowError(expect.objectContaining({ code: "workspace-render-limit-exceeded" }));
    expect(() => validateWorkspaceLayoutLintArgs({
      pages: Array.from({ length: MAX_LAYOUT_PAGE_SELECTORS + 1 }, () => 1),
      unit_id: "slide-1",
      worktree_id: "wt-1",
    })).toThrowError(expect.objectContaining({ code: "workspace-render-limit-exceeded" }));
    expect(() => validateWorkspaceLayoutLintArgs({
      pages: [],
      unit_id: "slide-1",
      worktree_id: "wt-1",
    })).toThrowError(expect.objectContaining({ code: "workspace-render-argument-invalid" }));

    const base = { output_directory: "", scope: "trunk", unit_id: "u" };
    const fixedBytes = Buffer.byteLength(JSON.stringify(base));
    const exact = { ...base, output_directory: "x".repeat(MAX_RENDER_ARGUMENT_BYTES - fixedBytes) };
    expect(Buffer.byteLength(JSON.stringify(exact))).toBe(MAX_RENDER_ARGUMENT_BYTES);
    expect(validateWorkspaceScreenshotArgs(exact).output_directory).toHaveLength(exact.output_directory.length);
    expect(() => validateWorkspaceScreenshotArgs({ ...exact, output_directory: `${exact.output_directory}x` }))
      .toThrowError(expect.objectContaining({ code: "workspace-render-limit-exceeded" }));
  });

  it("rejects more than 30 raw screenshot selectors before directory approval or probe", async () => {
    const harness = await setup();
    const result = await execute(harness.ctx, "workspace_screenshot", {
      scope: "trunk",
      target: {
        kind: "slide-pages",
        pages: Array.from({ length: MAX_SCREENSHOT_PAGES + 1 }, (_, index) => `page-${String(index + 1)}`),
      },
      unit_id: "slide-1",
    });
    expect(result).toMatchObject({ isError: true, error: { info: { code: "workspace-render-limit-exceeded" } } });
    expect(harness.processPath).not.toHaveBeenCalled();
    expect(harness.probeTarget).not.toHaveBeenCalled();
    expect(harness.captureScreenshot).not.toHaveBeenCalled();
  });

  it("preserves beta.2 first-use dedup before enforcing the 30-page limit", async () => {
    const harness = await setup();
    const repeatedDoc = await execute(harness.ctx, "workspace_screenshot", {
      scope: "trunk",
      target: { kind: "doc-pages", pages: Array.from({ length: 31 }, () => 1) },
      unit_id: "doc-1",
    });
    expect(repeatedDoc).toMatchObject({ isError: false, value: { outputs: [{ page: 1 }] } });

    const repeatedSlide = await execute(harness.ctx, "workspace_screenshot", {
      scope: "trunk",
      target: { kind: "slide-pages", pages: Array.from({ length: 31 }, () => 1) },
      unit_id: "slide-1",
    });
    expect(repeatedSlide).toMatchObject({ isError: false, value: { outputs: [{ page: 1 }] } });

    const mixedAliases = await execute(harness.ctx, "workspace_screenshot", {
      scope: "trunk",
      target: {
        kind: "slide-pages",
        pages: [...Array.from({ length: 16 }, () => 1), ...Array.from({ length: 15 }, () => "cover")],
      },
      unit_id: "slide-1",
    });
    expect(mixedAliases).toMatchObject({ isError: false, value: { outputs: [{ page: 1 }] } });

    const resolvedPages = [
      ...Array.from({ length: 16 }, (_, index) => index + 1),
      ...Array.from({ length: 15 }, (_, index) => `page-${String(index + 17)}`),
    ];
    const resolvedLimit = await setup({
      probeTarget: vi.fn(async (input) => ({
        slidePageIdentities: input.slidePages?.map((selector: number | string) => {
          const page = typeof selector === "number" ? selector : Number(selector.slice("page-".length));
          return { page, pageId: `page-${String(page)}` };
        }),
        target: runtimeTarget("slide", input.unitId, input.scope),
      })),
    });
    const rejected = await execute(resolvedLimit.ctx, "workspace_screenshot", {
      scope: "trunk",
      target: { kind: "slide-pages", pages: resolvedPages },
      unit_id: "slide-1",
    });
    expect(rejected).toMatchObject({ isError: true, error: { info: { code: "workspace-render-limit-exceeded" } } });
    expect(resolvedLimit.probeTarget).toHaveBeenCalledOnce();
    expect(resolvedLimit.captureScreenshot).not.toHaveBeenCalled();
    expect(resolvedLimit.publishScreenshots).not.toHaveBeenCalled();
  });

  it("accepts all six targets and fails mismatches after the authoritative probe but before capture", async () => {
    const cases = [
      ["sheet-viewport", "sheet-view", { kind: "sheet-viewport", scale: 1 }],
      ["sheet-range", "sheet-range", { kind: "sheet-range", range: "A1:B2", scale: 2, sheet_name: "Data" }],
      ["doc-pages", "doc-1", { kind: "doc-pages", pages: [1, 2], scale: 1 }],
      ["slide-pages", "slide-1", { kind: "slide-pages", pages: [1, "cover"], scale: 1, contact_sheet: { tile: { columns: 2, rows: 1 } } }],
      ["board-content", "board-1", { kind: "board-content", element_ids: ["shape-1"], padding: 8, scale: 1 }],
      ["base-view", "base-1", { kind: "base-view", scale: 1 }],
    ] as const;
    const harness = await setup();
    for (const [kind, unitId, target] of cases) {
      const result = await execute(harness.ctx, "workspace_screenshot", {
        scope: "worktree",
        target,
        unit_id: unitId,
        worktree_id: "wt-1",
      });
      expect(result).toMatchObject({ isError: false, value: { kind: "workspace-screenshot", unitId } });
      expect(harness.captureScreenshot.mock.calls.at(-1)?.[0].targetOptions).toMatchObject({ kind });
    }
    expect(harness.captureScreenshot.mock.calls[1]?.[0].targetOptions).toMatchObject({ sheetName: "Data" });
    expect(harness.captureScreenshot.mock.calls[3]?.[0].targetOptions).toMatchObject({ contactSheet: { tile: { columns: 2, rows: 1 } } });
    expect(harness.captureScreenshot.mock.calls[4]?.[0].targetOptions).toMatchObject({ elementIds: ["shape-1"] });

    const mismatch = await execute(harness.ctx, "workspace_screenshot", {
      scope: "trunk",
      target: { kind: "doc-pages", pages: [1] },
      unit_id: "sheet-view",
    });
    expect(mismatch).toMatchObject({ isError: true, error: { info: { code: "workspace-screenshot-target-required" } } });
    expect(harness.probeTarget).toHaveBeenCalled();
    expect(harness.captureScreenshot).toHaveBeenCalledTimes(cases.length);
  });

  it("resolves Slide page IDs before capture and validates beta.2 numeric page outputs", async () => {
    const valid = await setup();
    const accepted = await execute(valid.ctx, "workspace_screenshot", {
      scope: "trunk",
      target: { kind: "slide-pages", pages: ["cover"] },
      unit_id: "slide-1",
    });
    expect(accepted).toMatchObject({
      isError: false,
      value: { outputs: [{ page: 1 }] },
    });
    expect((accepted as { readonly value: { readonly outputs: readonly unknown[] } }).value.outputs[0])
      .not.toHaveProperty("pageId");
    expect(valid.probeTarget).toHaveBeenCalledWith(expect.objectContaining({ slidePages: ["cover"] }), expect.any(AbortSignal));

    const aliasContact = await execute(valid.ctx, "workspace_screenshot", {
      scope: "trunk",
      target: {
        contact_sheet: { tile: { columns: 1, rows: 1 } },
        kind: "slide-pages",
        pages: [1, "cover"],
      },
      unit_id: "slide-1",
    });
    expect(aliasContact).toMatchObject({
      isError: false,
      value: { outputs: [{ page: 1 }, { role: "contact-slide", tiles: 1 }] },
    });

    const missing = await setup();
    const missingResult = await execute(missing.ctx, "workspace_screenshot", {
      scope: "trunk",
      target: { kind: "slide-pages", pages: ["missing"] },
      unit_id: "slide-1",
    });
    expect(missingResult).toMatchObject({ isError: true, error: { info: { code: "workspace-render-operation-failed" } } });
    expect(missing.captureScreenshot).not.toHaveBeenCalled();

    const mismatch = await setup({
      captureScreenshot: vi.fn(async () => ({
        images: [{ ...image("slide-2.png"), page: 2 }],
        unitId: "slide-1",
        unitType: "slide",
      })),
    });
    const mismatchResult = await execute(mismatch.ctx, "workspace_screenshot", {
      scope: "trunk",
      target: { kind: "slide-pages", pages: ["cover"] },
      unit_id: "slide-1",
    });
    expect(mismatchResult).toMatchObject({ isError: true, error: { info: { code: "workspace-screenshot-output-invalid" } } });
    expect(mismatch.publishScreenshots).not.toHaveBeenCalled();
  });

  it("correlates canonical Sheet range and optional sheet identity without applying it to viewport", async () => {
    const validRange = await setup({
      captureScreenshot: vi.fn(async () => ({
        images: [{ ...image("data-A1-B2.png"), range: "A1:B2", sheetName: "Data" }],
        unitId: "sheet-range",
        unitType: "sheet",
      })),
    });
    const accepted = await execute(validRange.ctx, "workspace_screenshot", {
      scope: "trunk",
      target: { kind: "sheet-range", range: "a01:b02", sheet_name: "Data" },
      unit_id: "sheet-range",
    });
    expect(accepted).toMatchObject({ isError: false, value: { outputs: [{ range: "A1:B2", sheetName: "Data" }] } });

    for (const [target, imageMetadata] of [
      [{ kind: "sheet-range", range: "A1:B2", sheet_name: "Data" }, { range: "B2:C3", sheetName: "Data" }],
      [{ kind: "sheet-range", range: "A1:B2", sheet_name: "Data" }, { range: "A1:B2", sheetName: "Other" }],
      [{ kind: "sheet-range", range: "A1:B2", sheet_name: "Data" }, { range: "A1:B2" }],
      [{ kind: "sheet-range", range: "A1:B2" }, { range: "A1:B2", sheetName: "Other" }],
    ] as const) {
      const mismatch = await setup({
        captureScreenshot: vi.fn(async () => ({
          images: [{ ...image("mismatch.png"), ...imageMetadata }],
          unitId: "sheet-range",
          unitType: "sheet",
        })),
      });
      const result = await execute(mismatch.ctx, "workspace_screenshot", {
        scope: "trunk",
        target,
        unit_id: "sheet-range",
      });
      expect(result).toMatchObject({ isError: true, error: { info: { code: "workspace-screenshot-output-invalid" } } });
      expect(mismatch.publishScreenshots).not.toHaveBeenCalled();
    }

    const viewport = await setup({
      captureScreenshot: vi.fn(async () => ({
        images: [{ ...image("viewport.png"), range: "B2:C3", sheetName: "Active" }],
        unitId: "sheet-view",
        unitType: "sheet",
      })),
    });
    await expect(execute(viewport.ctx, "workspace_screenshot", {
      scope: "trunk",
      target: { kind: "sheet-viewport" },
      unit_id: "sheet-view",
    })).resolves.toMatchObject({ isError: false });
  });

  it("rejects requested/captured page, contact, and Board selector identity mismatches before publication", async () => {
    const slideBase = {
      unitId: "slide-1",
      unitType: "slide",
    } as const;
    const cases: Array<[WorkspaceScreenshotArgs, unknown]> = [
      [{ scope: "trunk", target: { kind: "doc-pages", pages: [1] }, unit_id: "doc-1" }, {
        images: [{ ...image("doc-99.png"), page: 99 }], unitId: "doc-1", unitType: "doc",
      }],
      [{ scope: "trunk", target: { kind: "slide-pages", pages: [2] }, unit_id: "slide-1" }, {
        ...slideBase, images: [{ ...image("slide-1.png"), page: 1, pageId: "cover" }],
      }],
      [{ scope: "trunk", target: { kind: "slide-pages", pages: ["agenda"] }, unit_id: "slide-1" }, {
        ...slideBase, images: [{ ...image("slide-1.png"), page: 1 }],
      }],
      [{ scope: "trunk", target: { kind: "slide-pages", pages: [1, 2] }, unit_id: "slide-1" }, {
        ...slideBase,
        images: [
          { ...image("slide-1.png"), page: 1, pageId: "cover" },
          { ...image("slide-2.png"), page: 1, pageId: "agenda" },
        ],
      }],
      [{ scope: "trunk", target: { kind: "slide-pages", pages: [1, 2] }, unit_id: "slide-1" }, {
        ...slideBase,
        images: [
          { ...image("slide-1.png"), page: 1, pageId: "same-id" },
          { ...image("slide-2.png"), page: 2, pageId: "same-id" },
        ],
      }],
      [{ scope: "trunk", target: { kind: "slide-pages", pages: [1], contact_sheet: {} }, unit_id: "slide-1" }, {
        ...slideBase,
        images: [
          { ...image("slide-1.png"), page: 1, pageId: "cover" },
          { ...image("contact-slide.png"), role: "contact-slide", tiles: 9 },
        ],
      }],
      [{
        scope: "trunk",
        target: { kind: "board-content", region: { height: 10, left: 1, top: 2, width: 20 } },
        unit_id: "board-1",
      }, (() => {
        const result = captureFor("board", "board-1", { kind: "board-content", region: { height: 10, left: 1, top: 2, width: 20 } });
        const board = result.images[0] as Record<string, unknown>;
        const { boardSelector: _selector, ...withoutSelector } = board;
        return { ...result, images: [withoutSelector] };
      })()],
    ];
    for (const [args, capture] of cases) {
      const harness = await setup({ captureScreenshot: vi.fn(async () => capture) });
      const result = await execute(harness.ctx, "workspace_screenshot", args);
      expect(result).toMatchObject({ isError: true, error: { info: { code: "workspace-screenshot-output-invalid" } } });
      expect(harness.publishScreenshots).not.toHaveBeenCalled();
    }
  });

  it("preserves complete Board metadata and complete lint finding fields", async () => {
    const harness = await setup();
    const screenshot = await execute(harness.ctx, "workspace_screenshot", {
      scope: "trunk",
      target: { kind: "board-content", region: { height: 20, left: 1, top: 2, width: 30 }, padding: 4, scale: 1 },
      unit_id: "board-1",
    });
    expect(screenshot).toMatchObject({
      isError: false,
      value: {
        outputs: [{
          boardSelector: { kind: "region", region: { height: 20, left: 1, top: 2, width: 30 } },
          contentBounds: { height: 20, left: 1, top: 2, width: 30 },
          layoutAnalysis: {
            issues: [{ endpoint: "end", routePoints: [{ x: 1, y: 2 }], suggestedAction: "bind-connector-endpoint" }],
            routes: [{ connectorId: "connector-1", points: [{ x: 1, y: 2 }], resolved: false }],
          },
          role: "board-content",
        }],
      },
    });

    const lint = await execute(harness.ctx, "workspace_layout_lint", {
      pages: [1, "cover"],
      unit_id: "slide-1",
      worktree_id: "wt-1",
    });
    expect(lint).toMatchObject({
      isError: false,
      value: {
        findings: [{
          detail: "authorized-workspace-text",
          other: { content: "other text" },
          overlapRatio: 0.5,
          related: "text-2",
          rule: "text-overlaps-text",
        }],
      },
    });
  });

  it("gates malformed, duplicate, unsafe, pixel, and oversized capture before first publication", async () => {
    const variants: Array<[unknown, string]> = [
      [{ ...captureFor("sheet", "sheet-view"), images: [{ ...image("one.png"), unknown: "sentinel" }] }, "workspace-screenshot-output-invalid"],
      [{ ...captureFor("sheet", "sheet-view"), images: [image("one.png"), image("one.png")] }, "workspace-screenshot-output-invalid"],
      [{ ...captureFor("sheet", "sheet-view"), images: [image("../one.png")] }, "workspace-screenshot-output-invalid"],
      [{ ...captureFor("sheet", "sheet-view"), images: [{ ...image("one.png"), width: MAX_SCREENSHOT_PIXELS + 1 }] }, "PIXEL_LIMIT_EXCEEDED"],
      [{ ...captureFor("sheet", "sheet-view"), images: [{ ...image("one.png"), range: "A1", sheetName: "x".repeat(MAX_RENDER_CANONICAL_BYTES) }] }, "workspace-render-limit-exceeded"],
    ];
    for (const [capture, code] of variants) {
      const harness = await setup({ captureScreenshot: vi.fn(async () => capture) });
      const result = await execute(harness.ctx, "workspace_screenshot", { scope: "trunk", unit_id: "sheet-view" });
      expect(result).toMatchObject({ isError: true, error: { info: { code } } });
      expect(harness.publishScreenshots).not.toHaveBeenCalled();
    }
    let deeperThanLimit: unknown = "leaf";
    for (let depth = 0; depth <= MAX_RENDER_CANONICAL_DEPTH; depth += 1) {
      deeperThanLimit = { next: deeperThanLimit };
    }
    expect(() => validateWorkspaceScreenshotResultBudget(deeperThanLimit))
      .toThrowError(expect.objectContaining({ code: "workspace-render-limit-exceeded" }));
  });

  it("stops later operations after authoritative, publication, or Unit-type failures", async () => {
    const scenarios = [
      {
        code: "workspace-render-operation-failed",
        expected: { capture: 0, lint: 0, publish: 0 },
        kind: "probe",
        tool: "workspace_screenshot",
        args: { scope: "trunk", unit_id: "sheet-view" },
      },
      {
        code: "workspace-screenshot-output-invalid",
        expected: { capture: 1, lint: 0, publish: 1 },
        kind: "receipt",
        tool: "workspace_screenshot",
        args: { scope: "trunk", unit_id: "sheet-view" },
      },
      {
        code: "workspace-unit-layout-lint-unit-type-unsupported",
        expected: { capture: 0, lint: 0, publish: 0 },
        kind: "non-slide",
        tool: "workspace_layout_lint",
        args: { unit_id: "sheet-view", worktree_id: "wt-1" },
      },
    ] as const;
    for (const scenario of scenarios) {
      const harness = scenario.kind === "probe"
        ? await setup({
          probeTarget: vi.fn(async (input) => ({
            target: runtimeTarget("sheet", "different-unit", input.scope),
          })),
        })
        : scenario.kind === "receipt"
        ? await setup({
          publishScreenshots: vi.fn(async () => [{ location: "/approved/screenshots/wrong.png", name: "wrong.png" }]),
        })
        : await setup();
      const result = await execute(harness.ctx, scenario.tool, scenario.args);
      expect(result).toMatchObject({ isError: true, error: { info: { code: scenario.code } } });
      expect(harness.captureScreenshot).toHaveBeenCalledTimes(scenario.expected.capture);
      expect(harness.publishScreenshots).toHaveBeenCalledTimes(scenario.expected.publish);
      expect(harness.lintLayout).toHaveBeenCalledTimes(scenario.expected.lint);
    }
  });

  it("returns lossless lint text and rejects oversized or malformed reports without truncation", async () => {
    const complete = lintReport("x".repeat(1_000_000));
    const target = runtimeTarget("slide", "slide-1", { kind: "worktree", worktreeId: "wt-1" });
    expect(() => validateWorkspaceLayoutLintResult(target, complete)).not.toThrow();
    expect((complete.findings[0] as { detail: string }).detail).toHaveLength(1_000_000);
    expect(() => validateWorkspaceLayoutLintResult(target, lintReport("x".repeat(MAX_RENDER_CANONICAL_BYTES))))
      .toThrowError(expect.objectContaining({ code: "workspace-render-limit-exceeded" }));
    expect(() => validateWorkspaceLayoutLintResult(target, {
      ...lintReport("ok"),
      findings: [{ ...lintReport("ok").findings[0], secret: "not-allowed" }],
    })).toThrowError(expect.objectContaining({ code: "INVALID_RENDER_RESULT" }));
  });

  it("requires exact evidence siblings for all three fixed lint rules", () => {
    const target = runtimeTarget("slide", "slide-1", { kind: "worktree", worktreeId: "wt-1" });
    const valid = allRulesLintReport();
    expect(() => validateWorkspaceLayoutLintResult(target, valid)).not.toThrow();
    expect(JSON.stringify(valid)).toContain("authorized off-page evidence");
    expect(JSON.stringify(valid)).toContain("authorized container evidence");
    expect(JSON.stringify(valid)).toContain("authorized overlap evidence");

    const [escapes, offPage, overlaps] = valid.findings;
    const invalid = [
      { ...valid, findings: [{ ...offPage, other: overlaps!.other }] },
      { ...valid, findings: [without(offPage!, "pageBox")] },
      { ...valid, findings: [without(escapes!, "container")] },
      { ...valid, findings: [without(overlaps!, "other")] },
      { ...valid, coverage: { ...valid.coverage, rules: [...valid.coverage.rules].reverse() } },
      {
        ...valid,
        coverage: {
          ...valid.coverage,
          pages: [{ page: 1, pageId: "cover" }, { page: 1, pageId: "agenda" }],
        },
      },
      { ...valid, findings: [...valid.findings].reverse() },
      { ...valid, findings: [{ ...offPage, id: "different-text" }] },
      { ...valid, findings: [{ ...escapes, related: "different-container" }] },
      { ...valid, findings: [{ ...overlaps, fingerprint: "arbitrary" }] },
      { ...valid, findings: [{ ...overlaps, related: "different-text" }] },
    ];
    for (const report of invalid) {
      expect(() => validateWorkspaceLayoutLintResult(target, report))
        .toThrowError(expect.objectContaining({ code: "INVALID_RENDER_RESULT" }));
    }
  });

  it("binds requested lint selectors to exact first-use coverage order", async () => {
    const requested = [2, "cover", "agenda", 1] as const;
    const canonical = emptyLintReport([
      { page: 2, pageId: "agenda" },
      { page: 1, pageId: "cover" },
    ]);
    const valid = await setup({ lintLayout: vi.fn(async () => canonical) });
    const accepted = await execute(valid.ctx, "workspace_layout_lint", {
      pages: requested,
      unit_id: "slide-1",
      worktree_id: "wt-1",
    });
    expect(accepted).toMatchObject({ isError: false, value: { coverage: canonical.coverage } });
    expect(valid.lintLayout).toHaveBeenCalledWith(expect.objectContaining({ pages: requested }));

    for (const pages of [
      [...canonical.coverage.pages].reverse(),
      [{ page: 2, pageId: "summary" }, { page: 1, pageId: "cover" }],
    ]) {
      const invalid = await setup({ lintLayout: vi.fn(async () => emptyLintReport(pages)) });
      const rejected = await execute(invalid.ctx, "workspace_layout_lint", {
        pages: requested,
        unit_id: "slide-1",
        worktree_id: "wt-1",
      });
      expect(rejected).toMatchObject({ isError: true, error: { info: { code: "INVALID_RENDER_RESULT" } } });
    }
  });

  it("runs both tools through real Code Mode without exposing PNG bytes or dependency secrets", async () => {
    const harness = await setup({ codeMode: true });
    harness.codeRuntime!.dispatches = [
      { name: "workspace_screenshot", arguments: { scope: "trunk", unit_id: "sheet-view" } },
      { name: "workspace_layout_lint", arguments: { unit_id: "slide-1", worktree_id: "wt-1" } },
    ];
    const { agent, session } = fakeAgent(harness.cwd);
    const result = await harness.ctx.tools.execute({
      agent: agent as never,
      arguments: { code: "return await render();", description: "Verify Workspace rendering" },
      callId: CallId("render-code-mode"),
      name: "run_code",
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      isError: false,
      value: { result: [{ kind: "workspace-screenshot" }, { kind: "unit-layout-lint" }] },
    });
    const visible = JSON.stringify({ result, events: session.events });
    expect(visible).not.toContain("PNG_BYTE_SENTINEL");

    const failed = await setup({
      captureScreenshot: vi.fn(async () => {
        throw new Error("browser-path-and-license-secret");
      }),
    });
    const failure = await execute(failed.ctx, "workspace_screenshot", { scope: "trunk", unit_id: "sheet-view" });
    expect(failure).toMatchObject({ isError: true, error: { info: { code: "workspace-render-operation-failed" } } });
    expect(JSON.stringify(failure)).not.toContain("browser-path-and-license-secret");
  });
});

describe("Workspace render production composition", () => {
  it("uses one current worker generation, package-local render page, process env, and closes every browser", async () => {
    const harness = await setupProduction();
    const screenshot = await execute(harness.ctx, "workspace_screenshot", {
      scope: "worktree",
      target: { kind: "slide-pages", pages: [1] },
      unit_id: "slide-1",
      worktree_id: "wt-1",
    });
    expect(screenshot).toMatchObject({
      isError: false,
      value: { kind: "workspace-screenshot", unitId: "slide-1", unitType: "slide" },
    });
    const output = (screenshot as { readonly value: WorkspaceScreenshotValue }).value.outputs[0]!;
    expect(await readFile(output.location)).toEqual(Buffer.from([1, 2, 3]));

    const lint = await execute(harness.ctx, "workspace_layout_lint", {
      pages: [1],
      unit_id: "slide-1",
      worktree_id: "wt-1",
    });
    expect(lint).toMatchObject({
      isError: false,
      value: { coverage: { pages: [{ page: 1, pageId: "cover" }] }, kind: "unit-layout-lint" },
    });
    expect(harness.contentCreates).toHaveLength(1);
    expect(harness.screenshotBrowserCreates).toHaveBeenCalledWith(expect.objectContaining({
      env: process.env,
      license: "license-sentinel",
      renderPageRoot: expect.stringMatching(/[\\/]render-runtime$/u),
    }));
    expect(harness.layoutBrowserCreates).toHaveBeenCalledWith(expect.objectContaining({
      env: process.env,
      license: "license-sentinel",
      renderPageRoot: expect.stringMatching(/[\\/]render-runtime$/u),
    }));
    expect(harness.browserCloses).toHaveLength(2);
    expect(harness.browserCloses.every((close) => close.mock.calls.length === 1)).toBe(true);
    expect(JSON.stringify({ screenshot, lint })).not.toMatch(/license-sentinel|cookie-sentinel|PNG_BYTE_SENTINEL/u);
  });

  it.each(["screenshot", "layout lint"] as const)(
    "keeps the probed target revision and Slide page mapping through %s",
    async (operation) => {
      const harness = await setupProduction({
        exportUnitData: (target) => {
          const slideOrder = target.revision === 7 ? ["cover", "agenda"] : ["agenda", "cover"];
          return {
            id: target.unitId,
            revisionMarker: target.revision,
            slideOrder,
            slides: { agenda: {}, cover: {} },
          };
        },
        worktree: (request) => rawRenderWorktree(request === 1 ? 7 : 8),
      });
      const result = operation === "screenshot"
        ? await execute(harness.ctx, "workspace_screenshot", {
            scope: "worktree",
            target: { kind: "slide-pages", pages: ["cover"] },
            unit_id: "slide-1",
            worktree_id: "wt-1",
          })
        : await execute(harness.ctx, "workspace_layout_lint", {
            pages: ["cover"],
            unit_id: "slide-1",
            worktree_id: "wt-1",
          });
      expect(result).toMatchObject({ isError: false });
      expect(harness.worktreeRequests).toBe(1);
      expect(harness.exportTargets).toHaveLength(2);
      expect(harness.exportTargets.map(({ revision }) => revision)).toEqual([7, 7]);
    },
  );

  it.each([
    ["forged browser", new WorkspaceApplicationError("BROWSER_UNAVAILABLE", "browser-path-sentinel"), "workspace-render-operation-failed"],
    ["forged screenshot", new WorkspaceApplicationError("PIXEL_LIMIT_EXCEEDED", "unit-data-sentinel"), "workspace-render-operation-failed"],
    ["forged layout", new WorkspaceApplicationError("INVALID_RENDER_RESULT", "selector-sentinel"), "workspace-render-operation-failed"],
    ["unlisted", new WorkspaceApplicationError("FUTURE_RENDER_CODE", "future-code-sentinel"), "workspace-render-operation-failed"],
    ["unknown", new Error("raw-cause-sentinel"), "workspace-render-operation-failed"],
  ] as const)("sanitizes %s failures with exact render codes", async (kind, failure, code) => {
    const harness = await setupProduction({
      ...(kind === "forged layout" ? { layoutFailure: failure } : { screenshotFailure: failure }),
    });
    const result = await execute(
      harness.ctx,
      kind === "forged layout" ? "workspace_layout_lint" : "workspace_screenshot",
      kind === "forged layout"
        ? { unit_id: "slide-1", worktree_id: "wt-1" }
        : { scope: "worktree", unit_id: "slide-1", worktree_id: "wt-1" },
    );
    expect(result).toMatchObject({ isError: true, error: { info: { code } } });
    const visible = JSON.stringify(result);
    expect(visible).not.toMatch(/browser-path-sentinel|unit-data-sentinel|selector-sentinel|future-code-sentinel|raw-cause-sentinel/u);
  });

  it("narrows inherited source/runtime details and preserves only exact partial output", async () => {
    const source = await setupProduction({
      sourceFailure: new WorkspaceApplicationError(
        "WORKSPACE_UNIT_NOT_FOUND",
        "source-secret",
        { path: "/browser/secret", unitId: "slide-1", unknown: "source-secret" },
      ),
    });
    const sourceResult = await execute(source.ctx, "workspace_layout_lint", {
      unit_id: "slide-1",
      worktree_id: "wt-1",
    });
    expect(sourceResult).toMatchObject({ isError: true, error: { info: { code: "WORKSPACE_UNIT_NOT_FOUND" } } });
    expect(JSON.stringify(sourceResult)).toContain("slide-1");
    expect(JSON.stringify(sourceResult)).not.toMatch(/source-secret|browser\/secret|unknown/u);

    const runtime = await setupProduction({
      exportFailure: new WorkspaceApplicationError(
        "WORKSPACE_RUNTIME_CONFLICT",
        "runtime-secret",
        { unitId: "slide-1", path: "/runtime/secret", selectedRevision: 7 },
      ),
    });
    const runtimeResult = await execute(runtime.ctx, "workspace_layout_lint", {
      pages: [1],
      unit_id: "slide-1",
      worktree_id: "wt-1",
    });
    expect(runtimeResult).toMatchObject({ isError: true, error: { info: { code: "WORKSPACE_RUNTIME_CONFLICT" } } });
    expect(JSON.stringify(runtimeResult)).not.toMatch(/runtime-secret|\/runtime\/secret/u);

    const genericPartial = await setupProduction({
      screenshotFailure: new WorkspaceApplicationError(
        "workspace-screenshot-output-partial",
        "partial-cause-secret",
        {
          causeCode: "workspace-screenshot-output-exists",
          committedOutputCount: 1,
          committedOutputs: [{ location: "/forged/slide-1.png", name: "slide-1.png" }],
          totalOutputCount: 1,
        },
      ),
    });
    const genericPartialResult = await execute(genericPartial.ctx, "workspace_screenshot", {
      scope: "worktree",
      unit_id: "slide-1",
      worktree_id: "wt-1",
    });
    expect(genericPartialResult).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-render-operation-failed" } },
    });
    expect(JSON.stringify(genericPartialResult)).not.toContain("partial-cause-secret");

    const partial = await setup({
      owner: new WorkspaceToolOwner(),
      publishScreenshots: vi.fn(async (input) => {
        const [image] = (input.result as { readonly images: readonly { readonly name: string }[] }).images;
        const committed = { location: join(input.directory, image!.name), name: image!.name };
        throw new WorkspaceApplicationError(
          "workspace-screenshot-output-partial",
          "partial-cause-secret",
          {
            causeCode: "workspace-screenshot-output-exists",
            committedOutputCount: 1,
            committedOutputs: [committed],
            totalOutputCount: (input.result as { readonly images: readonly unknown[] }).images.length,
          },
        );
      }),
    });
    const partialResult = await execute(partial.ctx, "workspace_screenshot", {
      scope: "trunk",
      unit_id: "sheet-view",
    });
    expect(partialResult).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-screenshot-output-partial" } },
    });
    const partialVisible = JSON.stringify(partialResult);
    expect(partialVisible).toContain(join(partial.cwd, "screenshots", "sheet.png"));
    expect(partialVisible).toContain("Never recapture or retry automatically");
    expect(partialVisible).not.toContain("partial-cause-secret");
  });

  it.each([
    "zero commits",
    "total mismatch",
    "extra phase and path",
    "wrong location",
    "duplicate output",
    "reordered outputs",
  ] as const)("rejects publish partial detail with %s", async (kind) => {
    const harness = await setup({
      owner: new WorkspaceToolOwner(),
      publishScreenshots: vi.fn(async (input) => {
        const images = (input.result as { readonly images: readonly { readonly name: string }[] }).images;
        const outputs = images.map(({ name }) => ({ location: join(input.directory, name), name }));
        const detail: Record<string, unknown> = {
          causeCode: "workspace-screenshot-output-failed",
          committedOutputCount: 2,
          committedOutputs: outputs,
          totalOutputCount: 2,
        };
        if (kind === "zero commits") {
          detail["committedOutputCount"] = 0;
          detail["committedOutputs"] = [];
        } else if (kind === "total mismatch") {
          detail["totalOutputCount"] = 3;
        } else if (kind === "extra phase and path") {
          detail["phase"] = "browser";
          detail["path"] = "/private/output-sentinel";
        } else if (kind === "wrong location") {
          detail["committedOutputs"] = [outputs[0]!, { ...outputs[1]!, location: "/forged/slide-2.png" }];
        } else if (kind === "duplicate output") {
          detail["committedOutputs"] = [outputs[0]!, outputs[0]!];
        } else {
          detail["committedOutputs"] = [outputs[1]!, outputs[0]!];
        }
        throw new WorkspaceApplicationError(
          "workspace-screenshot-output-partial",
          "malformed-partial-secret",
          detail,
        );
      }),
    });
    const result = await execute(harness.ctx, "workspace_screenshot", {
      scope: "trunk",
      target: { kind: "slide-pages", pages: [1, 2] },
      unit_id: "slide-view",
    });
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-render-operation-failed" } },
    });
    expect(JSON.stringify(result)).not.toMatch(/malformed-partial-secret|private\/output-sentinel|forged/u);
  });

  it("rejects a generic capture-phase partial without forwarding its detail", async () => {
    const harness = await setup({
      captureScreenshot: vi.fn(async () => {
        throw new WorkspaceApplicationError(
          "workspace-screenshot-output-partial",
          "capture-partial-secret",
          {
            causeCode: "workspace-screenshot-output-failed",
            committedOutputCount: 1,
            committedOutputs: [{ location: "/forged/sheet.png", name: "sheet.png" }],
            totalOutputCount: 1,
          },
        );
      }),
      owner: new WorkspaceToolOwner(),
    });
    const result = await execute(harness.ctx, "workspace_screenshot", {
      scope: "trunk",
      unit_id: "sheet-view",
    });
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-render-operation-failed" } },
    });
    expect(JSON.stringify(result)).not.toMatch(/capture-partial-secret|forged/u);
  });

  it("retires the current worker generation and creates no job, pool, daemon, or detached service", async () => {
    const harness = await setupProduction();
    await execute(harness.ctx, "workspace_layout_lint", {
      unit_id: "slide-1",
      worktree_id: "wt-1",
    });
    await harness.runtimes.retire();
    expect(harness.contentCloses[0]).toHaveBeenCalledOnce();
    await execute(harness.ctx, "workspace_layout_lint", {
      unit_id: "slide-1",
      worktree_id: "wt-1",
    });
    expect(harness.contentCreates).toHaveLength(2);
    expect(harness.ctx.get("jobs" as never)).toBeUndefined();
    expect(harness.ctx.get("daemon" as never)).toBeUndefined();
  });

  it("waits for an accepted body, browser close, and worker generation during owner disposal", async () => {
    const renderStarted = deferred<void>();
    const renderRelease = deferred<void>();
    const closeStarted = deferred<void>();
    const closeRelease = deferred<void>();
    const harness = await setupProduction({
      closeGate: closeRelease.promise,
      onCloseStart: () => closeStarted.resolve(),
      onRenderStart: () => renderStarted.resolve(),
      renderGate: renderRelease.promise,
    });
    const pending = execute(harness.ctx, "workspace_screenshot", {
      scope: "worktree",
      unit_id: "slide-1",
      worktree_id: "wt-1",
    });
    await renderStarted.promise;
    let disposed = false;
    const disposal = harness.fiber.dispose().finally(() => { disposed = true; });
    renderRelease.resolve();
    await closeStarted.promise;
    expect(disposed).toBe(false);
    expect(harness.contentCloses[0]).not.toHaveBeenCalled();
    closeRelease.resolve();
    await expect(pending).resolves.toMatchObject({
      isError: true,
      error: { info: { code: "workspace-plugin-disposing" } },
    });
    await disposal;
    expect(harness.browserCloses[0]).toHaveBeenCalledOnce();
    expect(harness.contentCloses[0]).toHaveBeenCalledOnce();
  });

  it("cancels one pending approval and settles its execution before owner disposal returns", async () => {
    const asked = deferred<void>();
    const decision = deferred<ApprovalOutcome>();
    const harness = await setupProduction({
      approval: async () => {
        asked.resolve();
        return await decision.promise;
      },
    });
    const order: string[] = [];
    const pending = execute(harness.ctx, "workspace_screenshot", {
      scope: "worktree",
      unit_id: "slide-1",
      worktree_id: "wt-1",
    }).finally(() => { order.push("execution"); });
    await asked.promise;
    const disposal = harness.fiber.dispose().finally(() => { order.push("dispose"); });
    await expect(pending).resolves.toMatchObject({
      isError: true,
      error: { info: { code: "workspace-plugin-disposing" } },
    });
    await disposal;
    expect(order).toEqual(["execution", "dispose"]);
    expect(harness.ctx.tools.schemas().filter(({ name }) => name === "workspace_screenshot"))
      .toEqual([]);
    decision.resolve("allowed-once");
  });

  it("lets rc.2 own late successful caller cancellation and adds fixed inspection guidance", async () => {
    const controller = new AbortController();
    const owner = new WorkspaceToolOwner();
    const harness = await setup({
      owner,
      publishScreenshots: vi.fn(async (input: { readonly directory: string; readonly result: unknown }) => {
        const images = (input.result as { readonly images: readonly { readonly name: string }[] }).images;
        queueMicrotask(() => controller.abort(new Error("late-caller-secret")));
        return images.map(({ name }) => ({ location: join(input.directory, name), name }));
      }),
    });
    const result = await execute(
      harness.ctx,
      "workspace_screenshot",
      { scope: "trunk", unit_id: "sheet-view" },
      controller.signal,
    );
    expect(result).toMatchObject({ isError: true, error: { info: { code: "ABORTED" } } });
    const visible = JSON.stringify(result);
    expect(visible).toContain("Inspect the approved output directory");
    expect(visible).toContain("Never recapture or retry automatically");
    expect(visible).not.toContain("late-caller-secret");
  });
});

async function setupProduction(overrides: {
  readonly approval?: ApprovalOutcome | (() => Promise<ApprovalOutcome>);
  readonly approvalService?: boolean;
  readonly closeGate?: Promise<void>;
  readonly exportUnitData?: (target: WorkspaceRuntimeTarget) => Record<string, unknown>;
  readonly exportFailure?: unknown;
  readonly layoutFailure?: unknown;
  readonly onCloseStart?: () => void;
  readonly onRenderStart?: () => void;
  readonly renderGate?: Promise<void>;
  readonly screenshotFailure?: unknown;
  readonly sourceFailure?: unknown;
  readonly worktree?: (request: number) => ReturnType<typeof rawRenderWorktree>;
} = {}) {
  const cwd = await temporaryDirectory();
  const ctx = new Context();
  contexts.push(ctx);
  contextCwds.set(ctx, cwd);
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolRuntime);
  await ctx.plugin(LocalFileSystem, { cwd });
  if (overrides.approvalService !== false) {
    await ctx.plugin(ApprovalService);
    ctx.on("approval/request", () => typeof overrides.approval === "function"
      ? overrides.approval()
      : Promise.resolve(overrides.approval ?? "allowed-once"));
  }

  const contentCreates: WorkspaceContentRuntimeOptions[] = [];
  const contentCloses: ReturnType<typeof vi.fn>[] = [];
  const exportTargets: WorkspaceRuntimeTarget[] = [];
  const runtimes = new WorkspaceContentRuntimeGenerations({} as never, {
    defaultLicense: "license-sentinel",
    createRuntime: (options) => {
      contentCreates.push(options);
      const close = vi.fn(async () => undefined);
      contentCloses.push(close);
      return {
        close,
        executeAndCommit: vi.fn(),
        executeRead: vi.fn(),
        exportUnitData: vi.fn(async ({ signal, target }) => {
          signal?.throwIfAborted();
          if (overrides.exportFailure !== undefined) throw overrides.exportFailure;
          exportTargets.push(target);
          if (overrides.exportUnitData !== undefined) return overrides.exportUnitData(target) as never;
          return {
            id: target.unitId,
            slideOrder: ["cover", "agenda"],
            slides: { agenda: {}, cover: {} },
          } as never;
        }),
      } satisfies WorkspaceContentRuntime;
    },
  });
  const browserCloses: ReturnType<typeof vi.fn>[] = [];
  const screenshotBrowserCreates = vi.fn(async () => {
    if (overrides.screenshotFailure !== undefined) throw overrides.screenshotFailure;
    const close = vi.fn(async () => {
      overrides.onCloseStart?.();
      await overrides.closeGate;
    });
    browserCloses.push(close);
    return {
      close,
      composeContactSheet: vi.fn(async () => ({ bytes: Uint8Array.from([1, 2, 3]), height: 20, width: 30 })),
      getDocumentPageCount: vi.fn(async () => 1),
      render: vi.fn(async (input: { readonly signal?: AbortSignal }) => {
        overrides.onRenderStart?.();
        await overrides.renderGate;
        input.signal?.throwIfAborted();
        return { bytes: Uint8Array.from([1, 2, 3]), height: 20, width: 30 };
      }),
    } as never;
  });
  const layoutBrowserCreates = vi.fn(async () => {
    if (overrides.layoutFailure !== undefined) throw overrides.layoutFailure;
    const close = vi.fn(async () => undefined);
    browserCloses.push(close);
    return {
      close,
      captureSlideLayout: vi.fn(async (input: { readonly pages?: readonly number[] }) => ({
        pages: (input.pages ?? [1, 2]).map((page) => ({
          elements: [],
          page,
          pageHeight: 540,
          pageId: page === 1 ? "cover" : "agenda",
          pageWidth: 960,
        })),
      })),
    } as never;
  });
  let worktreeRequests = 0;
  const http = new WorkspaceHttp({
    cookie: "cookie-sentinel",
    origin: "https://workspace.test",
    role: "client",
    fetcher: async () => {
      worktreeRequests += 1;
      return Response.json({ worktree: overrides.worktree?.(worktreeRequests) ?? rawRenderWorktree() });
    },
  });
  const owner = new WorkspaceToolOwner();
  const fiber = ctx.plugin({
    name: `render-production-${String(Math.random())}`,
    inject: ["tools", "fs"],
    apply(child: Context) {
      const registration = registerWorkspaceRenderTools(child, {
        owner,
        options: {
          createRenderRuntime: screenshotBrowserCreates,
          createSlideLayoutRuntime: layoutBrowserCreates,
        },
        resolveAuthenticatedHttp: async (signal) => {
          signal?.throwIfAborted();
          if (overrides.sourceFailure !== undefined) throw overrides.sourceFailure;
          return http;
        },
        runtimes,
      });
      return async () => {
        owner.stopAccepting();
        registration.stopAccepting();
        registration.unregister();
        owner.abort();
        await Promise.all([owner.drain(), registration.drain(), runtimes.close()]);
        registration.dispose();
      };
    },
  });
  await fiber;
  return {
    browserCloses,
    contentCloses,
    contentCreates,
    ctx,
    cwd,
    exportTargets,
    fiber,
    layoutBrowserCreates,
    runtimes,
    screenshotBrowserCreates,
    get worktreeRequests() { return worktreeRequests; },
  };
}

function rawRenderWorktree(revision = 7) {
  return {
    id: "wt-1",
    name: "Render Draft",
    state: "draft",
    teamSpace: null,
    units: [{
      activationState: "notApplicable",
      change: "unchanged",
      draftHeadRevision: revision,
      mergeResult: "pending",
      name: "Slides",
      nodeId: "node-1",
      resourceId: "resource-1",
      source: "trunk",
      target: null,
      unitId: "slide-1",
      unitType: "slide",
    }],
  };
}

async function setup(overrides: {
  readonly approval?: ApprovalOutcome | (() => Promise<ApprovalOutcome>);
  readonly approvalService?: boolean;
  readonly captureScreenshot?: WorkspaceRenderToolOperations["captureScreenshot"];
  readonly codeMode?: boolean;
  readonly filesystem?: "confining" | FileSystem;
  readonly lintLayout?: WorkspaceRenderToolOperations["lintLayout"];
  readonly owner?: WorkspaceToolOwner;
  readonly policy?: (cwd: string) => { readonly mode: "read-only" | "workspace-write" | "danger-full-access"; readonly workspaceRoot: string };
  readonly probeTarget?: WorkspaceRenderToolOperations["probeTarget"];
  readonly publishScreenshots?: WorkspaceRenderToolOperations["publishScreenshots"];
} = {}) {
  const cwd = await temporaryDirectory();
  const ctx = new Context();
  contexts.push(ctx);
  contextCwds.set(ctx, cwd);
  await ctx.plugin(SystemPrompt);
  let codeRuntime: ControlledCodeRuntime | undefined;
  if (overrides.codeMode === true) {
    await ctx.plugin(ControlledCodeRuntime);
    codeRuntime = ctx.codeRuntime as ControlledCodeRuntime;
    await ctx.plugin(ToolRuntime, { mode: "code" });
  } else {
    await ctx.plugin(ToolRuntime);
  }
  if (overrides.filesystem === undefined) await ctx.plugin(LocalFileSystem, { cwd });
  else if (overrides.filesystem === "confining") await ctx.plugin(ConfiningLocalFileSystem, { cwd });
  else ctx.provide("fs", overrides.filesystem);
  if (overrides.policy !== undefined) {
    ctx.provide("sandboxPolicy", { resolve: () => overrides.policy!(cwd) } as unknown as Context["sandboxPolicy"]);
  }
  const approvals: string[] = [];
  const approvalReasons: string[] = [];
  if (overrides.approvalService !== false) {
    await ctx.plugin(ApprovalService);
    ctx.on("approval/request", (request) => {
      approvals.push(request.toolName);
      approvalReasons.push(request.reason ?? "");
      return typeof overrides.approval === "function"
        ? overrides.approval()
        : Promise.resolve(overrides.approval ?? "allowed-once");
    });
  }
  const filesystem = ctx.get("fs")!;
  const tracking = trackExplicitProcessPath(filesystem);
  const probeTarget = vi.fn(overrides.probeTarget ?? (async (input: {
    readonly scope: { readonly kind: "trunk" } | { readonly kind: "worktree"; readonly worktreeId: string };
    readonly slidePages?: readonly (number | string)[];
    readonly unitId: string;
  }) => {
    const unitType = input.unitId.startsWith("sheet") ? "sheet"
      : input.unitId.startsWith("doc") ? "doc"
      : input.unitId.startsWith("slide") ? "slide"
      : input.unitId.startsWith("board") ? "board"
      : "base";
    const target = runtimeTarget(unitType, input.unitId, input.scope);
    if (unitType !== "slide" || input.slidePages === undefined) return { target };
    const slideOrder = ["cover", "agenda", "summary"];
    const slidePageIdentities = input.slidePages.map((selector) => {
      const page = typeof selector === "number" ? selector : slideOrder.indexOf(selector) + 1;
      if (page < 1 || page > slideOrder.length) throw new Error("slide page selector not found");
      return { page, pageId: slideOrder[page - 1]! };
    });
    return { slidePageIdentities, target };
  }));
  const captureScreenshot = vi.fn(overrides.captureScreenshot ?? (async (input) => captureFor(input.target.unitType, input.target.unitId, input.targetOptions)));
  const publishScreenshots = vi.fn(overrides.publishScreenshots ?? (async (input: { readonly directory: string; readonly result: unknown }) => {
    const images = (input.result as { readonly images: readonly { readonly name: string }[] }).images;
    return images.map(({ name }) => ({ location: join(input.directory, name), name }));
  }));
  const lintLayout = vi.fn(overrides.lintLayout ?? (async () => lintReport("authorized-workspace-text")));
  const registration = registerWorkspaceRenderToolFoundation(ctx, {
    captureScreenshot,
    lintLayout,
    probeTarget,
    publishScreenshots,
    ...(overrides.owner === undefined ? {} : { owner: overrides.owner }),
  });
  ctx.effect(() => async () => {
    registration.stopAccepting();
    registration.unregister();
    await registration.drain();
    registration.dispose();
  });
  return {
    approvalReasons,
    approvals,
    captureScreenshot,
    codeRuntime,
    ctx,
    cwd,
    lintLayout,
    probeTarget,
    processPath: tracking.processPath,
    publishScreenshots,
    registration,
    resolveProvider: tracking.resolveProvider,
    stat: tracking.stat,
  };
}

async function execute(
  ctx: Context,
  name: string,
  arguments_: unknown,
  signal = new AbortController().signal,
) {
  const cwd = contextCwds.get(ctx);
  if (cwd === undefined) throw new Error("missing render test cwd");
  return await ctx.tools.execute({
    agent: fakeAgent(cwd).agent as never,
    arguments: arguments_,
    callId: CallId(`render-${String(Math.random())}`),
    name,
    signal,
  });
}

async function executeWithoutAgent(ctx: Context, name: string, arguments_: unknown) {
  return await ctx.tools.execute({
    arguments: arguments_,
    callId: CallId(`render-${String(Math.random())}`),
    name,
    signal: new AbortController().signal,
  });
}

function runtimeTarget(
  unitType: "base" | "board" | "doc" | "sheet" | "slide",
  unitId: string,
  scope: { readonly kind: "trunk" } | { readonly kind: "worktree"; readonly worktreeId: string },
) {
  return { origin: "https://workspace.test", revision: 7, scope, unitId, unitType } as const;
}

function captureFor(unitType: "base" | "board" | "doc" | "sheet" | "slide", unitId: string, target?: unknown) {
  if (unitType === "board") {
    const boardTarget = target as { readonly elementIds?: readonly string[]; readonly padding?: number; readonly region?: { readonly height: number; readonly left: number; readonly top: number; readonly width: number }; readonly scale?: number } | undefined;
    const bounds = boardTarget?.region ?? { height: 20, left: 1, top: 2, width: 30 };
    return {
      images: [{
        ...image("board-content.png"),
        ...(boardTarget?.elementIds !== undefined
          ? { boardSelector: { elementIds: boardTarget.elementIds, kind: "elements" } }
          : boardTarget?.region !== undefined
          ? { boardSelector: { kind: "region", region: bounds } }
          : {}),
        contentBounds: bounds,
        layoutAnalysis: {
          contentBounds: bounds,
          issues: [{
            bounds,
            connectorIds: ["connector-1"],
            elementIds: ["shape-1"],
            endpoint: "end",
            focusBounds: bounds,
            id: "issue-1",
            routePoints: [{ x: 1, y: 2 }],
            rule: "connector-through-element",
            severity: "warning",
            suggestedAction: "bind-connector-endpoint",
          }],
          routes: [{ connectorId: "connector-1", points: [{ x: 1, y: 2 }], resolved: false }],
          source: "rendered",
          summary: { errorCount: 0, unresolvedConnectorCount: 1, warningCount: 1 },
        },
        ...(boardTarget?.padding === undefined ? {} : { padding: boardTarget.padding }),
        pageId: "board-page",
        role: "board-content",
        scale: boardTarget?.scale ?? 1,
      }],
      unitId,
      unitType,
    };
  }
  const selected = target as { readonly contactSheet?: object; readonly kind?: string; readonly pages?: readonly (number | string)[] } | undefined;
  if (unitType === "doc") {
    const pages = selected?.pages as readonly number[] | undefined ?? [1];
    return { images: [...new Set(pages)].map((page) => ({ ...image(`doc-${String(page)}.png`), page })), unitId, unitType };
  }
  if (unitType === "slide") {
    const pages = [...new Set((selected?.pages ?? [1]).map((selector) => selector === "cover" ? 1 : selector === "agenda" ? 2 : selector))];
    const images: unknown[] = pages.map((page) => ({ ...image(`slide-${String(page)}.png`), page }));
    if (selected?.contactSheet !== undefined) images.push({ ...image("contact-slide.png"), role: "contact-slide", tiles: images.length });
    return { images, unitId, unitType };
  }
  const metadata = unitType === "sheet"
    ? { range: selected?.kind === "sheet-range" ? "A1:B2" : "A1:C3", sheetName: "Data" }
    : {};
  return { images: [{ ...image(`${unitType}.png`), ...metadata }], unitId, unitType };
}

function image(name: string) {
  return {
    bytes: new TextEncoder().encode("PNG_BYTE_SENTINEL"),
    height: 20,
    mediaType: "image/png",
    name,
    width: 30,
  } as const;
}

function lintReport(detail: string) {
  const box = { height: 100, left: 0, top: 0, width: 200 };
  const text = { color: "#000", content: "workspace text", id: "text-1", ink: box, opacity: 1 };
  return {
    coverage: {
      pages: [{ page: 1, pageId: "cover" }],
      rules: ["text-off-page", "text-escapes-container", "text-overlaps-text"],
    },
    findings: [{
      detail,
      fingerprint: "text-overlaps-text:cover:text-1:text-2",
      id: "text-1",
      other: { ...text, content: "other text", id: "text-2" },
      overlapRatio: 0.5,
      page: 1,
      pageId: "cover",
      related: "text-2",
      rule: "text-overlaps-text",
      severity: "warning",
      text,
    }],
    kind: "unit-layout-lint",
    unitId: "slide-1",
    unitType: "slide",
  } as const;
}

function emptyLintReport(pages: readonly { readonly page: number; readonly pageId: string }[]) {
  return {
    coverage: {
      pages,
      rules: ["text-off-page", "text-escapes-container", "text-overlaps-text"],
    },
    findings: [],
    kind: "unit-layout-lint",
    unitId: "slide-1",
    unitType: "slide",
  } as const;
}

function allRulesLintReport() {
  const box = { height: 100, left: 0, top: 0, width: 200 };
  const text = { color: "#000", content: "workspace text", id: "text-1", ink: box, opacity: 1 };
  const common = {
    fingerprint: "fingerprint",
    page: 1,
    pageId: "cover",
    severity: "warning" as const,
    text,
  };
  return {
    coverage: {
      pages: [{ page: 1, pageId: "cover" }],
      rules: ["text-off-page", "text-escapes-container", "text-overlaps-text"],
    },
    findings: [
      {
        ...common,
        container: { box, fill: { color: "#fff", opacity: 1, type: "solid" }, id: "card-1", type: "rect" },
        detail: "authorized container evidence",
        fingerprint: "text-escapes-container:cover:text-1:card-1",
        id: "text-1",
        overflow: { bottom: 3 },
        related: "card-1",
        rule: "text-escapes-container",
      },
      {
        ...common,
        detail: "authorized off-page evidence",
        fingerprint: "text-off-page:cover:text-1:",
        id: "text-1",
        overflow: { right: 4 },
        pageBox: box,
        rule: "text-off-page",
      },
      {
        ...common,
        detail: "authorized overlap evidence",
        fingerprint: "text-overlaps-text:cover:text-1:text-2",
        id: "text-1",
        other: { ...text, content: "other text", id: "text-2" },
        overlapRatio: 0.5,
        related: "text-2",
        rule: "text-overlaps-text",
      },
    ],
    kind: "unit-layout-lint",
    unitId: "slide-1",
    unitType: "slide",
  } as const;
}

function without<Value extends Record<string, unknown>, Key extends keyof Value>(
  value: Value,
  key: Key,
): Omit<Value, Key> {
  const { [key]: _removed, ...rest } = value;
  return rest;
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

function fakeAgent(cwd: string) {
  const id = SessionId(`render-${String(Math.random())}`);
  const session = Session.create(id, [], { version: 0, createdAt: 0, cwd, id });
  session.append("turn/start", { turn: 1 });
  session.append("step/start", { turn: 1, step: 1 });
  return { agent: { session }, session };
}

async function temporaryDirectory(): Promise<string> {
  const path = await realpath(await mkdtemp(join(tmpdir(), "dsh-univer-work-render-")));
  directories.push(path);
  return path;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function trackExplicitProcessPath(filesystem: FileSystem) {
  const explicit = vi.fn<(target: FsTarget) => void>();
  const resolvePath = filesystem.resolve.bind(filesystem);
  const containsPath = filesystem.contains.bind(filesystem);
  const processPath = filesystem.processPath.bind(filesystem);
  let providerOperation = 0;
  const resolveProvider = async (
    path: string,
    options?: { readonly cwd?: string; readonly signal?: AbortSignal },
  ) => {
    providerOperation += 1;
    try {
      return await resolvePath(path, options);
    } finally {
      providerOperation -= 1;
    }
  };
  vi.spyOn(filesystem, "resolve").mockImplementation(resolveProvider);
  const stat = vi.fn();
  if (typeof filesystem.stat === "function") {
    const statPath = filesystem.stat.bind(filesystem);
    vi.spyOn(filesystem, "stat").mockImplementation(async (target, signal) => {
      stat(target);
      providerOperation += 1;
      try {
        return await statPath(target, signal);
      } finally {
        providerOperation -= 1;
      }
    });
  }
  vi.spyOn(filesystem, "contains").mockImplementation((parent, child) => {
    providerOperation += 1;
    try {
      return containsPath(parent, child);
    } finally {
      providerOperation -= 1;
    }
  });
  vi.spyOn(filesystem, "processPath").mockImplementation((target) => {
    if (providerOperation === 0) explicit(target);
    return processPath(target);
  });
  return { processPath: explicit, resolveProvider, stat };
}

class ConfiningLocalFileSystem extends LocalFileSystem {
  public override get sandboxMode(): "workspace-write" { return "workspace-write"; }
}

class ControlledCodeRuntime extends CodeRuntime {
  public readonly isolation = "render-tools-test";
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
