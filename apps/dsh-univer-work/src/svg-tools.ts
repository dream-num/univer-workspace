import type { Context } from "@deepseek-ai/cordis";
import type { FileSystem, FsTarget } from "@deepseek-ai/dsh-fs";
import type { SandboxExecutionPolicy } from "@deepseek-ai/dsh-sandbox";
import type { SandboxPolicyService } from "@deepseek-ai/dsh-sandbox-policy";
import { HarnessError } from "@deepseek-ai/dsh-llm";
import {
  defineTool,
  TOOL_ABORTED,
  type PreToolDecision,
  type ToolExecution,
  type ToolExecutionResult,
  type ToolExecutionToken,
  type ToolRunContext,
} from "@deepseek-ai/dsh-tools";
import {
  measureCanonicalJson,
  projectWorkspaceSvgDependencyCode,
  WorkspaceApplicationError,
  type WorkspaceCompileSvgFeature,
  type WorkspaceApplySvgResult,
  type WorkspaceCompileSvgResult,
  type WorkspaceContentExecuteResult,
} from "@univerjs/univer-workspace-client-core";
import { isAbsolute, normalize, relative, sep } from "node:path";
import {
  assertWorkspaceFileTransferComposition,
  currentFilesystem,
  currentPolicy,
  projectWorkspaceFileEffectFailure,
  projectWorkspaceFileTransferDependencyFailure,
  requireLocal,
  resolveContainedPath,
} from "./file-transfer.js";
import { projectWorkspaceContentDependencyFailure } from "./content-tools.js";
import { closeWorkspaceTool } from "./space-node.js";
import {
  WorkspaceOwnerNotAcceptingError,
  type WorkspaceOwnedExecution,
  type WorkspaceToolOwner,
} from "./tool-owner.js";

export const MAX_SVG_ARGUMENT_BYTES = 65_536;
export const MAX_SVG_SOURCE_BYTES = 10_485_760;
export const MAX_SVG_ASSET_BYTES = 67_108_864;
export const MAX_SVG_GENERATED_CODE_BYTES = 8_000_000;
export const MAX_SVG_CANONICAL_BYTES = 8_388_608;
export const MAX_SVG_JSON_DEPTH = 64;
const MAX_SVG_APPLY_VALUE_DEPTH = MAX_SVG_JSON_DEPTH - 2;

export interface WorkspaceSvgCompileArgs {
  readonly add?: boolean;
  readonly estimate_text_size?: boolean;
  readonly output_path?: string;
  readonly page?: number;
  readonly source_path: string;
}

export interface WorkspaceSvgApplyArgs {
  readonly add?: boolean;
  readonly estimate_text_size?: boolean;
  readonly output_path?: string;
  readonly page: number;
  readonly source_path: string;
  readonly unit_id: string;
  readonly worktree_id: string;
}

export type WorkspaceSvgGenerated =
  | { readonly code: string; readonly kind: "inline" }
  | { readonly kind: "file"; readonly location: string };

interface WorkspaceSvgValueBase {
  readonly generated: WorkspaceSvgGenerated;
  readonly lints: readonly string[];
  readonly mode: "add" | "replace";
  readonly page?: number;
  readonly textMeasure: string;
  readonly viewport: { readonly height: number; readonly width: number };
  readonly warnings: readonly string[];
}

export interface WorkspaceSvgCompileValue extends WorkspaceSvgValueBase {
  readonly kind: "workspace-svg-compile";
}

export interface WorkspaceSvgApplyValue extends WorkspaceSvgValueBase {
  readonly applied: WorkspaceContentExecuteResult;
  readonly kind: "workspace-svg-apply";
  readonly page: number;
}

export interface WorkspaceSvgToolOperations {
  readonly owner?: WorkspaceToolOwner;
  readonly apply: (input: {
    readonly args: WorkspaceSvgApplyArgs;
    readonly compiled: WorkspaceCompileSvgResult;
    readonly exec: ToolRunContext;
    readonly maxValueBytes: number;
    readonly maxValueDepth: number;
    readonly signal: AbortSignal;
  }) => Promise<WorkspaceApplySvgResult>;
  readonly compile: (input: {
    readonly args: WorkspaceSvgApplyArgs | WorkspaceSvgCompileArgs;
    readonly exec: ToolRunContext;
    readonly maxAssetBytes: number;
    readonly maxSourceBytes: number;
    readonly signal: AbortSignal;
  }) => Promise<WorkspaceCompileSvgResult>;
  readonly saveProgram: (input: {
    readonly args: WorkspaceSvgApplyArgs | WorkspaceSvgCompileArgs;
    readonly code: string;
    readonly exec: ToolRunContext;
    readonly signal: AbortSignal;
  }) => Promise<string>;
}

export interface WorkspaceSvgToolDependencies {
  readonly createFeature: (signal: AbortSignal) => Pick<WorkspaceCompileSvgFeature, "apply" | "compile">;
  readonly owner: WorkspaceToolOwner;
}

export interface WorkspaceSvgToolRegistration {
  dispose(): void;
  drain(): Promise<void>;
  stopAccepting(): void;
  unregister(): void;
}

