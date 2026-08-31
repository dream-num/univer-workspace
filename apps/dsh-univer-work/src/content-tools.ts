import type { Context } from "@deepseek-ai/cordis";
import { HarnessError } from "@deepseek-ai/dsh-llm";
import {
  defineTool,
  TOOL_ABORTED,
  type PreToolDecision,
  type ToolDefinition,
  type ToolExecutionResult,
  type ToolRunContext,
} from "@deepseek-ai/dsh-tools";
import {
  ContentInspectionError,
  inspectContent,
  type ContentInspectionQuery,
  type ContentInspectionResult,
} from "@univer-cli/content-inspection";
import {
  CollaborationRuntimeError,
  UniverCollaborationRuntimePoolError,
  WorkspaceApplicationError,
  WorkspaceContentExecutionFeature,
  WorkspaceContentSource,
  type WorkspaceHttp,
} from "@univerjs/univer-workspace-client-core";
import {
  WorkspaceAuthenticationRequiredError,
  WorkspaceCredentialError,
} from "./authentication-state.js";
import { WorkspaceContentRuntimeGenerations } from "./content-runtime-generation.js";
import { closeWorkspaceTool } from "./space-node.js";
import {
  WorkspaceOwnerNotAcceptingError,
  type WorkspaceOwnedExecution,
  type WorkspaceToolOwner,
} from "./tool-owner.js";

export const MAX_CONTENT_ARGUMENT_BYTES = 524_288;
export const MAX_CONTENT_CODE_BYTES = 262_144;
export const MAX_CONTENT_SELECTORS = 64;
export const MAX_CONTENT_REQUESTED_CELLS = 100_000;
export const MAX_EXECUTE_VALUE_BYTES = 8_388_000;
export const MAX_CONTENT_CANONICAL_BYTES = 8_388_608;
export const MAX_CONTENT_JSON_DEPTH = 64;

export interface WorkspaceContentDependencies {
  readonly owner: WorkspaceToolOwner;
  readonly resolveAuthenticatedHttp: (signal?: AbortSignal) => Promise<WorkspaceHttp>;
  readonly runtimes: WorkspaceContentRuntimeGenerations;
}

export interface WorkspaceContentInspectArgs {
  readonly query: ContentInspectionQuery;
  readonly scope: "trunk" | "worktree";
  readonly unit_id: string;
  readonly worktree_id?: string;
}

export interface WorkspaceContentExecuteArgs {
  readonly code: string;
  readonly unit_id: string;
  readonly worktree_id: string;
}

const stringSchema = { type: "string", required: true } as const;
const integerSchema = { type: "integer", required: true } as const;
const numberSchema = { type: "number", required: true } as const;
const booleanSchema = { type: "boolean", required: true } as const;
const jsonSchema = { type: "json", required: true } as const;
const stringArraySchema = {
  type: "array",
  required: true,
  items: { type: "string" },
} as const;
const worksheetSelectorSchema = {
  oneOf: [
    { type: "object", additionalProperties: false, properties: { id: stringSchema } },
    { type: "object", additionalProperties: false, properties: { name: stringSchema } },
    { type: "object", additionalProperties: false, properties: { index: integerSchema } },
  ],
} as const;
const indexedSelectorSchema = {
  oneOf: [
    { type: "object", additionalProperties: false, properties: { id: stringSchema } },
    { type: "object", additionalProperties: false, properties: { index: integerSchema } },
  ],
} as const;

export const workspaceContentInspectParameters = {
  unit_id: stringSchema,
  scope: { type: "string", enum: ["trunk", "worktree"], required: true },
  worktree_id: { type: "string" },
  query: {
    required: true,
    oneOf: [
      objectSchema({ kind: { type: "string", const: "workbook", required: true } }),
      objectSchema({
        kind: { type: "string", const: "worksheet", required: true },
        worksheets: { type: "array", items: worksheetSelectorSchema, required: true },
      }),
      objectSchema({
        kind: { type: "string", const: "worksheet-range", required: true },
        ranges: {
          type: "array",
          required: true,
          items: objectSchema({
            range: stringSchema,
            worksheet: { ...worksheetSelectorSchema, required: true },
          }),
        },
      }),
      objectSchema({ kind: { type: "string", const: "presentation", required: true } }),
      objectSchema({
        kind: { type: "string", const: "slide", required: true },
        slides: { type: "array", items: indexedSelectorSchema, required: true },
      }),
      objectSchema({ kind: { type: "string", const: "document", required: true } }),
      objectSchema({
        kind: { type: "string", const: "paragraph", required: true },
        paragraphs: { type: "array", items: indexedSelectorSchema, required: true },
      }),
    ],
  },
} as const;

export const workspaceContentExecuteParameters = {
  worktree_id: stringSchema,
  unit_id: stringSchema,
  code: stringSchema,
} as const;

