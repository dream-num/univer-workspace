import type { Context } from "@deepseek-ai/cordis";
import type { FileSystem, FsTarget } from "@deepseek-ai/dsh-fs";
import type { SandboxPolicyService } from "@deepseek-ai/dsh-sandbox-policy";
import { HarnessError } from "@deepseek-ai/dsh-llm";
import {
  defineTool,
  TOOL_ABORTED,
  type PreToolDecision,
  type ToolExecutionResult,
  type ToolRunContext,
} from "@deepseek-ai/dsh-tools";
import {
  measureCanonicalJson,
  projectWorkspaceTypstDependencyFailure,
  WorkspaceApplicationError,
  type WorkspaceCompileTypstResult,
  type WorkspaceUnit,
} from "@univerjs/univer-workspace-client-core";
import { basename, dirname, isAbsolute, normalize, relative, sep } from "node:path";
import {
  currentFilesystem,
  currentPolicy,
  projectWorkspaceFileTransferDependencyFailure,
  requireLocal,
  resolveContainedPath,
} from "./file-transfer.js";
import { closeWorkspaceTool } from "./space-node.js";
import {
  cleanupTypstArtifactStage,
  commitTypstArtifactStage,
  createTypstArtifactStage,
  MAX_TYPST_ARTIFACT_BYTES,
  projectTypstPreviews,
  stageTypstArtifacts,
  WorkspaceTypstArtifactError,
} from "./typst-artifacts.js";
import {
  WorkspaceOwnerNotAcceptingError,
  type WorkspaceOwnedExecution,
  type WorkspaceToolOwner,
} from "./tool-owner.js";
import {
  WorkspaceAuthenticationRequiredError,
  WorkspaceCredentialError,
} from "./authentication-state.js";

export const MAX_TYPST_ARGUMENT_BYTES = 524_288;
export const MAX_TYPST_GENERATED_JAVASCRIPT_BYTES = MAX_TYPST_ARTIFACT_BYTES;
export const MAX_TYPST_UNIT_ENVELOPE_BYTES = 524_288;
export const MAX_TYPST_RESULT_BYTES = 8_388_608;
export const MAX_TYPST_RESULT_DEPTH = 64;
export const MAX_TYPST_UNIT_DATA_BYTES = MAX_TYPST_ARTIFACT_BYTES;
export const MAX_TYPST_VISIBLE_RESULT_BYTES = MAX_TYPST_RESULT_BYTES - MAX_TYPST_UNIT_ENVELOPE_BYTES;

export interface WorkspaceTypstCompileArgs {
  readonly artifact_directory: string;
  readonly bundle_path: string;
  readonly render_previews?: boolean;
}

export interface WorkspaceTypstApplyArgs {
  readonly artifact_directory?: string;
  readonly bundle_path: string;
  readonly idempotency_key?: string;
  readonly parent_node_id?: string;
  readonly render_previews?: boolean;
  readonly space_id: string;
  readonly worktree_id: string;
}

export interface WorkspaceTypstDiagnostic {
  readonly fidelityLimit?: string;
  readonly feature?: string;
  readonly mappingGrade?: "approximate editable" | "diagnostic" | "native editable" | "preserved metadata";
  readonly pageId?: string;
  readonly reason: string;
  readonly recommendedNextAction?: string;
  readonly severity?: "error" | "info" | "warning";
  readonly sourceNodeId?: string;
  readonly sourcePath: string;
  readonly span?: {
    readonly column?: number;
    readonly endColumn?: number;
    readonly endLine?: number;
    readonly line?: number;
    readonly offset?: number;
  };
  readonly suggestedRewrite?: string;
}

export interface WorkspaceTypstPreview {
  readonly pageId: string;
  readonly path: string;
  readonly sourcePath: string;
}

export interface WorkspaceTypstCompileValue {
  readonly artifactDirectory: string;
  readonly committed: false;
  readonly diagnostics: readonly WorkspaceTypstDiagnostic[];
  readonly previews: readonly WorkspaceTypstPreview[];
  readonly targetUnitId: string;
  readonly title: string;
}

export interface WorkspaceTypstApplyValue {
  readonly artifactDirectory?: string;
  readonly committed: true;
  readonly diagnostics: readonly WorkspaceTypstDiagnostic[];
  readonly previews: readonly WorkspaceTypstPreview[];
  readonly targetUnitId: string;
  readonly title: string;
  readonly unit: WorkspaceUnit;
}

export interface WorkspaceTypstToolDependencies {
  readonly apply: (
    input: WorkspaceTypstApplyOperation,
    owned: WorkspaceOwnedExecution,
  ) => Promise<WorkspaceCompileTypstResult>;
  readonly compile: (
    input: WorkspaceTypstCompileOperation,
    owned: WorkspaceOwnedExecution,
  ) => Promise<WorkspaceCompileTypstResult>;
  readonly owner: WorkspaceToolOwner;
}

export interface WorkspaceTypstCompileOperation {
  readonly args: WorkspaceTypstCompileArgs;
  readonly bundlePath: string;
  readonly previewDirectory?: string;
}

export interface WorkspaceTypstApplyOperation {
  readonly args: WorkspaceTypstApplyArgs;
  readonly bundlePath: string;
  readonly previewDirectory?: string;
}

const requiredString = { type: "string", required: true } as const;
const optionalString = { type: "string" } as const;
const previewParameters = { render_previews: { type: "boolean" } } as const;

export const workspaceTypstCompileParameters = {
  artifact_directory: requiredString,
  bundle_path: requiredString,
  ...previewParameters,
} as const;