const requiredString = { type: "string", required: true } as const;
const optionalString = { type: "string" } as const;
const optionalBoolean = { type: "boolean" } as const;
const optionalPage = { type: "integer" } as const;

export const workspaceSvgCompileParameters = {
  add: optionalBoolean,
  estimate_text_size: optionalBoolean,
  output_path: optionalString,
  page: optionalPage,
  source_path: requiredString,
} as const;

export const workspaceSvgApplyParameters = {
  add: optionalBoolean,
  estimate_text_size: optionalBoolean,
  output_path: optionalString,
  page: { type: "integer", required: true },
  source_path: requiredString,
  unit_id: requiredString,
  worktree_id: requiredString,
} as const;

const generatedSchema = {
  oneOf: [
    objectSchema({ code: requiredString, kind: { type: "string", const: "inline", required: true } }),
    objectSchema({ kind: { type: "string", const: "file", required: true }, location: requiredString }),
  ],
} as const;
const viewportSchema = objectSchema({
  height: { type: "number", required: true },
  width: { type: "number", required: true },
});
const appliedSchema = {
  oneOf: [
    objectSchema({
      committed: { type: "boolean", const: false, required: true },
      value: { type: "json", required: true },
    }),
    objectSchema({
      committed: { type: "boolean", const: true, required: true },
      revision: { type: "integer", required: true },
      status: { type: "string", const: "committed", required: true },
      value: { type: "json", required: true },
    }),
  ],
} as const;
const commonOutput = {
  generated: { ...generatedSchema, required: true },
  lints: { type: "array", items: { type: "string" }, required: true },
  mode: { type: "string", enum: ["add", "replace"], required: true },
  page: { type: "integer" },
  textMeasure: requiredString,
  viewport: { ...viewportSchema, required: true },
  warnings: { type: "array", items: { type: "string" }, required: true },
} as const;

export const workspaceSvgCompileOutputSchema = objectSchema({
  ...commonOutput,
  kind: { type: "string", const: "workspace-svg-compile", required: true },
});
export const workspaceSvgApplyOutputSchema = objectSchema({
  applied: { ...appliedSchema, required: true },
  ...commonOutput,
  kind: { type: "string", const: "workspace-svg-apply", required: true },
  page: { type: "integer", required: true },
});

export function registerWorkspaceSvgToolFoundation(
  ctx: Context,
  operations: WorkspaceSvgToolOperations,
): readonly (() => void)[] {
  const compile = closeWorkspaceTool(defineTool({
    name: "workspace_svg_compile",
    description: "Compile one Host-local SVG into an editable Slide program.",
    parameters: workspaceSvgCompileParameters,
    output: {
      schema: workspaceSvgCompileOutputSchema,
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
    },
    finalizeContent: svgFinalizer("compile"),
    execute: async (args, exec) => await executeSvgOwned(
      operations.owner,
      exec,
      async (ownedExec) => await executeCompile(operations, args, ownedExec),
    ) as never,
  }), validateWorkspaceSvgCompileArgs);
  const apply = closeWorkspaceTool(defineTool({
    name: "workspace_svg_apply",
    description: "Compile one Host-local SVG and apply its exact program to a Draft Slide.",
    parameters: workspaceSvgApplyParameters,
    output: {
      schema: workspaceSvgApplyOutputSchema,
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
    },
    finalizeContent: svgFinalizer("apply"),
    execute: async (args, exec) => await executeSvgOwned(
      operations.owner,
      exec,
      async (ownedExec) => await executeApply(operations, args, ownedExec),
    ) as never,
  }), validateWorkspaceSvgApplyArgs);
  return [ctx.tools.register(compile), ctx.tools.register(apply)];
}