const worksheetIdentitySchema = objectSchema({
  id: stringSchema,
  index: integerSchema,
  name: stringSchema,
});
const ruleSummarySchema = objectSchema({
  count: integerSchema,
  ranges: stringArraySchema,
});
const drawingSummarySchema = objectSchema({
  charts: integerSchema,
  images: integerSchema,
  shapes: integerSchema,
  total: integerSchema,
});
const worksheetOverviewSchema = objectSchema({
  id: stringSchema,
  index: integerSchema,
  name: stringSchema,
  columnCount: integerSchema,
  conditionalFormatting: { ...ruleSummarySchema, required: true },
  dataValidation: { ...ruleSummarySchema, required: true },
  drawings: { ...drawingSummarySchema, required: true },
  formulaUsedRanges: stringArraySchema,
  mergedRanges: stringArraySchema,
  rowCount: integerSchema,
  styleUsedRanges: stringArraySchema,
  tables: {
    type: "array",
    required: true,
    items: objectSchema({ id: stringSchema, name: stringSchema, range: stringSchema }),
  },
  valueUsedRanges: stringArraySchema,
});
const elementCountsSchema = objectSchema({
  charts: integerSchema,
  groups: integerSchema,
  images: integerSchema,
  shapes: integerSchema,
  tables: integerSchema,
  text: integerSchema,
  total: integerSchema,
});
const slideSummaryProperties = {
  elementCounts: { ...elementCountsSchema, required: true },
  hasSpeakerNotes: booleanSchema,
  id: stringSchema,
  index: integerSchema,
  name: stringSchema,
  textPreview: { type: "string" },
} as const;
const slideElementSchema = objectSchema({
  chartId: { type: "string" },
  children: { type: "array", items: { type: "json" } },
  fill: { type: "json" },
  id: stringSchema,
  mediaType: { type: "string" },
  name: stringSchema,
  stroke: { type: "json" },
  tableId: { type: "string" },
  tableText: {
    type: "array",
    items: { type: "array", items: { type: "string" } },
  },
  text: {
    type: "object",
    additionalProperties: false,
    properties: {
      alignment: { type: "json" },
      insets: { type: "json" },
      text: stringSchema,
    },
  },
  transform: {
    type: "object",
    additionalProperties: false,
    properties: {
      angle: { type: "number" },
      height: { type: "number" },
      left: { type: "number" },
      top: { type: "number" },
      width: { type: "number" },
    },
  },
  type: stringSchema,
  visible: booleanSchema,
});

export const workspaceContentInspectOutputSchema = {
  oneOf: [
    objectSchema({
      kind: { type: "string", const: "workbook", required: true },
      name: stringSchema,
      unitId: stringSchema,
      worksheets: { type: "array", items: worksheetOverviewSchema, required: true },
    }),
    objectSchema({
      kind: { type: "string", const: "worksheet", required: true },
      unitId: stringSchema,
      worksheets: { type: "array", items: worksheetOverviewSchema, required: true },
    }),
    objectSchema({
      kind: { type: "string", const: "worksheet-range", required: true },
      ranges: {
        type: "array",
        required: true,
        items: objectSchema({
          cellData: { type: "array", items: { type: "array", items: { type: "json" } }, required: true },
          clipped: booleanSchema,
          displayValues: { type: "array", items: { type: "array", items: { type: "string" } }, required: true },
          requestedRange: stringSchema,
          resolvedRange: stringSchema,
          worksheet: { ...worksheetIdentitySchema, required: true },
        }),
      },
      unitId: stringSchema,
    }),
    objectSchema({
      kind: { type: "string", const: "presentation", required: true },
      layoutSlideCount: integerSchema,
      masterSlideCount: integerSchema,
      name: stringSchema,
      size: { ...objectSchema({ height: numberSchema, width: numberSchema }), required: true },
      slides: { type: "array", items: objectSchema(slideSummaryProperties), required: true },
      unitId: stringSchema,
    }),
    objectSchema({
      kind: { type: "string", const: "slide", required: true },
      slides: {
        type: "array",
        items: objectSchema({
          ...slideSummaryProperties,
          elements: { type: "array", items: slideElementSchema, required: true },
          speakerNotes: stringSchema,
        }),
        required: true,
      },
      unitId: stringSchema,
    }),
    objectSchema({
      characterCount: integerSchema,
      features: {
        ...objectSchema({
          blockRanges: integerSchema,
          customBlocks: integerSchema,
          drawings: integerSchema,
          lists: integerSchema,
          tables: integerSchema,
        }),
        required: true,
      },
      kind: { type: "string", const: "document", required: true },
      mode: { type: "string", enum: ["modern", "paginated", "unspecified"], required: true },
      paragraphCount: integerSchema,
      paragraphs: {
        type: "array",
        items: objectSchema({ id: stringSchema, index: integerSchema, textPreview: stringSchema }),
        required: true,
      },
      title: stringSchema,
      unitId: stringSchema,
    }),
    objectSchema({
      kind: { type: "string", const: "paragraph", required: true },
      paragraphs: {
        type: "array",
        items: objectSchema({
          bullet: { type: "json" },
          id: stringSchema,
          index: integerSchema,
          list: { type: "json" },
          style: { type: "json" },
          text: stringSchema,
          textRuns: { type: "array", items: { type: "json" }, required: true },
        }),
        required: true,
      },
      unitId: stringSchema,
    }),
  ],
} as const;

export const workspaceContentExecuteOutputSchema = {
  oneOf: [
    objectSchema({
      committed: { type: "boolean", const: false, required: true },
      value: jsonSchema,
    }),
    objectSchema({
      committed: { type: "boolean", const: true, required: true },
      revision: integerSchema,
      status: { type: "string", const: "committed", required: true },
      value: jsonSchema,
    }),
  ],
} as const;

