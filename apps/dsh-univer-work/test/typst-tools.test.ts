import { Context } from "@deepseek-ai/cordis";
import type { FileSystem } from "@deepseek-ai/dsh-fs";
import LocalFileSystem from "@deepseek-ai/dsh-fs-local";
import { CallId } from "@deepseek-ai/dsh-llm";
import { Session, SessionId } from "@deepseek-ai/dsh-session";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime, { TOOL_ABORTED, renderToolsSdk } from "@deepseek-ai/dsh-tools";
import ApprovalService, { type ApprovalOutcome } from "@deepseek-ai/dsh-user-approval";
import {
  WorkspaceApplicationError,
  WorkspaceCompileTypstFeature,
  WorkspaceHttp,
  WorkspaceUnitFeature,
} from "@univerjs/univer-workspace-client-core";
import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, stat, symlink, truncate, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_TYPST_ARGUMENT_BYTES,
  MAX_TYPST_RESULT_BYTES,
  MAX_TYPST_UNIT_ENVELOPE_BYTES,
  MAX_TYPST_VISIBLE_RESULT_BYTES,
  registerWorkspaceTypstTools,
  validateWorkspaceTypstApplyArgs,
  validateWorkspaceTypstApplyResult,
  validateWorkspaceTypstCompileArgs,
  validateWorkspaceTypstCompileResult,
  workspaceTypstApplyParameters,
  workspaceTypstCompileParameters,
  type WorkspaceTypstToolDependencies,
} from "../src/typst-tools.js";
import { WorkspaceToolOwner } from "../src/tool-owner.js";
import {
  cleanupTypstArtifactStage,
  commitTypstArtifactStage,
  createTypstArtifactStage,
  MAX_TYPST_ARTIFACT_BYTES,
  MAX_TYPST_PREVIEWS,
  stageTypstArtifacts,
} from "../src/typst-artifacts.js";

const contexts: Context[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async (ctx) => await ctx.fiber.dispose()));
  await Promise.all(temporaryDirectories.splice(0).map(async (path) => await rm(path, { force: true, recursive: true })));
});

describe("Workspace Typst closed contracts", () => {
  it("publishes exactly two root-closed operation schemas without arbitrary input", async () => {
    const harness = await setup("rejected");
    const schemas = harness.ctx.tools.schemas().filter(({ name }) => name.startsWith("workspace_typst_"));
    expect(schemas.map(({ name }) => name).sort()).toEqual([
      "workspace_typst_apply",
      "workspace_typst_compile",
    ]);
    expect(schemas.every(({ parameters }) => parameters.additionalProperties === false)).toBe(true);
    expect(schemas.every(({ name }) =>
      harness.ctx.tools.get(name)!.output.schema.additionalProperties === false)).toBe(true);
    expect(Object.keys(workspaceTypstCompileParameters).sort()).toEqual([
      "artifact_directory", "bundle_path", "render_previews",
    ]);
    expect(Object.keys(workspaceTypstApplyParameters).sort()).toEqual([
      "artifact_directory", "bundle_path", "idempotency_key", "parent_node_id",
      "render_previews", "space_id", "worktree_id",
    ]);
    const sdk = renderToolsSdk(schemas.map((schema) => ({
      ...schema,
      output: harness.ctx.tools.get(schema.name)!.output.schema,
    })));
    const argumentsSdk = sdk.slice(
      sdk.indexOf("interface ToolArgsMap"),
      sdk.indexOf("interface ToolOutputMap"),
    );
    expect(argumentsSdk).toMatch(/workspace_typst_apply[\s\S]*workspace_typst_compile/u);
    expect(argumentsSdk)
      .not.toMatch(/\b(?:cookie|license|origin|source|javascript|code|command|environment|worker|browser|font|force)\??:/iu);
  });

  it("rejects unknown, accessor, blank, wrong-type, and cross-field input before approval or work", async () => {
    let getterCalls = 0;
    const accessor = Object.defineProperty({
      artifact_directory: "artifacts",
      bundle_path: "bundle",
    }, "unknown", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "secret";
      },
    });
    for (const [name, args] of [
      ["workspace_typst_compile", { artifact_directory: "", bundle_path: "bundle" }],
      ["workspace_typst_compile", { artifact_directory: "artifacts", bundle_path: "bundle", render_previews: "yes" }],
      ["workspace_typst_apply", { bundle_path: "bundle", render_previews: true, space_id: "space-1", worktree_id: "wt-1" }],
      ["workspace_typst_apply", { bundle_path: "bundle", inline_source: "secret", space_id: "space-1", worktree_id: "wt-1" }],
    ] as const) {
      const harness = await setup("allowed-once");
      const result = await execute(harness.ctx, name, args);
      expect(result).toMatchObject({
        isError: true,
        error: { info: { code: "workspace-argument-invalid" } },
      });
      expect(harness.approvals).toEqual([]);
      expect(harness.compile).not.toHaveBeenCalled();
      expect(harness.apply).not.toHaveBeenCalled();
    }
    expect(() => validateWorkspaceTypstCompileArgs(accessor)).toThrowError(expect.objectContaining({
      code: "workspace-argument-invalid",
    }));
    expect(getterCalls).toBe(0);
  });

  it("enforces the exact 512 KiB canonical argument boundary", () => {
    const base = { artifact_directory: "artifacts", bundle_path: "" };
    const fixedBytes = Buffer.byteLength(JSON.stringify(base));
    const atLimit = { ...base, bundle_path: "x".repeat(MAX_TYPST_ARGUMENT_BYTES - fixedBytes) };
    const aboveLimit = { ...atLimit, bundle_path: `${atLimit.bundle_path}x` };
    expect(Buffer.byteLength(JSON.stringify(atLimit))).toBe(MAX_TYPST_ARGUMENT_BYTES);
    expect(validateWorkspaceTypstCompileArgs(atLimit)).toEqual(atLimit);
    expect(() => validateWorkspaceTypstCompileArgs(aboveLimit)).toThrowError(expect.objectContaining({
      code: "workspace-typst-limit-exceeded",
    }));
  });

  it("rejects 524,289-byte arguments before approval or operation work", async () => {
    const base = { artifact_directory: "artifacts", bundle_path: "" };
    const fixedBytes = Buffer.byteLength(JSON.stringify(base));
    const input = {
      ...base,
      bundle_path: "x".repeat(MAX_TYPST_ARGUMENT_BYTES + 1 - fixedBytes),
    };
    const harness = await setup("allowed-once");
    const result = await execute(harness.ctx, "workspace_typst_compile", input);
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-typst-limit-exceeded" } },
    });
    expect(harness.approvals).toEqual([]);
    expect(harness.compile).not.toHaveBeenCalled();
    expect(harness.apply).not.toHaveBeenCalled();
  });

  it("rejects broadened, mismatched, and oversized complete results", () => {
    const compileArgs = validateWorkspaceTypstCompileArgs(compileInput());
    expect(() => validateWorkspaceTypstCompileResult(compileArgs, {
      ...compileValue(),
      javascript: "generated-secret",
    })).toThrowError(expect.objectContaining({ code: "workspace-typst-result-invalid" }));
    expect(() => validateWorkspaceTypstCompileResult(compileArgs, {
      ...compileValue(),
      artifactDirectory: "other-artifacts",
    })).toThrowError(expect.objectContaining({ code: "workspace-typst-result-invalid" }));
    expect(() => validateWorkspaceTypstCompileResult(compileArgs, {
      ...compileValue(),
      previews: [{ bytes: "png-secret", pageId: "one", path: "one.png", sourcePath: "one.typ" }],
    })).toThrowError(expect.objectContaining({ code: "workspace-typst-result-invalid" }));
    expect(() => validateWorkspaceTypstCompileResult(compileArgs, {
      ...compileValue(),
      diagnostics: [{
        reason: "x".repeat(MAX_TYPST_RESULT_BYTES),
        severity: "error",
        sourcePath: "page.typ",
      }],
    })).toThrowError(expect.objectContaining({ code: "workspace-typst-limit-exceeded" }));

    const applyArgs = validateWorkspaceTypstApplyArgs(applyInput());
    expect(() => validateWorkspaceTypstApplyResult(applyArgs, {
      ...applyValue(),
      unit: { ...unit(), worktreeId: "other" },
    })).toThrowError(expect.objectContaining({ code: "workspace-typst-result-invalid" }));
    expect(() => validateWorkspaceTypstApplyResult(applyArgs, {
      ...applyValue(),
      artifactDirectory: "/absolute/other-artifacts",
    })).toThrowError(expect.objectContaining({ code: "workspace-typst-result-invalid" }));
  });

  it("rejects non-bundle-relative diagnostic and preview source paths", () => {
    const args = validateWorkspaceTypstCompileArgs({ ...compileInput(), render_previews: true });
    for (const sourcePath of [
      "/host/secret.typ",
      "C:/secret.typ",
      "//server/share.typ",
      "../secret.typ",
      "pages/../secret.typ",
      "./page.typ",
      "pages\\secret.typ",
      "pages//secret.typ",
      "pages/secret.typ\0suffix",
      "file:secret.typ",
    ]) {
      expect(() => validateWorkspaceTypstCompileResult(args, {
        ...compileValue(),
        diagnostics: [{ reason: "unsafe", sourcePath }],
      })).toThrowError(expect.objectContaining({ code: "workspace-typst-result-invalid" }));
      expect(() => validateWorkspaceTypstCompileResult(args, {
        ...compileValue(),
        previews: [{ pageId: "one", path: "artifacts/previews/one.png", sourcePath }],
      })).toThrowError(expect.objectContaining({ code: "workspace-typst-result-invalid" }));
    }
  });
});