export function registerWorkspaceSvgTools(
  ctx: Context,
  dependencies: WorkspaceSvgToolDependencies,
): WorkspaceSvgToolRegistration {
  assertWorkspaceFileTransferComposition(ctx);
  const sandboxPolicy = ctx.get("sandboxPolicy") as SandboxPolicyService | undefined;
  const activeExecutions = new Map<ToolExecutionToken, {
    readonly promise: Promise<void>;
    readonly resolve: () => void;
  }>();
  let accepting = true;
  const operations: WorkspaceSvgToolOperations = {
    owner: dependencies.owner,
    compile: async ({ args, exec, maxAssetBytes, maxSourceBytes, signal }) => {
      const paths = await resolveSvgBodyPaths(ctx, sandboxPolicy, exec, args, signal);
      return await dependencies.createFeature(signal).compile({
        ...(args.add === undefined ? {} : { add: args.add }),
        ...(args.estimate_text_size === undefined ? {} : { estimateTextSize: args.estimate_text_size }),
        file: paths.filesystem.processPath(paths.source),
        localRoot: paths.filesystem.processPath(paths.root),
        maxAssetBytes,
        maxSourceBytes,
        ...(args.page === undefined ? {} : { page: args.page }),
        signal,
      });
    },
    saveProgram: async ({ args, code, exec, signal }) => {
      if (args.output_path === undefined) throw operationFailed();
      const output = await resolveSvgOutput(
        ctx,
        sandboxPolicy,
        exec,
        args.output_path,
        "unit_id" in args ? "svg apply" : "svg compile",
        signal,
      );
      try {
        await output.filesystem.writeText(
          output.target,
          `${code}\n`,
          undefined,
          signal,
          output.policy,
        );
        return output.location;
      } catch (error) {
        signal.throwIfAborted();
        throw projectWorkspaceFileEffectFailure(error, "unit_id" in args ? "svg apply" : "svg compile")
          ?? outputFailed();
      }
    },
    apply: async ({ args, compiled, maxValueBytes, maxValueDepth, signal }) =>
      await dependencies.createFeature(signal).apply({
        compiled,
        maxValueBytes,
        maxValueDepth,
        signal,
        unitId: args.unit_id,
        worktreeId: args.worktree_id,
      }),
  };
  const registrations = [...registerWorkspaceSvgToolFoundation(ctx, operations)];
  registrations.push(ctx.on("tools/pre-execute", async (exec, next): Promise<PreToolDecision> => {
    if (exec.name !== "workspace_svg_compile" && exec.name !== "workspace_svg_apply") {
      return await next();
    }
    if (exec.signal.aborted) return await next();
    if (!accepting) throw disposing();
    const requiresApproval = exec.name === "workspace_svg_apply"
      || (isPlainRecord(exec.arguments) && Object.hasOwn(exec.arguments, "output_path"));
    if (!requiresApproval) {
      validateWorkspaceSvgCompileArgs(exec.arguments);
      return await next();
    }
    let resolveCompletion!: () => void;
    const promise = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    activeExecutions.set(exec.token, { promise, resolve: resolveCompletion });
    let ownedExecution: WorkspaceOwnedExecution | undefined;
    try {
      return await dependencies.owner.run(exec, async (owned) => {
        ownedExecution = owned;
        const ownedExec = { ...exec, signal: owned.signal };
        await preflightSvg(ctx, sandboxPolicy, ownedExec);
        const decision = await requestSvgApproval(
          ctx,
          exec,
          exec.name === "workspace_svg_compile" ? SVG_COMPILE_APPROVAL : SVG_APPLY_APPROVAL,
          owned.signal,
        );
        if (owned.ownerSignal.aborted || !accepting) throw disposing();
        if (owned.callerSignal.aborted) return await next();
        return decision;
      });
    } catch (error) {
      if (exec.signal.aborted) return await next();
      if (error instanceof WorkspaceSvgToolError) throw error;
      const projected = projectWorkspaceFileEffectFailure(
        error,
        exec.name === "workspace_svg_compile" ? "svg compile" : "svg apply",
      );
      if (projected !== undefined) throw projected;
      if (
        error instanceof WorkspaceOwnerNotAcceptingError
        || ownedExecution?.ownerSignal.aborted === true
      ) throw disposing();
      throw operationFailed();
    }
  }));
  const unregisterResult = ctx.root.on("tools/result", (exec) => {
    const completion = activeExecutions.get(exec.token);
    if (completion === undefined) return;
    activeExecutions.delete(exec.token);
    completion.resolve();
  });
  let registered = true;
  let resultRegistered = true;
  return {
    stopAccepting() {
      accepting = false;
    },
    unregister() {
      if (!registered) return;
      registered = false;
      for (const dispose of [...registrations].reverse()) dispose();
    },
    async drain() {
      await Promise.allSettled([...activeExecutions.values()].map(({ promise }) => promise));
      await Promise.resolve();
    },
    dispose() {
      if (!resultRegistered) return;
      resultRegistered = false;
      unregisterResult();
    },
  };
}

async function preflightSvg(
  ctx: Context,
  sandboxPolicy: SandboxPolicyService | undefined,
  exec: ToolExecution,
): Promise<void> {
  if (exec.name === "workspace_svg_compile") {
    const filesystem = currentFilesystem(ctx, "svg compile");
    const policy = currentPolicy(filesystem, sandboxPolicy, exec, "svg compile");
    requireLocal(filesystem, "svg compile");
    const args = validateWorkspaceSvgCompileArgs(exec.arguments);
    await resolveSvgSourceWith(filesystem, exec, args.source_path, "svg compile", exec.signal);
    await resolveSvgOutputWith(filesystem, policy, exec, args.output_path!, "svg compile", exec.signal);
    return;
  }
  const args = validateWorkspaceSvgApplyArgs(exec.arguments);
  const filesystem = currentFilesystem(ctx, "svg apply");
  const policy = args.output_path === undefined
    ? undefined
    : currentPolicy(filesystem, sandboxPolicy, exec, "svg apply");
  requireLocal(filesystem, "svg apply");
  await resolveSvgSourceWith(filesystem, exec, args.source_path, "svg apply", exec.signal);
  if (args.output_path !== undefined) {
    await resolveSvgOutputWith(filesystem, policy, exec, args.output_path, "svg apply", exec.signal);
  }
}