export function registerWorkspaceContentTools(
  ctx: Context,
  dependencies: WorkspaceContentDependencies,
): Array<() => void> {
  const inspectDefinition = closeWorkspaceTool(defineTool({
    name: "workspace_content_inspect",
    description: "Inspect structured Sheet, Slide, or Document content in a Workspace Trunk or Worktree Unit.",
    parameters: workspaceContentInspectParameters,
    output: {
      schema: workspaceContentInspectOutputSchema,
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => true,
    execute: async (args, exec) => await executeInspection(
      dependencies,
      validateWorkspaceContentInspectArgs(args),
      exec,
    ) as never,
  }), (value) => {
    validateWorkspaceContentInspectArgs(value);
  });
  const executeDefinition = closeWorkspaceTool(defineTool({
    name: "workspace_content_execute",
    description: "Execute approved inline Facade code once against an authoritative Draft Worktree Unit.",
    parameters: workspaceContentExecuteParameters,
    output: {
      schema: workspaceContentExecuteOutputSchema,
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
    },
    finalizeContent: contentExecutionFinalizer,
    execute: async (args, exec) => await executeContent(
      dependencies,
      validateWorkspaceContentExecuteArgs(args),
      exec,
    ) as never,
  }), (value) => {
    validateWorkspaceContentExecuteArgs(value);
  });
  return [
    ctx.tools.register(inspectDefinition),
    ctx.tools.register(executeDefinition),
    ctx.on("tools/pre-execute", async (exec, next): Promise<PreToolDecision> => {
      if (exec.name !== "workspace_content_execute") return await next();
      validateWorkspaceContentExecuteArgs(exec.arguments);
      return {
        kind: "ask",
        reason: "Workspace content execution may change remote Draft content.",
      };
    }),
  ];
}

async function executeInspection(
  dependencies: WorkspaceContentDependencies,
  args: WorkspaceContentInspectArgs,
  exec: ToolRunContext,
): Promise<ContentInspectionResult> {
  return await executeOwned(dependencies.owner, exec, async (owned) => {
    const result = await dependencies.runtimes.run(owned.signal, async (runtime) => {
      const http = await dependencies.resolveAuthenticatedHttp(owned.signal);
      owned.signal.throwIfAborted();
      const source = new WorkspaceContentSource(http);
      const target = args.scope === "trunk"
        ? await source.resolveTrunkRuntimeTarget({ unitId: args.unit_id }, owned.signal)
        : await source.resolveRuntimeTarget({
            unitId: args.unit_id,
            worktreeId: args.worktree_id!,
          }, owned.signal);
      owned.signal.throwIfAborted();
      return await inspectContent({
        unitId: target.unitId,
        unitType: target.unitType,
        execute: async ({ code }) => await runtime.executeRead({
          code,
          signal: owned.signal,
          target,
        }),
      }, args.query);
    });
    if (owned.ownerSignal.aborted) throw disposing();
    if (owned.callerSignal.aborted) throw cancelled();
    validateWorkspaceContentInspectionResult(args, result);
    return result;
  });
}

async function executeContent(
  dependencies: WorkspaceContentDependencies,
  args: WorkspaceContentExecuteArgs,
  exec: ToolRunContext,
): Promise<unknown> {
  return await executeOwned(dependencies.owner, exec, async (owned) => {
    const result = await dependencies.runtimes.run(owned.signal, async (runtime) => {
      const http = await dependencies.resolveAuthenticatedHttp(owned.signal);
      owned.signal.throwIfAborted();
      return await new WorkspaceContentExecutionFeature(
        new WorkspaceContentSource(http),
        runtime,
      ).execute({
        code: args.code,
        maxValueBytes: MAX_EXECUTE_VALUE_BYTES,
        maxValueDepth: MAX_CONTENT_JSON_DEPTH,
        signal: owned.signal,
        unitId: args.unit_id,
        worktreeId: args.worktree_id,
      });
    });
    validateWorkspaceContentExecuteResult(result);
    return result;
  });
}

async function executeOwned<Result>(
  owner: WorkspaceToolOwner,
  exec: ToolRunContext,
  body: (owned: WorkspaceOwnedExecution) => Promise<Result>,
): Promise<Result> {
  try {
    return await owner.run(exec, async (owned) => {
      try {
        owned.signal.throwIfAborted();
        return await body(owned);
      } catch (error) {
        if (error instanceof ContentToolError) throw error;
        const projected = projectWorkspaceContentDependencyFailure(error);
        if (
          projected?.code === "workspace-content-partial-side-effect"
          || projected?.code === "workspace-result-unknown"
        ) throw contentFailure(projected.code, projected.detail);
        if (owned.ownerSignal.aborted) throw disposing();
        if (owned.callerSignal.aborted) throw cancelled();
        if (projected !== undefined) throw contentFailure(projected.code, projected.detail);
        throw contentFailure("workspace-content-operation-failed");
      }
    });
  } catch (error) {
    if (error instanceof ContentToolError) throw error;
    if (error instanceof WorkspaceOwnerNotAcceptingError) throw disposing();
    throw contentFailure("workspace-content-operation-failed");
  }
}

const stableContentCodes = new Set([
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
]);

class ContentToolError extends HarnessError {
  readonly #detail: Record<string, unknown> | undefined;

  public constructor(message: string, code: string, detail?: Record<string, unknown>) {
    super(message, code);
    this.#detail = detail;
  }

  public projectedDetail(): Record<string, unknown> | undefined {
    return this.#detail;
  }
}

export function projectWorkspaceContentDependencyFailure(
  error: unknown,
): { code: string; detail?: Record<string, unknown> } | undefined {
  if (error instanceof ContentToolError) {
    if (
      !stableContentCodes.has(error.code)
      && error.code !== "workspace-operation-cancelled"
      && error.code !== "workspace-plugin-disposing"
    ) return undefined;
    const detail = error.projectedDetail();
    return { code: error.code, ...(detail === undefined ? {} : { detail }) };
  }
  if (
    error instanceof WorkspaceAuthenticationRequiredError
    || error instanceof WorkspaceCredentialError
  ) return { code: "workspace-authentication-required" };
  if (error instanceof ContentInspectionError && stableContentCodes.has(error.code)) {
    const detail = projectContentDetail(error.details);
    return { code: error.code, ...(detail === undefined ? {} : { detail }) };
  }
  if (error instanceof WorkspaceApplicationError && stableContentCodes.has(error.code)) {
    const detail = projectContentDetail(error.detail);
    return { code: error.code, ...(detail === undefined ? {} : { detail }) };
  }
  if (
    (error instanceof CollaborationRuntimeError
      || error instanceof UniverCollaborationRuntimePoolError)
    && stableContentCodes.has(error.code)
  ) return { code: error.code };
  return undefined;
}

function contentFailure(code: string, detail?: Record<string, unknown>): ContentToolError {
  return new ContentToolError(
    `Workspace content operation failed. ${JSON.stringify({ code, ...(detail === undefined ? {} : { detail }) })}`,
    code,
    detail,
  );
}

function invalidArguments(): ContentToolError {
  return contentFailure("workspace-argument-invalid");
}

function invalidSelector(): ContentToolError {
  return contentFailure("INSPECTION_SELECTOR_INVALID");
}

function contentLimit(kind: string, limit: number, actual?: number): ContentToolError {
  return contentFailure("workspace-content-limit-exceeded", {
    kind,
    limit,
    ...(actual === undefined ? {} : { actual }),
  });
}

function cancelled(): ContentToolError {
  return contentFailure("workspace-operation-cancelled");
}

function disposing(): ContentToolError {
  return contentFailure("workspace-plugin-disposing");
}

function objectSchema<const Properties extends Record<string, unknown>>(properties: Properties): {
  readonly additionalProperties: false;
  readonly properties: Properties;
  readonly type: "object";
} {
  return { type: "object", additionalProperties: false, properties };
}

export function validateWorkspaceContentExecuteArgs(value: unknown): WorkspaceContentExecuteArgs {
  if (
    !isPlainRecord(value)
    || !hasExactKeys(value, ["code", "unit_id", "worktree_id"])
    || !nonBlank(value["code"])
    || !nonBlank(value["unit_id"])
    || !nonBlank(value["worktree_id"])
  ) throw invalidArguments();
  const argumentBytes = canonicalBytes(value);
  if (argumentBytes > MAX_CONTENT_ARGUMENT_BYTES) {
    throw contentLimit("content-arguments", MAX_CONTENT_ARGUMENT_BYTES, argumentBytes);
  }
  const codeBytes = Buffer.byteLength(value["code"]);
  if (codeBytes > MAX_CONTENT_CODE_BYTES) {
    throw contentLimit("content-code", MAX_CONTENT_CODE_BYTES, codeBytes);
  }
  return value as unknown as WorkspaceContentExecuteArgs;
}

export function validateWorkspaceContentExecuteResult(value: unknown): void {
  if (!isPlainRecord(value) || typeof value["committed"] !== "boolean") {
    throw contentFailure("WORKSPACE_RUNTIME_RESULT_INVALID");
  }
  if (value["committed"] === false) {
    if (!hasExactKeys(value, ["committed", "value"])) {
      throw contentFailure("WORKSPACE_RUNTIME_RESULT_INVALID");
    }
  } else if (
    !hasExactKeys(value, ["committed", "revision", "status", "value"])
    || !Number.isSafeInteger(value["revision"])
    || Number(value["revision"]) < 1
    || value["status"] !== "committed"
  ) {
    throw contentFailure("WORKSPACE_RUNTIME_RESULT_INVALID");
  }
  try {
    validateJson(value["value"], 0);
  } catch (error) {
    if (error instanceof ContentToolError && error.code === "workspace-content-limit-exceeded") {
      throw error;
    }
    throw contentFailure("WORKSPACE_RUNTIME_RESULT_INVALID");
  }
  const bytes = canonicalBytes(value);
  if (bytes > MAX_CONTENT_CANONICAL_BYTES) {
    throw contentLimit("content-output", MAX_CONTENT_CANONICAL_BYTES, bytes);
  }
}

function contentExecutionFinalizer(_exec: unknown, result: Readonly<ToolExecutionResult>) {
  if (!result.isError) return undefined;
  const code = result.error.info?.code;
  if (
    code !== TOOL_ABORTED
    && code !== "workspace-content-partial-side-effect"
    && code !== "workspace-result-unknown"
  ) return undefined;
  return [{
    type: "text" as const,
    text: code === "workspace-content-partial-side-effect"
      ? "A Workspace embedded-image upload was confirmed and may now be an unreferenced orphan. Inspect the Worktree with workspace_worktree_get and workspace_content_inspect before deciding any next action. Never replay the Facade code or re-upload images automatically."
      : "The Workspace content mutation may have committed. Inspect current state with workspace_worktree_get and workspace_content_inspect before deciding any next action. Never replay the Facade code automatically.",
  }];
}

function projectContentDetail(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainRecord(value)) return undefined;
  const projected: Record<string, unknown> = {};
  for (const key of ["worktreeId", "unitId", "sid", "reqId"] as const) {
    if (nonBlank(value[key])) projected[key] = value[key];
  }
  for (const key of [
    "revision", "selectedRevision", "observedRevision", "status", "limit", "actual",
    "confirmedUploadCount", "baseRevision", "mutationCount",
  ] as const) {
    if (nonNegativeInteger(value[key])) projected[key] = value[key];
  }
  if (typeof value["contentCommitted"] === "boolean") {
    projected["contentCommitted"] = value["contentCommitted"];
  }
  if (typeof value["path"] === "string" && value["path"].startsWith("/")) {
    projected["path"] = value["path"];
  }
  if (typeof value["kind"] === "string" && new Set([
    "content-arguments", "content-code", "content-depth", "content-output",
    "content-selectors", "execute-value-bytes", "execute-value-depth", "worksheet-cells",
  ]).has(value["kind"])) projected["kind"] = value["kind"];
  if (typeof value["effect"] === "string" && value["effect"] === "embedded-image-upload") {
    projected["effect"] = value["effect"];
  }
  if (typeof value["status"] === "string" && new Set([
    "confirmed", "retry", "unknown", "rejected", "committed",
  ]).has(value["status"])) projected["status"] = value["status"];
  for (const key of ["unitType", "actualUnitType", "supportedUnitType"] as const) {
    if (typeof value[key] === "string" && new Set(["sheet", "doc", "slide", "base", "board"]).has(value[key])) {
      projected[key] = value[key];
    }
  }
  if (typeof value["range"] === "string" && isCanonicalA1(value["range"])) {
    projected["range"] = value["range"];
  }
  if (nonNegativeInteger(value["index"])) projected["index"] = value["index"];
  for (const key of ["target", "request", "requested", "actual", "changeset"] as const) {
    const nested = projectContentIdentity(value[key]);
    if (nested !== undefined) projected[key] = nested;
  }
  return Object.keys(projected).length === 0 ? undefined : projected;
}