describe("Workspace Typst real ToolRuntime", () => {
  it("fails closed on denied approval and invokes no operation", async () => {
    for (const name of ["workspace_typst_compile", "workspace_typst_apply"] as const) {
      const harness = await setup("rejected");
      const result = await execute(
        harness.ctx,
        name,
        name === "workspace_typst_compile" ? compileInput() : applyInput(),
      );
      expect(result).toMatchObject({ isError: true });
      expect(harness.approvals).toHaveLength(1);
      expect(harness.compile).not.toHaveBeenCalled();
      expect(harness.apply).not.toHaveBeenCalled();
    }
  });

  it("asks once with fixed secret-safe text and returns closed canonical values", async () => {
    const generatedJavascript = "generated-javascript-secret";
    const pngBytes = "png-bytes-secret";
    let credentialResolutions = 0;
    let licenseResolutions = 0;
    const harness = await setup("allowed-once", {
      compile: vi.fn(async () => {
        void generatedJavascript;
        void pngBytes;
        return compileOperationValue();
      }),
      apply: vi.fn(async (input) => {
        credentialResolutions += 1;
        licenseResolutions += 1;
        if (input.previewDirectory !== undefined) {
          await writeFile(join(input.previewDirectory, "one.png"), pngBytes);
        }
        return applyOperationValue(input.previewDirectory);
      }),
    });

    const compileAgent = fakeAgent(harness.cwd);
    const applyAgent = fakeAgent(harness.cwd);
    const compiled = await execute(
      harness.ctx,
      "workspace_typst_compile",
      compileInput(),
      compileAgent,
    );
    expect(compiled).toMatchObject({ isError: false, value: compileValue() });
    expect(harness.compile).toHaveBeenCalledOnce();
    expect(harness.apply).not.toHaveBeenCalled();
    expect(credentialResolutions).toBe(0);
    expect(licenseResolutions).toBe(0);

    const appliedInput = applyInput("apply-artifacts");
    const applied = await execute(harness.ctx, "workspace_typst_apply", appliedInput, applyAgent);
    expect(applied).toMatchObject({ isError: false, value: applyValue("apply-artifacts") });
    expect(await readdir(join(harness.cwd, "apply-artifacts"))).toEqual([
      "diagnostics.json", "previews", "program.js",
    ]);
    expect(await readFile(join(harness.cwd, "apply-artifacts", "previews", "one.png"), "utf8"))
      .toBe(pngBytes);
    expect((await stat(join(harness.cwd, "apply-artifacts", "previews"))).mode & 0o777).toBe(0o700);
    expect((await stat(join(harness.cwd, "apply-artifacts", "previews", "one.png"))).mode & 0o777)
      .toBe(0o600);
    expect(harness.apply).toHaveBeenCalledOnce();
    expect(credentialResolutions).toBe(1);
    expect(licenseResolutions).toBe(1);
    expect(harness.approvals).toEqual([
      "Workspace Typst compilation writes Host-local review artifacts.",
      "Workspace Typst apply creates a remote Worktree-local Doc and may write Host-local review artifacts.",
    ]);
    expect(JSON.stringify({
      approvals: harness.approvals,
      applied,
      compiled,
      events: [...compileAgent.session.events, ...applyAgent.session.events],
    }))
      .not.toMatch(/generated-javascript-secret|png-bytes-secret/u);
    expect(JSON.stringify(harness.approvals)).not.toMatch(/paper-bundle|typst-artifacts|space-1/u);
  });

  it("converts Host paths only in the accepted body and returns only Session-relative paths", async () => {
    const harness = await setup("allowed-once", {}, { filesystem: "tracing" });
    const artifactDirectory = join(harness.cwd, "absolute-artifacts");
    const result = await execute(harness.ctx, "workspace_typst_apply", {
      ...applyInput(artifactDirectory),
      bundle_path: join(harness.cwd, "paper-bundle"),
    });
    expect(harness.approvalProcessPathCalls).toEqual([0]);
    expect((harness.ctx.get("fs") as TracingLocalFileSystem).explicitProcessPathCalls).toBeGreaterThan(0);
    expect(result).toMatchObject({
      isError: false,
      value: {
        artifactDirectory: "absolute-artifacts",
        previews: [{ path: join("absolute-artifacts", "previews", "one.png") }],
      },
    });
    expect(JSON.stringify({ approvals: harness.approvals, result })).not.toContain(harness.cwd);
  });

  it("returns bounded Session-relative partial errors and never removes public artifacts", async () => {
    const sentinel = "host-and-temp-sentinel";
    for (const name of ["workspace_typst_compile", "workspace_typst_apply"] as const) {
      const artifactDirectory = `${name}-partial`;
      let destination = "";
      const harness = await setup("allowed-once", {
        compile: vi.fn(async (input, owned) => {
          installFilesystemFence(owned.signal, () => addForeignPublicEntry(destination, sentinel));
          return {
            ...compileOperationValue(),
            previews: await writePreviews(input.previewDirectory!, 2),
          };
        }),
        apply: vi.fn(async (input, owned) => {
          installFilesystemFence(owned.signal, () => addForeignPublicEntry(destination, sentinel));
          return {
            ...applyOperationValue(undefined),
            previews: await writePreviews(input.previewDirectory!, 2),
          };
        }),
      });
      destination = join(harness.cwd, artifactDirectory);
      const result = await execute(
        harness.ctx,
        name,
        name === "workspace_typst_compile"
          ? { ...compileInput(), artifact_directory: artifactDirectory, render_previews: true }
          : applyInput(artifactDirectory),
      );

      expect(result).toMatchObject({
        isError: true,
        error: {
          info: {
            code: name === "workspace_typst_compile"
              ? "workspace-typst-artifact-partial"
              : "workspace-typst-partial-side-effect",
          },
        },
      });
      const serialized = JSON.stringify(result);
      expect(serialized).toContain(artifactDirectory);
      expect(serialized).toMatch(/inspect|Inspect/u);
      expect(serialized).toMatch(/Never replay/u);
      expect(serialized).not.toContain(harness.cwd);
      expect(serialized).not.toContain(sentinel);
      expect(await readFile(join(destination, "foreign.txt"), "utf8")).toBe(sentinel);
    }
  });

  it("retains only safe Unit identity when the confirmed Unit exceeds its 512 KiB reserve", async () => {
    const oversizedUnit = unitWithJsonBytes(600_246);
    const harness = await setup("allowed-once", {
      apply: vi.fn(async () => ({ ...applyOperationValue(undefined), unit: oversizedUnit })),
    });
    const result = await execute(harness.ctx, "workspace_typst_apply", {
      ...applyInput(),
      render_previews: false,
    });

    expect(Buffer.byteLength(JSON.stringify(oversizedUnit))).toBe(600_246);
    expect(MAX_TYPST_UNIT_ENVELOPE_BYTES).toBe(524_288);
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-typst-partial-side-effect" } },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).toContain("unit-1");
    expect(serialized).toContain("worktree-1");
    expect(serialized).not.toContain("x".repeat(256));
    expect(await readdir(harness.cwd)).toEqual(["paper-bundle"]);
  });

  it("projects later invalid results as a confirmed partial side effect", async () => {
    const harness = await setup("allowed-once", {
      apply: vi.fn(async () => ({
        ...applyOperationValue(undefined),
        diagnostics: [{ reason: "invalid", sourcePath: "page.typ", unknown: "hidden" }],
      } as never)),
    });
    const result = await execute(harness.ctx, "workspace_typst_apply", {
      bundle_path: "paper-bundle",
      parent_node_id: "parent-1",
      space_id: "space-1",
      worktree_id: "worktree-1",
    });

    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-typst-partial-side-effect" } },
    });
    expect(JSON.stringify(result)).toContain("not-requested");
  });

  it("does not trust or leak identity from a malformed Unit", async () => {
    const sentinel = "malformed-unit-identity-sentinel";
    const harness = await setup("allowed-once", {
      apply: vi.fn(async () => ({
        ...applyOperationValue(undefined),
        unit: { ...unit(), target: { parentNodeId: "wrong", spaceId: "space-1" }, unitId: sentinel },
      })),
    });
    const result = await execute(harness.ctx, "workspace_typst_apply", {
      bundle_path: "paper-bundle",
      parent_node_id: "parent-1",
      space_id: "space-1",
      worktree_id: "worktree-1",
    });

    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-typst-result-invalid" } },
    });
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });

  it("preserves uncertain-create identity and guidance without dependency secrets", async () => {
    const createSecret = "http-cookie-stack-secret";
    const requests: Request[] = [];
    const http = new WorkspaceHttp({
      cookie: "workspace_session=private",
      fetcher: vi.fn<typeof fetch>(async (requestInput, init) => {
        requests.push(new Request(requestInput, init));
        throw new Error(createSecret);
      }),
      origin: "https://workspace.test",
      role: "client",
    });
    const core = new WorkspaceCompileTypstFeature({
      compile: async () => compileOperationValue(),
      materializer: {
        materialize: async () => ({ initialData: { id: "compiled-doc" }, name: "Compiled paper" }),
      },
      units: new WorkspaceUnitFeature(async () => http),
    });
    const apply = vi.fn<WorkspaceTypstToolDependencies["apply"]>(async (input, owned) =>
      await core.execute({
        apply: {
          spaceId: input.args.space_id,
          worktreeId: input.args.worktree_id,
          ...(input.args.parent_node_id === undefined
            ? {}
            : { parentNodeId: input.args.parent_node_id }),
          ...(input.args.idempotency_key === undefined
            ? {}
            : { idempotencyKey: input.args.idempotency_key }),
        },
        bundlePath: input.bundlePath,
        maxUnitDataBytes: MAX_TYPST_ARTIFACT_BYTES,
        maxUnitDataDepth: 64,
        maxVisibleResultBytes: MAX_TYPST_VISIBLE_RESULT_BYTES,
        maxVisibleResultDepth: 64,
        signal: owned.signal,
      }));
    const uncertain = await setup("allowed-once", { apply });
    const applied = await execute(uncertain.ctx, "workspace_typst_apply", {
      bundle_path: "paper-bundle",
      parent_node_id: "parent-1",
      space_id: "space-1",
      worktree_id: "worktree-1",
    });
    expect(applied).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-result-unknown" } },
    });
    const serialized = JSON.stringify(applied);
    const generatedIdempotencyKey = requests[0]!.headers.get("idempotency-key")!;
    expect(generatedIdempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(requests).toHaveLength(3);
    expect(requests.every((request) =>
      request.headers.get("idempotency-key") === generatedIdempotencyKey)).toBe(true);
    expect(serialized).toContain(generatedIdempotencyKey);
    expect(serialized).toContain("workspace_unit_list");
    expect(serialized).toContain("Never replay");
    expect(serialized).not.toContain(createSecret);
    expect(apply).toHaveBeenCalledOnce();
    const message = applied.error!.message;
    const envelope = JSON.parse(message.slice(message.indexOf("{"), message.indexOf(" Inspect"))) as {
      readonly detail: Record<string, unknown>;
    };
    expect(envelope.detail).toEqual({
      idempotencyKey: generatedIdempotencyKey,
      name: "Compiled paper",
      parentNodeId: "parent-1",
      spaceId: "space-1",
      type: "doc",
      worktreeId: "worktree-1",
    });
  });

  it("fails safe on mismatched, broadened, or oversized uncertain-create identity", async () => {
    const sentinel = "uncertain-request-private-sentinel";
    const validRequest = {
      idempotencyKey: "request-1",
      name: "Compiled paper",
      parentNodeId: "parent-1",
      spaceId: "space-1",
      type: "doc",
      worktreeId: "worktree-1",
    };
    for (const request of [
      { ...validRequest, parentNodeId: "wrong-parent" },
      { ...validRequest, secret: sentinel },
      { ...validRequest, name: "x".repeat(MAX_TYPST_VISIBLE_RESULT_BYTES) },
    ]) {
      const harness = await setup("allowed-once", {
        apply: vi.fn(async () => {
          throw new WorkspaceApplicationError("workspace-result-unknown", sentinel, {
            cause: sentinel,
            request,
          });
        }),
      });
      const result = await execute(harness.ctx, "workspace_typst_apply", {
        bundle_path: "paper-bundle",
        idempotency_key: "request-1",
        parent_node_id: "parent-1",
        render_previews: false,
        space_id: "space-1",
        worktree_id: "worktree-1",
      });
      expect(result).toMatchObject({
        isError: true,
        error: { info: { code: "workspace-typst-operation-failed" } },
      });
      expect(JSON.stringify(result)).not.toContain(sentinel);
      expect(harness.apply).toHaveBeenCalledOnce();
    }
  });

  it("retains the exact caller idempotency identity and explicit null parent for recovery", async () => {
    const harness = await setup("allowed-once", {
      apply: vi.fn(async () => {
        throw new WorkspaceApplicationError("workspace-result-mismatch", "unsafe dependency message", {
          request: {
            idempotencyKey: "request-1",
            name: "Compiled paper",
            parentNodeId: null,
            spaceId: "space-1",
            type: "doc",
            worktreeId: "worktree-1",
          },
        });
      }),
    });
    const result = await execute(harness.ctx, "workspace_typst_apply", {
      bundle_path: "paper-bundle",
      idempotency_key: "request-1",
      space_id: "space-1",
      worktree_id: "worktree-1",
    });

    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-result-mismatch" } },
    });
    const message = result.error!.message;
    const envelope = JSON.parse(message.slice(message.indexOf("{"), message.indexOf(" Inspect"))) as {
      readonly detail: Record<string, unknown>;
    };
    expect(envelope.detail).toEqual({
      idempotencyKey: "request-1",
      name: "Compiled paper",
      parentNodeId: null,
      spaceId: "space-1",
      type: "doc",
      worktreeId: "worktree-1",
    });
    expect(message).toContain("workspace_unit_list");
    expect(harness.apply).toHaveBeenCalledOnce();
  });

  it.each(["compile", "apply"] as const)(
    "keeps fully confirmed %s side effects when post-execute caller cancellation becomes ABORTED",
    async (operation) => {
      const compile = vi.fn(async () => compileOperationValue());
      const materialize = vi.fn(async () => ({
        initialData: { id: "typst-doc", optional: undefined },
        name: "Compiled paper",
      }));
      const create = vi.fn(async () => unit());
      const core = new WorkspaceCompileTypstFeature({
        compile,
        materializer: { materialize },
        units: { create },
      });
      const compileOperation = vi.fn<WorkspaceTypstToolDependencies["compile"]>(
        async (input, owned) => await core.execute({
          bundlePath: input.bundlePath,
          signal: owned.signal,
        }),
      );
      const applyOperation = vi.fn<WorkspaceTypstToolDependencies["apply"]>(
        async (input, owned) => await core.execute({
          apply: {
            spaceId: input.args.space_id,
            worktreeId: input.args.worktree_id,
            ...(input.args.idempotency_key === undefined
              ? {}
              : { idempotencyKey: input.args.idempotency_key }),
            ...(input.args.parent_node_id === undefined
              ? {}
              : { parentNodeId: input.args.parent_node_id }),
          },
          bundlePath: input.bundlePath,
          maxUnitDataBytes: MAX_TYPST_ARTIFACT_BYTES,
          maxUnitDataDepth: 64,
          maxVisibleResultBytes: MAX_TYPST_VISIBLE_RESULT_BYTES,
          maxVisibleResultDepth: 64,
          signal: owned.signal,
        }),
      );
      const harness = await setup("allowed-once", {
        apply: applyOperation,
        compile: compileOperation,
      });
      const controller = new AbortController();
      let postExecuteCalls = 0;
      harness.ctx.on("tools/post-execute", async (exec, result, next) => {
        if (exec.name === `workspace_typst_${operation}` && !result.isError) {
          postExecuteCalls += 1;
          expect(await readdir(join(harness.cwd, "late-artifacts"))).toEqual([
            "diagnostics.json",
            "program.js",
          ]);
          controller.abort(new Error("late-caller-private-sentinel"));
        }
        return await next();
      });

      const result = await execute(
        harness.ctx,
        `workspace_typst_${operation}`,
        operation === "compile"
          ? { artifact_directory: "late-artifacts", bundle_path: "paper-bundle" }
          : {
              artifact_directory: "late-artifacts",
              bundle_path: "paper-bundle",
              idempotency_key: "request-1",
              parent_node_id: "parent-1",
              render_previews: false,
              space_id: "space-1",
              worktree_id: "worktree-1",
            },
        fakeAgent(harness.cwd),
        controller.signal,
      );

      expect(result).toMatchObject({
        isError: true,
        error: { info: { code: TOOL_ABORTED } },
      });
      expect(postExecuteCalls).toBe(1);
      expect(compile).toHaveBeenCalledOnce();
      expect(materialize).toHaveBeenCalledTimes(operation === "apply" ? 1 : 0);
      expect(create).toHaveBeenCalledTimes(operation === "apply" ? 1 : 0);
      expect(compileOperation).toHaveBeenCalledTimes(operation === "compile" ? 1 : 0);
      expect(applyOperation).toHaveBeenCalledTimes(operation === "apply" ? 1 : 0);
      expect(JSON.stringify(result)).toContain("Never replay");
      expect(JSON.stringify(result)).toContain(operation === "apply"
        ? "workspace_unit_list"
        : "requested artifact directory");
      expect(JSON.stringify(result)).not.toContain("late-caller-private-sentinel");
      expect(await readFile(join(harness.cwd, "late-artifacts", "program.js"), "utf8"))
        .toBe("generated-javascript-secret");
    },
  );

  it("fences completed stage creation before compile and apply dependencies", async () => {
    for (const name of ["workspace_typst_compile", "workspace_typst_apply"] as const) {
      const harness = await setup("allowed-once");
      let stageFences = 0;
      const controlled = {
        get aborted() { return false; },
        throwIfAborted() {
          const staged = readdirSync(harness.cwd).some((entry) => entry.startsWith(".typst-artifacts."));
          if (staged && ++stageFences === 4) throw new Error("cancel at dependency boundary");
        },
      } as AbortSignal;
      const any = vi.spyOn(AbortSignal, "any").mockReturnValue(controlled);
      try {
        const definition = harness.ctx.tools.get(name)!;
        const execution = {
          ...directExecution(),
          agent: fakeAgent(harness.cwd) as never,
          name,
        };
        await expect(definition.execute(
          name === "workspace_typst_compile"
            ? compileInput()
            : { ...applyInput(), render_previews: false },
          execution,
        )).rejects.toMatchObject({ code: "workspace-typst-operation-failed" });
      } finally {
        any.mockRestore();
      }
      expect(stageFences).toBe(4);
      expect(harness.compile).not.toHaveBeenCalled();
      expect(harness.apply).not.toHaveBeenCalled();
      expect(await readdir(harness.cwd)).toEqual(["paper-bundle"]);
    }
  });

  it("defensively revalidates the body snapshot before invoking the operation", async () => {
    const harness = await setup("allowed-once");
    const definition = harness.ctx.tools.get("workspace_typst_compile")!;
    const result = definition.execute({
      artifact_directory: "artifacts",
      bundle_path: "bundle",
      extra: "secret",
    } as never, directExecution());
    await expect(result).rejects.toMatchObject({ code: "workspace-argument-invalid" });
    expect(harness.compile).not.toHaveBeenCalled();
  });

  it("publishes the exact synced fixed layout and preserves compile-only error diagnostics", async () => {
    const diagnostic = { reason: "unsupported", severity: "error" as const, sourcePath: "pages/one.typ" };
    const harness = await setup("allowed-once", {
      compile: vi.fn(async (input) => ({
        ...compileOperationValue(),
        diagnostics: [diagnostic],
        javascript: "const generated = true;\n",
        targetUnitId: input.bundlePath.endsWith("paper-bundle") ? "compiled-doc" : "wrong",
      })),
    });
    const result = await execute(harness.ctx, "workspace_typst_compile", compileInput());
    expect(result).toMatchObject({ isError: false, value: { committed: false, diagnostics: [diagnostic] } });
    const output = join(harness.cwd, "typst-artifacts");
    expect(await readdir(output)).toEqual(["diagnostics.json", "program.js"]);
    expect(await readFile(join(output, "program.js"), "utf8")).toBe("const generated = true;\n");
    expect(JSON.parse(await readFile(join(output, "diagnostics.json"), "utf8"))).toEqual({
      diagnostics: [diagnostic],
      schemaVersion: 1,
    });
    expect((await stat(output)).mode & 0o777).toBe(0o700);
    expect((await stat(join(output, "program.js"))).mode & 0o777).toBe(0o600);
  });

  it("rejects non-local, read-only, outside, and overlapping paths before approval or compiler work", async () => {
    const nonLocal = await setup("allowed-once", {}, { filesystem: "non-local" });
    const nonLocalResult = await execute(
      nonLocal.ctx,
      "workspace_typst_compile",
      compileInput(),
      fakeAgent(nonLocal.cwd),
    );
    expect(nonLocalResult).toMatchObject({ isError: true, error: { info: { code: "workspace-local-filesystem-required" } } });
    expect(nonLocal.approvals).toEqual([]);
    expect(nonLocal.compile).not.toHaveBeenCalled();

    const readOnly = await setup("allowed-once", {}, {
      filesystem: "confining",
      policy: () => ({ mode: "read-only" as const, workspaceRoot: "unused" }),
    });
    const readOnlyResult = await execute(readOnly.ctx, "workspace_typst_compile", compileInput());
    expect(readOnlyResult).toMatchObject({ isError: true, error: { info: { code: "workspace-file-policy-denied" } } });
    expect(readOnly.approvals).toEqual([]);
    expect(readOnly.compile).not.toHaveBeenCalled();

    for (const input of [
      { ...compileInput(), artifact_directory: "../outside" },
      { ...compileInput(), artifact_directory: "paper-bundle/artifacts" },
    ]) {
      const harness = await setup("allowed-once");
      const result = await execute(harness.ctx, "workspace_typst_compile", input);
      expect(result).toMatchObject({ isError: true });
      expect(harness.approvals).toEqual([]);
      expect(harness.compile).not.toHaveBeenCalled();
    }
  });

  it("rechecks current provider and policy after approval", async () => {
    let mode: "workspace-write" | "read-only" = "workspace-write";
    let policyCwd = "";
    const policyHarness = await setup(async () => {
      mode = "read-only";
      return "allowed-once";
    }, {}, {
      filesystem: "confining",
      policy: () => ({ mode, workspaceRoot: policyCwd }),
    });
    policyCwd = policyHarness.cwd;
    const policyResult = await execute(policyHarness.ctx, "workspace_typst_compile", compileInput());
    expect(policyResult).toMatchObject({ isError: true, error: { info: { code: "workspace-file-policy-denied" } } });
    expect(policyHarness.compile).not.toHaveBeenCalled();

    let filesystem: LocalFileSystem;
    let prototype: object;
    const providerHarness = await setup(async () => {
      Object.setPrototypeOf(filesystem, Object.prototype);
      return "allowed-once";
    });
    filesystem = providerHarness.ctx.get("fs") as LocalFileSystem;
    prototype = Object.getPrototypeOf(filesystem) as object;
    const providerResult = await execute(providerHarness.ctx, "workspace_typst_compile", compileInput())
      .finally(() => Object.setPrototypeOf(filesystem, prototype));
    expect(providerResult).toMatchObject({ isError: true, error: { info: { code: "workspace-local-filesystem-required" } } });
    expect(providerHarness.compile).not.toHaveBeenCalled();
  });

  it("keeps raced or existing destinations unchanged and cleans private state on throw or cancellation", async () => {
    const existing = await setup("allowed-once");
    await mkdir(join(existing.cwd, "typst-artifacts"));
    await writeFile(join(existing.cwd, "typst-artifacts", "owner.txt"), "existing");
    const existingResult = await execute(existing.ctx, "workspace_typst_compile", compileInput());
    expect(existingResult).toMatchObject({ isError: true, error: { info: { code: "workspace-output-exists" } } });
    expect(existing.approvals).toEqual([]);
    expect(existing.compile).not.toHaveBeenCalled();
    expect(await readFile(join(existing.cwd, "typst-artifacts", "owner.txt"), "utf8")).toBe("existing");

    const raced = await setup("allowed-once", {
      compile: vi.fn(async (input) => {
        await mkdir(join(dirname(input.bundlePath), "typst-artifacts"));
        await writeFile(join(dirname(input.bundlePath), "typst-artifacts", "owner.txt"), "other");
        return compileOperationValue();
      }),
    });
    const racedResult = await execute(raced.ctx, "workspace_typst_compile", compileInput());
    expect(racedResult).toMatchObject({ isError: true, error: { info: { code: "workspace-output-exists" } } });
    expect(await readFile(join(raced.cwd, "typst-artifacts", "owner.txt"), "utf8")).toBe("other");
    expect((await readdir(raced.cwd)).filter((name) => name.startsWith(".typst-artifacts."))).toEqual([]);

    const emptyRace = await setup("allowed-once", {
      compile: vi.fn(async (input) => {
        await mkdir(join(dirname(input.bundlePath), "typst-artifacts"));
        return compileOperationValue();
      }),
    });
    const emptyRaceResult = await execute(emptyRace.ctx, "workspace_typst_compile", compileInput());
    expect(emptyRaceResult).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-output-exists" } },
    });
    expect(await readdir(join(emptyRace.cwd, "typst-artifacts"))).toEqual([]);

    const failed = await setup("allowed-once", {
      apply: vi.fn(async (input) => {
        if (input.previewDirectory !== undefined) await writeFile(join(input.previewDirectory, "one.png"), "partial");
        throw new Error("dependency secret");
      }),
    });
    const failedResult = await execute(failed.ctx, "workspace_typst_apply", applyInput());
    expect(failedResult).toMatchObject({ isError: true, error: { info: { code: "workspace-typst-operation-failed" } } });
    const failedEntries = await readdir(failed.cwd);
    const privateEntry = failedEntries.find((entry) => entry.startsWith(".typst-artifacts."));
    expect(privateEntry).toBeDefined();
    expect(await readFile(join(failed.cwd, privateEntry!, "previews", "one.png"), "utf8")).toBe("partial");

    const controller = new AbortController();
    const cancelled = await setup("allowed-once", {
      compile: vi.fn(async () => {
        controller.abort();
        return compileOperationValue();
      }),
    });
    const cancelledResult = await execute(
      cancelled.ctx,
      "workspace_typst_compile",
      compileInput(),
      fakeAgent(cancelled.cwd),
      controller.signal,
    );
    expect(cancelledResult).toMatchObject({ isError: true });
    expect(await readdir(cancelled.cwd)).toEqual(["paper-bundle"]);
  });

  it("rejects symlink world drift after approval and starts no compiler work", async () => {
    const outside = await mkdtemp(join(tmpdir(), "dsh-typst-outside-"));
    temporaryDirectories.push(outside);
    await mkdir(join(outside, "paper-bundle"));
    await writeFile(join(outside, "paper-bundle", "typst.json"), "{}", "utf8");
    let cwd = "";
    const harness = await setup(async () => {
      await rename(join(cwd, "paper-bundle"), join(cwd, "paper-bundle-original"));
      await symlink(join(outside, "paper-bundle"), join(cwd, "paper-bundle"));
      return "allowed-once";
    });
    cwd = harness.cwd;
    const result = await execute(harness.ctx, "workspace_typst_compile", compileInput());
    expect(result).toMatchObject({ isError: true, error: { info: { code: "workspace-file-path-outside-session" } } });
    expect(harness.approvals).toHaveLength(1);
    expect(harness.compile).not.toHaveBeenCalled();
  });

  it("accepts exact artifact and preview limits and rejects the first value above each", async () => {
    const diagnostics = compileOperationValue().diagnostics;
    const diagnosticsBytes = Buffer.byteLength(`${JSON.stringify({ schemaVersion: 1, diagnostics }, null, 2)}\n`);
    const exactProgram = "x".repeat(MAX_TYPST_ARTIFACT_BYTES - diagnosticsBytes);
    const exactBytes = await setup("allowed-once", {
      compile: vi.fn(async () => ({ ...compileOperationValue(), javascript: exactProgram })),
    });
    await expect(execute(exactBytes.ctx, "workspace_typst_compile", compileInput()))
      .resolves.toMatchObject({ isError: false });
    expect((await stat(join(exactBytes.cwd, "typst-artifacts", "program.js"))).size)
      .toBe(MAX_TYPST_ARTIFACT_BYTES - diagnosticsBytes);

    const aboveBytes = await setup("allowed-once", {
      compile: vi.fn(async () => ({ ...compileOperationValue(), javascript: `${exactProgram}x` })),
    });
    await expect(execute(aboveBytes.ctx, "workspace_typst_compile", compileInput()))
      .resolves.toMatchObject({ isError: true, error: { info: { code: "workspace-typst-limit-exceeded" } } });
    expect(await readdir(aboveBytes.cwd)).toEqual(["paper-bundle"]);

    const exactPreviews = await setup("allowed-once", {
      apply: vi.fn(async (input) => {
        const previews = await writePreviews(input.previewDirectory!, MAX_TYPST_PREVIEWS);
        return { ...applyOperationValue(undefined), previews };
      }),
    });
    await expect(execute(exactPreviews.ctx, "workspace_typst_apply", applyInput()))
      .resolves.toMatchObject({ isError: false, value: { previews: { length: MAX_TYPST_PREVIEWS } } });

    const abovePreviews = await setup("allowed-once", {
      apply: vi.fn(async (input) => ({
        ...applyOperationValue(undefined),
        previews: await writePreviews(input.previewDirectory!, MAX_TYPST_PREVIEWS + 1),
      })),
    });
    await expect(execute(abovePreviews.ctx, "workspace_typst_apply", applyInput()))
      .resolves.toMatchObject({ isError: true, error: { info: { code: "workspace-typst-partial-side-effect" } } });
    expect(await readdir(abovePreviews.cwd)).toEqual(["paper-bundle"]);
  }, 15_000);

  it("stops stage creation after a settled filesystem call and removes the fresh private directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-typst-create-cancel-"));
    temporaryDirectories.push(root);
    let fences = 0;
    const signal = {
      get aborted() { return false; },
      throwIfAborted() {
        fences += 1;
        if (fences === 4) throw new Error("cancel after mkdtemp");
      },
    } as AbortSignal;

    await expect(createTypstArtifactStage(join(root, "artifacts"), false, signal))
      .rejects.toThrow("cancel after mkdtemp");
    expect(fences).toBe(4);
    expect(await readdir(root)).toEqual([]);
  });

  it("cleans only recorded identities with unlink and non-recursive rmdir", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-typst-artifacts-"));
    temporaryDirectories.push(root);
    const replaced = await createTypstArtifactStage(join(root, "replaced"), false, new AbortController().signal);
    await stageTypstArtifacts(
      replaced,
      compileOperationValue(),
      false,
      new AbortController().signal,
    );
    const replacedProgram = join(replaced.privateDirectory, "program.js");
    await unlink(replacedProgram);
    await writeFile(replacedProgram, "foreign");
    await cleanupTypstArtifactStage(replaced);
    expect(await readFile(replacedProgram, "utf8")).toBe("foreign");

    const committed = await createTypstArtifactStage(join(root, "committed"), false, new AbortController().signal);
    await stageTypstArtifacts(
      committed,
      compileOperationValue(),
      false,
      new AbortController().signal,
    );
    await commitTypstArtifactStage(committed, new AbortController().signal);
    await mkdir(committed.privateDirectory);
    await writeFile(join(committed.privateDirectory, "owner.txt"), "foreign");
    await cleanupTypstArtifactStage(committed);
    expect(await readFile(join(committed.privateDirectory, "owner.txt"), "utf8")).toBe("foreign");
    expect(await readdir(join(root, "committed"))).toEqual(["diagnostics.json", "program.js"]);
  });

  it("preserves unrecorded private preview files instead of scanning them into the cleanup ledger", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-typst-foreign-preview-"));
    temporaryDirectories.push(root);
    const stage = await createTypstArtifactStage(join(root, "artifacts"), true, new AbortController().signal);
    const foreign = join(stage.previewDirectory!, "foreign.png");
    await writeFile(foreign, "foreign-private-preview");

    await cleanupTypstArtifactStage(stage);

    expect(await readFile(foreign, "utf8")).toBe("foreign-private-preview");
  });

  it("detects same-inode size drift before public reservation and cleans only private owned paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-typst-size-drift-"));
    temporaryDirectories.push(root);
    const stage = await createTypstArtifactStage(join(root, "artifacts"), false, new AbortController().signal);
    await stageTypstArtifacts(stage, compileOperationValue(), false, new AbortController().signal);
    await truncate(join(stage.privateDirectory, "program.js"), MAX_TYPST_ARTIFACT_BYTES + 1);

    await expect(commitTypstArtifactStage(stage, new AbortController().signal))
      .rejects.toThrow("artifact file changed");
    await cleanupTypstArtifactStage(stage);

    expect(await readdir(root)).toEqual([]);
  });

  it("detects destination replacement and preserves both public locations", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-typst-destination-drift-"));
    temporaryDirectories.push(root);
    const stage = await createTypstArtifactStage(join(root, "artifacts"), false, new AbortController().signal);
    await stageTypstArtifacts(stage, compileOperationValue(), false, new AbortController().signal);
    const moved = join(root, "reserved-moved");
    const signal = filesystemFence(() => {
      if (!existsSync(stage.destination)) return false;
      renameSync(stage.destination, moved);
      mkdirSync(stage.destination, { mode: 0o700 });
      writeFileSync(join(stage.destination, "foreign.txt"), "foreign-directory");
      return true;
    });

    await expect(commitTypstArtifactStage(stage, signal)).rejects.toThrow("artifact identity changed");
    await cleanupTypstArtifactStage(stage);

    expect(await readFile(join(stage.destination, "foreign.txt"), "utf8")).toBe("foreign-directory");
    expect(await readdir(moved)).toEqual([]);
  });

  it("detects public file replacement and preserves the partial public directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-typst-file-drift-"));
    temporaryDirectories.push(root);
    const stage = await createTypstArtifactStage(join(root, "artifacts"), false, new AbortController().signal);
    await stageTypstArtifacts(stage, compileOperationValue(), false, new AbortController().signal);
    const program = join(stage.destination, "program.js");
    const signal = filesystemFence(() => {
      if (!existsSync(program)) return false;
      unlinkSync(program);
      writeFileSync(program, "foreign-program");
      return true;
    });

    await expect(commitTypstArtifactStage(stage, signal)).rejects.toThrow("artifact identity changed");
    await cleanupTypstArtifactStage(stage);

    expect(await readFile(program, "utf8")).toBe("foreign-program");
    expect(await readdir(stage.destination)).toEqual(["program.js"]);
  });

  it("detects a foreign public layout entry and performs no public cleanup", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-typst-layout-drift-"));
    temporaryDirectories.push(root);
    const stage = await createTypstArtifactStage(join(root, "artifacts"), false, new AbortController().signal);
    await stageTypstArtifacts(stage, compileOperationValue(), false, new AbortController().signal);
    const signal = filesystemFence(() => {
      if (!existsSync(stage.destination)) return false;
      writeFileSync(join(stage.destination, "foreign.txt"), "foreign-layout");
      return true;
    });

    await expect(commitTypstArtifactStage(stage, signal)).rejects.toThrow("unexpected Typst artifact layout");
    await cleanupTypstArtifactStage(stage);

    expect(await readFile(join(stage.destination, "foreign.txt"), "utf8")).toBe("foreign-layout");
  });

  it("never deletes public artifacts after a final-boundary failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-typst-publication-"));
    temporaryDirectories.push(root);
    const stage = await createTypstArtifactStage(join(root, "artifacts"), false, new AbortController().signal);
    await stageTypstArtifacts(stage, compileOperationValue(), false, new AbortController().signal);
    let fences = 0;
    const failingSignal = {
      get aborted() { return false; },
      throwIfAborted() {
        fences += 1;
        if (fences === 7) throw new Error("final boundary failed");
      },
    } as AbortSignal;
    await expect(commitTypstArtifactStage(stage, failingSignal)).rejects.toThrow("final boundary failed");
    expect(stage.committed).toBe(false);
    expect(await readdir(stage.destination)).toEqual(["diagnostics.json", "program.js"]);
    await unlink(join(stage.destination, "program.js"));
    await writeFile(join(stage.destination, "program.js"), "foreign");
    await cleanupTypstArtifactStage(stage);
    expect(await readdir(stage.destination)).toEqual(["diagnostics.json", "program.js"]);
    expect(await readFile(join(stage.destination, "program.js"), "utf8")).toBe("foreign");
  });
});