async function requestSvgApproval(
  ctx: Context,
  exec: ToolExecution,
  reason: string,
  signal: AbortSignal,
): Promise<PreToolDecision> {
  const approval = ctx.get("approval");
  if (approval === undefined) return { kind: "deny", reason };
  if (exec.agent === undefined) {
    return {
      kind: "deny",
      reason: `tool "${exec.name}" requires approval, but the call has no agent to route it through`,
    };
  }
  const outcome: "allowed-once" | "cancelled" | "rejected" | "unavailable" = await approval.request({
    agent: exec.agent,
    callId: exec.callId,
    reason,
    signal,
    toolName: exec.name,
  });
  switch (outcome) {
    case "allowed-once": return { kind: "allow" };
    case "rejected": return { kind: "deny", reason: `the user rejected tool "${exec.name}"` };
    case "cancelled": return { kind: "deny", reason: `approval for tool "${exec.name}" was cancelled` };
    case "unavailable": return {
      kind: "deny",
      reason: `tool "${exec.name}" requires approval, but no approval channel is available`,
    };
  }
}

const SVG_COMPILE_APPROVAL = "Workspace SVG compile replaces one approved Host-local generated-code file.";
const SVG_APPLY_APPROVAL = "Workspace SVG apply may replace one approved Host-local generated-code file and changes remote Draft Slide content.";

interface SvgBodyPaths {
  readonly filesystem: FileSystem;
  readonly root: FsTarget;
  readonly source: FsTarget;
}

type SvgPathExecution = Pick<ToolRunContext, "agent" | "signal">;

interface SvgOutputPath {
  readonly filesystem: FileSystem;
  readonly location: string;
  readonly policy: SandboxExecutionPolicy | undefined;
  readonly target: FsTarget;
}

async function resolveSvgBodyPaths(
  ctx: Context,
  sandboxPolicy: SandboxPolicyService | undefined,
  exec: SvgPathExecution,
  args: WorkspaceSvgApplyArgs | WorkspaceSvgCompileArgs,
  signal: AbortSignal,
): Promise<SvgBodyPaths> {
  const operation = "unit_id" in args ? "svg apply" : "svg compile";
  const filesystem = currentFilesystem(ctx, operation);
  const policy = args.output_path === undefined
    ? undefined
    : currentPolicy(filesystem, sandboxPolicy, exec, operation);
  requireLocal(filesystem, operation);
  if (args.output_path !== undefined) {
    await resolveSvgOutputWith(filesystem, policy, exec, args.output_path, operation, signal);
  }
  const source = await resolveSvgSourceWith(filesystem, exec, args.source_path, operation, signal);
  const cwd = exec.agent?.session.header.cwd;
  if (cwd === undefined) throw operationFailed();
  const root = await filesystem.resolve(cwd, { cwd, signal });
  signal.throwIfAborted();
  return { filesystem, root, source };
}

async function resolveSvgOutput(
  ctx: Context,
  sandboxPolicy: SandboxPolicyService | undefined,
  exec: SvgPathExecution,
  path: string,
  operation: "svg apply" | "svg compile",
  signal: AbortSignal,
): Promise<SvgOutputPath> {
  const filesystem = currentFilesystem(ctx, operation);
  const policy = currentPolicy(filesystem, sandboxPolicy, exec, operation);
  requireLocal(filesystem, operation);
  return await resolveSvgOutputWith(filesystem, policy, exec, path, operation, signal);
}

async function resolveSvgSourceWith(
  filesystem: FileSystem,
  exec: SvgPathExecution,
  path: string,
  operation: "svg apply" | "svg compile",
  signal: AbortSignal,
): Promise<FsTarget> {
  return await resolveContainedPath(filesystem, undefined, exec, path, operation, signal);
}

async function resolveSvgOutputWith(
  filesystem: FileSystem,
  policy: SandboxExecutionPolicy | undefined,
  exec: SvgPathExecution,
  path: string,
  operation: "svg apply" | "svg compile",
  signal: AbortSignal,
): Promise<SvgOutputPath> {
  const target = await resolveContainedPath(filesystem, policy, exec, path, operation, signal);
  return {
    filesystem,
    location: sessionRelativePath(exec.agent?.session.header.cwd, path),
    policy,
    target,
  };
}

function sessionRelativePath(cwd: string | undefined, path: string): string {
  if (cwd === undefined) throw operationFailed();
  const normalized = isAbsolute(path) ? relative(cwd, path) : normalize(path);
  if (normalized === ".." || normalized.startsWith(`..${sep}`) || isAbsolute(normalized)) {
    throw operationFailed();
  }
  return normalized === "" ? "." : normalized;
}

export function validateWorkspaceSvgCompileArgs(value: unknown): WorkspaceSvgCompileArgs {
  const record = exactRecord(value, ["source_path"], [
    "add", "estimate_text_size", "output_path", "page",
  ]);
  const result = {
    source_path: nonBlank(record, "source_path"),
    ...optionalBooleanProperty(record, "add"),
    ...optionalBooleanProperty(record, "estimate_text_size"),
    ...optionalNonBlankProperty(record, "output_path"),
    ...optionalPageProperty(record),
  } satisfies WorkspaceSvgCompileArgs;
  if ((result.add === true || result.output_path !== undefined) && result.page === undefined) {
    throw invalidArguments();
  }
  validateArgumentBudget(record);
  return result;
}

