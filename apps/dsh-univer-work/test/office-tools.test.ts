import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import type { FileSystem } from "@deepseek-ai/dsh-fs";
import LocalFileSystem from "@deepseek-ai/dsh-fs-local";
import CodeRuntime, { type CodeJsonValue, type CodeRunRequest, type CodeRunResult } from "@deepseek-ai/dsh-code-runtime";
import { CallId, HarnessError } from "@deepseek-ai/dsh-llm";
import { Session, SessionId } from "@deepseek-ai/dsh-session";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime, {
  defineTool,
  TOOL_ABORTED,
  renderToolsSdk,
  type CodeDispatchEventData,
  type CodeDispatchStartEventData,
} from "@deepseek-ai/dsh-tools";
import ApprovalService, { type ApprovalOutcome } from "@deepseek-ai/dsh-user-approval";
import {
  ExchangeError,
  ExchangeErrorCode,
  prepareDownload,
  WorkspaceApplicationError,
  WorkspaceUnitExchangeFeature,
  workspaceError,
  type WorkspaceImportFileResult,
  type WorkspaceRuntimeTarget,
  type WorkspaceUnit,
  type WorkspaceUnitExchangeDependencies,
  type WorkspaceUnitType,
} from "@univerjs/univer-workspace-client-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_OFFICE_ARGUMENT_BYTES,
  registerWorkspaceOfficeTools,
  validateWorkspaceOfficeExportArgs,
  validateWorkspaceOfficeImportArgs,
} from "../src/office-tools.js";
import { WorkspaceToolOwner } from "../src/tool-owner.js";

const contexts: Context[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async (ctx) => await ctx.fiber.dispose()));
  await Promise.all(directories.splice(0).map(async (path) => await rm(path, { force: true, recursive: true })));
});

