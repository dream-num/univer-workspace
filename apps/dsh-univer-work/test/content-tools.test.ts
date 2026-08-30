import { Context } from "@deepseek-ai/cordis";
import AgentRegistry from "@deepseek-ai/dsh-agent";
import AgentLoop from "@deepseek-ai/dsh-agent-loop";
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
import LlmRuntime, { CallId, createUserMessage, HarnessError, LlmAdapter } from "@deepseek-ai/dsh-llm";
import CodeRuntime, {
  type CodeJsonValue,
  type CodeRunRequest,
  type CodeRunResult,
} from "@deepseek-ai/dsh-code-runtime";
import SessionStore, { Session, SessionId } from "@deepseek-ai/dsh-session";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime, { type ToolRunContext } from "@deepseek-ai/dsh-tools";
import ApprovalService, { type ApprovalOutcome } from "@deepseek-ai/dsh-user-approval";
import {
  CollaborationRuntimeError,
  UniverCollaborationRuntimePoolError,
  WorkspaceApplicationError,
  WorkspaceHttp,
  type WorkspaceContentRuntime,
  type WorkspaceContentRuntimeOptions,
} from "@univerjs/univer-workspace-client-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_CONTENT_ARGUMENT_BYTES,
  MAX_CONTENT_CANONICAL_BYTES,
  MAX_CONTENT_CODE_BYTES,
  MAX_CONTENT_JSON_DEPTH,
  projectWorkspaceContentDependencyFailure,
  registerWorkspaceContentTools,
  validateWorkspaceContentExecuteArgs,
  validateWorkspaceContentExecuteResult,
  validateWorkspaceContentInspectArgs,
  validateWorkspaceContentInspectionResult,
  workspaceContentInspectOutputSchema,
  workspaceContentInspectParameters,
  workspaceContentExecuteOutputSchema,
  workspaceContentExecuteParameters,
  type WorkspaceContentInspectArgs,
} from "../src/content-tools.js";
import {
  WorkspaceAuthenticationRequiredError,
  WorkspaceCredentialError,
} from "../src/authentication-state.js";
import { WorkspaceContentRuntimeGenerations } from "../src/content-runtime-generation.js";
import { WorkspaceToolOwner } from "../src/tool-owner.js";

const unitId = "unit-1";
const contexts: Context[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async (ctx) => await ctx.fiber.dispose()));
});

describe("Workspace content inspection arguments", () => {
  it("publishes the exact closed root and seven query branches", () => {
    expect(Object.keys(workspaceContentInspectParameters).sort()).toEqual([
      "query", "scope", "unit_id", "worktree_id",
    ]);
    expect(workspaceContentInspectParameters.query.oneOf).toHaveLength(7);
    expect(workspaceContentInspectOutputSchema.oneOf).toHaveLength(7);
    for (const branch of workspaceContentInspectParameters.query.oneOf) {
      expect(branch).toMatchObject({ additionalProperties: false, type: "object" });
    }
  });

  it("accepts every published query and zero-based selector", () => {
    const queries = [
      { kind: "workbook" },
      { kind: "worksheet", worksheets: [{ id: "sheet-1" }, { name: "Sheet 1" }, { index: 0 }] },
      { kind: "worksheet-range", ranges: [{ worksheet: { index: 0 }, range: "$A$1:B2" }] },
      { kind: "presentation" },
      { kind: "slide", slides: [{ id: "slide-1" }, { index: 0 }] },
      { kind: "document" },
      { kind: "paragraph", paragraphs: [{ id: "paragraph-1" }, { index: 0 }] },
    ];
    for (const query of queries) {
      expect(validateWorkspaceContentInspectArgs(args(query))).toMatchObject({ query });
    }
    expect(validateWorkspaceContentInspectArgs(args({ kind: "workbook" }, "worktree")))
      .toMatchObject({ scope: "worktree", worktree_id: "worktree-1" });
  });

  it("rejects conflicting scope keys and sparse selector arrays before authenticated work", () => {
    expectCode(() => validateWorkspaceContentInspectArgs({
      ...args({ kind: "workbook" }),
      worktree_id: undefined,
    }), "workspace-argument-invalid");
    expectCode(() => validateWorkspaceContentInspectArgs({
      ...args({ kind: "workbook" }, "worktree"),
      worktree_id: undefined,
    }), "workspace-argument-invalid");
    for (const [kind, key] of [
      ["worksheet", "worksheets"],
      ["slide", "slides"],
      ["paragraph", "paragraphs"],
    ] as const) {
      expectCode(() => validateWorkspaceContentInspectArgs(args({
        kind,
        [key]: new Array(1),
      })), "workspace-argument-invalid");
    }
    expectCode(() => validateWorkspaceContentInspectArgs(args({
      kind: "worksheet-range",
      ranges: new Array(1),
    })), "workspace-argument-invalid");
  });

  it("applies count, complete argument bytes, A1 grammar, and requested-cell limits in order", () => {
    expectCode(() => validateWorkspaceContentInspectArgs(args({
      kind: "worksheet",
      worksheets: Array.from({ length: 65 }, (_, index) => ({ index })),
    })), "workspace-content-limit-exceeded", "content-selectors");
    const huge = "x".repeat(MAX_CONTENT_ARGUMENT_BYTES);
    expectCode(() => validateWorkspaceContentInspectArgs({
      ...args({ kind: "workbook" }),
      unit_id: huge,
    }), "workspace-content-limit-exceeded", "content-arguments");
    expectCode(() => validateWorkspaceContentInspectArgs(args({
      kind: "worksheet-range",
      ranges: [{ worksheet: { index: 0 }, range: "A0" }],
    })), "INSPECTION_SELECTOR_INVALID");
    expectCode(() => validateWorkspaceContentInspectArgs(args({
      kind: "worksheet-range",
      ranges: [{ worksheet: { index: 0 }, range: "B2:A1" }],
    })), "INSPECTION_SELECTOR_INVALID");
    expectCode(() => validateWorkspaceContentInspectArgs(args({
      kind: "worksheet-range",
      ranges: [{ worksheet: { index: 0 }, range: `${"Z".repeat(20)}1` }],
    })), "workspace-content-limit-exceeded", "worksheet-cells");
    expectCode(() => validateWorkspaceContentInspectArgs(args({
      kind: "worksheet-range",
      ranges: [{ worksheet: { index: 0 }, range: "A1:A100001" }],
    })), "workspace-content-limit-exceeded", "worksheet-cells");
  });

  it("does not echo a malformed selector", () => {
    const sentinel = "selector-secret-sentinel";
    const error = capture(() => validateWorkspaceContentInspectArgs(args({
      kind: "worksheet-range",
      ranges: [{ worksheet: { index: 0 }, range: sentinel }],
    }))) as Error;
    expect(error).toMatchObject({ code: "INSPECTION_SELECTOR_INVALID" });
    expect(error.message).not.toContain(sentinel);
  });
});