export function validateWorkspaceSvgApplyArgs(value: unknown): WorkspaceSvgApplyArgs {
  const record = exactRecord(value, ["page", "source_path", "unit_id", "worktree_id"], [
    "add", "estimate_text_size", "output_path",
  ]);
  const page = dataProperty(record, "page");
  if (!positiveInteger(page)) throw invalidArguments();
  const result = {
    page,
    source_path: nonBlank(record, "source_path"),
    unit_id: nonBlank(record, "unit_id"),
    worktree_id: nonBlank(record, "worktree_id"),
    ...optionalBooleanProperty(record, "add"),
    ...optionalBooleanProperty(record, "estimate_text_size"),
    ...optionalNonBlankProperty(record, "output_path"),
  } satisfies WorkspaceSvgApplyArgs;
  validateArgumentBudget(record);
  return result;
}

async function executeCompile(
  operations: WorkspaceSvgToolOperations,
  value: unknown,
  exec: ToolRunContext,
): Promise<WorkspaceSvgCompileValue> {
  const args = validateWorkspaceSvgCompileArgs(value);
  exec.signal.throwIfAborted();
  const compiled = validateCompiled(args, await operations.compile({
    args,
    exec,
    maxAssetBytes: MAX_SVG_ASSET_BYTES,
    maxSourceBytes: MAX_SVG_SOURCE_BYTES,
    signal: exec.signal,
  }));
  const logical = compileValue(compiled, { code: compiled.code, kind: "inline" });
  validateResultBudget(logical);
  const result = args.output_path === undefined
    ? logical
    : compileValue(compiled, {
        kind: "file",
        location: nonBlankLocation(await operations.saveProgram({ args, code: compiled.code, exec, signal: exec.signal })),
      });
  validateResultBudget(result);
  return result;
}

async function executeApply(
  operations: WorkspaceSvgToolOperations,
  value: unknown,
  exec: ToolRunContext,
): Promise<WorkspaceSvgApplyValue> {
  const args = validateWorkspaceSvgApplyArgs(value);
  exec.signal.throwIfAborted();
  const compiled = validateCompiled(args, await operations.compile({
    args,
    exec,
    maxAssetBytes: MAX_SVG_ASSET_BYTES,
    maxSourceBytes: MAX_SVG_SOURCE_BYTES,
    signal: exec.signal,
  }));
  const logical = applyValue(compiled, { code: compiled.code, kind: "inline" }, {
    committed: false,
    value: null,
  });
  validateResultBudget(logical);
  const generated: WorkspaceSvgGenerated = args.output_path === undefined
    ? { code: compiled.code, kind: "inline" }
    : {
        kind: "file",
        location: nonBlankLocation(await operations.saveProgram({ args, code: compiled.code, exec, signal: exec.signal })),
      };
  const maxValueBytes = remainingApplyValueBytes(compiled, generated);
  try {
    exec.signal.throwIfAborted();
  } catch (error) {
    if (generated.kind === "file") throw new WorkspaceSvgConfirmedFileError(generated.location, error);
    throw error;
  }
  let confirmedApplied: WorkspaceContentExecuteResult | undefined;
  try {
    const applied = await operations.apply({
      args,
      compiled,
      exec,
      maxValueBytes,
      maxValueDepth: MAX_SVG_APPLY_VALUE_DEPTH,
      signal: exec.signal,
    });
    if (applied.code !== compiled.code) throw operationFailed();
    confirmedApplied = validateApplied(applied.applied);
    const result = applyValue(compiled, generated, confirmedApplied);
    validateResultBudget(result);
    return result;
  } catch (error) {
    if (generated.kind === "file") {
      throw new WorkspaceSvgConfirmedFileError(generated.location, error, confirmedApplied, true);
    }
    throw error;
  }
}

async function executeSvgOwned<Result>(
  owner: WorkspaceToolOwner | undefined,
  exec: ToolRunContext,
  body: (exec: ToolRunContext) => Promise<Result>,
): Promise<Result> {
  const run = async (owned: WorkspaceOwnedExecution): Promise<Result> => {
    try {
      owned.signal.throwIfAborted();
      return await body({ ...exec, signal: owned.signal });
    } catch (error) {
      throw sanitizeSvgFailure(error, owned);
    }
  };
  try {
    if (owner !== undefined) return await owner.run(exec, run);
    return await run({
      callerSignal: exec.signal,
      ownerSignal: new AbortController().signal,
      signal: exec.signal,
    });
  } catch (error) {
    if (error instanceof WorkspaceSvgToolError) throw error;
    if (error instanceof WorkspaceOwnerNotAcceptingError) throw disposing();
    throw operationFailed();
  }
}