describe("Workspace Office tool policy", () => {
  it("publishes two root-closed Native and Code schemas", async () => {
    const cwd = await temporaryDirectory();
    const harness = await setup({ cwd, approval: "rejected" });
    const schemas = harness.ctx.tools.schemas().filter(({ name }) => name.startsWith("workspace_office_"));
    expect(schemas.map(({ name }) => name).sort()).toEqual([
      "workspace_office_export",
      "workspace_office_import",
    ]);
    expect(schemas.every(({ parameters }) => parameters.additionalProperties === false)).toBe(true);
    expect(schemas.every(({ name }) => harness.ctx.tools.get(name)!.output.schema.additionalProperties === false)).toBe(true);
    expect(renderToolsSdk(schemas.map((schema) => ({
      ...schema,
      output: harness.ctx.tools.get(schema.name)!.output.schema,
    })))).not.toMatch(/\b(?:origin|credential|cookie|bytes|revision|resource_id|replacement|action|command)\??:/iu);
  });

  it.each([
    ["workspace_office_import", { source_path: "input.csv", space_id: "space-1", worktree_id: "wt-1" }],
    ["workspace_office_import", { source_path: "input.pdf", space_id: "space-1", worktree_id: "wt-1" }],
    ["workspace_office_import", { source_path: "input.docx", space_id: "space-1", type: "sheet", worktree_id: "wt-1" }],
    ["workspace_office_import", { extra: true, source_path: "input.xlsx", space_id: "space-1", worktree_id: "wt-1" }],
    ["workspace_office_export", { output_path: "output.xls", unit_id: "unit-1", worktree_id: "wt-1" }],
    ["workspace_office_export", { output_path: "output.doc", unit_id: "unit-1", worktree_id: "wt-1" }],
    ["workspace_office_export", { output_path: "output.ppt", unit_id: "unit-1", worktree_id: "wt-1" }],
    ["workspace_office_export", { output_path: "output.csv", unit_id: "unit-1", worktree_id: "wt-1" }],
    ["workspace_office_export", { force: "yes", output_path: "output.xlsx", unit_id: "unit-1", worktree_id: "wt-1" }],
    ["workspace_office_export", { output_path: "output.xlsx", revision: 1, unit_id: "unit-1", worktree_id: "wt-1" }],
  ] as const)("rejects invalid %s arguments before approval, path conversion, or body", async (name, args) => {
    const cwd = await temporaryDirectory();
    await writeFile(join(cwd, "input.xlsx"), "office");
    const harness = await setup({ cwd, approval: "allowed-once" });
    const filesystem = harness.ctx.get("fs") as LocalFileSystem;
    const contains = vi.spyOn(filesystem, "contains");
    const processPath = vi.spyOn(filesystem, "processPath");
    const resolve = vi.spyOn(filesystem, "resolve");
    const stat = vi.spyOn(filesystem, "stat");
    const result = await execute(harness.ctx, name, args, fakeAgent(cwd));
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-argument-invalid" } },
    });
    expect(harness.approvals).toEqual([]);
    expect(resolve).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
    expect(contains).not.toHaveBeenCalled();
    expect(processPath).not.toHaveBeenCalled();
    expect(harness.importFile).not.toHaveBeenCalled();
    expect(harness.exportFile).not.toHaveBeenCalled();
  });

  it("rejects accessors, symbols, and oversized canonical arguments without observing them", () => {
    let getterCalls = 0;
    const accessor = Object.defineProperty({
      source_path: "input.xlsx",
      space_id: "space-1",
      worktree_id: "wt-1",
    }, "name", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "secret";
      },
    });
    expect(() => validateWorkspaceOfficeImportArgs(accessor)).toThrowError(expect.objectContaining({
      code: "workspace-argument-invalid",
    }));
    expect(getterCalls).toBe(0);

    const symbol = {
      output_path: "output.xlsx",
      unit_id: "unit-1",
      worktree_id: "wt-1",
      [Symbol("secret")]: true,
    };
    expect(() => validateWorkspaceOfficeExportArgs(symbol)).toThrowError(expect.objectContaining({
      code: "workspace-argument-invalid",
    }));
    expect(() => validateWorkspaceOfficeImportArgs({
      name: "x".repeat(MAX_OFFICE_ARGUMENT_BYTES),
      source_path: "input.xlsx",
      space_id: "space-1",
      worktree_id: "wt-1",
    })).toThrowError(expect.objectContaining({ code: "workspace-argument-invalid" }));
  });

  it("accepts exactly 512 KiB of canonical arguments and rejects the next byte", () => {
    const base = {
      name: "",
      source_path: "input.xlsx",
      space_id: "space-1",
      worktree_id: "wt-1",
    };
    const fixedBytes = Buffer.byteLength(JSON.stringify(base));
    const exact = { ...base, name: "x".repeat(MAX_OFFICE_ARGUMENT_BYTES - fixedBytes) };
    expect(Buffer.byteLength(JSON.stringify(exact))).toBe(MAX_OFFICE_ARGUMENT_BYTES);
    expect(validateWorkspaceOfficeImportArgs(exact)).toEqual(exact);
    expect(() => validateWorkspaceOfficeImportArgs({ ...exact, name: `${exact.name}x` }))
      .toThrowError(expect.objectContaining({ code: "workspace-argument-invalid" }));
  });

  it("asks for import before any filesystem work, then gates a regular contained source", async () => {
    const cwd = await temporaryDirectory();
    await writeFile(join(cwd, "input.xlsx"), "office");
    const asked = deferred<void>();
    const decision = deferred<ApprovalOutcome>();
    const harness = await setup({
      cwd,
      approval: async () => {
        asked.resolve();
        return await decision.promise;
      },
    });
    const filesystem = harness.ctx.get("fs") as LocalFileSystem;
    const resolve = vi.spyOn(filesystem, "resolve");
    const stat = vi.spyOn(filesystem, "stat");
    const processPath = vi.spyOn(filesystem, "processPath");
    const pending = execute(harness.ctx, "workspace_office_import", {
      source_path: "input.xlsx",
      space_id: "space-1",
      worktree_id: "wt-1",
    }, fakeAgent(cwd));
    await asked.promise;
    expect(resolve).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
    expect(processPath).not.toHaveBeenCalled();
    expect(harness.importFile).not.toHaveBeenCalled();
    decision.resolve("allowed-once");
    await expect(pending).resolves.toMatchObject({ isError: false });
    expect(harness.approvals).toEqual(["workspace_office_import"]);
    expect(resolve).toHaveBeenCalled();
    expect(stat).toHaveBeenCalled();
    expect(processPath).toHaveBeenCalledTimes(3);
    expect(harness.importFile).toHaveBeenCalledOnce();
  });

  it("rejects mismatched import outcomes before render and preserves explicit Base and name", async () => {
    const cwd = await temporaryDirectory();
    const sourcePath = join(cwd, "input.xlsx");
    await writeFile(sourcePath, "office");
    const harness = await setup({ cwd, approval: "allowed-once" });
    const result = (resolvedSourcePath: string, type: "base" | "sheet", name: string) => ({
      committed: true as const,
      name,
      nodeId: "node-1",
      resourceId: "resource-1",
      sourcePath: resolvedSourcePath,
      type,
      unitId: "unit-1",
      worktreeId: "wt-1",
    });

    harness.importFile.mockImplementationOnce(async ({ sourcePath: resolvedSourcePath }) =>
      result(resolvedSourcePath, "base", "Wrong default type"));
    const wrongDefault = await execute(harness.ctx, "workspace_office_import", {
      source_path: "input.xlsx",
      space_id: "space-1",
      worktree_id: "wt-1",
    }, fakeAgent(cwd));
    expect(wrongDefault).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-office-operation-failed" } },
    });
    expect(JSON.stringify(wrongDefault)).not.toContain("Wrong default type");

    harness.importFile.mockImplementationOnce(async ({ sourcePath: resolvedSourcePath }) =>
      result(resolvedSourcePath, "sheet", "Wrong explicit name"));
    const wrongName = await execute(harness.ctx, "workspace_office_import", {
      name: "Expected name",
      source_path: "input.xlsx",
      space_id: "space-1",
      worktree_id: "wt-1",
    }, fakeAgent(cwd));
    expect(wrongName).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-office-operation-failed" } },
    });
    expect(JSON.stringify(wrongName)).not.toContain("Wrong explicit name");

    harness.importFile.mockImplementationOnce(async ({ sourcePath: resolvedSourcePath }) =>
      result(resolvedSourcePath, "base", "Expected Base"));
    const explicitBase = await execute(harness.ctx, "workspace_office_import", {
      name: "Expected Base",
      source_path: "input.xlsx",
      space_id: "space-1",
      type: "base",
      worktree_id: "wt-1",
    }, fakeAgent(cwd));
    expect(explicitBase).toMatchObject({
      isError: false,
      content: [{ type: "text", text: "Imported base Unit Expected Base (unit-1) into Worktree wt-1." }],
    });
  });

  it("applies export policy and containment before asking, then rechecks before processPath", async () => {
    const cwd = await temporaryDirectory();
    const allowed = join(cwd, "allowed");
    await mkdir(allowed);
    const asked = deferred<void>();
    const decision = deferred<ApprovalOutcome>();
    const harness = await setup({
      cwd,
      filesystem: "confining",
      policy: () => ({ mode: "workspace-write", workspaceRoot: allowed }),
      approval: async () => {
        asked.resolve();
        return await decision.promise;
      },
    });
    const filesystem = harness.ctx.get("fs") as LocalFileSystem;
    const processPath = vi.spyOn(filesystem, "processPath");
    const pending = execute(harness.ctx, "workspace_office_export", {
      output_path: "allowed/output.xlsx",
      unit_id: "unit-1",
      worktree_id: "wt-1",
    }, fakeAgent(cwd));
    await asked.promise;
    const preflightPathCalls = processPath.mock.calls.length;
    expect(preflightPathCalls).toBeGreaterThan(0);
    expect(harness.exportFile).not.toHaveBeenCalled();
    decision.resolve("allowed-once");
    await expect(pending).resolves.toMatchObject({ isError: false });
    expect(harness.approvals).toEqual(["workspace_office_export"]);
    expect(processPath.mock.calls.length).toBeGreaterThan(preflightPathCalls);
    expect(harness.exportFile).toHaveBeenCalledOnce();

    const outside = await execute(harness.ctx, "workspace_office_export", {
      output_path: "outside.xlsx",
      unit_id: "unit-1",
      worktree_id: "wt-1",
    }, fakeAgent(cwd));
    expect(outside).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-file-path-outside-session" } },
    });
    expect(harness.approvals).toEqual(["workspace_office_export"]);
  });

  it("denies read-only export before argument/path/approval while allowing import to ask", async () => {
    const cwd = await temporaryDirectory();
    await writeFile(join(cwd, "input.xlsx"), "office");
    const harness = await setup({
      cwd,
      filesystem: "confining",
      policy: () => ({ mode: "read-only", workspaceRoot: cwd }),
      approval: "rejected",
    });
    const filesystem = harness.ctx.get("fs") as LocalFileSystem;
    const processPath = vi.spyOn(filesystem, "processPath");
    const denied = await execute(harness.ctx, "workspace_office_export", {
      output_path: "output.xlsx",
      unit_id: "unit-1",
      worktree_id: "wt-1",
    }, fakeAgent(cwd));
    expect(denied).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-file-policy-denied" } },
    });
    expect(harness.approvals).toEqual([]);
    expect(processPath).not.toHaveBeenCalled();

    const imported = await execute(harness.ctx, "workspace_office_import", {
      source_path: "input.xlsx",
      space_id: "space-1",
      worktree_id: "wt-1",
    }, fakeAgent(cwd));
    expect(imported).toMatchObject({ isError: true });
    expect(harness.approvals).toEqual(["workspace_office_import"]);
    expect(harness.importFile).not.toHaveBeenCalled();
  });

  it("denies read-only export before filesystem, approval, or Core despite invalid accessor arguments", async () => {
    const cwd = await temporaryDirectory();
    const arguments_ = Object.defineProperty({
      unit_id: "unit-1",
      worktree_id: "wt-1",
    }, "output_path", {
      enumerable: true,
      get() {
        return "output.xlsx";
      },
    });
    const harness = await setup({
      cwd,
      filesystem: "confining",
      policy: () => ({ mode: "read-only", workspaceRoot: cwd }),
      approval: "allowed-once",
    });
    const filesystem = harness.ctx.get("fs") as LocalFileSystem;
    const resolve = vi.spyOn(filesystem, "resolve");
    const stat = vi.spyOn(filesystem, "stat");
    const contains = vi.spyOn(filesystem, "contains");
    const processPath = vi.spyOn(filesystem, "processPath");
    const result = await execute(
      harness.ctx,
      "workspace_office_export",
      arguments_,
      fakeAgent(cwd),
    );
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-file-policy-denied" } },
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
    expect(contains).not.toHaveBeenCalled();
    expect(processPath).not.toHaveBeenCalled();
    expect(harness.approvals).toEqual([]);
    expect(harness.exportFile).not.toHaveBeenCalled();
  });

  it("rejects non-local providers and missing or outside Session paths at the correct approval boundary", async () => {
    const cwd = await temporaryDirectory();
    const outside = await temporaryDirectory();
    await writeFile(join(outside, "outside.xlsx"), "outside");
    const remote = {} as FileSystem;
    const nonLocal = await setup({ cwd, filesystem: remote, approval: "allowed-once" });
    const importResult = await execute(nonLocal.ctx, "workspace_office_import", {
      source_path: "input.xlsx",
      space_id: "space-1",
      worktree_id: "wt-1",
    }, fakeAgent(cwd));
    expect(importResult).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-local-filesystem-required" } },
    });
    expect(nonLocal.approvals).toEqual(["workspace_office_import"]);
    const exportResult = await execute(nonLocal.ctx, "workspace_office_export", {
      output_path: "output.xlsx",
      unit_id: "unit-1",
      worktree_id: "wt-1",
    }, fakeAgent(cwd));
    expect(exportResult).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-local-filesystem-required" } },
    });
    expect(nonLocal.approvals).toEqual(["workspace_office_import"]);

    const local = await setup({ cwd, approval: "allowed-once" });
    const localFilesystem = local.ctx.get("fs") as LocalFileSystem;
    const localProcessPath = vi.spyOn(localFilesystem, "processPath");
    const noCwd = await execute(local.ctx, "workspace_office_export", {
      output_path: "output.xlsx",
      unit_id: "unit-1",
      worktree_id: "wt-1",
    }, fakeAgentWithoutCwd());
    expect(noCwd).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-session-cwd-required" } },
    });
    expect(local.approvals).toEqual([]);
    const importNoCwd = await execute(local.ctx, "workspace_office_import", {
      source_path: "input.xlsx",
      space_id: "space-1",
      worktree_id: "wt-1",
    }, fakeAgentWithoutCwd());
    expect(importNoCwd).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-session-cwd-required" } },
    });
    expect(local.approvals).toEqual(["workspace_office_import"]);
    expect(localProcessPath).not.toHaveBeenCalled();
    expect(local.importFile).not.toHaveBeenCalled();
    const outsideExport = await execute(local.ctx, "workspace_office_export", {
      output_path: join(outside, "output.xlsx"),
      unit_id: "unit-1",
      worktree_id: "wt-1",
    }, fakeAgent(cwd));
    expect(outsideExport).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-file-path-outside-session" } },
    });
    expect(local.approvals).toEqual(["workspace_office_import"]);
    const outsideImport = await execute(local.ctx, "workspace_office_import", {
      source_path: join(outside, "outside.xlsx"),
      space_id: "space-1",
      worktree_id: "wt-1",
    }, fakeAgent(cwd));
    expect(outsideImport).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-file-path-outside-session" } },
    });
    expect(local.approvals).toEqual([
      "workspace_office_import",
      "workspace_office_import",
    ]);
    expect(local.importFile).not.toHaveBeenCalled();
    expect(local.exportFile).not.toHaveBeenCalled();

    await mkdir(join(cwd, "directory.xlsx"));
    const directorySource = await execute(local.ctx, "workspace_office_import", {
      source_path: "directory.xlsx",
      space_id: "space-1",
      worktree_id: "wt-1",
    }, fakeAgent(cwd));
    expect(directorySource).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-office-operation-failed" } },
    });
    const missingSource = await execute(local.ctx, "workspace_office_import", {
      source_path: "missing.xlsx",
      space_id: "space-1",
      worktree_id: "wt-1",
    }, fakeAgent(cwd));
    expect(missingSource).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-office-operation-failed" } },
    });
    expect(local.approvals).toEqual([
      "workspace_office_import",
      "workspace_office_import",
      "workspace_office_import",
      "workspace_office_import",
    ]);
  });

  it("keeps danger-full-access outputs inside the Session cwd", async () => {
    const cwd = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const harness = await setup({
      cwd,
      filesystem: "confining",
      policy: () => ({ mode: "danger-full-access", workspaceRoot: outside }),
      approval: "rejected",
    });
    const inside = await execute(harness.ctx, "workspace_office_export", {
      output_path: "inside.xlsx",
      unit_id: "unit-1",
      worktree_id: "wt-1",
    }, fakeAgent(cwd));
    expect(inside).toMatchObject({ isError: true });
    expect(harness.approvals).toEqual(["workspace_office_export"]);
    const escaped = await execute(harness.ctx, "workspace_office_export", {
      output_path: join(outside, "outside.xlsx"),
      unit_id: "unit-1",
      worktree_id: "wt-1",
    }, fakeAgent(cwd));
    expect(escaped).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-file-path-outside-session" } },
    });
    expect(harness.approvals).toEqual(["workspace_office_export"]);
  });

  it.each(["rejected", "cancelled", "unavailable", undefined] as const)(
    "keeps both Office bodies at zero when approval is %s",
    async (outcome) => {
      const cwd = await temporaryDirectory();
      await writeFile(join(cwd, "input.xlsx"), "office");
      for (const [name, args] of [
        ["workspace_office_import", { source_path: "input.xlsx", space_id: "space-1", worktree_id: "wt-1" }],
        ["workspace_office_export", { output_path: "output.xlsx", unit_id: "unit-1", worktree_id: "wt-1" }],
      ] as const) {
        let processPath: ReturnType<typeof vi.spyOn> | undefined;
        let callsAtDecision: number | undefined;
        const harness = await setup({
          cwd,
          ...(outcome === undefined
            ? {}
            : {
                approval: async () => {
                  callsAtDecision = processPath!.mock.calls.length;
                  return outcome;
                },
              }),
        });
        const filesystem = harness.ctx.get("fs") as LocalFileSystem;
        processPath = vi.spyOn(filesystem, "processPath");
        const result = await execute(harness.ctx, name, args, fakeAgent(cwd));
        expect(result).toMatchObject({ isError: true });
        if (callsAtDecision !== undefined) expect(processPath.mock.calls.length).toBe(callsAtDecision);
        expect(harness.importFile).not.toHaveBeenCalled();
        expect(harness.exportFile).not.toHaveBeenCalled();
        expect(harness.approvals).toEqual(outcome === undefined ? [] : [name]);
      }
    },
  );

  it("rejects policy, public-local-constructor, and symlink drift after one approval", async () => {
    const cwd = await temporaryDirectory();
    const outside = await temporaryDirectory();
    let mode: "read-only" | "workspace-write" = "workspace-write";
    const asked = deferred<void>();
    const decision = deferred<ApprovalOutcome>();
    const harness = await setup({
      cwd,
      filesystem: "confining",
      policy: () => ({ mode, workspaceRoot: cwd }),
      approval: async () => {
        asked.resolve();
        return await decision.promise;
      },
    });
    const filesystem = harness.ctx.get("fs") as LocalFileSystem;
    const processPath = vi.spyOn(filesystem, "processPath");
    const pending = execute(harness.ctx, "workspace_office_export", {
      output_path: "output.xlsx",
      unit_id: "unit-1",
      worktree_id: "wt-1",
    }, fakeAgent(cwd));
    await asked.promise;
    const preflightPathCalls = processPath.mock.calls.length;
    mode = "read-only";
    decision.resolve("allowed-once");
    await expect(pending).resolves.toMatchObject({
      isError: true,
      error: { info: { code: "workspace-file-policy-denied" } },
    });
    expect(processPath).toHaveBeenCalledTimes(preflightPathCalls);
    expect(harness.exportFile).not.toHaveBeenCalled();

    let workspaceRoot = cwd;
    const rootAsked = deferred<void>();
    const rootDecision = deferred<ApprovalOutcome>();
    const allowed = join(cwd, "allowed");
    await mkdir(allowed);
    const rootHarness = await setup({
      cwd,
      filesystem: "confining",
      policy: () => ({ mode: "workspace-write", workspaceRoot }),
      approval: async () => {
        rootAsked.resolve();
        return await rootDecision.promise;
      },
    });
    const rootPending = execute(rootHarness.ctx, "workspace_office_export", {
      output_path: "root-drift.xlsx",
      unit_id: "unit-1",
      worktree_id: "wt-1",
    }, fakeAgent(cwd));
    await rootAsked.promise;
    workspaceRoot = allowed;
    rootDecision.resolve("allowed-once");
    await expect(rootPending).resolves.toMatchObject({
      isError: true,
      error: { info: { code: "workspace-file-path-outside-session" } },
    });
    expect(rootHarness.approvals).toEqual(["workspace_office_export"]);
    expect(rootHarness.exportFile).not.toHaveBeenCalled();

    const symlinkAsked = deferred<void>();
    const symlinkDecision = deferred<ApprovalOutcome>();
    const symlinkHarness = await setup({
      cwd,
      approval: async () => {
        symlinkAsked.resolve();
        return await symlinkDecision.promise;
      },
    });
    const symlinkPending = execute(symlinkHarness.ctx, "workspace_office_export", {
      output_path: "drift.xlsx",
      unit_id: "unit-1",
      worktree_id: "wt-1",
    }, fakeAgent(cwd));
    await symlinkAsked.promise;
    await writeFile(join(outside, "outside.xlsx"), "outside");
    await symlink(join(outside, "outside.xlsx"), join(cwd, "drift.xlsx"));
    symlinkDecision.resolve("allowed-once");
    await expect(symlinkPending).resolves.toMatchObject({
      isError: true,
      error: { info: { code: "workspace-file-path-outside-session" } },
    });
    expect(symlinkHarness.exportFile).not.toHaveBeenCalled();

    const providerAsked = deferred<void>();
    const providerDecision = deferred<ApprovalOutcome>();
    const providerHarness = await setup({
      cwd,
      approval: async () => {
        providerAsked.resolve();
        return await providerDecision.promise;
      },
    });
    const providerFilesystem = providerHarness.ctx.get("fs")!;
    const prototype = Object.getPrototypeOf(providerFilesystem) as object;
    const providerPending = execute(providerHarness.ctx, "workspace_office_export", {
      output_path: "provider.xlsx",
      unit_id: "unit-1",
      worktree_id: "wt-1",
    }, fakeAgent(cwd));
    await providerAsked.promise;
    Object.setPrototypeOf(providerFilesystem, Object.prototype);
    providerDecision.resolve("allowed-once");
    const providerResult = await providerPending.finally(() => Object.setPrototypeOf(providerFilesystem, prototype));
    expect(providerResult).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-local-filesystem-required" } },
    });
    expect(providerHarness.approvals).toEqual(["workspace_office_export"]);
    expect(providerHarness.exportFile).not.toHaveBeenCalled();
  });

  it("keeps invalid export argument identity in real Code Mode", async () => {
    const cwd = await temporaryDirectory();
    const harness = await setup({ cwd, approval: "allowed-once", codeMode: true });
    harness.codeRuntime!.dispatches = [{
      name: "workspace_office_export",
      arguments: { output_path: "output.xls", unit_id: "unit-1", worktree_id: "wt-1" },
    }];
    const agent = fakeAgent(cwd) as { readonly session: Session };
    const result = await harness.ctx.tools.execute({
      arguments: { code: "return await office();", description: "Invalid Office export" },
      callId: CallId("office-code-invalid"),
      name: "run_code",
      signal: new AbortController().signal,
      agent: agent as never,
    });
    expect(result).toMatchObject({ isError: false });
    const starts = agent.session.events.flatMap((event) => event.type === "tool/code-dispatch-start"
      ? [event.data as CodeDispatchStartEventData]
      : []);
    const settled = agent.session.events.flatMap((event) => event.type === "tool/code-dispatch"
      ? [event.data as CodeDispatchEventData]
      : []);
    expect(starts).toHaveLength(1);
    expect(settled).toHaveLength(1);
    expect(settled[0]).toMatchObject({
      isError: true,
      name: "workspace_office_export",
      subCallId: starts[0]!.subCallId,
      content: [{ type: "text", text: "Error: Workspace Office export arguments are invalid." }],
    });
    expect(result.value).toMatchObject({
      result: [{ error: "Workspace Office export arguments are invalid." }],
    });
    expect(harness.approvals).toEqual([]);
    expect(harness.exportFile).not.toHaveBeenCalled();
  });
});