function projectContentIdentity(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainRecord(value)) return undefined;
  const projected: Record<string, unknown> = {};
  for (const key of ["worktreeId", "unitId", "sid", "reqId"] as const) {
    if (nonBlank(value[key])) projected[key] = value[key];
  }
  for (const key of ["revision", "baseRevision", "mutationCount", "index"] as const) {
    if (nonNegativeInteger(value[key])) projected[key] = value[key];
  }
  if (typeof value["unitType"] === "string" && new Set(["sheet", "doc", "slide", "base", "board"]).has(value["unitType"])) {
    projected["unitType"] = value["unitType"];
  }
  if (typeof value["kind"] === "string" && (value["kind"] === "trunk" || value["kind"] === "worktree")) {
    projected["kind"] = value["kind"];
  }
  const scope = projectContentIdentity(value["scope"]);
  if (scope !== undefined) projected["scope"] = scope;
  return Object.keys(projected).length === 0 ? undefined : projected;
}

function isCanonicalA1(value: string): boolean {
  try {
    return a1Area(value) !== undefined;
  } catch {
    return false;
  }
}

export function validateWorkspaceContentInspectArgs(value: unknown): WorkspaceContentInspectArgs {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["query", "scope", "unit_id"], ["worktree_id"])) {
    throw invalidArguments();
  }
  if (
    !nonBlank(value["unit_id"])
    || (value["scope"] !== "trunk" && value["scope"] !== "worktree")
    || (value["scope"] === "trunk" && Object.hasOwn(value, "worktree_id"))
    || (value["scope"] === "worktree"
      && (!Object.hasOwn(value, "worktree_id") || !nonBlank(value["worktree_id"])))
  ) throw invalidArguments();
  const query = validateQueryShape(value["query"]);
  const count = query.kind === "worksheet"
    ? query.worksheets.length
    : query.kind === "worksheet-range"
      ? query.ranges.length
      : query.kind === "slide"
        ? query.slides.length
        : query.kind === "paragraph"
          ? query.paragraphs.length
          : 0;
  if (count > MAX_CONTENT_SELECTORS) {
    throw contentLimit("content-selectors", MAX_CONTENT_SELECTORS, count);
  }
  const argumentBytes = canonicalBytes(value);
  if (argumentBytes > MAX_CONTENT_ARGUMENT_BYTES) {
    throw contentLimit("content-arguments", MAX_CONTENT_ARGUMENT_BYTES, argumentBytes);
  }
  if (query.kind === "worksheet") {
    query.worksheets.forEach(validateWorksheetSelector);
  } else if (query.kind === "worksheet-range") {
    let requestedCells = 0;
    for (const request of query.ranges) {
      validateWorksheetSelector(request.worksheet);
      const area = a1Area(request.range);
      if (area === undefined || !Number.isSafeInteger(requestedCells + area)) {
        throw contentLimit("worksheet-cells", MAX_CONTENT_REQUESTED_CELLS);
      }
      requestedCells += area;
      if (requestedCells > MAX_CONTENT_REQUESTED_CELLS) {
        throw contentLimit("worksheet-cells", MAX_CONTENT_REQUESTED_CELLS, requestedCells);
      }
    }
  } else if (query.kind === "slide") {
    query.slides.forEach(validateIndexedSelector);
  } else if (query.kind === "paragraph") {
    query.paragraphs.forEach(validateIndexedSelector);
  }
  return value as unknown as WorkspaceContentInspectArgs;
}