export const workspaceTypstApplyParameters = {
  artifact_directory: optionalString,
  bundle_path: requiredString,
  idempotency_key: optionalString,
  parent_node_id: optionalString,
  ...previewParameters,
  space_id: requiredString,
  worktree_id: requiredString,
} as const;

const optionalDiagnosticString = { type: "string" } as const;
const diagnosticSpanSchema = objectSchema({
  column: { type: "number" },
  endColumn: { type: "number" },
  endLine: { type: "number" },
  line: { type: "number" },
  offset: { type: "number" },
});
const diagnosticSchema = objectSchema({
  fidelityLimit: optionalDiagnosticString,
  feature: optionalDiagnosticString,
  mappingGrade: {
    type: "string",
    enum: ["native editable", "approximate editable", "preserved metadata", "diagnostic"],
  },
  pageId: optionalDiagnosticString,
  reason: requiredString,
  recommendedNextAction: optionalDiagnosticString,
  severity: { type: "string", enum: ["info", "warning", "error"] },
  sourceNodeId: optionalDiagnosticString,
  sourcePath: requiredString,
  span: diagnosticSpanSchema,
  suggestedRewrite: optionalDiagnosticString,
});
const previewSchema = objectSchema({
  pageId: requiredString,
  path: requiredString,
  sourcePath: requiredString,
});
const nullableStringSchema = {
  oneOf: [{ type: "string" }, { type: "null" }],
  required: true,
} as const;
const unitSchema = objectSchema({
  activationState: {
    type: "string",
    enum: ["notApplicable", "waitingForMerge", "pending", "completed", "failed", "discarded"],
    required: true,
  },
  change: {
    type: "string",
    enum: ["modified", "added", "deleted", "unchanged"],
    required: true,
  },
  draftHeadRevision: { type: "integer", required: true },
  mergeResult: {
    type: "string",
    enum: ["pending", "merged", "unchanged", "conflict", "failed"],
    required: true,
  },
  name: requiredString,
  nodeId: requiredString,
  resourceId: requiredString,
  source: { type: "string", const: "worktree", required: true },
  target: {
    ...objectSchema({ parentNodeId: nullableStringSchema, spaceId: requiredString }),
    required: true,
  },
  type: { type: "string", const: "doc", required: true },
  unitId: requiredString,
  worktreeId: requiredString,
});
const commonOutputProperties = {
  diagnostics: { type: "array", items: diagnosticSchema, required: true },
  previews: { type: "array", items: previewSchema, required: true },
  targetUnitId: requiredString,
  title: requiredString,
} as const;

export const workspaceTypstCompileOutputSchema = objectSchema({
  artifactDirectory: requiredString,
  committed: { type: "boolean", const: false, required: true },
  ...commonOutputProperties,
});

export const workspaceTypstApplyOutputSchema = objectSchema({
  artifactDirectory: optionalString,
  committed: { type: "boolean", const: true, required: true },
  ...commonOutputProperties,
  unit: { ...unitSchema, required: true },
});