describe("Workspace Office tool outcomes", () => {
  it.each([
    ["xls", "sheet"],
    ["xlsx", "sheet"],
    ["doc", "doc"],
    ["docx", "doc"],
    ["ppt", "slide"],
    ["pptx", "slide"],
    ["pptm", "slide"],
    ["ppsx", "slide"],
    ["ppsm", "slide"],
    ["potx", "slide"],
    ["xls", "base"],
    ["xlsx", "base"],
  ] as const)("imports .%s as the exact %s outcome through the controlled buffer converter", async (suffix, type) => {
    const cwd = await temporaryDirectory();
    const bytes = Buffer.from(`office-${suffix}-${type}`);
    await writeFile(join(cwd, `input.${suffix}`), bytes);
    const importBuffer: NonNullable<WorkspaceUnitExchangeDependencies["importBuffer"]> = vi.fn(
      async (value, options) => {
        expect(value).toEqual(bytes);
        expect(options.fileName).toBe(`input.${suffix}`);
        return { id: "converted", name: `Imported ${type}` };
      },
    );
    const createUnit: WorkspaceUnitExchangeDependencies["createUnit"] = vi.fn(async (input) => {
      expect(input).toMatchObject({
        initialData: { id: "converted", name: `Imported ${type}` },
        name: `Imported ${type}`,
        spaceId: "space-1",
        type,
        worktreeId: "wt-1",
      });
      return createdUnit(input);
    });
    const office = createCoreOfficeFeature({ createUnit, importBuffer });
    const harness = await setup({ cwd, office, approval: "allowed-once" });
    const result = await execute(harness.ctx, "workspace_office_import", {
      source_path: `input.${suffix}`,
      space_id: "space-1",
      ...(type === "base" ? { type } : {}),
      worktree_id: "wt-1",
    }, fakeAgent(cwd));
    expect(result).toMatchObject({
      isError: false,
      value: {
        committed: true,
        name: `Imported ${type}`,
        type,
        unitId: "unit-1",
        worktreeId: "wt-1",
      },
    });
    expect(importBuffer).toHaveBeenCalledOnce();
    expect(createUnit).toHaveBeenCalledOnce();
  });

  it("stops a grown actual source before conversion or authoritative Unit create", async () => {
    const cwd = await temporaryDirectory();
    await writeFile(join(cwd, "input.xlsx"), "abc");
    const importBuffer = vi.fn();
    const createUnit = vi.fn();
    const office = createCoreOfficeFeature({
      createUnit,
      importBuffer,
      openSource: async function* () {
        yield Buffer.from("abcd");
      },
    });
    const harness = await setup({ cwd, office, approval: "allowed-once" });
    const result = await execute(harness.ctx, "workspace_office_import", {
      source_path: "input.xlsx",
      space_id: "space-1",
      worktree_id: "wt-1",
    }, fakeAgent(cwd));
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-blob-size-mismatch" } },
    });
    expect(parseFailureEnvelope(result.error!.message)).toEqual({
      code: "workspace-blob-size-mismatch",
      detail: { actualByteSize: 4, expectedByteSize: 3 },
    });
    expect(importBuffer).not.toHaveBeenCalled();
    expect(createUnit).not.toHaveBeenCalled();
  });

  it.each([
    ["sheet", "xlsx"],
    ["base", "xlsx"],
    ["doc", "docx"],
    ["slide", "pptx"],
  ] as const)("exports the exact revision of a %s Unit to .%s without content commit", async (type, suffix) => {
    const cwd = await temporaryDirectory();
    const outputPath = join(await realpath(cwd), `output.${suffix}`);
    const target = runtimeTarget(type, 17);
    const resolveRuntimeTarget = vi.fn(async () => target);
    const exportUnitData = vi.fn(async (input) => {
      expect(input.target).toEqual(target);
      return { id: "unit-1", revisionMarker: 17 } as never;
    });
    const executeAndCommit = vi.fn();
    const exportToBuffer: NonNullable<WorkspaceUnitExchangeDependencies["exportToBuffer"]> = vi.fn(
      async (data) => {
        expect(data).toEqual({ id: "unit-1", revisionMarker: 17 });
        return Buffer.from(`${type}-revision-17`);
      },
    );
    const office = createCoreOfficeFeature({
      exportToBuffer,
      resolveRuntimeTarget,
      runtime: { executeAndCommit, exportUnitData } as never,
    });
    const harness = await setup({ cwd, office, approval: "allowed-once" });
    const result = await execute(harness.ctx, "workspace_office_export", {
      output_path: `output.${suffix}`,
      unit_id: "unit-1",
      worktree_id: "wt-1",
    }, fakeAgent(cwd));
    expect(result).toMatchObject({
      isError: false,
      value: { outputPath, type, unitId: "unit-1", worktreeId: "wt-1" },
    });
    expect(await readFile(outputPath, "utf8")).toBe(`${type}-revision-17`);
    expect(resolveRuntimeTarget).toHaveBeenCalledOnce();
    expect(exportUnitData).toHaveBeenCalledOnce();
    expect(exportToBuffer).toHaveBeenCalledOnce();
    expect(executeAndCommit).not.toHaveBeenCalled();
  });

  it("rejects Board and wrong canonical export outcomes before render or publication", async () => {
    const cwd = await temporaryDirectory();
    const exportUnitData = vi.fn();
    const exportToBuffer = vi.fn();
    const boardOffice = createCoreOfficeFeature({
      exportToBuffer,
      resolveRuntimeTarget: async () => runtimeTarget("board", 4),
      runtime: { exportUnitData },
    });
    const boardHarness = await setup({ cwd, office: boardOffice, approval: "allowed-once" });
    const board = await execute(boardHarness.ctx, "workspace_office_export", {
      output_path: "board.xlsx",
      unit_id: "unit-1",
      worktree_id: "wt-1",
    }, fakeAgent(cwd));
    expect(board).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-unit-type-unsupported" } },
    });
    expect(parseFailureEnvelope(board.error!.message)).toEqual({
      code: "workspace-unit-type-unsupported",
      detail: { unitId: "unit-1" },
    });
    expect(exportUnitData).not.toHaveBeenCalled();
    expect(exportToBuffer).not.toHaveBeenCalled();

    const wrongTypeOffice = {
      importFile: vi.fn(),
      exportFile: vi.fn(async ({ outputPath, unitId, worktreeId }) => ({
        outputPath,
        type: "doc" as const,
        unitId,
        worktreeId,
      })),
    };
    const wrongHarness = await setup({ cwd, office: wrongTypeOffice, approval: "allowed-once" });
    const wrong = await execute(wrongHarness.ctx, "workspace_office_export", {
      output_path: "wrong.xlsx",
      unit_id: "unit-1",
      worktree_id: "wt-1",
    }, fakeAgent(cwd));
    expect(wrong).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-office-operation-failed" } },
    });
    expect(JSON.stringify(wrong)).not.toContain("wrong.xlsx");
  });

  it("preserves no-clobber, explicit force, and once-selected revision mismatch outcomes", async () => {
    const cwd = await temporaryDirectory();
    const outputPath = join(await realpath(cwd), "output.xlsx");
    await writeFile(outputPath, "prior");
    const exportToBuffer = vi.fn(async () => Buffer.from("replacement"));
    const resolveRuntimeTarget = vi.fn(async () => runtimeTarget("sheet", 23));
    const exportUnitData = vi.fn(async () => ({ id: "unit-1" }) as never);
    const office = createCoreOfficeFeature({
      exportToBuffer,
      resolveRuntimeTarget,
      runtime: { exportUnitData },
    });
    const harness = await setup({ cwd, office, approval: "allowed-once" });
    const input = {
      output_path: "output.xlsx",
      unit_id: "unit-1",
      worktree_id: "wt-1",
    } as const;
    const noClobber = await execute(harness.ctx, "workspace_office_export", input, fakeAgent(cwd));
    expect(noClobber).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-office-output-exists" } },
    });
    expect(await readFile(outputPath, "utf8")).toBe("prior");
    const forced = await execute(harness.ctx, "workspace_office_export", {
      ...input,
      force: true,
    }, fakeAgent(cwd));
    expect(forced).toMatchObject({ isError: false, value: { outputPath } });
    expect(await readFile(outputPath, "utf8")).toBe("replacement");

    const mismatchedBuffer = vi.fn();
    const mismatchCommit = vi.fn();
    const mismatchTarget = vi.fn(async () => runtimeTarget("sheet", 24));
    const mismatchOffice = createCoreOfficeFeature({
      exportToBuffer: mismatchedBuffer,
      resolveRuntimeTarget: mismatchTarget,
      runtime: {
        executeAndCommit: mismatchCommit,
        exportUnitData: vi.fn(async () => {
          throw workspaceError("workspace-result-mismatch", "Runtime head advanced.");
        }),
      } as never,
    });
    const mismatchHarness = await setup({ cwd, office: mismatchOffice, approval: "allowed-once" });
    const mismatch = await execute(mismatchHarness.ctx, "workspace_office_export", {
      output_path: "mismatch.xlsx",
      unit_id: "unit-1",
      worktree_id: "wt-1",
    }, fakeAgent(cwd));
    expect(mismatch).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-result-mismatch" } },
    });
    expect(mismatchTarget).toHaveBeenCalledOnce();
    expect(mismatchedBuffer).not.toHaveBeenCalled();
    expect(mismatchCommit).not.toHaveBeenCalled();
  });
});