async function setup(
  approval: ApprovalOutcome | (() => Promise<ApprovalOutcome>),
  operations: {
    readonly apply?: WorkspaceTypstToolDependencies["apply"];
    readonly compile?: WorkspaceTypstToolDependencies["compile"];
  } = {},
  environment: {
    readonly filesystem?: "confining" | "non-local" | "tracing";
    readonly policy?: () => { readonly mode: "danger-full-access" | "read-only" | "workspace-write"; readonly workspaceRoot: string };
  } = {},
) {
  const cwd = await mkdtemp(join(tmpdir(), "dsh-typst-tools-"));
  temporaryDirectories.push(cwd);
  await mkdir(join(cwd, "paper-bundle"));
  await writeFile(join(cwd, "paper-bundle", "typst.json"), "{}", "utf8");
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolRuntime);
  if (environment.filesystem === "non-local") ctx.provide("fs", {} as FileSystem);
  else if (environment.filesystem === "confining") await ctx.plugin(ConfiningLocalFileSystem, { cwd });
  else if (environment.filesystem === "tracing") await ctx.plugin(TracingLocalFileSystem, { cwd });
  else await ctx.plugin(LocalFileSystem, { cwd });
  if (environment.policy !== undefined) {
    ctx.provide("sandboxPolicy", { resolve: environment.policy } as never);
  }
  await ctx.plugin(ApprovalService);
  const approvals: string[] = [];
  const approvalProcessPathCalls: number[] = [];
  ctx.on("approval/request", (request) => {
    approvals.push(request.reason ?? "");
    approvalProcessPathCalls.push(
      (ctx.get("fs") as Partial<TracingLocalFileSystem>).explicitProcessPathCalls ?? 0,
    );
    return typeof approval === "function" ? approval() : Promise.resolve(approval);
  });
  const compile = operations.compile ?? vi.fn(async () => compileOperationValue());
  const apply = operations.apply ?? vi.fn(async (input) => {
    if (input.previewDirectory !== undefined) {
      await writeFile(join(input.previewDirectory, "one.png"), "png");
    }
    return applyOperationValue(input.previewDirectory);
  });
  const owner = new WorkspaceToolOwner();
  const fiber = ctx.plugin({
    name: `dsh-univer-work-typst-test-${String(Math.random())}`,
    inject: ["fs", "tools"],
    apply(child: Context) {
      const unregister = registerWorkspaceTypstTools(child, { apply, compile, owner });
      return async () => {
        owner.stopAccepting();
        for (const dispose of [...unregister].reverse()) dispose();
        owner.abort();
        await owner.drain();
      };
    },
  });
  await fiber;
  return { apply, approvalProcessPathCalls, approvals, compile, ctx, cwd };
}