describe("Workspace content dependency projection", () => {
  it("preserves the complete frozen allowlist with safe detail", () => {
    for (const code of [
      "workspace-argument-invalid",
      "workspace-authentication-required",
      "workspace-content-limit-exceeded",
      "workspace-content-partial-side-effect",
      "workspace-license-required",
      "workspace-origin-mismatch",
      "workspace-invalid-response",
      "workspace-result-mismatch",
      "workspace-result-unknown",
      "workspace-request-invalid",
      "workspace-redirect-refused",
      "workspace-submit-retry-exhausted",
      "workspace-worktree-not-editable",
      "workspace-unit-type-unsupported",
      "WORKSPACE_UNIT_NOT_FOUND",
      "WORKSPACE_RESPONSE_INVALID",
      "WORKSPACE_TARGET_INVALID",
      "WORKSPACE_TARGET_NOT_EDITABLE",
      "WORKSPACE_RUNTIME_DIRTY",
      "WORKSPACE_RUNTIME_CONFLICT",
      "WORKSPACE_RUNTIME_PULL_REQUIRED",
      "WORKSPACE_RUNTIME_COMMIT_INVALID",
      "WORKSPACE_RUNTIME_RESULT_INVALID",
      "WORKSPACE_CONTENT_UNIT_TYPE_UNSUPPORTED",
      "CONTENT_EXECUTION_INVALID_INPUT",
      "CONTENT_EXECUTION_RESERVED_BINDING",
      "CONTENT_EXECUTION_UNIT_TYPE_UNSUPPORTED",
      "INSPECTION_RANGE_OUT_OF_BOUNDS",
      "INSPECTION_RESULT_INVALID",
      "INSPECTION_SELECTOR_AMBIGUOUS",
      "INSPECTION_SELECTOR_INVALID",
      "INSPECTION_SELECTOR_NOT_FOUND",
      "INSPECTION_UNIT_TYPE_MISMATCH",
      "COLLABORATION_INVALID_INPUT",
      "COLLABORATION_LOAD_FAILED",
      "COLLABORATION_UNAVAILABLE",
      "COLLABORATION_PROTOCOL_ERROR",
      "COLLABORATION_CLOSED",
      "COLLABORATION_POOL_INVALID_INPUT",
      "COLLABORATION_POOL_CLOSED",
      "COLLABORATION_POOL_CAPACITY_EXCEEDED",
      "COLLABORATION_LEASE_CLOSED",
      "COLLABORATION_WORKER_OPEN_TIMEOUT",
      "COLLABORATION_WORKER_OPERATION_TIMEOUT",
      "COLLABORATION_WORKER_CRASHED",
      "COLLABORATION_WORKER_PROTOCOL_ERROR",
      "COLLABORATION_WORKER_CLOSED",
      "UNAUTHENTICATED",
      "INVALID_INPUT",
      "FORBIDDEN",
      "NOT_FOUND",
      "CONFLICT",
      "INTERNAL_ERROR",
    ]) {
      expect(projectWorkspaceContentDependencyFailure(
        new WorkspaceApplicationError(code, "dependency-sentinel", {
          path: "/safe/path",
          status: 409,
          cause: "dependency-sentinel",
        }),
      )).toEqual({ code, detail: { path: "/safe/path", status: 409 } });
    }
  });

  it("requires exact dependency constructors and projects owner validation", () => {
    expect(projectWorkspaceContentDependencyFailure(
      new WorkspaceAuthenticationRequiredError(),
    )).toEqual({ code: "workspace-authentication-required" });
    expect(projectWorkspaceContentDependencyFailure(
      new WorkspaceCredentialError(),
    )).toEqual({ code: "workspace-authentication-required" });
    expect(projectWorkspaceContentDependencyFailure(
      new HarnessError("counterfeit", "FORBIDDEN"),
    )).toBeUndefined();
    expect(projectWorkspaceContentDependencyFailure(
      new WorkspaceApplicationError("UNLISTED_SENTINEL", "secret"),
    )).toBeUndefined();

    let validationFailure: unknown;
    try {
      validateWorkspaceContentExecuteArgs({});
    } catch (error) {
      validationFailure = error;
    }
    expect(projectWorkspaceContentDependencyFailure(validationFailure)).toEqual({
      code: "workspace-argument-invalid",
    });
  });
});

describe("Workspace content inspection results", () => {
  it("accepts all seven complete published discriminants", () => {
    const cases: Array<[WorkspaceContentInspectArgs, unknown]> = [
      [validated({ kind: "workbook" }), workbookResult()],
      [validated({ kind: "worksheet", worksheets: [{ index: 0 }] }), worksheetResult()],
      [validated({ kind: "worksheet-range", ranges: [{ worksheet: { index: 0 }, range: "A1" }] }), rangeResult()],
      [validated({ kind: "presentation" }), presentationResult()],
      [validated({ kind: "slide", slides: [{ index: 0 }] }), slideResult()],
      [validated({ kind: "document" }), documentResult()],
      [validated({ kind: "paragraph", paragraphs: [{ index: 0 }] }), paragraphResult()],
    ];
    for (const [input, result] of cases) {
      expect(() => validateWorkspaceContentInspectionResult(input, result)).not.toThrow();
    }
  });

  it.each([
    [validated({ kind: "worksheet", worksheets: [{ id: "expected" }] }), worksheetResult({ id: "other" })],
    [validated({ kind: "worksheet-range", ranges: [{ worksheet: { name: "Expected" }, range: "A1" }] }), rangeResult({ name: "Other" })],
    [validated({ kind: "slide", slides: [{ id: "expected" }] }), slideResult({ id: "other" })],
    [validated({ kind: "paragraph", paragraphs: [{ index: 2 }] }), paragraphResult({ index: 0 })],
  ])("rejects a result for the wrong ordered selector", (input, result) => {
    expectCode(() => validateWorkspaceContentInspectionResult(input, result), "INSPECTION_RESULT_INVALID");
  });

  it("rejects wrong Unit identity, nested unknown keys, and non-ICellData keys", () => {
    expectCode(() => validateWorkspaceContentInspectionResult(
      validated({ kind: "workbook" }),
      { ...workbookResult(), unitId: "other" },
    ), "INSPECTION_RESULT_INVALID");
    const unknown = workbookResult();
    unknown.worksheets[0]!.drawings = { ...unknown.worksheets[0]!.drawings, secret: true } as never;
    expectCode(() => validateWorkspaceContentInspectionResult(validated({ kind: "workbook" }), unknown),
      "INSPECTION_RESULT_INVALID");
    const cell = rangeResult();
    cell.ranges[0]!.cellData = [[{ unknownKey: "secret" }]];
    expectCode(() => validateWorkspaceContentInspectionResult(
      validated({ kind: "worksheet-range", ranges: [{ worksheet: { index: 0 }, range: "A1" }] }),
      cell,
    ), "INSPECTION_RESULT_INVALID");
    for (const invalid of [{ v: { nested: true } }, { f: 42 }, { t: "wrong" }, { t: 5 }, { p: "wrong" }]) {
      const primitive = rangeResult();
      primitive.ranges[0]!.cellData = [[invalid]];
      expectCode(() => validateWorkspaceContentInspectionResult(
        validated({ kind: "worksheet-range", ranges: [{ worksheet: { index: 0 }, range: "A1" }] }),
        primitive,
      ), "INSPECTION_RESULT_INVALID");
    }
    const ownUndefined = slideResult();
    (ownUndefined.slides[0]! as unknown as Record<string, unknown>)["textPreview"] = undefined;
    expectCode(() => validateWorkspaceContentInspectionResult(
      validated({ kind: "slide", slides: [{ index: 0 }] }),
      ownUndefined,
    ), "INSPECTION_RESULT_INVALID");
  });

  it("accepts Slide children at depth 64 and rejects depth 65 or a deep unknown key", () => {
    const input = validated({ kind: "slide", slides: [{ index: 0 }] });
    expect(() => validateWorkspaceContentInspectionResult(input, slideResult({}, nestedElement(64))))
      .not.toThrow();
    expectCode(() => validateWorkspaceContentInspectionResult(input, slideResult({}, nestedElement(65))),
      "workspace-content-limit-exceeded", "content-depth");
    const deep = nestedElement(8);
    let cursor = deep;
    while (cursor.children?.[0] !== undefined) cursor = cursor.children[0];
    (cursor as unknown as Record<string, unknown>)["unknown"] = true;
    expectCode(() => validateWorkspaceContentInspectionResult(input, slideResult({}, deep)),
      "INSPECTION_RESULT_INVALID");
  });

  it("rejects non-lossless JSON and complete canonical output above 8 MiB without truncation", () => {
    const paragraph = paragraphResult();
    paragraph.paragraphs[0]!.textRuns = [Number.NaN];
    expectCode(() => validateWorkspaceContentInspectionResult(
      validated({ kind: "paragraph", paragraphs: [{ index: 0 }] }),
      paragraph,
    ), "INSPECTION_RESULT_INVALID");
    expectCode(() => validateWorkspaceContentInspectionResult(
      validated({ kind: "workbook" }),
      workbookResult("x".repeat(MAX_CONTENT_CANONICAL_BYTES)),
    ), "workspace-content-limit-exceeded", "content-output");
  });
});