export function registerWorkspaceTypstTools(
  ctx: Context,
  dependencies: WorkspaceTypstToolDependencies,
): readonly (() => void)[] {
  const sandboxPolicy = ctx.get("sandboxPolicy") as SandboxPolicyService | undefined;
  const definitions = [
    closeWorkspaceTool(defineTool({
      name: "workspace_typst_compile",
      description: "Compile one approved Host-local Typst Source Bundle into review artifacts.",
      parameters: workspaceTypstCompileParameters,
      output: {
        schema: workspaceTypstCompileOutputSchema,
        render: (_args, value) => [{
          type: "text",
          text: `Compiled Typst target ${value.targetUnitId} with ${String(value.diagnostics.length)} diagnostic(s) to ${value.artifactDirectory}; no Workspace Unit was created.`,
        }],
      },
      finalizeContent: typstFinalizer("compile"),
      execute: async (args, exec) => {
        const input = validateWorkspaceTypstCompileArgs(args);
        return await executeOwned(dependencies.owner, "compile", input, exec, async (owned) => {
          const paths = await resolveTypstHostPaths(ctx, sandboxPolicy, exec, input, owned.signal);
          const normalizedInput: WorkspaceTypstCompileArgs = {
            ...input,
            artifact_directory: paths.artifactRelativePath!,
            bundle_path: paths.bundleRelativePath,
          };
          const stage = await createTypstArtifactStage(
            paths.artifactPath!,
            input.render_previews === true,
            owned.signal,
          )
            .catch(mapTypstArtifactFailure);
          try {
            owned.signal.throwIfAborted();
            const compiled = await dependencies.compile({
              args: normalizedInput,
              bundlePath: paths.bundlePath,
              ...(stage.previewDirectory === undefined ? {} : { previewDirectory: stage.previewDirectory }),
            }, owned);
            const result = compileValueFrom(normalizedInput, compiled);
            validateWorkspaceTypstCompileResult(normalizedInput, result);
            await stageTypstArtifacts(stage, compiled, input.render_previews === true, owned.signal);
            await commitTypstArtifactStage(stage, owned.signal);
            return result as never;
          } catch (error) {
            if (stage.publicStarted) throw artifactPartial(normalizedInput.artifact_directory);
            mapTypstArtifactFailure(error);
          } finally {
            await cleanupTypstArtifactStage(stage);
          }
        });
      },
    }), validateWorkspaceTypstCompileArgs),
    closeWorkspaceTool(defineTool({
      name: "workspace_typst_apply",
      description: "Compile one approved Host-local Typst Source Bundle and create one Worktree-local Doc.",
      parameters: workspaceTypstApplyParameters,
      output: {
        schema: workspaceTypstApplyOutputSchema,
        render: (_args, value) => [{
          type: "text",
          text: `Applied Typst target ${value.targetUnitId} as Workspace Unit ${value.unit.unitId} in Worktree ${value.unit.worktreeId} with ${String(value.diagnostics.length)} diagnostic(s)${value.artifactDirectory === undefined ? "." : `; artifacts: ${value.artifactDirectory}.`}`,
        }],
      },
      finalizeContent: typstFinalizer("apply"),
      execute: async (args, exec) => {
        const input = validateWorkspaceTypstApplyArgs(args);
        return await executeOwned(dependencies.owner, "apply", input, exec, async (owned) => {
          const paths = await resolveTypstHostPaths(ctx, sandboxPolicy, exec, input, owned.signal);
          const normalizedInput: WorkspaceTypstApplyArgs = {
            ...input,
            bundle_path: paths.bundleRelativePath,
            ...(paths.artifactRelativePath === undefined
              ? {}
              : { artifact_directory: paths.artifactRelativePath }),
          };
          const stage = paths.artifactPath === undefined
            ? undefined
            : await createTypstArtifactStage(
              paths.artifactPath,
              input.render_previews === true,
              owned.signal,
            )
              .catch(mapTypstArtifactFailure);
          let confirmedUnitIdentity: Pick<WorkspaceUnit, "unitId" | "worktreeId"> | undefined;
          try {
            owned.signal.throwIfAborted();
            const compiled = await dependencies.apply({
              args: normalizedInput,
              bundlePath: paths.bundlePath,
              ...(stage?.previewDirectory === undefined ? {} : { previewDirectory: stage.previewDirectory }),
            }, owned);
            let confirmedUnit: WorkspaceUnit | undefined;
            if (compiled.committed === true && compiled.unit !== undefined) {
              const unit = validateUnit(compiled.unit, normalizedInput);
              confirmedUnitIdentity = validatedUnitIdentity(unit);
              validateUnitEnvelopeBudget(normalizedInput, unit);
              confirmedUnit = structuredClone(unit);
            }
            const result = applyValueFrom(normalizedInput, compiled, confirmedUnit);
            validateWorkspaceTypstApplyResult(normalizedInput, result);
            if (stage !== undefined) {
              await stageTypstArtifacts(stage, compiled, input.render_previews === true, owned.signal);
              await commitTypstArtifactStage(stage, owned.signal);
            }
            return result as never;
          } catch (error) {
            if (confirmedUnitIdentity !== undefined) {
              throw typstPartialSideEffect(
                confirmedUnitIdentity,
                normalizedInput.artifact_directory,
                stage === undefined ? "not-requested" : stage.publicStarted ? "partial" : "not-published",
              );
            }
            if (stage?.publicStarted === true) throw artifactPartial(normalizedInput.artifact_directory!);
            mapTypstArtifactFailure(error);
          } finally {
            if (stage !== undefined) await cleanupTypstArtifactStage(stage);
          }
        });
      },
    }), validateWorkspaceTypstApplyArgs),
  ];
  return [
    ...definitions.map((definition) => ctx.tools.register(definition)),
    ctx.on("tools/pre-execute", async (exec, next): Promise<PreToolDecision> => {
      if (exec.name === "workspace_typst_compile") {
        const input = validateWorkspaceTypstCompileArgs(exec.arguments);
        await resolveTypstModelPaths(ctx, sandboxPolicy, exec, input, exec.signal);
        return {
          kind: "ask",
          reason: "Workspace Typst compilation writes Host-local review artifacts.",
        };
      }
      if (exec.name === "workspace_typst_apply") {
        const input = validateWorkspaceTypstApplyArgs(exec.arguments);
        await resolveTypstModelPaths(ctx, sandboxPolicy, exec, input, exec.signal);
        return {
          kind: "ask",
          reason: "Workspace Typst apply creates a remote Worktree-local Doc and may write Host-local review artifacts.",
        };
      }
      return await next();
    }),
  ];
}

interface WorkspaceTypstModelPaths {
  readonly artifact?: FsTarget;
  readonly artifactRelativePath?: string;
  readonly bundle: FsTarget;
  readonly bundleRelativePath: string;
  readonly filesystem: FileSystem;
}

async function resolveTypstHostPaths(
  ctx: Context,
  sandboxPolicy: SandboxPolicyService | undefined,
  exec: Pick<ToolRunContext, "agent" | "signal">,
  input: WorkspaceTypstCompileArgs | WorkspaceTypstApplyArgs,
  signal: AbortSignal,
): Promise<{
  readonly artifactPath?: string;
  readonly artifactRelativePath?: string;
  readonly bundlePath: string;
  readonly bundleRelativePath: string;
}> {
  const paths = await resolveTypstModelPaths(ctx, sandboxPolicy, exec, input, signal);
  signal.throwIfAborted();
  return {
    ...(paths.artifact === undefined
      ? {}
      : {
        artifactPath: paths.filesystem.processPath(paths.artifact),
        artifactRelativePath: paths.artifactRelativePath!,
      }),
    bundlePath: paths.filesystem.processPath(paths.bundle),
    bundleRelativePath: paths.bundleRelativePath,
  };
}