async function execute(
  ctx: Context,
  name: string,
  arguments_: unknown,
  agent = fakeAgent((ctx.get("fs") as LocalFileSystem).config.cwd),
  signal = new AbortController().signal,
) {
  return await ctx.tools.execute({
    agent: agent as never,
    arguments: arguments_,
    callId: CallId(`typst-${String(Math.random())}`),
    name,
    signal,
  });
}

class ConfiningLocalFileSystem extends LocalFileSystem {
  public override get sandboxMode(): "workspace-write" { return "workspace-write"; }
}

class TracingLocalFileSystem extends LocalFileSystem {
  public explicitProcessPathCalls = 0;

  public override processPath(target: Parameters<LocalFileSystem["processPath"]>[0]): string {
    if (new Error().stack?.includes("resolveTypstHostPaths") === true) {
      this.explicitProcessPathCalls += 1;
    }
    return super.processPath(target);
  }
}

function fakeAgent(cwd: string) {
  const id = SessionId(`typst-${String(Math.random())}`);
  const session = Session.create(id, [], { version: 0, createdAt: 0, cwd, id });
  session.append("turn/start", { turn: 1 });
  session.append("step/start", { turn: 1, step: 1 });
  return { session };
}

function directExecution() {
  const callId = CallId(`typst-direct-${String(Math.random())}`);
  return {
    arguments: {},
    callId,
    concludeTurn() {},
    deferContext() {},
    name: "workspace_typst_compile",
    rootCallId: callId,
    signal: new AbortController().signal,
    token: Symbol("typst") as never,
  };
}