describe("Workspace content execution validation", () => {
  it("publishes only the three closed arguments and two closed outcomes", () => {
    expect(Object.keys(workspaceContentExecuteParameters).sort()).toEqual(["code", "unit_id", "worktree_id"]);
    expect(workspaceContentExecuteOutputSchema.oneOf).toHaveLength(2);
    for (const branch of workspaceContentExecuteOutputSchema.oneOf) {
      expect(branch).toMatchObject({ additionalProperties: false, type: "object" });
    }
  });

  it("validates exact nonblank keys, complete argument bytes, then code bytes", () => {
    expect(validateWorkspaceContentExecuteArgs(executeArgs())).toEqual(executeArgs());
    for (const invalid of [
      { ...executeArgs(), code: "" },
      { ...executeArgs(), unit_id: " " },
      { ...executeArgs(), script: "file.ts" },
      { ...executeArgs(), code: undefined },
    ]) expectCode(() => validateWorkspaceContentExecuteArgs(invalid), "workspace-argument-invalid");
    expectCode(() => validateWorkspaceContentExecuteArgs({
      ...executeArgs(),
      unit_id: "u".repeat(MAX_CONTENT_ARGUMENT_BYTES),
    }), "workspace-content-limit-exceeded", "content-arguments");
    expectCode(() => validateWorkspaceContentExecuteArgs({
      ...executeArgs(),
      code: "x".repeat(MAX_CONTENT_CODE_BYTES + 1),
    }), "workspace-content-limit-exceeded", "content-code");
  });

  it("accepts only lossless bounded no-mutation or committed envelopes", () => {
    expect(() => validateWorkspaceContentExecuteResult({ committed: false, value: { answer: 42 } }))
      .not.toThrow();
    expect(() => validateWorkspaceContentExecuteResult({
      committed: true,
      revision: 2,
      status: "committed",
      value: ["ok"],
    })).not.toThrow();
    for (const invalid of [
      { committed: false, value: null, revision: 1 },
      { committed: true, revision: 0, status: "committed", value: null },
      { committed: true, revision: 1, status: "other", value: null },
      { committed: false, value: BigInt(1) },
      { committed: false, value: undefined },
    ]) expectCode(() => validateWorkspaceContentExecuteResult(invalid), "WORKSPACE_RUNTIME_RESULT_INVALID");
    expect(() => validateWorkspaceContentExecuteResult({
      committed: false,
      value: nestedJson(MAX_CONTENT_JSON_DEPTH),
    })).not.toThrow();
    expectCode(() => validateWorkspaceContentExecuteResult({
      committed: false,
      value: nestedJson(MAX_CONTENT_JSON_DEPTH + 1),
    }), "workspace-content-limit-exceeded", "content-depth");
    expectCode(() => validateWorkspaceContentExecuteResult({
      committed: false,
      value: "x".repeat(MAX_CONTENT_CANONICAL_BYTES),
    }), "workspace-content-limit-exceeded", "content-output");
  });
});