async function resolveTypstModelPaths(
  ctx: Context,
  sandboxPolicy: SandboxPolicyService | undefined,
  exec: Pick<ToolRunContext, "agent" | "signal">,
  input: WorkspaceTypstCompileArgs | WorkspaceTypstApplyArgs,
  signal: AbortSignal,
): Promise<WorkspaceTypstModelPaths> {
  const operation = "space_id" in input ? "typst apply" : "typst compile";
  try {
    const filesystem = currentFilesystem(ctx, operation);
    requireLocal(filesystem, operation);
    const cwd = exec.agent?.session.header.cwd;
    const bundle = await resolveContainedPath(filesystem, undefined, exec, input.bundle_path, operation, signal);
    const bundleRelativePath = sessionRelativePath(cwd, input.bundle_path);
    const bundleRoot = await validateBundlePath(
      filesystem,
      exec,
      bundleRelativePath,
      bundle,
      operation,
      signal,
    );
    if (input.artifact_directory === undefined) return { bundle, bundleRelativePath, filesystem };
    const policy = currentPolicy(filesystem, sandboxPolicy, exec, operation);
    const artifact = await resolveContainedPath(
      filesystem,
      policy,
      exec,
      input.artifact_directory,
      operation,
      signal,
    );
    const artifactRelativePath = sessionRelativePath(cwd, input.artifact_directory);
    signal.throwIfAborted();
    if (filesystem.contains(bundleRoot, artifact) || filesystem.contains(artifact, bundleRoot)) {
      throw pathOverlap();
    }
    if (await filesystem.stat(artifact, signal) !== undefined) throw outputExists();
    const parent = await resolveContainedPath(
      filesystem,
      policy,
      exec,
      dirname(artifactRelativePath),
      operation,
      signal,
    );
    if ((await filesystem.stat(parent, signal))?.type !== "directory") throw operationFailed();
    return {
      artifact,
      artifactRelativePath,
      bundle,
      bundleRelativePath,
      filesystem,
    };
  } catch (error) {
    if (error instanceof WorkspaceTypstToolError) throw error;
    if (signal.aborted) throw cancelled();
    throw projectFileFailure(error) ?? operationFailed();
  }
}

function sessionRelativePath(cwd: string | undefined, path: string): string {
  if (cwd === undefined) throw operationFailed();
  const normalized = isAbsolute(path) ? relative(cwd, path) : normalize(path);
  if (normalized === ".." || normalized.startsWith(`..${sep}`) || isAbsolute(normalized)) {
    throw operationFailed();
  }
  return normalized === "" ? "." : normalized;
}

async function validateBundlePath(
  filesystem: FileSystem,
  exec: Pick<ToolRunContext, "agent" | "signal">,
  bundleRelativePath: string,
  bundle: FsTarget,
  operation: "typst compile" | "typst apply",
  signal: AbortSignal,
): Promise<FsTarget> {
  const info = await filesystem.stat(bundle, signal);
  signal.throwIfAborted();
  if (info?.type === "directory") {
    const manifest = await resolveContainedPath(
      filesystem,
      undefined,
      exec,
      `${bundleRelativePath.replace(/[\\/]$/u, "")}/typst.json`,
      operation,
      signal,
    );
    if (!filesystem.contains(bundle, manifest) || (await filesystem.stat(manifest, signal))?.type !== "file") {
      throw bundleInvalid();
    }
    return bundle;
  }
  if (info?.type !== "file" || basename(bundleRelativePath) !== "typst.json") {
    throw bundleInvalid();
  }
  return await resolveContainedPath(
    filesystem,
    undefined,
    exec,
    dirname(bundleRelativePath),
    operation,
    signal,
  );
}

function compileValueFrom(
  input: WorkspaceTypstCompileArgs,
  compiled: WorkspaceCompileTypstResult,
): WorkspaceTypstCompileValue {
  if (compiled.committed !== false || compiled.unit !== undefined) throw invalidResult();
  return {
    artifactDirectory: input.artifact_directory,
    committed: false,
    diagnostics: compiled.diagnostics,
    previews: projectTypstPreviews(compiled.previews, input.artifact_directory),
    targetUnitId: compiled.targetUnitId,
    title: compiled.title,
  };
}

function applyValueFrom(
  input: WorkspaceTypstApplyArgs,
  compiled: WorkspaceCompileTypstResult,
  confirmedUnit: WorkspaceUnit | undefined,
): WorkspaceTypstApplyValue {
  if (
    compiled.committed !== true
    || confirmedUnit === undefined
    || (input.artifact_directory === undefined && compiled.previews.length > 0)
  ) throw invalidResult();
  return {
    ...(input.artifact_directory === undefined ? {} : { artifactDirectory: input.artifact_directory }),
    committed: true,
    diagnostics: compiled.diagnostics,
    previews: input.artifact_directory === undefined
      ? []
      : projectTypstPreviews(compiled.previews, input.artifact_directory),
    targetUnitId: compiled.targetUnitId,
    title: compiled.title,
    unit: confirmedUnit,
  };
}

export function validateWorkspaceTypstCompileArgs(value: unknown): WorkspaceTypstCompileArgs {
  const record = exactRecord(value, ["artifact_directory", "bundle_path"], ["render_previews"]);
  const result = {
    artifact_directory: nonBlankProperty(record, "artifact_directory"),
    bundle_path: nonBlankProperty(record, "bundle_path"),
    ...optionalBooleanProperty(record, "render_previews"),
  };
  validateArgumentBudget(result);
  return result;
}