function compileInput() {
  return { artifact_directory: "typst-artifacts", bundle_path: "paper-bundle" };
}

function applyInput(artifactDirectory = "typst-artifacts") {
  return {
    artifact_directory: artifactDirectory,
    bundle_path: "paper-bundle",
    idempotency_key: "request-1",
    parent_node_id: "parent-1",
    render_previews: true,
    space_id: "space-1",
    worktree_id: "worktree-1",
  };
}

function compileValue() {
  return {
    artifactDirectory: "typst-artifacts",
    committed: false as const,
    diagnostics: [{ reason: "Approximate mapping", severity: "warning" as const, sourcePath: "pages/one.typ" }],
    previews: [],
    targetUnitId: "compiled-doc",
    title: "Compiled paper",
  };
}

function applyValue(artifactDirectory = "typst-artifacts") {
  return {
    artifactDirectory,
    committed: true as const,
    diagnostics: [],
    previews: [{ pageId: "one", path: `${artifactDirectory}/previews/one.png`, sourcePath: "pages/one.typ" }],
    targetUnitId: "compiled-doc",
    title: "Compiled paper",
    unit: unit(),
  };
}

function compileOperationValue() {
  return {
    committed: false,
    diagnostics: compileValue().diagnostics,
    javascript: "generated-javascript-secret",
    previews: [],
    targetUnitId: "compiled-doc",
    title: "Compiled paper",
  };
}