function validateQueryShape(value: unknown): ContentInspectionQuery {
  if (!isPlainRecord(value) || typeof value["kind"] !== "string") throw invalidArguments();
  switch (value["kind"]) {
    case "workbook":
    case "presentation":
    case "document":
      if (!hasExactKeys(value, ["kind"])) throw invalidArguments();
      return value as unknown as ContentInspectionQuery;
    case "worksheet":
      if (!hasExactKeys(value, ["kind", "worksheets"]) || !nonEmptyArray(value["worksheets"])) {
        throw invalidArguments();
      }
      return value as unknown as ContentInspectionQuery;
    case "worksheet-range":
      if (!hasExactKeys(value, ["kind", "ranges"]) || !nonEmptyArray(value["ranges"])) {
        throw invalidArguments();
      }
      for (const request of value["ranges"]) {
        if (
          !isPlainRecord(request)
          || !hasExactKeys(request, ["range", "worksheet"])
          || typeof request["range"] !== "string"
          || !isPlainRecord(request["worksheet"])
        ) throw invalidArguments();
      }
      return value as unknown as ContentInspectionQuery;
    case "slide":
      if (!hasExactKeys(value, ["kind", "slides"]) || !nonEmptyArray(value["slides"])) {
        throw invalidArguments();
      }
      return value as unknown as ContentInspectionQuery;
    case "paragraph":
      if (!hasExactKeys(value, ["kind", "paragraphs"]) || !nonEmptyArray(value["paragraphs"])) {
        throw invalidArguments();
      }
      return value as unknown as ContentInspectionQuery;
    default:
      throw invalidArguments();
  }
}