export function validateWorkspaceTypstApplyArgs(value: unknown): WorkspaceTypstApplyArgs {
  const record = exactRecord(value, ["bundle_path", "space_id", "worktree_id"], [
    "artifact_directory", "idempotency_key", "parent_node_id", "render_previews",
  ]);
  const artifactDirectory = optionalNonBlankProperty(record, "artifact_directory");
  const renderPreviews = optionalBooleanProperty(record, "render_previews");
  if (renderPreviews.render_previews === true && artifactDirectory === undefined) {
    throw invalidArguments();
  }
  const result: WorkspaceTypstApplyArgs = {
    bundle_path: nonBlankProperty(record, "bundle_path"),
    space_id: nonBlankProperty(record, "space_id"),
    worktree_id: nonBlankProperty(record, "worktree_id"),
    ...(artifactDirectory === undefined ? {} : { artifact_directory: artifactDirectory }),
    ...optionalNonBlankResult(record, "idempotency_key"),
    ...optionalNonBlankResult(record, "parent_node_id"),
    ...renderPreviews,
  };
  validateArgumentBudget(result);
  return result;
}

export function validateWorkspaceTypstCompileResult(
  args: WorkspaceTypstCompileArgs,
  value: unknown,
): asserts value is WorkspaceTypstCompileValue {
  const record = exactRecord(value, [
    "artifactDirectory", "committed", "diagnostics", "previews", "targetUnitId", "title",
  ], [], invalidResult);
  if (
    dataProperty(record, "committed") !== false
    || dataProperty(record, "artifactDirectory") !== args.artifact_directory
  ) throw invalidResult();
  validateCommonResult(record, args.render_previews === true);
  validateResultBudget(value);
}

export function validateWorkspaceTypstApplyResult(
  args: WorkspaceTypstApplyArgs,
  value: unknown,
): asserts value is WorkspaceTypstApplyValue {
  const required = ["committed", "diagnostics", "previews", "targetUnitId", "title", "unit"];
  const record = exactRecord(value, required, ["artifactDirectory"], invalidResult);
  if (
    dataProperty(record, "committed") !== true
    || dataProperty(record, "artifactDirectory") !== args.artifact_directory
  ) throw invalidResult();
  validateCommonResult(record, args.render_previews === true);
  const unit = validateUnit(dataProperty(record, "unit"), args);
  validateUnitEnvelopeBudget(args, unit);
  validateResultBudget(value);
}

async function executeOwned<Result>(
  owner: WorkspaceToolOwner,
  operation: "apply" | "compile",
  args: WorkspaceTypstApplyArgs | WorkspaceTypstCompileArgs,
  exec: ToolRunContext,
  body: (owned: WorkspaceOwnedExecution) => Promise<Result>,
): Promise<Result> {
  try {
    return await owner.run(exec, async (owned) => {
      try {
        owned.signal.throwIfAborted();
        return await body(owned);
      } catch (error) {
        throw sanitizeTypstFailure(operation, args, error, owned);
      }
    });
  } catch (error) {
    if (error instanceof WorkspaceTypstToolError) throw error;
    if (error instanceof WorkspaceOwnerNotAcceptingError) throw disposing();
    throw operationFailed();
  }
}

function sanitizeTypstFailure(
  operation: "apply" | "compile",
  args: WorkspaceTypstApplyArgs | WorkspaceTypstCompileArgs,
  error: unknown,
  owned: WorkspaceOwnedExecution,
): WorkspaceTypstToolError {
  if (error instanceof WorkspaceTypstToolError) return error;
  const compiler = projectCompilerFailure(error);
  if (compiler !== undefined) return compiler;
  if (
    operation === "apply"
    && error instanceof WorkspaceApplicationError
    && typstCreateOutcomeUnknown.has(error.code)
  ) return createOutcomeUnknown(error.code, args as WorkspaceTypstApplyArgs, error.detail);
  if (owned.ownerSignal.aborted) return disposing();
  if (owned.callerSignal.aborted) return cancelled();
  if (
    error instanceof WorkspaceAuthenticationRequiredError
    || error instanceof WorkspaceCredentialError
  ) return dependencyFailure("workspace-authentication-required");
  if (error instanceof WorkspaceApplicationError && stableTypstCodes.has(error.code)) {
    return dependencyFailure(error.code, projectTypstDetail(error.detail));
  }
  const file = projectFileFailure(error);
  if (file !== undefined) return file;
  return operationFailed();
}

function projectCompilerFailure(error: unknown): WorkspaceTypstToolError | undefined {
  const projected = projectWorkspaceTypstDependencyFailure(error);
  if (projected === undefined) return undefined;
  if (projected.code === "workspace-typst-bundle-invalid") return bundleInvalid();
  return dependencyFailure(
    projected.code,
    projectTypstDetail({ diagnostics: projected.diagnostics }),
  );
}

function validateCommonResult(record: Record<string, unknown>, previewsRequested: boolean): void {
  nonBlankProperty(record, "targetUnitId", invalidResult);
  nonBlankProperty(record, "title", invalidResult);
  const diagnostics = arrayProperty(record, "diagnostics", invalidResult);
  for (const diagnostic of diagnostics) validateDiagnostic(diagnostic);
  const previews = arrayProperty(record, "previews", invalidResult);
  if (!previewsRequested && previews.length > 0) throw invalidResult();
  for (const preview of previews) validatePreview(preview);
}

function validateDiagnostic(value: unknown): void {
  const record = exactRecord(value, ["reason", "sourcePath"], [
    "fidelityLimit", "feature", "mappingGrade", "pageId", "recommendedNextAction", "severity",
    "sourceNodeId", "span", "suggestedRewrite",
  ], invalidResult);
  nonBlankProperty(record, "reason", invalidResult);
  bundleRelativeSourcePath(dataProperty(record, "sourcePath"));
  for (const key of [
    "fidelityLimit", "feature", "pageId", "recommendedNextAction", "sourceNodeId", "suggestedRewrite",
  ] as const) optionalStringProperty(record, key, invalidResult);
  const grade = dataProperty(record, "mappingGrade");
  if (grade !== undefined && !mappingGrades.has(grade)) throw invalidResult();
  const severity = dataProperty(record, "severity");
  if (severity !== undefined && !severities.has(severity)) throw invalidResult();
  const span = dataProperty(record, "span");
  if (span !== undefined) validateSpan(span);
}