describe("Workspace Office error, cancellation, and lifecycle", () => {
  it("stops an already-aborted call before approval, path work, or Office body dispatch", async () => {
    const cwd = await temporaryDirectory();
    await writeFile(join(cwd, "input.xlsx"), "office");
    const harness = await setup({ cwd, approval: "allowed-once" });
    const filesystem = harness.ctx.get("fs") as LocalFileSystem;
    const resolve = vi.spyOn(filesystem, "resolve");
    const stat = vi.spyOn(filesystem, "stat");
    const processPath = vi.spyOn(filesystem, "processPath");
    const controller = new AbortController();
    controller.abort(new Error("pre-dispatch-secret"));
    const result = await execute(harness.ctx, "workspace_office_import", {
      source_path: "input.xlsx",
      space_id: "space-1",
      worktree_id: "wt-1",
    }, fakeAgent(cwd), controller.signal);
    expect(result).toMatchObject({ isError: true, error: { info: { code: "ABORTED_BEFORE_DISPATCH" } } });
    expect(harness.approvals).toEqual([]);
    expect(resolve).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
    expect(processPath).not.toHaveBeenCalled();
    expect(harness.importFile).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("pre-dispatch-secret");
  });

  it.each(Object.values(ExchangeErrorCode).flatMap((code) => [
    ["import", code],
    ["export", code],
  ] as const))("projects a real %s %s converter failure without dependency material", async (phase, code) => {
    const cwd = await temporaryDirectory();
    await writeFile(join(cwd, "input.xlsx"), "office");
    const secret = `native-secret-${phase}-${code}`;
    const failure = new ExchangeError(code, secret, { cause: new Error(`${secret}-cause`) });
    const office = {
      importFile: vi.fn(async () => { throw failure; }),
      exportFile: vi.fn(async () => { throw failure; }),
    };
    const harness = await setup({ cwd, office, approval: "allowed-once" });
    const result = phase === "import"
      ? await execute(harness.ctx, "workspace_office_import", {
          source_path: "input.xlsx",
          space_id: "space-1",
          worktree_id: "wt-1",
        }, fakeAgent(cwd))
      : await execute(harness.ctx, "workspace_office_export", {
          output_path: "output.xlsx",
          unit_id: "unit-1",
          worktree_id: "wt-1",
        }, fakeAgent(cwd));
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-office-conversion-failed" } },
    });
    expect(parseFailureEnvelope(result.error!.message)).toEqual({
      code: "workspace-office-conversion-failed",
      detail: { exchangeCode: code, phase },
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it.each([
    { code: "PRIVATE_NATIVE_CODE", forged: false, message: "unlisted-exchange-secret" },
    { code: ExchangeErrorCode.CONVERSION_FAILED, message: "forged-exchange-secret", forged: true },
  ] as const)("downgrades an untrusted converter error $code", async ({ code, forged, message }) => {
    const cwd = await temporaryDirectory();
    await writeFile(join(cwd, "input.xlsx"), "office");
    const failure = forged === true
      ? Object.assign(new Error(message), { code, name: "ExchangeError" })
      : new ExchangeError(code as ExchangeErrorCode, message, { cause: new Error(`${message}-cause`) });
    const harness = await setup({
      cwd,
      approval: "allowed-once",
      office: {
        exportFile: vi.fn(),
        importFile: vi.fn(async () => { throw failure; }),
      },
    });
    const result = await execute(harness.ctx, "workspace_office_import", {
      source_path: "input.xlsx",
      space_id: "space-1",
      worktree_id: "wt-1",
    }, fakeAgent(cwd));
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-office-operation-failed" } },
    });
    expect(JSON.stringify(result)).not.toContain(message);
  });

  it.each([
    ["import", "workspace-blob-source-invalid"],
    ["import", "workspace-blob-source-unavailable"],
    ["export", "workspace-license-required"],
  ] as const)("preserves the genuine shared %s %s code without private detail", async (phase, code) => {
    const cwd = await temporaryDirectory();
    await writeFile(join(cwd, "input.xlsx"), "office");
    const secret = `shared-${phase}-${code}-credential-cookie-license-unit-data-temp-path`;
    const failure = new WorkspaceApplicationError(
      code,
      secret,
      { cause: secret, credential: secret, path: `/private/${secret}` },
      { cause: new Error(secret) },
    );
    const office = phase === "import"
      ? createCoreOfficeFeature({ inspectSource: async () => { throw failure; } })
      : createCoreOfficeFeature({ runtime: { exportUnitData: async () => { throw failure; } } });
    const harness = await setup({ cwd, approval: "allowed-once", office });
    const result = phase === "import"
      ? await execute(harness.ctx, "workspace_office_import", {
          source_path: "input.xlsx",
          space_id: "space-1",
          worktree_id: "wt-1",
        }, fakeAgent(cwd))
      : await execute(harness.ctx, "workspace_office_export", {
          output_path: "output.xlsx",
          unit_id: "unit-1",
          worktree_id: "wt-1",
        }, fakeAgent(cwd));
    expect(result).toMatchObject({ isError: true, error: { info: { code } } });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("keeps a real Code Mode conversion failure paired and secret-free", async () => {
    const cwd = await temporaryDirectory();
    await writeFile(join(cwd, "input.xlsx"), "office");
    const secret = "code-native-cause-cookie-license-unit-data-office-bytes-temp-path";
    const harness = await setup({
      cwd,
      approval: "allowed-once",
      codeMode: true,
      office: {
        exportFile: vi.fn(),
        importFile: vi.fn(async () => {
          throw new ExchangeError(ExchangeErrorCode.NATIVE_LOAD_FAILED, secret, {
            cause: new Error(`${secret}-cause`),
          });
        }),
      },
    });
    harness.codeRuntime!.dispatches = [{
      name: "workspace_office_import",
      arguments: { source_path: "input.xlsx", space_id: "space-1", worktree_id: "wt-1" },
    }];
    const agent = fakeAgent(cwd) as { readonly session: Session };
    const result = await harness.ctx.tools.execute({
      arguments: { code: "return await officeImport();", description: "Office import failure" },
      callId: CallId("office-code-native-failure"),
      name: "run_code",
      signal: new AbortController().signal,
      agent: agent as never,
    });
    expect(result).toMatchObject({
      isError: false,
      value: { result: [{ error: expect.stringContaining("workspace-office-conversion-failed") }] },
    });
    const starts = agent.session.events.flatMap((event) => event.type === "tool/code-dispatch-start"
      ? [event.data as CodeDispatchStartEventData]
      : []);
    const settled = agent.session.events.flatMap((event) => event.type === "tool/code-dispatch"
      ? [event.data as CodeDispatchEventData]
      : []);
    expect(starts).toHaveLength(1);
    expect(settled).toHaveLength(1);
    expect(settled[0]).toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("workspace-office-conversion-failed") }],
      isError: true,
      name: "workspace_office_import",
      subCallId: starts[0]!.subCallId,
    });
    expect(JSON.stringify({ approvals: harness.approvals, events: agent.session.events, result })).not.toContain(secret);
  });

  it.each([
    ["caller", "workspace-result-unknown"],
    ["caller", "workspace-result-mismatch"],
    ["caller", "workspace-invalid-response"],
    ["owner", "workspace-result-unknown"],
    ["owner", "workspace-result-mismatch"],
    ["owner", "workspace-invalid-response"],
  ] as const)("preserves post-dispatch import %s after %s cancellation", async (source, code) => {
    const cwd = await temporaryDirectory();
    await writeFile(join(cwd, "input.xlsx"), "office");
    const controller = new AbortController();
    const secret = `create-${code}-secret`;
    const inspected = vi.fn(async (sourcePath: string) => ({
      byteSize: 6,
      originalFilename: "input.xlsx",
      path: sourcePath,
    }));
    const opened = vi.fn(async function* () { yield Buffer.from("office"); });
    const importBuffer = vi.fn(async () => ({ id: "converted", name: "Imported Sheet" }));
    const createStarted = deferred<void>();
    const createRelease = deferred<void>();
    let createSignal: AbortSignal | undefined;
    const createUnit = vi.fn(async (_input, signal?: AbortSignal) => {
      createSignal = signal;
      createStarted.resolve();
      await createRelease.promise;
      throw new WorkspaceApplicationError(
        code,
        secret,
        { credential: secret, request: { cookie: secret } },
        { cause: new Error(`${secret}-cause`) },
      );
    });
    const office = createCoreOfficeFeature({
      createUnit,
      importBuffer,
      inspectSource: inspected,
      openSource: opened,
    });
    const harness = await setup({
      cwd,
      approval: "allowed-once",
      office,
    });
    const pending = execute(harness.ctx, "workspace_office_import", {
      idempotency_key: "stable-import-key",
      source_path: "input.xlsx",
      space_id: "space-1",
      worktree_id: "wt-1",
    }, fakeAgent(cwd), controller.signal);
    await createStarted.promise;
    const disposal = source === "owner" ? harness.fiber.dispose() : undefined;
    if (source === "caller") controller.abort(new Error(`${secret}-abort`));
    await vi.waitFor(() => expect(createSignal?.aborted).toBe(true));
    createRelease.resolve();
    const result = await pending;
    await disposal;
    expect(result).toMatchObject({ isError: true, error: { info: { code } } });
    expect(createUnit.mock.calls[0]![0].idempotencyKey).toBe("stable-import-key");
    expect(parseFailureEnvelope(result.error!.message)).toEqual({
      code,
      detail: {
        idempotencyKey: "stable-import-key",
        spaceId: "space-1",
        worktreeId: "wt-1",
      },
    });
    expect(inspected).toHaveBeenCalledOnce();
    expect(opened).toHaveBeenCalledOnce();
    expect(importBuffer).toHaveBeenCalledOnce();
    expect(createUnit).toHaveBeenCalledOnce();
    const transcript = JSON.stringify(result);
    expect(transcript).toContain("workspace_unit_list");
    expect(transcript).toContain("Never replay");
    expect(transcript).not.toContain(secret);
  });

  it.each([
    ["caller", "source-read"],
    ["owner", "source-read"],
    ["caller", "target-runtime"],
    ["owner", "target-runtime"],
  ] as const)("classifies %s cancellation during %s and starts no later Office step", async (source, stage) => {
    const cwd = await temporaryDirectory();
    await writeFile(join(cwd, "input.xlsx"), "office");
    const stageStarted = deferred<void>();
    const stageRelease = deferred<void>();
    let observedSignal: AbortSignal | undefined;
    let sourceClosed = 0;
    const importBuffer = vi.fn();
    const createUnit = vi.fn();
    const exportUnitData = vi.fn();
    const exportToBuffer = vi.fn();
    const writeOutput = vi.fn();
    const office = createCoreOfficeFeature({
      createUnit,
      exportToBuffer,
      importBuffer,
      inspectSource: async (sourcePath) => ({
        byteSize: 6,
        originalFilename: "input.xlsx",
        path: sourcePath,
      }),
      openSource: async function* (_source, signal) {
        observedSignal = signal;
        stageStarted.resolve();
        try {
          await stageRelease.promise;
          signal?.throwIfAborted();
          yield Buffer.from("office");
        } finally {
          sourceClosed += 1;
        }
      },
      resolveRuntimeTarget: async (_input, signal) => {
        observedSignal = signal;
        stageStarted.resolve();
        await stageRelease.promise;
        return runtimeTarget("sheet", 1);
      },
      runtime: { exportUnitData },
      writeOutput,
    });
    const harness = await setup({ cwd, office, approval: "allowed-once" });
    const controller = new AbortController();
    const pending = stage === "source-read"
      ? execute(harness.ctx, "workspace_office_import", {
          source_path: "input.xlsx",
          space_id: "space-1",
          worktree_id: "wt-1",
        }, fakeAgent(cwd), controller.signal)
      : execute(harness.ctx, "workspace_office_export", {
          output_path: "output.xlsx",
          unit_id: "unit-1",
          worktree_id: "wt-1",
        }, fakeAgent(cwd), controller.signal);
    await stageStarted.promise;
    const disposal = source === "owner" ? harness.fiber.dispose() : undefined;
    if (source === "caller") controller.abort(new Error("stage-cancellation-secret"));
    await vi.waitFor(() => expect(observedSignal?.aborted).toBe(true));
    stageRelease.resolve();
    const result = await pending;
    await disposal;
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: source === "owner" ? "workspace-plugin-disposing" : "workspace-operation-cancelled" } },
    });
    expect(importBuffer).not.toHaveBeenCalled();
    expect(createUnit).not.toHaveBeenCalled();
    expect(exportUnitData).not.toHaveBeenCalled();
    expect(exportToBuffer).not.toHaveBeenCalled();
    expect(writeOutput).not.toHaveBeenCalled();
    expect(sourceClosed).toBe(stage === "source-read" ? 1 : 0);
    expect(JSON.stringify(result)).not.toContain("stage-cancellation-secret");
  });

  it.each([
    ["caller", "import"],
    ["owner", "import"],
    ["caller", "export"],
    ["owner", "export"],
  ] as const)("awaits actual %s native conversion and classifies %s cancellation before side effects", async (source, phase) => {
    const cwd = await temporaryDirectory();
    await writeFile(join(cwd, "input.xlsx"), "office");
    const nativeStarted = deferred<void>();
    const nativeRelease = deferred<void>();
    const createUnit = vi.fn(async (input) => createdUnit(input));
    const writeOutput = vi.fn();
    const office = createCoreOfficeFeature({
      createUnit,
      importBuffer: vi.fn(async () => {
        nativeStarted.resolve();
        await nativeRelease.promise;
        return { id: "converted", name: "Imported Sheet" };
      }),
      exportToBuffer: vi.fn(async () => {
        nativeStarted.resolve();
        await nativeRelease.promise;
        return Buffer.from("office-output");
      }),
      writeOutput,
    });
    const harness = await setup({ cwd, office, approval: "allowed-once" });
    const controller = new AbortController();
    const pending = phase === "import"
      ? execute(harness.ctx, "workspace_office_import", {
          source_path: "input.xlsx",
          space_id: "space-1",
          worktree_id: "wt-1",
        }, fakeAgent(cwd), controller.signal)
      : execute(harness.ctx, "workspace_office_export", {
          output_path: "output.xlsx",
          unit_id: "unit-1",
          worktree_id: "wt-1",
        }, fakeAgent(cwd), controller.signal);
    await nativeStarted.promise;
    let disposed = false;
    const disposal = source === "owner"
      ? harness.fiber.dispose().then(() => { disposed = true; })
      : undefined;
    if (source === "caller") controller.abort(new Error("native-cancellation-secret"));
    if (source === "owner") {
      await vi.waitFor(() => expect(
        harness.ctx.tools.schemas().filter(({ name }) => name.startsWith("workspace_office_")),
      ).toEqual([]));
    }
    if (source === "owner") expect(disposed).toBe(false);
    nativeRelease.resolve();
    const result = await pending;
    await disposal;
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: source === "owner" ? "workspace-plugin-disposing" : "workspace-operation-cancelled" } },
    });
    expect(createUnit).not.toHaveBeenCalled();
    expect(writeOutput).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("native-cancellation-secret");
  });

  it.each(["caller", "owner"] as const)(
    "awaits private output cleanup and preserves the prior destination after %s cancellation",
    async (source) => {
      const cwd = await temporaryDirectory();
      const outputPath = join(await realpath(cwd), "output.xlsx");
      await writeFile(outputPath, "prior");
      const writeStarted = deferred<void>();
      const writeRelease = deferred<void>();
      let writeSignal: AbortSignal | undefined;
      let cleanups = 0;
      const writeOutput: NonNullable<WorkspaceUnitExchangeDependencies["writeOutput"]> = vi.fn(async (input) => {
        writeSignal = input.signal;
        const target = await prepareDownload(input);
        writeStarted.resolve();
        await writeRelease.promise;
        try {
          return await target.writeAndCommit((async function* () {
            yield Buffer.from("replacement");
          })(), Buffer.byteLength("replacement"));
        } finally {
          await target.discard();
          cleanups += 1;
        }
      });
      const office = createCoreOfficeFeature({
        exportToBuffer: async () => Buffer.from("replacement"),
        writeOutput,
      });
      const harness = await setup({ cwd, office, approval: "allowed-once" });
      const controller = new AbortController();
      const pending = execute(harness.ctx, "workspace_office_export", {
        force: true,
        output_path: "output.xlsx",
        unit_id: "unit-1",
        worktree_id: "wt-1",
      }, fakeAgent(cwd), controller.signal);
      await writeStarted.promise;
      const privateFiles = await readdir(cwd);
      expect(privateFiles.some((name) => name.startsWith(".output.xlsx.") && name.endsWith(".tmp"))).toBe(true);
      const disposal = source === "owner" ? harness.fiber.dispose() : undefined;
      if (source === "caller") controller.abort(new Error("private-output-secret"));
      await vi.waitFor(() => expect(writeSignal?.aborted).toBe(true));
      writeRelease.resolve();
      const result = await pending;
      await disposal;
      expect(result).toMatchObject({
        isError: true,
        error: { info: { code: source === "owner" ? "workspace-plugin-disposing" : "workspace-operation-cancelled" } },
      });
      expect(writeOutput).toHaveBeenCalledOnce();
      expect(cleanups).toBe(1);
      expect(await readFile(outputPath, "utf8")).toBe("prior");
      expect((await readdir(cwd)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
      expect(JSON.stringify(result)).not.toContain("private-output-secret");
    },
  );

  it.each(["import", "export"] as const)(
    "keeps late caller cancellation after confirmed %s as canonical ABORTED with inspection guidance",
    async (phase) => {
      const cwd = await temporaryDirectory();
      await writeFile(join(cwd, "input.xlsx"), "office");
      const started = deferred<void>();
      const release = deferred<void>();
      const office = {
        importFile: vi.fn(async ({ sourcePath, worktreeId }) => {
          started.resolve();
          await release.promise;
          return canonicalImportResult(sourcePath, worktreeId);
        }),
        exportFile: vi.fn(async ({ outputPath, unitId, worktreeId }) => {
          started.resolve();
          await release.promise;
          return { outputPath, type: "sheet" as const, unitId, worktreeId };
        }),
      };
      const harness = await setup({ cwd, office, approval: "allowed-once" });
      const controller = new AbortController();
      const pending = phase === "import"
        ? execute(harness.ctx, "workspace_office_import", {
            source_path: "input.xlsx",
            space_id: "space-1",
            worktree_id: "wt-1",
          }, fakeAgent(cwd), controller.signal)
        : execute(harness.ctx, "workspace_office_export", {
            output_path: "output.xlsx",
            unit_id: "unit-1",
            worktree_id: "wt-1",
          }, fakeAgent(cwd), controller.signal);
      await started.promise;
      controller.abort(new Error("late-confirmed-secret"));
      release.resolve();
      const result = await pending;
      expect(result).toMatchObject({ isError: true, error: { info: { code: TOOL_ABORTED } } });
      expect(JSON.stringify(result)).toContain(phase === "import" ? "workspace_unit_list" : "destination");
      expect(JSON.stringify(result)).not.toContain("late-confirmed-secret");
    },
  );

  it("drains concurrent accepted Office bodies independently and unregisters tools and policy", async () => {
    const cwd = await temporaryDirectory();
    await writeFile(join(cwd, "input.xlsx"), "office");
    const importStarted = deferred<void>();
    const exportStarted = deferred<void>();
    const importRelease = deferred<void>();
    const exportRelease = deferred<void>();
    const harness = await setup({
      cwd,
      approval: "allowed-once",
      office: {
        importFile: vi.fn(async ({ sourcePath, worktreeId }) => {
          importStarted.resolve();
          await importRelease.promise;
          return canonicalImportResult(sourcePath, worktreeId);
        }),
        exportFile: vi.fn(async ({ outputPath, unitId, worktreeId }) => {
          exportStarted.resolve();
          await exportRelease.promise;
          return { outputPath, type: "sheet" as const, unitId, worktreeId };
        }),
      },
    });
    const imported = execute(harness.ctx, "workspace_office_import", {
      source_path: "input.xlsx",
      space_id: "space-1",
      worktree_id: "wt-1",
    }, fakeAgent(cwd));
    const exported = execute(harness.ctx, "workspace_office_export", {
      output_path: "output.xlsx",
      unit_id: "unit-1",
      worktree_id: "wt-1",
    }, fakeAgent(cwd));
    await Promise.all([importStarted.promise, exportStarted.promise]);
    let disposed = false;
    const disposal = harness.fiber.dispose().then(() => { disposed = true; });
    await vi.waitFor(() => expect(
      harness.ctx.tools.schemas().filter(({ name }) => name.startsWith("workspace_office_")),
    ).toEqual([]));
    importRelease.resolve();
    const importResult = await imported;
    await Promise.resolve();
    expect(disposed).toBe(false);
    exportRelease.resolve();
    const exportResult = await exported;
    await disposal;
    expect(disposed).toBe(true);
    expect(importResult).toMatchObject({ isError: false });
    expect(exportResult).toMatchObject({ isError: false });

    const approvalsBeforeProbe = harness.approvals.length;
    const unregister = harness.ctx.tools.register(defineTool({
      name: "workspace_office_import",
      description: "Office listener disposal probe.",
      parameters: {},
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { ok: { type: "boolean", const: true, required: true } },
        },
        render: () => [{ type: "text", text: "ok" }],
      },
      execute: async () => ({ ok: true as const }),
    }));
    await expect(execute(harness.ctx, "workspace_office_import", {}, fakeAgent(cwd)))
      .resolves.toMatchObject({ isError: false, value: { ok: true } });
    expect(harness.approvals).toHaveLength(approvalsBeforeProbe);
    unregister();

    const remountOwner = new WorkspaceToolOwner();
    const remount = registerWorkspaceOfficeTools(harness.ctx, {
      office: { exportFile: harness.exportFile, importFile: harness.importFile },
      owner: remountOwner,
    });
    expect(harness.ctx.tools.schemas().filter(({ name }) => name.startsWith("workspace_office_")))
      .toHaveLength(2);
    await expect(execute(harness.ctx, "workspace_office_import", {
      source_path: "input.xlsx",
      space_id: "space-1",
      worktree_id: "wt-1",
    }, fakeAgent(cwd))).resolves.toMatchObject({ isError: false });
    expect(harness.approvals).toHaveLength(approvalsBeforeProbe + 1);
    remountOwner.stopAccepting();
    for (const dispose of [...remount].reverse()) dispose();
    remountOwner.abort();
    await remountOwner.drain();
  });
});