function validateWorksheetSelector(value: unknown): void {
  if (!isPlainRecord(value)) throw invalidArguments();
  if (hasExactKeys(value, ["id"]) && nonBlank(value["id"])) return;
  if (hasExactKeys(value, ["name"]) && nonBlank(value["name"])) return;
  if (hasExactKeys(value, ["index"]) && nonNegativeInteger(value["index"])) return;
  throw invalidArguments();
}

function validateIndexedSelector(value: unknown): void {
  if (!isPlainRecord(value)) throw invalidArguments();
  if (hasExactKeys(value, ["id"]) && nonBlank(value["id"])) return;
  if (hasExactKeys(value, ["index"]) && nonNegativeInteger(value["index"])) return;
  throw invalidArguments();
}

function a1Area(value: string): number | undefined {
  const match = /^\$?([A-Za-z]+)\$?(\d+)(?::\$?([A-Za-z]+)\$?(\d+))?$/u.exec(value);
  if (match === null) throw invalidSelector();
  const startColumn = columnNumber(match[1]!);
  const startRow = Number(match[2]);
  const endColumn = match[3] === undefined ? startColumn : columnNumber(match[3]);
  const endRow = match[4] === undefined ? startRow : Number(match[4]);
  if (startRow === 0 || endRow === 0) {
    throw invalidSelector();
  }
  if (
    startColumn === undefined
    || endColumn === undefined
    || !Number.isSafeInteger(startRow)
    || !Number.isSafeInteger(endRow)
  ) return undefined;
  if (endColumn < startColumn || endRow < startRow) throw invalidSelector();
  const columns = endColumn - startColumn + 1;
  const rows = endRow - startRow + 1;
  const area = columns * rows;
  return Number.isSafeInteger(area) ? area : undefined;
}

function columnNumber(value: string): number | undefined {
  let result = 0;
  for (const character of value.toUpperCase()) {
    result = result * 26 + character.charCodeAt(0) - 64;
    if (!Number.isSafeInteger(result)) return undefined;
  }
  return result;
}

export function validateWorkspaceContentInspectionResult(
  args: WorkspaceContentInspectArgs,
  value: unknown,
): asserts value is ContentInspectionResult {
  if (!isPlainRecord(value) || value["kind"] !== args.query.kind || value["unitId"] !== args.unit_id) {
    throw invalidInspectionResult();
  }
  switch (args.query.kind) {
    case "workbook":
      exactResult(value, ["kind", "name", "unitId", "worksheets"]);
      requireString(value["name"]);
      validateArray(value["worksheets"], validateWorksheetOverview);
      break;
    case "worksheet":
      exactResult(value, ["kind", "unitId", "worksheets"]);
      validateArray(value["worksheets"], validateWorksheetOverview);
      if ((value["worksheets"] as unknown[]).length !== args.query.worksheets.length) {
        throw invalidInspectionResult();
      }
      (value["worksheets"] as unknown[]).forEach((worksheet, index) =>
        matchSelector(worksheet, args.query.kind === "worksheet" ? args.query.worksheets[index] : undefined));
      break;
    case "worksheet-range": {
      exactResult(value, ["kind", "ranges", "unitId"]);
      const ranges = requireArray(value["ranges"]);
      const requests = args.query.ranges;
      if (ranges.length !== requests.length) throw invalidInspectionResult();
      ranges.forEach((range, index) => validateWorksheetRange(range, requests[index]!));
      break;
    }
    case "presentation":
      exactResult(value, ["kind", "layoutSlideCount", "masterSlideCount", "name", "size", "slides", "unitId"]);
      requireNonNegativeInteger(value["layoutSlideCount"]);
      requireNonNegativeInteger(value["masterSlideCount"]);
      requireString(value["name"]);
      validateSize(value["size"]);
      validateArray(value["slides"], validateSlideSummary);
      break;
    case "slide":
      exactResult(value, ["kind", "slides", "unitId"]);
      validateArray(value["slides"], validateSlideDetails);
      if ((value["slides"] as unknown[]).length !== args.query.slides.length) {
        throw invalidInspectionResult();
      }
      (value["slides"] as unknown[]).forEach((slide, index) =>
        matchSelector(slide, args.query.kind === "slide" ? args.query.slides[index] : undefined));
      break;
    case "document":
      validateDocument(value);
      break;
    case "paragraph":
      exactResult(value, ["kind", "paragraphs", "unitId"]);
      validateArray(value["paragraphs"], validateParagraphDetails);
      if ((value["paragraphs"] as unknown[]).length !== args.query.paragraphs.length) {
        throw invalidInspectionResult();
      }
      (value["paragraphs"] as unknown[]).forEach((paragraph, index) =>
        matchSelector(paragraph, args.query.kind === "paragraph" ? args.query.paragraphs[index] : undefined));
      break;
  }
  const bytes = canonicalBytes(value);
  if (bytes > MAX_CONTENT_CANONICAL_BYTES) {
    throw contentLimit("content-output", MAX_CONTENT_CANONICAL_BYTES, bytes);
  }
}