function validateSpan(value: unknown): void {
  const record = exactRecord(value, [], ["column", "endColumn", "endLine", "line", "offset"], invalidResult);
  for (const key of ["column", "endColumn", "endLine", "line", "offset"] as const) {
    const item = dataProperty(record, key);
    if (item !== undefined && (typeof item !== "number" || !Number.isFinite(item))) {
      throw invalidResult();
    }
  }
}

function validatePreview(value: unknown): void {
  const record = exactRecord(value, ["pageId", "path", "sourcePath"], [], invalidResult);
  for (const key of ["pageId", "path"] as const) {
    nonBlankProperty(record, key, invalidResult);
  }
  bundleRelativeSourcePath(dataProperty(record, "sourcePath"));
}

function bundleRelativeSourcePath(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.includes("\0")
    || value.includes("\\")
    || value.startsWith("/")
    || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value)
  ) throw invalidResult();
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw invalidResult();
  }
  return segments.join("/");
}

function validateUnit(value: unknown, args: WorkspaceTypstApplyArgs): WorkspaceUnit {
  const record = exactRecord(value, [
    "activationState", "change", "draftHeadRevision", "mergeResult", "name", "nodeId",
    "resourceId", "source", "target", "type", "unitId", "worktreeId",
  ], [], invalidResult);
  if (
    !activationStates.has(dataProperty(record, "activationState"))
    || !changes.has(dataProperty(record, "change"))
    || !mergeResults.has(dataProperty(record, "mergeResult"))
    || dataProperty(record, "source") !== "worktree"
    || dataProperty(record, "type") !== "doc"
    || dataProperty(record, "worktreeId") !== args.worktree_id
    || !nonNegativeInteger(dataProperty(record, "draftHeadRevision"))
  ) throw invalidResult();
  if (typeof dataProperty(record, "name") !== "string") throw invalidResult();
  for (const key of ["nodeId", "resourceId", "unitId"] as const) {
    nonBlankProperty(record, key, invalidResult);
  }
  const target = exactRecord(dataProperty(record, "target"), ["parentNodeId", "spaceId"], [], invalidResult);
  const parentNodeId = dataProperty(target, "parentNodeId");
  if (
    dataProperty(target, "spaceId") !== args.space_id
    || parentNodeId !== (args.parent_node_id ?? null)
  ) throw invalidResult();
  return record as unknown as WorkspaceUnit;
}

function validateUnitEnvelopeBudget(args: WorkspaceTypstApplyArgs, unit: WorkspaceUnit): void {
  let measurement: ReturnType<typeof measureCanonicalJson>;
  try {
    measurement = measureCanonicalJson({
      ...(args.artifact_directory === undefined ? {} : { artifactDirectory: args.artifact_directory }),
      committed: true,
      unit,
    });
  } catch {
    throw invalidResult();
  }
  if (
    measurement.depth > MAX_TYPST_RESULT_DEPTH
    || measurement.bytes > MAX_TYPST_UNIT_ENVELOPE_BYTES
  ) throw invalidResult();
}

function validatedUnitIdentity(unit: WorkspaceUnit): Pick<WorkspaceUnit, "unitId" | "worktreeId"> {
  const identity = { unitId: unit.unitId, worktreeId: unit.worktreeId };
  const measurement = measureCanonicalJson(identity);
  if (
    measurement.depth > MAX_TYPST_RESULT_DEPTH
    || measurement.bytes > MAX_TYPST_UNIT_ENVELOPE_BYTES
  ) throw invalidResult();
  return identity;
}

function validateArgumentBudget(value: object): void {
  const measurement = measureCanonicalJson(value);
  if (measurement.bytes > MAX_TYPST_ARGUMENT_BYTES) {
    throw limitExceeded("typst-arguments", MAX_TYPST_ARGUMENT_BYTES, measurement.bytes);
  }
}

function validateResultBudget(value: unknown): void {
  let measurement: ReturnType<typeof measureCanonicalJson>;
  try {
    measurement = measureCanonicalJson(value);
  } catch {
    throw invalidResult();
  }
  if (measurement.depth > MAX_TYPST_RESULT_DEPTH) {
    throw limitExceeded("typst-result-depth", MAX_TYPST_RESULT_DEPTH, measurement.depth);
  }
  if (measurement.bytes > MAX_TYPST_RESULT_BYTES) {
    throw limitExceeded("typst-result-bytes", MAX_TYPST_RESULT_BYTES, measurement.bytes);
  }
}

function exactRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  failure: () => WorkspaceTypstToolError = invalidArguments,
): Record<string, unknown> {
  if (!isPlainRecord(value)) throw failure();
  const allowed = new Set([...required, ...optional]);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.some((key) => typeof key !== "string" || !allowed.has(key))
    || required.some((key) => !Object.hasOwn(value, key))
  ) throw failure();
  for (const key of ownKeys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined
      || !("value" in descriptor)
      || descriptor.enumerable !== true
      || descriptor.value === undefined
    ) throw failure();
  }
  return value;
}