describe("Workspace content inspection ToolRuntime", () => {
  it("returns the same validated canonical value through the real Native runtime", async () => {
    const expected = worksheetResult();
    const { ctx, runtime } = await setupContentTool(expected);
    const result = await executeTool(ctx, args({ kind: "worksheet", worksheets: [{ index: 0 }] }, "worktree"));

    expect(result).toMatchObject({ isError: false, value: expected });
    expect(runtime.executeRead).toHaveBeenCalledTimes(1);
    expect(runtime.executeRead.mock.calls[0]?.[0]).toMatchObject({
      target: {
        revision: 0,
        scope: { kind: "worktree", worktreeId: "worktree-1" },
        unitId,
        unitType: "sheet",
      },
    });
  });

  it("resolves an authoritative Trunk target without Worktree access", async () => {
    const expected = workbookResult();
    const { ctx, requests, runtime } = await setupContentTool(expected, undefined, false, true);
    const result = await executeTool(ctx, args({ kind: "workbook" }));

    expect(result).toMatchObject({ isError: false, value: expected });
    expect(requests).toEqual(["/universer-api/snapshot/2/unit/unit-1/rev/0"]);
    expect(runtime.executeRead.mock.calls[0]?.[0]).toMatchObject({
      target: { revision: 0, scope: { kind: "trunk" }, unitId, unitType: "sheet" },
    });
  });

  it("rejects oversized arguments before authenticated HTTP or runtime generation", async () => {
    const { ctx, creates, requests } = await setupContentTool(worksheetResult());
    const result = await executeTool(ctx, {
      ...args({ kind: "workbook" }),
      unit_id: "x".repeat(MAX_CONTENT_ARGUMENT_BYTES),
    });

    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-content-limit-exceeded" } },
    });
    expect(creates).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });

  it("awaits an in-flight read that ignores abort, then returns caller cancellation", async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const { ctx } = await setupContentTool(worksheetResult(), async () => {
      entered.resolve();
      await release.promise;
      return { value: { ok: true, value: worksheetResult() } } as never;
    });
    const controller = new AbortController();
    const pending = executeTool(
      ctx,
      args({ kind: "worksheet", worksheets: [{ index: 0 }] }, "worktree"),
      controller.signal,
    );
    await entered.promise;
    controller.abort(new Error("caller-secret-sentinel"));
    await Promise.resolve();
    let settled = false;
    void pending.finally(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    release.resolve();

    const result = await pending;
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-operation-cancelled" } },
    });
    expect(JSON.stringify(result)).not.toContain("caller-secret-sentinel");
  });

  it("maps owner disposal separately and waits for the accepted read and generation close", async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const { ctx, dispose, runtime } = await setupContentTool(worksheetResult(), async () => {
      entered.resolve();
      await release.promise;
      return { value: { ok: true, value: worksheetResult() } } as never;
    });
    const pending = executeTool(
      ctx,
      args({ kind: "worksheet", worksheets: [{ index: 0 }] }, "worktree"),
    );
    await entered.promise;
    const disposing = dispose();
    await Promise.resolve();
    expect(runtime.close).not.toHaveBeenCalled();
    release.resolve();

    const result = await pending;
    await disposing;
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-plugin-disposing" } },
    });
    expect(runtime.close).toHaveBeenCalledTimes(1);
  });

  it("returns the same canonical value through real Code Mode dispatch", async () => {
    const expected = worksheetResult();
    const { codeRuntime, ctx, runtime } = await setupContentTool(expected, undefined, true);
    codeRuntime!.dispatches = [{
      name: "workspace_content_inspect",
      arguments: args({ kind: "worksheet", worksheets: [{ index: 0 }] }, "worktree"),
    }];
    const { agent, session } = fakeAgent();
    const result = await ctx.tools.execute({
      agent: agent as never,
      arguments: {
        code: "return await tools.workspace_content_inspect({});",
        description: "Inspect Workspace content",
      },
      callId: CallId("content-code-mode"),
      name: "run_code",
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      isError: false,
      value: { result: [expected] },
    });
    expect(runtime.executeRead).toHaveBeenCalledTimes(1);
    const starts = session.events.filter((event) => event.type === "tool/code-dispatch-start");
    const settled = session.events.filter((event) => event.type === "tool/code-dispatch");
    expect(starts).toHaveLength(1);
    expect(settled).toHaveLength(1);
    expect(settled[0]!.data).toMatchObject({
      name: "workspace_content_inspect",
      subCallId: (starts[0]!.data as { subCallId: string }).subCallId,
    });
  });
});