function applyOperationValue(previewDirectory: string | undefined) {
  return {
    committed: true,
    diagnostics: [],
    javascript: "generated-javascript-secret",
    previews: previewDirectory === undefined ? [] : [{
      pageId: "one",
      path: join(previewDirectory, "one.png"),
      sourcePath: "pages/one.typ",
    }],
    targetUnitId: "compiled-doc",
    title: "Compiled paper",
    unit: unit(),
  };
}

async function writePreviews(previewDirectory: string, count: number) {
  return await Promise.all(Array.from({ length: count }, async (_, index) => {
    const path = join(previewDirectory, `${String(index).padStart(3, "0")}.png`);
    await writeFile(path, "");
    return { pageId: String(index), path, sourcePath: `pages/${String(index)}.typ` };
  }));
}

function filesystemFence(action: () => boolean): AbortSignal {
  let completed = false;
  return {
    get aborted() { return false; },
    throwIfAborted() {
      if (!completed) completed = action();
    },
  } as AbortSignal;
}

function installFilesystemFence(signal: AbortSignal, action: () => boolean): void {
  const original = signal.throwIfAborted.bind(signal);
  let completed = false;
  Object.defineProperty(signal, "throwIfAborted", {
    configurable: true,
    value() {
      original();
      if (!completed) completed = action();
    },
  });
}

function addForeignPublicEntry(destination: string, content: string): boolean {
  if (!existsSync(destination)) return false;
  writeFileSync(join(destination, "foreign.txt"), content);
  return true;
}

function unit() {
  return {
    activationState: "notApplicable" as const,
    change: "added" as const,
    draftHeadRevision: 0,
    mergeResult: "pending" as const,
    name: "Compiled paper",
    nodeId: "node-1",
    resourceId: "resource-1",
    source: "worktree" as const,
    target: { parentNodeId: "parent-1", spaceId: "space-1" },
    type: "doc" as const,
    unitId: "unit-1",
    worktreeId: "worktree-1",
  };
}

function unitWithJsonBytes(bytes: number) {
  const base = { ...unit(), name: "" };
  const fixed = Buffer.byteLength(JSON.stringify(base));
  return { ...base, name: "x".repeat(bytes - fixed) };
}