function dataProperty(record: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function nonBlankProperty(
  record: object,
  key: string,
  failure: () => WorkspaceTypstToolError = invalidArguments,
): string {
  const value = dataProperty(record, key);
  if (typeof value !== "string" || value.trim() === "") throw failure();
  return value;
}

function optionalNonBlankProperty(record: object, key: string): string | undefined {
  const value = dataProperty(record, key);
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") throw invalidArguments();
  return value;
}

function optionalNonBlankResult<Key extends "idempotency_key" | "parent_node_id">(
  record: object,
  key: Key,
): Partial<Record<Key, string>> {
  const value = optionalNonBlankProperty(record, key);
  return value === undefined ? {} : { [key]: value } as Partial<Record<Key, string>>;
}

function optionalBooleanProperty(
  record: object,
  key: "render_previews",
): Partial<Pick<WorkspaceTypstCompileArgs, "render_previews">> {
  const value = dataProperty(record, key);
  if (value === undefined) return {};
  if (typeof value !== "boolean") throw invalidArguments();
  return { render_previews: value };
}

function optionalStringProperty(
  record: object,
  key: string,
  failure: () => WorkspaceTypstToolError,
): void {
  const value = dataProperty(record, key);
  if (value !== undefined && typeof value !== "string") throw failure();
}

function arrayProperty(
  record: object,
  key: string,
  failure: () => WorkspaceTypstToolError,
): readonly unknown[] {
  const value = dataProperty(record, key);
  if (!Array.isArray(value) || Reflect.ownKeys(value).length !== value.length + 1) throw failure();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
      throw failure();
    }
  }
  return value;
}

function objectSchema<const Properties extends Record<string, unknown>>(properties: Properties) {
  return { type: "object", additionalProperties: false, properties } as const;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

const mappingGrades = new Set<unknown>([
  "native editable", "approximate editable", "preserved metadata", "diagnostic",
]);
const severities = new Set<unknown>(["info", "warning", "error"]);
const activationStates = new Set<unknown>([
  "notApplicable", "waitingForMerge", "pending", "completed", "failed", "discarded",
]);
const changes = new Set<unknown>(["modified", "added", "deleted", "unchanged"]);
const mergeResults = new Set<unknown>(["pending", "merged", "unchanged", "conflict", "failed"]);
const typstCreateOutcomeUnknown = new Set([
  "workspace-invalid-response",
  "workspace-result-mismatch",
  "workspace-result-unknown",
]);
const typstLimitKinds = new Set([
  "generated-javascript-bytes", "unit-data-bytes", "unit-data-depth",
  "unit-data-json", "visible-result-bytes", "visible-result-depth", "visible-result-json",
]);
const stableTypstCodes = new Set([
  "workspace-authentication-required",
  "workspace-invalid-response",
  "workspace-license-required",
  "workspace-origin-mismatch",
  "workspace-redirect-refused",
  "workspace-request-invalid",
  "workspace-result-mismatch",
  "workspace-result-unknown",
  "workspace-typst-diagnostics",
  "workspace-typst-limit-exceeded",
  "workspace-typst-runtime-contract",
  "UNAUTHENTICATED",
  "INVALID_INPUT",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "PAYLOAD_TOO_LARGE",
  "INTERNAL_ERROR",
]);

function typstFinalizer(operation: "apply" | "compile") {
  return (_exec: unknown, result: Readonly<ToolExecutionResult>) => {
    if (!result.isError || result.error.info?.code !== TOOL_ABORTED) return undefined;
    return [{
      type: "text" as const,
      text: operation === "apply"
        ? "Workspace Typst apply may have created a Unit or published artifacts. Inspect the requested artifact directory and workspace_unit_list before deciding any next action. Never replay apply or publication automatically."
        : "Workspace Typst compilation may have published artifacts. Inspect the requested artifact directory before deciding any next action. Never replay compilation or publication automatically.",
    }];
  };
}

function projectTypstDetail(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainRecord(value)) return undefined;
  const detail: Record<string, unknown> = {};
  const kind = dataProperty(value, "kind");
  if (typeof kind === "string" && typstLimitKinds.has(kind)) detail["kind"] = kind;
  for (const key of ["actual", "limit"] as const) {
    const item = dataProperty(value, key);
    if (Number.isSafeInteger(item) && Number(item) >= 0) detail[key] = item;
  }
  const diagnostics = dataProperty(value, "diagnostics");
  if (Array.isArray(diagnostics)) {
    try {
      for (const diagnostic of diagnostics) validateDiagnostic(diagnostic);
      const projected = structuredClone(diagnostics);
      const measurement = measureCanonicalJson(projected);
      if (
        measurement.depth <= MAX_TYPST_RESULT_DEPTH
        && measurement.bytes <= MAX_TYPST_VISIBLE_RESULT_BYTES
      ) detail["diagnostics"] = projected;
    } catch {
      // Unsafe dependency diagnostics are omitted from the fixed projection.
    }
  }
  return Object.keys(detail).length === 0 ? undefined : detail;
}