function sanitizeSvgFailure(
  error: unknown,
  owned: WorkspaceOwnedExecution,
): WorkspaceSvgToolError {
  if (error instanceof WorkspaceSvgToolError) return error;
  if (error instanceof WorkspaceSvgConfirmedFileError) {
    return confirmedFilePartial(error, owned);
  }
  const projected = projectWorkspaceSvgDependencyFailure(error);
  if (
    projected?.code === "workspace-content-partial-side-effect"
    || projected?.code === "workspace-result-unknown"
  ) return svgFailure(projected.code, projected.detail);
  if (owned.ownerSignal.aborted) return disposing();
  if (owned.callerSignal.aborted) return cancelled();
  return projected === undefined
    ? operationFailed()
    : svgFailure(projected.code, projected.detail);
}

function confirmedFilePartial(
  error: WorkspaceSvgConfirmedFileError,
  owned: WorkspaceOwnedExecution,
): WorkspaceSvgToolError {
  const projected = projectWorkspaceSvgDependencyFailure(error.failure);
  const ownerCancelled = owned.ownerSignal.aborted;
  const callerCancelled = owned.callerSignal.aborted;
  const causeCode = projected?.code === "workspace-content-partial-side-effect"
      || projected?.code === "workspace-result-unknown"
    ? projected.code
    : ownerCancelled
      ? "workspace-plugin-disposing"
      : callerCancelled
        ? "workspace-operation-cancelled"
        : projected?.code ?? "workspace-svg-operation-failed";
  const state = error.applied !== undefined
    ? "confirmed"
    : causeCode === "workspace-content-partial-side-effect"
      ? "partial"
      : causeCode === "workspace-result-unknown"
        ? "unknown"
        : !error.dispatched && (ownerCancelled || callerCancelled)
          ? "not-dispatched"
          : "failed";
  const content = {
    causeCode,
    state,
    ...(error.applied === undefined
      ? projectSvgPartialIdentity(projected?.detail)
      : projectConfirmedApplied(error.applied)),
  };
  return svgFailure("workspace-svg-apply-partial", {
    content,
    generated: { kind: "file", location: error.location },
  });
}

function projectConfirmedApplied(value: WorkspaceContentExecuteResult): Record<string, unknown> {
  if (value.committed !== true) return {};
  return { revision: value.revision, status: value.status };
}

function projectSvgPartialIdentity(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) return {};
  const result: Record<string, unknown> = {};
  for (const key of [
    "actual", "baseRevision", "confirmedUploadCount", "contentCommitted", "limit", "mutationCount",
    "observedRevision", "revision", "selectedRevision", "status", "unitId", "unitType", "worktreeId",
    "changeset", "request", "requested", "target",
  ] as const) {
    if (Object.hasOwn(value, key)) result[key] = value[key];
  }
  return result;
}

class WorkspaceSvgConfirmedFileError extends Error {
  public constructor(
    public readonly location: string,
    public readonly failure: unknown,
    public readonly applied?: WorkspaceContentExecuteResult,
    public readonly dispatched = applied !== undefined,
  ) {
    super("Workspace SVG apply failed after generated-code publication.");
  }
}

function validateCompiled(
  args: WorkspaceSvgApplyArgs | WorkspaceSvgCompileArgs,
  value: unknown,
): WorkspaceCompileSvgResult {
  const record = exactRecord(
    value,
    ["code", "lints", "mode", "textMeasure", "viewport", "warnings"],
    ["page"],
    operationFailed,
    true,
  );
  const code = nonBlank(record, "code", operationFailed);
  const expectedMode = args.add === true ? "add" : "replace";
  const expectedPage = args.page;
  if (
    dataProperty(record, "mode") !== expectedMode
    || dataProperty(record, "page") !== expectedPage
    || Buffer.byteLength(code) > MAX_SVG_GENERATED_CODE_BYTES
  ) {
    if (Buffer.byteLength(code) > MAX_SVG_GENERATED_CODE_BYTES) {
      throw limitExceeded("svg-generated-code", MAX_SVG_GENERATED_CODE_BYTES, Buffer.byteLength(code));
    }
    throw operationFailed();
  }
  const viewport = exactRecord(dataProperty(record, "viewport"), ["height", "width"], [], operationFailed);
  const height = finitePositive(viewport, "height");
  const width = finitePositive(viewport, "width");
  return {
    code,
    lints: stringArray(record, "lints"),
    mode: expectedMode,
    page: expectedPage,
    textMeasure: nonBlank(record, "textMeasure", operationFailed),
    viewport: { height, width },
    warnings: stringArray(record, "warnings"),
  };
}

function validateApplied(value: unknown): WorkspaceContentExecuteResult {
  const record = exactRecord(value, ["committed", "value"], ["revision", "status"], operationFailed);
  const committed = dataProperty(record, "committed");
  if (committed === false && !Object.hasOwn(record, "revision") && !Object.hasOwn(record, "status")) {
    validateJson(dataProperty(record, "value"));
    return { committed: false, value: dataProperty(record, "value") as never };
  }
  const revision = dataProperty(record, "revision");
  const status = dataProperty(record, "status");
  if (committed !== true || !positiveInteger(revision) || status !== "committed") {
    throw operationFailed();
  }
  validateJson(dataProperty(record, "value"));
  return { committed: true, revision, status, value: dataProperty(record, "value") as never };
}