class ConfiningLocalFileSystem extends LocalFileSystem {
  public override get sandboxMode(): "workspace-write" { return "workspace-write"; }
}

class ControlledCodeRuntime extends CodeRuntime {
  public readonly isolation = "dsh-univer-work-office";
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
        value.push({
          error: error instanceof Error ? error.message : "tool failed",
          ...(error instanceof HarnessError ? { code: error.code } : {}),
        });
      }
    }
    return { logs: [], value };
  }
}

function createCoreOfficeFeature(
  overrides: Partial<WorkspaceUnitExchangeDependencies> = {},
): WorkspaceUnitExchangeFeature {
  return new WorkspaceUnitExchangeFeature({
    createUnit: async (input) => createdUnit(input),
    resolveRuntimeTarget: async () => runtimeTarget("sheet", 1),
    runtime: { exportUnitData: async () => ({ id: "unit-1" }) as never },
    ...overrides,
  });
}

function createdUnit(
  input: Parameters<WorkspaceUnitExchangeDependencies["createUnit"]>[0],
): WorkspaceUnit {
  return {
    activationState: "notApplicable",
    change: "added",
    draftHeadRevision: 0,
    mergeResult: "pending",
    name: input.name,
    nodeId: "node-1",
    resourceId: "resource-1",
    source: "worktree",
    target: { parentNodeId: input.parentNodeId ?? null, spaceId: input.spaceId },
    type: input.type,
    unitId: "unit-1",
    worktreeId: input.worktreeId,
  };
}