describe("Workspace content execution ToolRuntime", () => {
  it("rejects invalid and oversized arguments before approval, HTTP, or generation", async () => {
    const { approvalRequests, creates, ctx, requests, runtime } = await setupContentTool(
      worksheetResult(),
      undefined,
      false,
      false,
      { approval: "allowed-once" },
    );
    const agent = fakeAgent().agent;
    for (const invalid of [
      { ...executeArgs(), cookie: "rejected-sentinel" },
      { ...executeArgs(), code: "x".repeat(MAX_CONTENT_CODE_BYTES + 1) },
    ]) {
      const result = await executeContentTool(ctx, invalid, undefined, agent);
      expect(result.isError).toBe(true);
    }
    expect(approvalRequests).toEqual([]);
    expect(creates).toEqual([]);
    expect(requests).toEqual([]);
    expect(runtime.executeAndCommit).not.toHaveBeenCalled();
  });

  it("fails closed when approval is rejected or unavailable", async () => {
    for (const approval of ["rejected" as const, "cancelled" as const, "unavailable" as const, undefined]) {
      const { creates, ctx, requests, runtime } = await setupContentTool(
        worksheetResult(),
        undefined,
        false,
        false,
        approval === undefined ? {} : { approval },
      );
      const result = await executeContentTool(ctx, executeArgs(), undefined, fakeAgent().agent);
      expect(result.isError).toBe(true);
      expect(creates).toEqual([]);
      expect(requests).toEqual([]);
      expect(runtime.executeAndCommit).not.toHaveBeenCalled();
    }
  });

  it("repeats pure validation in the accepted definition body", async () => {
    const { approvalRequests, creates, ctx, requests, runtime } = await setupContentTool(
      worksheetResult(),
      undefined,
      false,
      false,
      { approval: "allowed-once" },
    );
    await expect(ctx.tools.get("workspace_content_execute")!.execute(
      { ...executeArgs(), cookie: "accepted-body-sentinel" },
      directExecution("workspace_content_execute"),
    )).rejects.toMatchObject({ code: "workspace-argument-invalid" });
    expect(approvalRequests).toHaveLength(0);
    expect(creates).toEqual([]);
    expect(requests).toEqual([]);
    expect(runtime.executeAndCommit).not.toHaveBeenCalled();
  });

  it("keeps already-aborted dispatch in DSH with zero plugin work", async () => {
    const { approvalRequests, creates, ctx, requests, runtime } = await setupContentTool(
      worksheetResult(),
      undefined,
      false,
      false,
      { approval: "allowed-once" },
    );
    const controller = new AbortController();
    controller.abort(new Error("already-aborted-sentinel"));
    const result = await executeContentTool(ctx, executeArgs(), controller.signal, fakeAgent().agent);

    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "ABORTED_BEFORE_DISPATCH" } },
    });
    expect(approvalRequests).toEqual([]);
    expect(creates).toEqual([]);
    expect(requests).toEqual([]);
    expect(runtime.executeAndCommit).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("already-aborted-sentinel");
  });

  it("asks once with fixed text and returns a canonical no-mutation value", async () => {
    const executeAndCommit = vi.fn<WorkspaceContentRuntime["executeAndCommit"]>(async () => ({
      committed: false,
      value: { answer: 42 },
    }));
    const { approvalRequests, ctx } = await setupContentTool(
      worksheetResult(),
      undefined,
      false,
      false,
      { approval: "allowed-once", executeAndCommit },
    );
    const result = await executeContentTool(ctx, executeArgs(), undefined, fakeAgent().agent);

    expect(result).toMatchObject({ isError: false, value: { committed: false, value: { answer: 42 } } });
    expect(approvalRequests).toEqual(["Workspace content execution may change remote Draft content."]);
    expect(JSON.stringify(approvalRequests)).not.toMatch(/unit-1|worktree-1|return|cookie|license/u);
    expect(executeAndCommit).toHaveBeenCalledTimes(1);
    expect(executeAndCommit.mock.calls[0]?.[0]).toMatchObject({
      maxValueBytes: 8_388_000,
      maxValueDepth: 64,
      target: { scope: { kind: "worktree", worktreeId: "worktree-1" }, unitId },
    });
  });

  it("returns only the confirmed committed envelope", async () => {
    const { ctx } = await setupContentTool(worksheetResult(), undefined, false, false, {
      approval: "allowed-once",
      executeAndCommit: async () => ({ committed: true, revision: 3, status: "committed", value: "done" }),
    });
    const result = await executeContentTool(ctx, executeArgs(), undefined, fakeAgent().agent);
    expect(result).toMatchObject({
      isError: false,
      value: { committed: true, revision: 3, status: "committed", value: "done" },
    });
  });

  it.each(["caller", "owner"] as const)(
    "settles %s cancellation before a confirmed mutation without a later result",
    async (source) => {
      const entered = deferred<void>();
      const { ctx, dispose, runtime } = await setupContentTool(worksheetResult(), undefined, false, false, {
        approval: "allowed-once",
        executeAndCommit: async ({ signal }) => {
          entered.resolve();
          await new Promise<void>((resolve) => signal!.addEventListener("abort", () => resolve(), { once: true }));
          signal!.throwIfAborted();
          throw new Error("unreachable");
        },
      });
      const controller = new AbortController();
      const pending = executeContentTool(ctx, executeArgs(), controller.signal, fakeAgent().agent);
      await entered.promise;
      const disposing = source === "owner" ? dispose() : undefined;
      if (source === "caller") controller.abort(new Error("pre-mutation-caller-sentinel"));

      await expect(pending).resolves.toMatchObject({
        isError: true,
        error: {
          info: {
            code: source === "owner" ? "workspace-plugin-disposing" : "workspace-operation-cancelled",
          },
        },
      });
      await disposing;
      expect(runtime.executeAndCommit).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["workspace-content-partial-side-effect", {
      effect: "embedded-image-upload",
      confirmedUploadCount: 1,
      contentCommitted: false,
      target: {
        origin: "https://credential-sentinel.test",
        revision: 0,
        scope: { kind: "worktree", worktreeId: "worktree-1" },
        unitId,
        unitType: "sheet",
        unsafe: "dependency-sentinel",
      },
    }],
    ["workspace-result-unknown", {
      target: {
        origin: "https://credential-sentinel.test",
        revision: 0,
        scope: { kind: "worktree", worktreeId: "worktree-1" },
        unitId,
        unitType: "sheet",
      },
      changeset: { baseRevision: 0, mutationCount: 1, reqId: "req-1", sid: "sid-1", unsafe: "dependency-sentinel" },
      cause: "dependency-sentinel",
    }],
  ])("preserves thrown %s under caller cancellation with safe guidance", async (code, detail) => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const { ctx } = await setupContentTool(worksheetResult(), undefined, false, false, {
      approval: "allowed-once",
      executeAndCommit: async () => {
        entered.resolve();
        await release.promise;
        throw new WorkspaceApplicationError(code, "dependency-sentinel", detail, {
          cause: new Error("credential-sentinel"),
        });
      },
    });
    const controller = new AbortController();
    const pending = executeContentTool(ctx, executeArgs(), controller.signal, fakeAgent().agent);
    await entered.promise;
    controller.abort(new Error("caller-sentinel"));
    release.resolve();

    const result = await pending;
    expect(result).toMatchObject({ isError: true, error: { info: { code } } });
    const transcript = JSON.stringify(result);
    expect(transcript).toMatch(/workspace_worktree_get.*workspace_content_inspect.*Never replay/u);
    expect(transcript).not.toMatch(/credential-sentinel|dependency-sentinel|caller-sentinel|https:\/\//u);
  });

  it.each([
    ["workspace-content-partial-side-effect", {
      effect: "embedded-image-upload",
      confirmedUploadCount: 1,
      contentCommitted: false,
      target: {
        origin: "https://credential-sentinel.test",
        revision: 0,
        scope: { kind: "worktree", worktreeId: "worktree-1" },
        unitId,
        unitType: "sheet",
      },
    }],
    ["workspace-result-unknown", {
      effect: "embedded-image-upload",
      target: {
        origin: "https://credential-sentinel.test",
        revision: 0,
        scope: { kind: "worktree", worktreeId: "worktree-1" },
        unitId,
        unitType: "sheet",
      },
    }],
  ])("preserves owner-only %s while disposal drains", async (code, detail) => {
    const entered = deferred<void>();
    const { ctx, dispose, runtime } = await setupContentTool(worksheetResult(), undefined, false, false, {
      approval: "allowed-once",
      executeAndCommit: async ({ signal }) => {
        entered.resolve();
        await new Promise<void>((resolve) => signal!.addEventListener("abort", () => resolve(), { once: true }));
        throw new WorkspaceApplicationError(code, "dependency-sentinel", detail);
      },
    });
    const pending = executeContentTool(ctx, executeArgs(), undefined, fakeAgent().agent);
    await entered.promise;
    const disposing = dispose();

    const result = await pending;
    expect(result).toMatchObject({ isError: true, error: { info: { code } } });
    expect(JSON.stringify(result)).toMatch(/workspace_content_inspect.*Never replay/u);
    expect(JSON.stringify(result)).not.toMatch(/credential-sentinel|dependency-sentinel|https:\/\//u);
    await disposing;
    expect(runtime.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["FORBIDDEN", { status: 403, path: "/api/worktrees/public-id", headers: { cookie: "secret" } }],
    ["CONTENT_EXECUTION_INVALID_INPUT", { unsafe: "dependency-sentinel" }],
    ["CONTENT_EXECUTION_RESERVED_BINDING", { unsafe: "dependency-sentinel" }],
    ["WORKSPACE_TARGET_NOT_EDITABLE", {
      actualUnitType: "sheet",
      selectedRevision: 4,
      target: {
        origin: "https://credential-sentinel.test",
        revision: 3,
        scope: { kind: "worktree", worktreeId: "worktree-public" },
        unitId: "unit-public",
        unitType: "sheet",
      },
    }],
    ["CONTENT_EXECUTION_UNIT_TYPE_UNSUPPORTED", {
      actualUnitType: "sheet",
      supportedUnitType: "doc",
      unsafe: "dependency-sentinel",
    }],
    ["WORKSPACE_RUNTIME_CONFLICT", {
      selectedRevision: 4,
      target: {
        origin: "https://credential-sentinel.test",
        revision: 3,
        scope: { kind: "worktree", worktreeId: "worktree-public" },
        unitId: "unit-public",
        unitType: "sheet",
        unsafe: "dependency-sentinel",
      },
    }],
  ])("preserves allowlisted %s with only safe detail", async (code, detail) => {
    const { ctx } = await setupContentTool(worksheetResult(), undefined, false, false, {
      approval: "allowed-once",
      executeAndCommit: async () => {
        throw new WorkspaceApplicationError(code, "dependency-sentinel", detail, {
          cause: new Error("credential-sentinel"),
        });
      },
    });
    const result = await executeContentTool(ctx, executeArgs(), undefined, fakeAgent().agent);
    expect(result).toMatchObject({ isError: true, error: { info: { code } } });
    const transcript = JSON.stringify(result);
    expect(transcript).not.toMatch(/credential-sentinel|dependency-sentinel|https:\/\/|cookie/u);
    if (code === "FORBIDDEN") expect(transcript).toMatch(/403.*\/api\/worktrees\/public-id/u);
    if (code === "WORKSPACE_RUNTIME_CONFLICT" || code === "WORKSPACE_TARGET_NOT_EDITABLE") {
      expect(transcript).toMatch(/worktree-public.*unit-public/u);
    }
  });

  it("maps an unlisted dependency failure to the fixed generic code", async () => {
    const { ctx } = await setupContentTool(worksheetResult(), undefined, false, false, {
      approval: "allowed-once",
      executeAndCommit: async () => {
        throw new WorkspaceApplicationError("UNLISTED_SENTINEL", "dependency-sentinel", {
          target: { worktreeId: "unsafe-public-looking-id" },
        });
      },
    });
    const result = await executeContentTool(ctx, executeArgs(), undefined, fakeAgent().agent);
    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: "workspace-content-operation-failed" } },
    });
    expect(JSON.stringify(result)).not.toMatch(/UNLISTED_SENTINEL|dependency-sentinel|unsafe-public-looking-id/u);
  });

  it.each([
    new CollaborationRuntimeError("COLLABORATION_PROTOCOL_ERROR", "runtime-secret-sentinel", {
      cause: new Error("runtime-cause-sentinel"),
    }),
    new UniverCollaborationRuntimePoolError("COLLABORATION_WORKER_CRASHED", "pool-secret-sentinel", {
      cause: new Error("pool-cause-sentinel"),
    }),
  ])("preserves the real frozen %s constructor code without source material", async (failure) => {
    const { ctx } = await setupContentTool(worksheetResult(), undefined, false, false, {
      approval: "allowed-once",
      executeAndCommit: async () => { throw failure; },
    });
    const result = await executeContentTool(ctx, executeArgs(), undefined, fakeAgent().agent);
    expect(result).toMatchObject({ isError: true, error: { info: { code: failure.code } } });
    expect(JSON.stringify(result)).not.toMatch(/runtime-secret|runtime-cause|pool-secret|pool-cause/u);
  });

  it.each([
    { committed: false, value: undefined },
    { committed: true, revision: 1, status: "retry", value: null },
    { committed: false, value: "x".repeat(MAX_CONTENT_CANONICAL_BYTES) },
  ])("rejects an invalid or oversized Core envelope before rendering", async (envelope) => {
    const { ctx } = await setupContentTool(worksheetResult(), undefined, false, false, {
      approval: "allowed-once",
      executeAndCommit: async () => envelope as never,
    });
    const result = await executeContentTool(ctx, executeArgs(), undefined, fakeAgent().agent);
    expect(result.isError).toBe(true);
    expect(result.error?.info?.code).toMatch(/WORKSPACE_RUNTIME_RESULT_INVALID|workspace-content-limit-exceeded/u);
  });

  it("lets rc.2 replace caller-late confirmed success with ABORTED and fixed no-replay guidance", async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const { ctx } = await setupContentTool(worksheetResult(), undefined, false, false, {
      approval: "allowed-once",
      executeAndCommit: async () => {
        entered.resolve();
        await release.promise;
        return { committed: true, revision: 4, status: "committed", value: "done" };
      },
    });
    const controller = new AbortController();
    const pending = executeContentTool(ctx, executeArgs(), controller.signal, fakeAgent().agent);
    await entered.promise;
    controller.abort(new Error("caller-sentinel"));
    release.resolve();

    const result = await pending;
    expect(result).toMatchObject({ isError: true, error: { info: { code: "ABORTED" } } });
    expect(JSON.stringify(result)).toMatch(/workspace_worktree_get.*workspace_content_inspect.*Never replay/u);
  });

  it("allows owner-only confirmed success while disposal drains and closes", async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const { ctx, dispose, runtime } = await setupContentTool(worksheetResult(), undefined, false, false, {
      approval: "allowed-once",
      executeAndCommit: async () => {
        entered.resolve();
        await release.promise;
        return { committed: true, revision: 5, status: "committed", value: "done" };
      },
    });
    const pending = executeContentTool(ctx, executeArgs(), undefined, fakeAgent().agent);
    await entered.promise;
    const disposing = dispose();
    release.resolve();

    await expect(pending).resolves.toMatchObject({ isError: false, value: { revision: 5 } });
    await disposing;
    expect(runtime.close).toHaveBeenCalledTimes(1);
  });

  it("dispatches approved execution through real Code Mode with the canonical value", async () => {
    const codeSentinel = "caller-code-mode-sentinel";
    const { approvalRequests, codeRuntime, ctx } = await setupContentTool(
      worksheetResult(),
      undefined,
      true,
      false,
      {
        approval: "allowed-once",
        executeAndCommit: async () => ({ committed: false, value: { mode: "code" } }),
      },
    );
    codeRuntime!.dispatches = [{
      name: "workspace_content_execute",
      arguments: executeArgs({ code: `return ${JSON.stringify(codeSentinel)};` }),
    }];
    const { agent, session } = fakeAgent();
    const result = await ctx.tools.execute({
      agent: agent as never,
      arguments: { code: "return await execute();", description: "Execute Workspace Draft content" },
      callId: CallId("content-execute-code-mode"),
      name: "run_code",
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      isError: false,
      value: { result: [{ committed: false, value: { mode: "code" } }] },
    });
    expect(approvalRequests).toHaveLength(1);
    const starts = session.events.filter((event) => event.type === "tool/code-dispatch-start");
    const settled = session.events.filter((event) => event.type === "tool/code-dispatch");
    expect(JSON.stringify(starts)).toContain(codeSentinel);
    expect(JSON.stringify(settled)).toContain(codeSentinel);
    expect(settled[0]!.data).toMatchObject({
      name: "workspace_content_execute",
      subCallId: (starts[0]!.data as { subCallId: string }).subCallId,
    });
    const pluginSurfaces = JSON.stringify({
      result,
      approvalRequests,
      events: session.events.map((event) => {
        if (event.type === "tool/code-dispatch-start" || event.type === "tool/code-dispatch") {
          const { arguments: _arguments, ...data } = event.data;
          return { ...event, data };
        }
        return event;
      }),
    });
    expect(pluginSurfaces).not.toContain(codeSentinel);
  });

  it("keeps Native caller code in DSH-owned records and out of plugin-owned content", async () => {
    const codeSentinel = "caller-native-code-sentinel";
    const { approvalRequests, ctx } = await setupContentTool(
      worksheetResult(),
      undefined,
      false,
      false,
      {
        approval: "allowed-once",
        executeAndCommit: async () => ({ committed: false, value: { ok: true } }),
        nativeAgent: true,
      },
    );
    class NativeContentAdapter extends LlmAdapter {
      private calls = 0;

      public override resolveModel(provider: string, model: string) {
        return Promise.resolve({ provider, id: model, name: model });
      }

      public override async * stream() {
        if (this.calls++ === 0) {
          yield { type: "block-start" as const, index: 0, blockType: "tool-call" as const };
          yield {
            type: "block-end" as const,
            index: 0,
            block: {
              type: "tool-call" as const,
              id: CallId("native-content-execute"),
              name: "workspace_content_execute",
              arguments: JSON.stringify(executeArgs({ code: `return ${JSON.stringify(codeSentinel)};` })),
            },
          };
          yield { type: "usage" as const, usage: { inputTokens: 1, outputTokens: 1 } };
          yield { type: "finish" as const, reason: { kind: "tool-calls" as const } };
          return;
        }
        yield { type: "block-start" as const, index: 0, blockType: "text" as const };
        yield { type: "text-delta" as const, index: 0, text: "done" };
        yield { type: "block-end" as const, index: 0, block: { type: "text" as const, text: "done" } };
        yield { type: "usage" as const, usage: { inputTokens: 1, outputTokens: 1 } };
        yield { type: "finish" as const, reason: { kind: "stop" as const } };
      }
    }
    ctx.llm.registerAdapter(["native-content"], new NativeContentAdapter());
    await ctx.plugin(AgentLoop, { agents: [] });
    const agent = ctx.agentLoop.create(SessionId("native-content-execute"), {
      provider: "native-content",
      model: "native-content",
    });
    agent.followup(createUserMessage({
      content: [{ type: "text", text: "Execute approved Draft content." }],
      source: { kind: "user" },
    }));
    await agent.whenIdle();

    const calls = agent.session.events.filter((event) => event.type === "tool/call");
    expect(JSON.stringify(calls)).toContain(codeSentinel);
    expect(approvalRequests).toHaveLength(1);
    const pluginSurfaces = JSON.stringify({
      approvalRequests,
      events: agent.session.events.filter((event) =>
        event.type === "approval/asked"
        || event.type === "approval/decided"
        || event.type === "tool/result"
        || (event.type === "user/message" && event.data.source.kind === "plugin")),
    });
    expect(pluginSurfaces).not.toContain(codeSentinel);
  });

  it("unregisters content tools and approval policy before disposal settles", async () => {
    const { approvalRequests, ctx, dispose } = await setupContentTool(
      worksheetResult(),
      undefined,
      false,
      false,
      { approval: "allowed-once" },
    );
    await dispose();
    expect(ctx.tools.get("workspace_content_inspect")).toBeUndefined();
    expect(ctx.tools.get("workspace_content_execute")).toBeUndefined();

    const result = await executeContentTool(ctx, executeArgs(), undefined, fakeAgent().agent);
    expect(result).toMatchObject({ isError: true, error: { info: { code: "UNKNOWN_TOOL" } } });
    expect(approvalRequests).toEqual([]);
  });
});