function validateWorksheetOverview(value: unknown): void {
  const record = exactResult(value, [
    "columnCount", "conditionalFormatting", "dataValidation", "drawings", "formulaUsedRanges",
    "id", "index", "mergedRanges", "name", "rowCount", "styleUsedRanges", "tables",
    "valueUsedRanges",
  ]);
  validateWorksheetIdentity(record);
  requireNonNegativeInteger(record["columnCount"]);
  requireNonNegativeInteger(record["rowCount"]);
  validateRuleSummary(record["conditionalFormatting"]);
  validateRuleSummary(record["dataValidation"]);
  validateDrawingSummary(record["drawings"]);
  for (const key of ["formulaUsedRanges", "mergedRanges", "styleUsedRanges", "valueUsedRanges"] as const) {
    validateArray(record[key], requireString);
  }
  validateArray(record["tables"], (table) => {
    const item = exactResult(table, ["id", "name", "range"]);
    requireString(item["id"]);
    requireString(item["name"]);
    requireString(item["range"]);
  });
}

function validateWorksheetIdentity(value: unknown): void {
  const record = isPlainRecord(value) ? value : invalidInspectionResult();
  requireString(record["id"]);
  requireNonNegativeInteger(record["index"]);
  requireString(record["name"]);
}

function validateRuleSummary(value: unknown): void {
  const record = exactResult(value, ["count", "ranges"]);
  requireNonNegativeInteger(record["count"]);
  validateArray(record["ranges"], requireString);
}

function validateDrawingSummary(value: unknown): void {
  const record = exactResult(value, ["charts", "images", "shapes", "total"]);
  for (const key of ["charts", "images", "shapes", "total"] as const) {
    requireNonNegativeInteger(record[key]);
  }
}

function validateWorksheetRange(
  value: unknown,
  request: { readonly range: string; readonly worksheet: unknown },
): void {
  const record = exactResult(value, [
    "cellData", "clipped", "displayValues", "requestedRange", "resolvedRange", "worksheet",
  ]);
  if (record["requestedRange"] !== request.range) throw invalidInspectionResult();
  requireString(record["resolvedRange"]);
  if (typeof record["clipped"] !== "boolean") throw invalidInspectionResult();
  const worksheet = exactResult(record["worksheet"], ["id", "index", "name"]);
  validateWorksheetIdentity(worksheet);
  matchSelector(worksheet, request.worksheet);
  validateArray(record["displayValues"], (row) => validateArray(row, requireString));
  validateArray(record["cellData"], (row) => validateArray(row, (cell) => {
    if (cell === null) return;
    const data = exactResult(cell, [], ["custom", "f", "p", "ref", "s", "si", "t", "v", "xf"]);
    if (data["v"] !== undefined && !(
      data["v"] === null
      || typeof data["v"] === "string"
      || typeof data["v"] === "boolean"
      || (typeof data["v"] === "number" && Number.isFinite(data["v"]))
    )) throw invalidInspectionResult();
    if (data["t"] !== undefined && !(
      data["t"] === null
      || (Number.isInteger(data["t"]) && Number(data["t"]) >= 1 && Number(data["t"]) <= 4)
    )) throw invalidInspectionResult();
    for (const key of ["f", "ref", "si", "xf"] as const) {
      if (data[key] !== undefined && data[key] !== null && typeof data[key] !== "string") {
        throw invalidInspectionResult();
      }
    }
    for (const key of ["custom", "p"] as const) {
      if (data[key] !== undefined && data[key] !== null && !isPlainRecord(data[key])) {
        throw invalidInspectionResult();
      }
    }
    if (
      data["s"] !== undefined
      && data["s"] !== null
      && typeof data["s"] !== "string"
      && !isPlainRecord(data["s"])
    ) throw invalidInspectionResult();
    for (const item of Object.values(data)) validateJson(item, 0);
  }));
}

function matchSelector(identity: unknown, selector: unknown): void {
  if (!isPlainRecord(identity) || !isPlainRecord(selector)) throw invalidInspectionResult();
  if (Object.hasOwn(selector, "id") && identity["id"] !== selector["id"]) throw invalidInspectionResult();
  if (Object.hasOwn(selector, "name") && identity["name"] !== selector["name"]) throw invalidInspectionResult();
  if (Object.hasOwn(selector, "index") && identity["index"] !== selector["index"]) throw invalidInspectionResult();
}

function validateSize(value: unknown): void {
  const record = exactResult(value, ["height", "width"]);
  requireFiniteNumber(record["height"]);
  requireFiniteNumber(record["width"]);
}

function validateSlideSummary(value: unknown): void {
  const record = exactResult(
    value,
    ["elementCounts", "hasSpeakerNotes", "id", "index", "name"],
    ["textPreview"],
  );
  validateElementCounts(record["elementCounts"]);
  if (typeof record["hasSpeakerNotes"] !== "boolean") throw invalidInspectionResult();
  requireString(record["id"]);
  requireNonNegativeInteger(record["index"]);
  requireString(record["name"]);
  if (record["textPreview"] !== undefined) requireString(record["textPreview"]);
}

function validateElementCounts(value: unknown): void {
  const record = exactResult(value, ["charts", "groups", "images", "shapes", "tables", "text", "total"]);
  for (const key of ["charts", "groups", "images", "shapes", "tables", "text", "total"] as const) {
    requireNonNegativeInteger(record[key]);
  }
}

function validateSlideDetails(value: unknown): void {
  const record = exactResult(
    value,
    ["elementCounts", "elements", "hasSpeakerNotes", "id", "index", "name", "speakerNotes"],
    ["textPreview"],
  );
  validateSlideSummary({
    elementCounts: record["elementCounts"],
    hasSpeakerNotes: record["hasSpeakerNotes"],
    id: record["id"],
    index: record["index"],
    name: record["name"],
    ...(record["textPreview"] === undefined ? {} : { textPreview: record["textPreview"] }),
  });
  requireString(record["speakerNotes"]);
  validateArray(record["elements"], (element) => validateSlideElement(element, 1));
}