function canonicalImportResult(sourcePath: string, worktreeId: string): WorkspaceImportFileResult {
  return {
    committed: true,
    name: "Imported Sheet",
    nodeId: "node-1",
    resourceId: "resource-1",
    sourcePath,
    type: "sheet",
    unitId: "unit-1",
    worktreeId,
  };
}

function runtimeTarget(type: WorkspaceUnitType, revision: number): WorkspaceRuntimeTarget {
  return {
    origin: "https://workspace.test",
    revision,
    scope: { kind: "worktree", worktreeId: "wt-1" },
    unitId: "unit-1",
    unitType: type,
  };
}

async function setup(options: {
  readonly approval?: ApprovalOutcome | (() => Promise<ApprovalOutcome>);
  readonly codeMode?: boolean;
  readonly cwd: string;
  readonly filesystem?: "confining" | FileSystem;
  readonly office?: Pick<WorkspaceUnitExchangeFeature, "exportFile" | "importFile">;
  readonly policy?: () => { readonly mode: "danger-full-access" | "read-only" | "workspace-write"; readonly workspaceRoot: string };
}) {
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(SystemPrompt);
  if (options.codeMode === true) {
    await ctx.plugin(ControlledCodeRuntime);
    await ctx.plugin(ToolRuntime, { mode: "code" });
  } else {
    await ctx.plugin(ToolRuntime);
  }
  if (options.filesystem === undefined) await ctx.plugin(LocalFileSystem, { cwd: options.cwd });
  else if (options.filesystem === "confining") await ctx.plugin(ConfiningLocalFileSystem, { cwd: options.cwd });
  else ctx.provide("fs", options.filesystem);
  if (options.policy !== undefined) {
    ctx.provide("sandboxPolicy", { resolve: options.policy } as unknown as Context["sandboxPolicy"]);
  }
  const approvals: string[] = [];
  if (options.approval !== undefined) {
    await ctx.plugin(ApprovalService);
    ctx.on("approval/request", (request) => {
      approvals.push(request.toolName);
      return typeof options.approval === "function"
        ? options.approval()
        : Promise.resolve(options.approval!);
    });
  }
  const importFile = vi.fn(async (
    input: { readonly sourcePath: string; readonly worktreeId: string },
  ): Promise<WorkspaceImportFileResult> => ({
    committed: true as const,
    name: "Imported",
    nodeId: "node-1",
    resourceId: "resource-1",
    sourcePath: input.sourcePath,
    type: "sheet" as const,
    unitId: "unit-1",
    worktreeId: input.worktreeId,
  }));
  const exportFile = vi.fn(async (input: { readonly outputPath: string; readonly unitId: string; readonly worktreeId: string }) => ({
    outputPath: input.outputPath,
    type: "sheet" as const,
    unitId: input.unitId,
    worktreeId: input.worktreeId,
  }));
  const owner = new WorkspaceToolOwner();
  const fiber = ctx.plugin({
    name: `dsh-univer-work-office-test-${String(Math.random())}`,
    inject: ["tools", "fs"],
    apply(child: Context) {
      const unregister = registerWorkspaceOfficeTools(child, {
        office: options.office ?? { exportFile, importFile },
        owner,
      });
      return async () => {
        owner.stopAccepting();
        for (const dispose of [...unregister].reverse()) dispose();
        owner.abort();
        await owner.drain();
      };
    },
  });
  await fiber;
  return {
    approvals,
    codeRuntime: options.codeMode === true ? ctx.codeRuntime as ControlledCodeRuntime : undefined,
    ctx,
    exportFile,
    fiber,
    importFile,
    owner,
  };
}

async function execute(
  ctx: Context,
  name: string,
  arguments_: unknown,
  agent: unknown,
  signal: AbortSignal = new AbortController().signal,
) {
  return await ctx.tools.execute({
    arguments: arguments_,
    callId: CallId(`${name}-${String(Math.random())}`),
    name,
    signal,
    agent: agent as never,
  });
}

function fakeAgent(cwd: string): unknown {
  const id = SessionId(`office-${String(Math.random())}`);
  const session = Session.create(id, [], { version: 0, id, createdAt: 0, cwd });
  session.append("turn/start", { turn: 1 });
  session.append("step/start", { turn: 1, step: 1 });
  return { session };
}

function fakeAgentWithoutCwd(): unknown {
  const id = SessionId(`office-no-cwd-${String(Math.random())}`);
  const session = Session.create(id, [], { version: 0, id, createdAt: 0 });
  session.append("turn/start", { turn: 1 });
  session.append("step/start", { turn: 1, step: 1 });
  return { session };
}

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "dsh-univer-work-office-"));
  directories.push(path);
  return path;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function parseFailureEnvelope(message: string): unknown {
  return JSON.parse(message.slice(message.indexOf("{")));
}