function compileValue(
  compiled: WorkspaceCompileSvgResult,
  generated: WorkspaceSvgGenerated,
): WorkspaceSvgCompileValue {
  return {
    generated,
    kind: "workspace-svg-compile",
    lints: [...compiled.lints],
    mode: compiled.mode,
    ...(compiled.page === undefined ? {} : { page: compiled.page }),
    textMeasure: compiled.textMeasure,
    viewport: { ...compiled.viewport },
    warnings: [...compiled.warnings],
  };
}

function applyValue(
  compiled: WorkspaceCompileSvgResult,
  generated: WorkspaceSvgGenerated,
  applied: WorkspaceContentExecuteResult,
): WorkspaceSvgApplyValue {
  if (compiled.page === undefined) throw operationFailed();
  return {
    applied,
    generated,
    kind: "workspace-svg-apply",
    lints: [...compiled.lints],
    mode: compiled.mode,
    page: compiled.page,
    textMeasure: compiled.textMeasure,
    viewport: { ...compiled.viewport },
    warnings: [...compiled.warnings],
  };
}

function remainingApplyValueBytes(
  compiled: WorkspaceCompileSvgResult,
  generated: WorkspaceSvgGenerated,
): number {
  const noMutation = applyValue(compiled, generated, { committed: false, value: null });
  const committed = applyValue(compiled, generated, {
    committed: true,
    revision: Number.MAX_SAFE_INTEGER,
    status: "committed",
    value: null,
  });
  const nullBytes = Buffer.byteLength("null");
  const fixedBytes = Math.max(
    measureCanonicalJson(noMutation).bytes - nullBytes,
    measureCanonicalJson(committed).bytes - nullBytes,
  );
  const remaining = MAX_SVG_CANONICAL_BYTES - fixedBytes;
  if (remaining < 1) throw limitExceeded("svg-result-bytes", MAX_SVG_CANONICAL_BYTES, fixedBytes);
  return remaining;
}

function validateArgumentBudget(value: object): void {
  let bytes: number;
  try {
    bytes = measureCanonicalJson(value).bytes;
  } catch {
    throw invalidArguments();
  }
  if (bytes > MAX_SVG_ARGUMENT_BYTES) {
    throw limitExceeded("svg-arguments", MAX_SVG_ARGUMENT_BYTES, bytes);
  }
}

function validateResultBudget(value: unknown): void {
  let measurement: ReturnType<typeof measureCanonicalJson>;
  try {
    measurement = measureCanonicalJson(value);
  } catch {
    throw operationFailed();
  }
  if (measurement.depth > MAX_SVG_JSON_DEPTH) {
    throw limitExceeded("svg-result-depth", MAX_SVG_JSON_DEPTH, measurement.depth);
  }
  if (measurement.bytes > MAX_SVG_CANONICAL_BYTES) {
    throw limitExceeded("svg-result-bytes", MAX_SVG_CANONICAL_BYTES, measurement.bytes);
  }
}

function validateJson(value: unknown): void {
  try {
    measureCanonicalJson(value);
  } catch {
    throw operationFailed();
  }
}

function exactRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  failure: () => WorkspaceSvgToolError = invalidArguments,
  allowUndefinedOptional = false,
): Record<string, unknown> {
  if (!isPlainRecord(value)) throw failure();
  const allowed = new Set([...required, ...optional]);
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== "string" || !allowed.has(key))
    || required.some((key) => !Object.hasOwn(value, key))
  ) throw failure();
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined
      || !("value" in descriptor)
      || !descriptor.enumerable
      || (descriptor.value === undefined && (!allowUndefinedOptional || required.includes(key)))
    ) {
      throw failure();
    }
  }
  return value;
}

function dataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function nonBlank(
  value: object,
  key: string,
  failure: () => WorkspaceSvgToolError = invalidArguments,
): string {
  const item = dataProperty(value, key);
  if (typeof item !== "string" || item.trim() === "") throw failure();
  return item;
}

function nonBlankLocation(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw operationFailed();
  return value;
}

function optionalBooleanProperty<Key extends "add" | "estimate_text_size">(
  record: object,
  key: Key,
): Partial<Record<Key, boolean>> {
  const value = dataProperty(record, key);
  if (value === undefined) return {};
  if (typeof value !== "boolean") throw invalidArguments();
  return { [key]: value } as Partial<Record<Key, boolean>>;
}

function optionalNonBlankProperty<Key extends "output_path">(
  record: object,
  key: Key,
): Partial<Record<Key, string>> {
  const value = dataProperty(record, key);
  if (value === undefined) return {};
  if (typeof value !== "string" || value.trim() === "") throw invalidArguments();
  return { [key]: value } as Partial<Record<Key, string>>;
}

function optionalPageProperty(record: object): { readonly page?: number } {
  const value = dataProperty(record, "page");
  if (value === undefined) return {};
  if (!positiveInteger(value)) throw invalidArguments();
  return { page: value };
}