function args(query: Record<string, unknown>, scope: "trunk" | "worktree" = "trunk"): Record<string, unknown> {
  return {
    query,
    scope,
    unit_id: unitId,
    ...(scope === "worktree" ? { worktree_id: "worktree-1" } : {}),
  };
}

function executeArgs(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    code: "return { ok: true };",
    unit_id: unitId,
    worktree_id: "worktree-1",
    ...overrides,
  };
}

function nestedJson(depth: number): unknown {
  let value: unknown = "leaf";
  for (let index = 0; index < depth; index += 1) value = [value];
  return value;
}

async function setupContentTool(
  result: unknown,
  executeRead?: WorkspaceContentRuntime["executeRead"],
  codeMode = false,
  trunk = false,
  options: {
    readonly approval?: ApprovalOutcome | (() => Promise<ApprovalOutcome>);
    readonly executeAndCommit?: WorkspaceContentRuntime["executeAndCommit"];
    readonly nativeAgent?: boolean;
  } = {},
): Promise<{
  readonly approvalRequests: string[];
  readonly codeRuntime?: ControlledCodeRuntime;
  readonly creates: WorkspaceContentRuntimeOptions[];
  readonly ctx: Context;
  readonly dispose: () => Promise<void>;
  readonly requests: string[];
  readonly runtime: FakeContentRuntime;
}> {
  const ctx = new Context();
  contexts.push(ctx);
  if (options.nativeAgent === true) {
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(SessionStore);
  }
  await ctx.plugin(SystemPrompt);
  if (codeMode) {
    await ctx.plugin(ControlledCodeRuntime);
    await ctx.plugin(ToolRuntime, { mode: "code" });
  } else {
    await ctx.plugin(ToolRuntime);
  }
  if (options.nativeAgent === true) {
    await ctx.plugin(AgentRegistry);
    await ctx.plugin(SkillRegistry);
  }
  await ctx.plugin(MemoryCredentials);
  const approvalRequests: string[] = [];
  if (options.approval !== undefined) {
    await ctx.plugin(ApprovalService);
    ctx.on("approval/request", (request) => {
      approvalRequests.push(request.reason ?? "");
      return typeof options.approval === "function"
        ? options.approval()
        : Promise.resolve(options.approval!);
    });
  }
  const creates: WorkspaceContentRuntimeOptions[] = [];
  const runtime = new FakeContentRuntime(executeRead
    ?? (async () => ({ value: { ok: true, value: result } }) as never), options.executeAndCommit);
  const runtimes = new WorkspaceContentRuntimeGenerations(ctx.credentials, {
    createRuntime: (options) => {
      creates.push(options);
      return runtime;
    },
  });
  const requests: string[] = [];
  const http = new WorkspaceHttp({
    cookie: "workspace_session=test",
    origin: "https://workspace.test",
    role: "client",
    fetcher: async (input) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      requests.push(url.pathname);
      if (trunk) {
        return Response.json({
          changesets: [],
          snapshot: {
            rev: 0,
            type: 2,
            unitID: unitId,
            workbook: { originalMeta: "YQ==", sheets: {} },
          },
        });
      }
      return Response.json({ worktree: rawWorktree() });
    },
  });
  const owner = new WorkspaceToolOwner();
  const fiber = ctx.plugin({
    name: `content-tool-${Math.random()}`,
    inject: ["tools"],
    apply(child: Context) {
      const disposers = registerWorkspaceContentTools(child, {
        owner,
        resolveAuthenticatedHttp: () => Promise.resolve(http),
        runtimes,
      });
      return async () => {
        owner.stopAccepting();
        for (const dispose of disposers.reverse()) dispose();
        owner.abort();
        await Promise.all([owner.drain(), runtimes.close()]);
      };
    },
  });
  await fiber;
  return {
    ...(codeMode ? { codeRuntime: ctx.codeRuntime as ControlledCodeRuntime } : {}),
    approvalRequests,
    creates,
    ctx,
    dispose: async () => await fiber.dispose(),
    requests,
    runtime,
  };
}