function createOutcomeUnknown(
  code: string,
  args: WorkspaceTypstApplyArgs,
  value: unknown,
): WorkspaceTypstToolError {
  if (!isPlainRecord(value)) return operationFailed();
  const requestValue = dataProperty(value, "request");
  if (!isPlainRecord(requestValue)) return operationFailed();
  let request: Record<string, unknown>;
  try {
    request = exactRecord(requestValue, [
      "idempotencyKey", "name", "parentNodeId", "spaceId", "type", "worktreeId",
    ], [], operationFailed);
  } catch {
    return operationFailed();
  }
  const idempotencyKey = dataProperty(request, "idempotencyKey");
  const name = dataProperty(request, "name");
  if (
    typeof idempotencyKey !== "string"
    || (args.idempotency_key === undefined
      ? !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(idempotencyKey)
      : idempotencyKey !== args.idempotency_key)
    || typeof name !== "string"
    || name.trim() === ""
    || dataProperty(request, "parentNodeId") !== (args.parent_node_id ?? null)
    || dataProperty(request, "spaceId") !== args.space_id
    || dataProperty(request, "type") !== "doc"
    || dataProperty(request, "worktreeId") !== args.worktree_id
  ) return operationFailed();
  const detail = {
    idempotencyKey,
    name,
    parentNodeId: args.parent_node_id ?? null,
    spaceId: args.space_id,
    type: "doc",
    worktreeId: args.worktree_id,
  };
  const measurement = measureCanonicalJson(detail);
  if (
    measurement.bytes > MAX_TYPST_VISIBLE_RESULT_BYTES
    || measurement.depth > MAX_TYPST_RESULT_DEPTH
  ) return operationFailed();
  return new WorkspaceTypstToolError(
    `Workspace Typst Unit create outcome is not confirmed. ${JSON.stringify({ code, detail })} Inspect workspace_unit_list before deciding any next action. Never replay apply or Unit create automatically.`,
    code,
  );
}

class WorkspaceTypstToolError extends HarnessError {}

function invalidArguments(): WorkspaceTypstToolError {
  return new WorkspaceTypstToolError(
    "Workspace Typst arguments are invalid.",
    "workspace-argument-invalid",
  );
}

function invalidResult(): WorkspaceTypstToolError {
  return new WorkspaceTypstToolError(
    "Workspace Typst returned an invalid result.",
    "workspace-typst-result-invalid",
  );
}

function limitExceeded(kind: string, limit: number, actual: number): WorkspaceTypstToolError {
  return new WorkspaceTypstToolError(
    `Workspace Typst exceeded a fixed limit. ${JSON.stringify({ code: "workspace-typst-limit-exceeded", detail: { actual, kind, limit } })}`,
    "workspace-typst-limit-exceeded",
  );
}

function cancelled(): WorkspaceTypstToolError {
  return new WorkspaceTypstToolError(
    "Workspace Typst was cancelled.",
    "workspace-operation-cancelled",
  );
}

function disposing(): WorkspaceTypstToolError {
  return new WorkspaceTypstToolError(
    "Workspace Typst stopped because the plugin is disposing.",
    "workspace-plugin-disposing",
  );
}

function operationFailed(): WorkspaceTypstToolError {
  return new WorkspaceTypstToolError(
    "Workspace Typst operation failed.",
    "workspace-typst-operation-failed",
  );
}

function dependencyFailure(
  code: string,
  detail?: Record<string, unknown>,
): WorkspaceTypstToolError {
  return new WorkspaceTypstToolError(
    `Workspace Typst dependency failed. ${JSON.stringify({ code, ...(detail === undefined ? {} : { detail }) })}`,
    code,
  );
}

function outputExists(): WorkspaceTypstToolError {
  return new WorkspaceTypstToolError(
    "Workspace Typst artifact destination already exists.",
    "workspace-output-exists",
  );
}

function pathOverlap(): WorkspaceTypstToolError {
  return new WorkspaceTypstToolError(
    "Workspace Typst bundle and artifact paths overlap.",
    "workspace-file-path-outside-session",
  );
}

function bundleInvalid(): WorkspaceTypstToolError {
  return new WorkspaceTypstToolError(
    "Workspace Typst bundle path is invalid.",
    "workspace-typst-bundle-invalid",
  );
}

function artifactPartial(artifactDirectory: string): WorkspaceTypstToolError {
  const detail = { artifactDirectory, artifactState: "partial" };
  return new WorkspaceTypstToolError(
    `Workspace Typst artifact publication is partial. ${JSON.stringify({ code: "workspace-typst-artifact-partial", detail })} Inspect that Session-relative artifact directory before any manual next action. Never replay compilation or publication automatically.`,
    "workspace-typst-artifact-partial",
  );
}

function typstPartialSideEffect(
  unit: Pick<WorkspaceUnit, "unitId" | "worktreeId">,
  artifactDirectory: string | undefined,
  artifactState: "not-published" | "not-requested" | "partial",
): WorkspaceTypstToolError {
  const detail = {
    ...(artifactDirectory === undefined ? {} : { artifactDirectory }),
    artifactState,
    unitId: unit.unitId,
    worktreeId: unit.worktreeId,
  };
  return new WorkspaceTypstToolError(
    `Workspace Typst created a Worktree-local Unit but did not complete artifact publication. ${JSON.stringify({ code: "workspace-typst-partial-side-effect", detail })} Inspect the artifact directory and workspace_unit_list before any manual next action. Never replay apply or publication automatically.`,
    "workspace-typst-partial-side-effect",
  );
}

function projectFileFailure(error: unknown): WorkspaceTypstToolError | undefined {
  const projected = projectWorkspaceFileTransferDependencyFailure(error);
  if (projected === undefined) return undefined;
  return new WorkspaceTypstToolError("Workspace Typst file validation failed.", projected.code);
}

function mapTypstArtifactFailure(error: unknown): never {
  if (error instanceof WorkspaceTypstArtifactError) {
    if (error.code === "workspace-output-exists") throw outputExists();
    const detail = error.detail;
    throw limitExceeded(
      typeof detail?.["kind"] === "string" ? detail["kind"] : "artifacts",
      typeof detail?.["limit"] === "number" ? detail["limit"] : 52_428_800,
      typeof detail?.["actual"] === "number" ? detail["actual"] : 52_428_801,
    );
  }
  throw error;
}