function stringArray(record: object, key: string): string[] {
  const value = dataProperty(record, key);
  if (!Array.isArray(value) || Reflect.ownKeys(value).length !== value.length + 1) throw operationFailed();
  const result: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = dataProperty(value, String(index));
    if (typeof item !== "string") throw operationFailed();
    result.push(item);
  }
  return result;
}

function finitePositive(record: object, key: string): number {
  const value = dataProperty(record, key);
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw operationFailed();
  return value;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function objectSchema<const Properties extends Record<string, unknown>>(properties: Properties) {
  return { type: "object", additionalProperties: false, properties } as const;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

const workspaceSvgApplicationCodes = new Set([
  "workspace-svg-asset-unavailable",
  "workspace-svg-input-outside-root",
  "workspace-svg-limit-exceeded",
  "workspace-svg-source-unavailable",
]);

const workspaceSvgLocalCodes = new Set([
  "workspace-file-path-outside-session",
  "workspace-file-policy-denied",
  "workspace-local-filesystem-required",
  "workspace-operation-cancelled",
  "workspace-plugin-disposing",
  "workspace-session-cwd-required",
]);

class WorkspaceSvgToolError extends HarnessError {
  public constructor(
    message: string,
    code: string,
    private readonly detail?: Record<string, unknown>,
  ) {
    super(message, code);
  }

  public projectedDetail(): Record<string, unknown> | undefined {
    return this.detail;
  }
}

export function projectWorkspaceSvgDependencyFailure(
  error: unknown,
): { readonly code: string; readonly detail?: Record<string, unknown> } | undefined {
  if (error instanceof WorkspaceSvgToolError) {
    const detail = error.projectedDetail();
    return { code: error.code, ...(detail === undefined ? {} : { detail }) };
  }
  if (error instanceof WorkspaceApplicationError && workspaceSvgApplicationCodes.has(error.code)) {
    const detail = projectSvgApplicationDetail(error.code, error.detail);
    return { code: error.code, ...(detail === undefined ? {} : { detail }) };
  }
  const svgCode = projectWorkspaceSvgDependencyCode(error);
  if (svgCode !== undefined) return { code: svgCode };
  const file = projectWorkspaceFileTransferDependencyFailure(error);
  if (file !== undefined && workspaceSvgLocalCodes.has(file.code)) return { code: file.code };
  return projectWorkspaceContentDependencyFailure(error);
}

function projectSvgApplicationDetail(
  code: string,
  value: unknown,
): Record<string, unknown> | undefined {
  if (code !== "workspace-svg-limit-exceeded" || !isPlainRecord(value)) return undefined;
  const kind = dataProperty(value, "kind");
  const limit = dataProperty(value, "limit");
  const actual = dataProperty(value, "actual");
  if (
    typeof kind !== "string"
    || !new Set([
      "asset", "source", "svg-arguments", "svg-generated-code", "svg-result-bytes", "svg-result-depth",
    ]).has(kind)
    || !nonNegativeInteger(limit)
    || !nonNegativeInteger(actual)
  ) return undefined;
  return { actual, kind, limit };
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function svgFailure(code: string, detail?: Record<string, unknown>): WorkspaceSvgToolError {
  return new WorkspaceSvgToolError(
    `Workspace SVG operation failed. ${JSON.stringify({ code, ...(detail === undefined ? {} : { detail }) })}`,
    code,
    detail,
  );
}

function invalidArguments(): WorkspaceSvgToolError {
  return new WorkspaceSvgToolError("Workspace SVG arguments are invalid.", "workspace-svg-argument-invalid");
}

function limitExceeded(kind: string, limit: number, actual: number): WorkspaceSvgToolError {
  return svgFailure("workspace-svg-limit-exceeded", { actual, kind, limit });
}

function operationFailed(): WorkspaceSvgToolError {
  return svgFailure("workspace-svg-operation-failed");
}

function outputFailed(): WorkspaceSvgToolError {
  return svgFailure("workspace-svg-output-failed");
}

function cancelled(): WorkspaceSvgToolError {
  return svgFailure("workspace-operation-cancelled");
}

function disposing(): WorkspaceSvgToolError {
  return svgFailure("workspace-plugin-disposing");
}

function svgFinalizer(operation: "apply" | "compile") {
  return (_exec: unknown, result: Readonly<ToolExecutionResult>) => {
    if (!result.isError) return undefined;
    const code = result.error.info?.code;
    if (
      code !== TOOL_ABORTED
      && code !== "workspace-operation-cancelled"
      && code !== "workspace-plugin-disposing"
      && code !== "workspace-svg-apply-partial"
      && code !== "workspace-content-partial-side-effect"
      && code !== "workspace-result-unknown"
    ) return undefined;
    return [{
      type: "text" as const,
      text: operation === "compile"
        ? "Workspace SVG generated-code output may exist. Inspect the approved output location before deciding on a deliberate retry. Never recompile or overwrite it automatically."
        : "Workspace SVG generated-code output or Draft Slide content may have changed. Inspect the approved output location and Worktree Unit before deciding on a deliberate retry. Never recompile, delete the file, or replay apply automatically.",
    }];
  };
}