async function executeTool(ctx: Context, arguments_: unknown, signal = new AbortController().signal) {
  return await ctx.tools.execute({
    arguments: arguments_,
    callId: CallId(`content-${Math.random()}`),
    name: "workspace_content_inspect",
    signal,
  });
}

async function executeContentTool(
  ctx: Context,
  arguments_: unknown,
  signal = new AbortController().signal,
  agent?: unknown,
) {
  return await ctx.tools.execute({
    ...(agent === undefined ? {} : { agent: agent as never }),
    arguments: arguments_,
    callId: CallId(`content-execute-${Math.random()}`),
    name: "workspace_content_execute",
    signal,
  });
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

function rawWorktree(): Record<string, unknown> {
  return {
    id: "worktree-1",
    name: "Draft",
    state: "draft",
    teamSpace: null,
    units: [{
      activationState: "notApplicable",
      change: "unchanged",
      draftHeadRevision: 0,
      mergeResult: "pending",
      name: "Sheet",
      nodeId: "node-1",
      resourceId: "resource-1",
      source: "trunk",
      target: null,
      unitId,
      unitType: "sheet",
    }],
  };
}

function fakeAgent(): { readonly agent: unknown; readonly session: Session } {
  const id = SessionId(`content-${Math.random()}`);
  const session = Session.create(id, [], { version: 0, id, createdAt: 0 });
  session.append("turn/start", { turn: 1 });
  session.append("step/start", { turn: 1, step: 1 });
  return { agent: { session }, session };
}

function validated(query: Record<string, unknown>): WorkspaceContentInspectArgs {
  return validateWorkspaceContentInspectArgs(args(query));
}

function overview(identity: Partial<{ id: string; index: number; name: string }> = {}) {
  return {
    id: identity.id ?? "sheet-1",
    index: identity.index ?? 0,
    name: identity.name ?? "Sheet 1",
    columnCount: 1,
    conditionalFormatting: { count: 0, ranges: [] as string[] },
    dataValidation: { count: 0, ranges: [] as string[] },
    drawings: { charts: 0, images: 0, shapes: 0, total: 0 },
    formulaUsedRanges: [] as string[],
    mergedRanges: [] as string[],
    rowCount: 1,
    styleUsedRanges: [] as string[],
    tables: [] as Array<{ id: string; name: string; range: string }>,
    valueUsedRanges: [] as string[],
  };
}

function workbookResult(name = "Workbook") {
  return { kind: "workbook", name, unitId, worksheets: [overview()] };
}

function worksheetResult(identity = {}) {
  return { kind: "worksheet", unitId, worksheets: [overview(identity)] };
}

function rangeResult(identity: Partial<{ id: string; index: number; name: string }> = {}) {
  return {
    kind: "worksheet-range",
    ranges: [{
      cellData: [[{ v: "value" }]] as unknown[][],
      clipped: false,
      displayValues: [["value"]],
      requestedRange: "A1",
      resolvedRange: "A1",
      worksheet: { id: identity.id ?? "sheet-1", index: identity.index ?? 0, name: identity.name ?? "Sheet 1" },
    }],
    unitId,
  };
}

function slideSummary(identity: Partial<{ id: string; index: number }> = {}) {
  return {
    elementCounts: { charts: 0, groups: 0, images: 0, shapes: 0, tables: 0, text: 0, total: 0 },
    hasSpeakerNotes: false,
    id: identity.id ?? "slide-1",
    index: identity.index ?? 0,
    name: "Slide 1",
  };
}

function presentationResult() {
  return {
    kind: "presentation",
    layoutSlideCount: 0,
    masterSlideCount: 0,
    name: "Presentation",
    size: { height: 720, width: 1280 },
    slides: [slideSummary()],
    unitId,
  };
}

function slideResult(
  identity: Partial<{ id: string; index: number }> = {},
  element?: ReturnType<typeof nestedElement>,
) {
  return {
    kind: "slide",
    slides: [{
      ...slideSummary(identity),
      elements: element === undefined ? [] : [element],
      speakerNotes: "",
    }],
    unitId,
  };
}

function documentResult() {
  return {
    characterCount: 0,
    features: { blockRanges: 0, customBlocks: 0, drawings: 0, lists: 0, tables: 0 },
    kind: "document",
    mode: "modern",
    paragraphCount: 1,
    paragraphs: [{ id: "paragraph-1", index: 0, textPreview: "Text" }],
    title: "Document",
    unitId,
  };
}

function paragraphResult(identity: Partial<{ id: string; index: number }> = {}) {
  return {
    kind: "paragraph",
    paragraphs: [{
      id: identity.id ?? "paragraph-1",
      index: identity.index ?? 0,
      text: "Text",
      textRuns: [{}] as unknown[],
    }],
    unitId,
  };
}

interface TestElement {
  children?: TestElement[];
  id: string;
  name: string;
  type: string;
  visible: boolean;
}

function nestedElement(depth: number): TestElement {
  let value: TestElement = { id: `element-${String(depth)}`, name: "Element", type: "shape", visible: true };
  for (let index = 1; index < depth; index += 1) {
    value = {
      children: [value],
      id: `element-${String(depth - index)}`,
      name: "Group",
      type: "group",
      visible: true,
    };
  }
  return value;
}

function capture(operation: () => unknown): unknown {
  try {
    operation();
  } catch (error) {
    return error;
  }
  throw new Error("Expected operation to throw");
}

function expectCode(operation: () => unknown, code: string, detail?: string): void {
  const error = capture(operation) as Error & { code?: string };
  expect(error.code).toBe(code);
  if (detail !== undefined) expect(error.message).toContain(detail);
}

class ControlledCodeRuntime extends CodeRuntime {
  public readonly isolation = "content-runtime-test";
  public readonly language = "typescript";
  public dispatches: Array<{ readonly arguments: Record<string, unknown>; readonly name: string }> = [];

  public override async run(request: CodeRunRequest): Promise<CodeRunResult> {
    const tools = request.bindings.find(({ global }) => global === "tools")?.functions;
    if (tools === undefined) return { logs: [], error: { kind: "exception", message: "missing tools" } };
    const value: CodeJsonValue[] = [];
    for (const dispatch of this.dispatches) {
      value.push(await tools[dispatch.name]!(dispatch.arguments));
    }
    return { logs: [], value };
  }
}

class FakeContentRuntime implements WorkspaceContentRuntime {
  public readonly close = vi.fn(async () => undefined);
  public readonly executeAndCommit: ReturnType<typeof vi.fn<WorkspaceContentRuntime["executeAndCommit"]>>;
  public readonly executeRead: ReturnType<typeof vi.fn<WorkspaceContentRuntime["executeRead"]>>;
  public readonly exportUnitData = vi.fn<WorkspaceContentRuntime["exportUnitData"]>();

  public constructor(
    executeRead: WorkspaceContentRuntime["executeRead"],
    executeAndCommit: WorkspaceContentRuntime["executeAndCommit"] = async () => ({ committed: false, value: null }),
  ) {
    this.executeRead = vi.fn(executeRead);
    this.executeAndCommit = vi.fn(executeAndCommit);
  }
}

class MemoryCredentials extends CredentialProvider {
  public override readRecord(_key: CredentialKey): Promise<CredentialRecord | undefined> {
    return Promise.resolve(undefined);
  }
  public override modifyRecord(
    _key: CredentialKey,
    _mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> { return Promise.resolve(undefined); }
  public override deleteRecord(_key: CredentialKey): Promise<void> { return Promise.resolve(); }
  public override resolve(_ref: CredentialRef): Promise<ResolvedCredential | undefined> { return Promise.resolve(undefined); }
  public override describe(_ref: CredentialRef): Promise<CredentialInfo> { return Promise.resolve({ configured: false, writable: true }); }
  public override set(_ref: CredentialRef, _value: string): Promise<void> { return Promise.resolve(); }
  public override unset(_ref: CredentialRef): Promise<void> { return Promise.resolve(); }
  public override describeRecord(_key: CredentialKey): Promise<CredentialRecordInfo> {
    return Promise.resolve({ configured: false, writable: true });
  }
  public override listRecords(): Promise<readonly CredentialRecordEntry[]> { return Promise.resolve([]); }
}

function deferred<T>(): { readonly promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