function validateSlideElement(value: unknown, depth: number): void {
  if (depth > MAX_CONTENT_JSON_DEPTH) throw contentLimit("content-depth", MAX_CONTENT_JSON_DEPTH, depth);
  const record = exactResult(
    value,
    ["id", "name", "type", "visible"],
    ["chartId", "children", "fill", "mediaType", "stroke", "tableId", "tableText", "text", "transform"],
  );
  requireString(record["id"]);
  requireString(record["name"]);
  requireString(record["type"]);
  if (typeof record["visible"] !== "boolean") throw invalidInspectionResult();
  for (const key of ["chartId", "mediaType", "tableId"] as const) {
    if (record[key] !== undefined) requireString(record[key]);
  }
  for (const key of ["fill", "stroke"] as const) {
    if (record[key] !== undefined) validateJson(record[key], 0);
  }
  if (record["children"] !== undefined) {
    validateArray(record["children"], (child) => validateSlideElement(child, depth + 1));
  }
  if (record["tableText"] !== undefined) {
    validateArray(record["tableText"], (row) => validateArray(row, requireString));
  }
  if (record["text"] !== undefined) {
    const text = exactResult(record["text"], ["text"], ["alignment", "insets"]);
    requireString(text["text"]);
    if (text["alignment"] !== undefined) validateJson(text["alignment"], 0);
    if (text["insets"] !== undefined) validateJson(text["insets"], 0);
  }
  if (record["transform"] !== undefined) {
    const transform = exactResult(record["transform"], [], ["angle", "height", "left", "top", "width"]);
    for (const key of ["angle", "height", "left", "top", "width"] as const) {
      if (transform[key] !== undefined) requireFiniteNumber(transform[key]);
    }
  }
}

function validateDocument(value: Record<string, unknown>): void {
  const record = exactResult(value, [
    "characterCount", "features", "kind", "mode", "paragraphCount", "paragraphs", "title", "unitId",
  ]);
  requireNonNegativeInteger(record["characterCount"]);
  requireNonNegativeInteger(record["paragraphCount"]);
  if (!new Set(["modern", "paginated", "unspecified"]).has(record["mode"] as string)) {
    throw invalidInspectionResult();
  }
  requireString(record["title"]);
  const features = exactResult(record["features"], ["blockRanges", "customBlocks", "drawings", "lists", "tables"]);
  for (const key of ["blockRanges", "customBlocks", "drawings", "lists", "tables"] as const) {
    requireNonNegativeInteger(features[key]);
  }
  validateArray(record["paragraphs"], (paragraph) => {
    const item = exactResult(paragraph, ["id", "index", "textPreview"]);
    requireString(item["id"]);
    requireNonNegativeInteger(item["index"]);
    requireString(item["textPreview"]);
  });
}

function validateParagraphDetails(value: unknown): void {
  const record = exactResult(value, ["id", "index", "text", "textRuns"], ["bullet", "list", "style"]);
  requireString(record["id"]);
  requireNonNegativeInteger(record["index"]);
  requireString(record["text"]);
  validateArray(record["textRuns"], (run) => validateJson(run, 0));
  for (const key of ["bullet", "list", "style"] as const) {
    if (record[key] !== undefined) validateJson(record[key], 0);
  }
}

function validateJson(value: unknown, depth: number): void {
  if (depth > MAX_CONTENT_JSON_DEPTH) throw contentLimit("content-depth", MAX_CONTENT_JSON_DEPTH, depth);
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value))
  ) return;
  if (Array.isArray(value)) {
    if (Reflect.ownKeys(value).some((key) => key !== "length" && !/^\d+$/u.test(String(key)))) {
      throw invalidInspectionResult();
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw invalidInspectionResult();
      validateJson(value[index], depth + 1);
    }
    return;
  }
  if (!isPlainRecord(value)) throw invalidInspectionResult();
  if (Reflect.ownKeys(value).length !== Object.keys(value).length) throw invalidInspectionResult();
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) throw invalidInspectionResult();
    validateJson(descriptor.value, depth + 1);
  }
}

function exactResult(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!isPlainRecord(value) || !hasExactKeys(value, required, optional)) throw invalidInspectionResult();
  return value;
}

function invalidInspectionResult(): never {
  throw contentFailure("INSPECTION_RESULT_INVALID");
}

function validateArray(value: unknown, validate: (item: unknown) => void): void {
  for (const item of requireArray(value)) validate(item);
}

function requireArray(value: unknown): unknown[] {
  if (!validArrayShape(value)) throw invalidInspectionResult();
  return value;
}

function requireString(value: unknown): void {
  if (typeof value !== "string") throw invalidInspectionResult();
}

function requireFiniteNumber(value: unknown): void {
  if (typeof value !== "number" || !Number.isFinite(value)) throw invalidInspectionResult();
}

function requireNonNegativeInteger(value: unknown): void {
  if (!nonNegativeInteger(value)) throw invalidInspectionResult();
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function nonEmptyArray(value: unknown): value is unknown[] {
  return validArrayShape(value) && value.length > 0;
}

function validArrayShape(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false;
  if (Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function canonicalBytes(value: unknown): number {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw invalidArguments();
  }
  if (serialized === undefined) throw invalidArguments();
  return Buffer.byteLength(serialized);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return Reflect.ownKeys(value).length === keys.length
    && required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return allowed.has(key)
        && descriptor !== undefined
        && "value" in descriptor
        && descriptor.value !== undefined;
    });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
