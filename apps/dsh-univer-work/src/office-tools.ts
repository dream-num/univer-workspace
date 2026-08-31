import { extname } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { FileSystem, FsTarget } from "@deepseek-ai/dsh-fs";
import { HarnessError } from "@deepseek-ai/dsh-llm";
import type { SandboxPolicyService } from "@deepseek-ai/dsh-sandbox-policy";
import {
  defineTool,
  TOOL_ABORTED,
  type PreToolDecision,
  type ToolExecutionResult,
  type ToolRunContext,
} from "@deepseek-ai/dsh-tools";
import {
  CollaborationRuntimeError,
  ExchangeError,
  ExchangeErrorCode,
  UniverCollaborationRuntimePoolError,
  WorkspaceApplicationError,
  type WorkspaceExportFileResult,
  type WorkspaceImportFileResult,
  type WorkspaceUnitExchangeFeature,
} from "@univerjs/univer-workspace-client-core";
import {
  WorkspaceAuthenticationRequiredError,
  WorkspaceCredentialError,
} from "./authentication-state.js";
import type {
  WorkspaceOwnedExecution,
  WorkspaceToolOwner,
} from "./tool-owner.js";
import {
  currentFilesystem,
  currentPolicy,
  projectWorkspaceFileEffectFailure,
  requireLocal,
  resolveContainedPath,
} from "./file-transfer.js";
import { closeWorkspaceTool } from "./space-node.js";
import { WorkspaceOwnerNotAcceptingError } from "./tool-owner.js";

export const MAX_OFFICE_ARGUMENT_BYTES = 524_288;
export const MAX_OFFICE_FILE_BYTES = 52_428_800;
export const MAX_OFFICE_JSON_DEPTH = 64;

export interface WorkspaceOfficeDependencies {
  readonly office: Pick<WorkspaceUnitExchangeFeature, "exportFile" | "importFile">;
  readonly owner: WorkspaceToolOwner;
}

export interface WorkspaceOfficeImportArgs {
  readonly idempotency_key?: string;
  readonly name?: string;
  readonly parent_node_id?: string;
  readonly source_path: string;
  readonly space_id: string;
  readonly type?: "base" | "doc" | "sheet" | "slide";
  readonly worktree_id: string;
}

export interface WorkspaceOfficeExportArgs {
  readonly force?: boolean;
  readonly output_path: string;
  readonly unit_id: string;
  readonly worktree_id: string;
}

type OfficeOperation = "export" | "import";
type OfficeArgs = WorkspaceOfficeExportArgs | WorkspaceOfficeImportArgs;

const stringSchema = { type: "string", required: true } as const;
export const workspaceOfficeImportParameters = {
  source_path: stringSchema,
  worktree_id: stringSchema,
  space_id: stringSchema,
  type: { type: "string", enum: ["sheet", "base", "doc", "slide"] },
  name: { type: "string" },
  parent_node_id: { type: "string" },
  idempotency_key: { type: "string" },
} as const;
export const workspaceOfficeExportParameters = {
  output_path: stringSchema,
  worktree_id: stringSchema,
  unit_id: stringSchema,
  force: { type: "boolean" },
} as const;

const unitTypeSchema = {
  type: "string",
  enum: ["sheet", "base", "doc", "slide"],
  required: true,
} as const;
export const workspaceOfficeImportOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    committed: { type: "boolean", const: true, required: true },
    name: stringSchema,
    nodeId: stringSchema,
    resourceId: stringSchema,
    sourcePath: stringSchema,
    type: unitTypeSchema,
    unitId: stringSchema,
    worktreeId: stringSchema,
  },
} as const;
export const workspaceOfficeExportOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    outputPath: stringSchema,
    type: unitTypeSchema,
    unitId: stringSchema,
    worktreeId: stringSchema,
  },
} as const;

export function registerWorkspaceOfficeTools(
  ctx: Context,
  dependencies: WorkspaceOfficeDependencies,
): readonly (() => void)[] {
  const sandboxPolicy = ctx.get("sandboxPolicy") as SandboxPolicyService | undefined;
  const definitions = [
    closeWorkspaceTool(defineTool({
      name: "workspace_office_import",
      description: "Import one approved Host-local Office file as a new Workspace Worktree Unit.",
      parameters: workspaceOfficeImportParameters,
      output: {
        schema: workspaceOfficeImportOutputSchema,
        render: (_args, value) => [{
          type: "text",
          text: `Imported ${value.type} Unit ${value.name} (${value.unitId}) into Worktree ${value.worktreeId}.`,
        }],
      },
      finalizeContent: officeFinalizer("import"),
      execute: async (args, exec) => {
        const input = validateWorkspaceOfficeImportArgs(args);
        return await executeOfficeOwned(dependencies.owner, "import", input, exec, async (owned) => {
        const filesystem = currentFilesystem(ctx, "office import");
        requireLocal(filesystem, "office import");
        const source = await resolveOfficeSource(filesystem, exec, input.source_path, owned.signal);
        const sourcePath = filesystem.processPath(source);
        owned.signal.throwIfAborted();
        const result = await dependencies.office.importFile({
          sourcePath,
          spaceId: input.space_id,
          worktreeId: input.worktree_id,
          ...(input.type === undefined ? {} : { type: input.type }),
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.parent_node_id === undefined ? {} : { parentNodeId: input.parent_node_id }),
          ...(input.idempotency_key === undefined ? {} : { idempotencyKey: input.idempotency_key }),
        }, {
          maxSourceBytes: MAX_OFFICE_FILE_BYTES,
          maxUnitDataBytes: MAX_OFFICE_FILE_BYTES,
          maxUnitDataDepth: MAX_OFFICE_JSON_DEPTH,
          signal: owned.signal,
        });
        validateWorkspaceOfficeImportResult(input, sourcePath, result);
        return result as never;
        });
      },
    }), validateWorkspaceOfficeImportArgs),
    closeWorkspaceTool(defineTool({
      name: "workspace_office_export",
      description: "Export one authoritative Workspace Worktree Unit head to an approved Host-local Office file.",
      parameters: workspaceOfficeExportParameters,
      output: {
        schema: workspaceOfficeExportOutputSchema,
        render: (_args, value) => [{
          type: "text",
          text: `Exported ${value.type} Unit ${value.unitId} from Worktree ${value.worktreeId} to ${value.outputPath}.`,
        }],
      },
      finalizeContent: officeFinalizer("export"),
      execute: async (args, exec) => {
        const input = validateWorkspaceOfficeExportArgs(args);
        return await executeOfficeOwned(dependencies.owner, "export", input, exec, async (owned) => {
        const filesystem = currentFilesystem(ctx, "office export");
        const policy = currentPolicy(filesystem, sandboxPolicy, exec, "office export");
        requireLocal(filesystem, "office export");
        const target = await resolveContainedPath(
          filesystem,
          policy,
          exec,
          input.output_path,
          "office export",
          owned.signal,
        );
        const outputPath = filesystem.processPath(target);
        owned.signal.throwIfAborted();
        const result = await dependencies.office.exportFile({
          outputPath,
          unitId: input.unit_id,
          worktreeId: input.worktree_id,
        }, {
          atomicOutput: { force: input.force === true, maxOutputBytes: MAX_OFFICE_FILE_BYTES },
          maxUnitDataBytes: MAX_OFFICE_FILE_BYTES,
          maxUnitDataDepth: MAX_OFFICE_JSON_DEPTH,
          signal: owned.signal,
        });
        validateWorkspaceOfficeExportResult(input, outputPath, result);
        return result as never;
        });
      },
    }), validateWorkspaceOfficeExportArgs),
  ];

  return [
    ...definitions.map((definition) => ctx.tools.register(definition)),
    ctx.on("tools/pre-execute", async (exec, next): Promise<PreToolDecision> => {
      if (exec.name === "workspace_office_import") {
        validateWorkspaceOfficeImportArgs(exec.arguments);
        return { kind: "ask", reason: "Workspace Office import creates a new remote Worktree Unit." };
      }
      if (exec.name !== "workspace_office_export") return await next();
      try {
        const filesystem = currentFilesystem(ctx, "office export");
        const policy = currentPolicy(filesystem, sandboxPolicy, exec, "office export");
        requireLocal(filesystem, "office export");
        const input = validateWorkspaceOfficeExportArgs(exec.arguments);
        await resolveContainedPath(
          filesystem,
          policy,
          exec,
          input.output_path,
          "office export",
          exec.signal,
        );
        return { kind: "ask", reason: "Workspace Office export writes a Host-local file." };
      } catch (error) {
        if (error instanceof OfficeToolError) throw error;
        throw projectWorkspaceFileEffectFailure(error, "office export") ?? officeFailed("export");
      }
    }),
  ];
}

function officeFinalizer(operation: OfficeOperation) {
  return (_exec: unknown, result: Readonly<ToolExecutionResult>) => {
    if (!result.isError) return undefined;
    const code = result.error.info?.code;
    if (
      code !== TOOL_ABORTED
      && !(operation === "import" && officeCreateOutcomeUnknown.has(code ?? ""))
    ) return undefined;
    return [{
      type: "text" as const,
      text: operation === "import"
        ? "The Workspace Office import may have created a Unit. Inspect current state with workspace_unit_list and workspace_worktree_get before deciding any next action. Never replay the import or Unit create automatically."
        : "The Workspace Office export may have completed. Inspect the requested destination before deciding any next action. Never replay the export automatically.",
    }];
  };
}

async function executeOfficeOwned<Result>(
  owner: WorkspaceToolOwner,
  operation: OfficeOperation,
  args: OfficeArgs,
  exec: ToolRunContext,
  body: (owned: WorkspaceOwnedExecution) => Promise<Result>,
): Promise<Result> {
  try {
    return await owner.run(exec, async (owned) => {
      try {
        owned.signal.throwIfAborted();
        return await body(owned);
      } catch (error) {
        throw sanitizeOfficeFailure(operation, args, error, owned);
      }
    });
  } catch (error) {
    if (error instanceof OfficeToolError) throw error;
    const projected = projectWorkspaceFileEffectFailure(error, `office ${operation}`);
    if (projected !== undefined) throw projected;
    if (error instanceof WorkspaceOwnerNotAcceptingError) throw disposing(operation);
    throw officeFailed(operation);
  }
}

function sanitizeOfficeFailure(
  operation: OfficeOperation,
  args: OfficeArgs,
  error: unknown,
  owned: WorkspaceOwnedExecution,
): Error {
  if (error instanceof OfficeToolError) return error;
  const projected = projectWorkspaceFileEffectFailure(error, `office ${operation}`);
  if (projected !== undefined) return projected;
  if (
    operation === "import"
    && error instanceof WorkspaceApplicationError
    && officeCreateOutcomeUnknown.has(error.code)
  ) return officeFailure(operation, error.code, officeIdentity(args, error.detail));
  if (owned.ownerSignal.aborted) return disposing(operation);
  if (owned.callerSignal.aborted) return cancelled(operation);
  if (
    error instanceof WorkspaceAuthenticationRequiredError
    || error instanceof WorkspaceCredentialError
  ) return officeFailure(operation, "workspace-authentication-required");
  if (
    error instanceof ExchangeError
    && Object.getPrototypeOf(error) === ExchangeError.prototype
    && exchangeErrorCodes.has(error.code)
  ) {
    return officeFailure(operation, "workspace-office-conversion-failed", {
      exchangeCode: error.code,
      phase: operation,
    });
  }
  if (error instanceof WorkspaceApplicationError && stableOfficeCodes.has(error.code)) {
    return officeFailure(operation, error.code, projectOfficeDetail(error.detail, args));
  }
  if (
    (error instanceof CollaborationRuntimeError
      || error instanceof UniverCollaborationRuntimePoolError)
    && stableOfficeCodes.has(error.code)
  ) return officeFailure(operation, error.code);
  return officeFailed(operation);
}

const officeCreateOutcomeUnknown = new Set([
  "workspace-invalid-response",
  "workspace-result-mismatch",
  "workspace-result-unknown",
]);

const exchangeErrorCodes = new Set<string>([
  ExchangeErrorCode.INVALID_ARGUMENT,
  ExchangeErrorCode.UNSUPPORTED_FORMAT,
  ExchangeErrorCode.INVALID_FILE,
  ExchangeErrorCode.INCOMPLETE_SNAPSHOT,
  ExchangeErrorCode.IO_ERROR,
  ExchangeErrorCode.NATIVE_LOAD_FAILED,
  ExchangeErrorCode.CONVERSION_FAILED,
]);

const stableOfficeCodes = new Set([
  "workspace-argument-invalid",
  "workspace-authentication-required",
  "workspace-blob-source-invalid",
  "workspace-blob-source-unavailable",
  "workspace-blob-size-mismatch",
  "workspace-exchange-export-format-mismatch",
  "workspace-exchange-export-format-unsupported",
  "workspace-exchange-import-format-unsupported",
  "workspace-exchange-unit-data-invalid",
  "workspace-invalid-response",
  "workspace-license-required",
  "workspace-office-limit-exceeded",
  "workspace-office-output-exists",
  "workspace-office-output-invalid-state",
  "workspace-office-output-unavailable",
  "workspace-office-output-write-failed",
  "workspace-origin-mismatch",
  "workspace-redirect-refused",
  "workspace-request-invalid",
  "workspace-result-mismatch",
  "workspace-result-unknown",
  "workspace-unit-type-unsupported",
  "workspace-worktree-not-editable",
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
  "PAYLOAD_TOO_LARGE",
  "INTERNAL_ERROR",
]);

function projectOfficeDetail(
  value: unknown,
  args: OfficeArgs,
): Record<string, unknown> | undefined {
  if (!isPlainRecord(value)) return undefined;
  const detail: Record<string, unknown> = {};
  for (const [source, target] of [
    ["worktreeId", "worktree_id"],
    ["unitId", "unit_id"],
    ["spaceId", "space_id"],
    ["idempotencyKey", "idempotency_key"],
  ] as const) {
    const expected = dataProperty(args, target);
    if (typeof expected === "string" && dataProperty(value, source) === expected) {
      detail[source] = expected;
    }
  }
  const kind = dataProperty(value, "kind");
  if (
    typeof kind === "string"
    && new Set(["source-bytes", "unit-data-bytes", "unit-data-depth", "output-bytes"]).has(kind)
  ) detail["kind"] = kind;
  for (const key of ["limit", "actual", "expectedByteSize", "actualByteSize"] as const) {
    const current = dataProperty(value, key);
    if (Number.isSafeInteger(current) && (current as number) >= 0) detail[key] = current;
  }
  return Object.keys(detail).length === 0 ? undefined : detail;
}

function officeIdentity(args: OfficeArgs, value?: unknown): Record<string, unknown> {
  if (!("space_id" in args)) return { worktreeId: args.worktree_id };
  const result: Record<string, unknown> = {
    spaceId: args.space_id,
    worktreeId: args.worktree_id,
    ...(args.idempotency_key === undefined ? {} : { idempotencyKey: args.idempotency_key }),
    ...(args.parent_node_id === undefined ? {} : { parentNodeId: args.parent_node_id }),
  };
  if (args.idempotency_key !== undefined) return result;
  const request = isPlainRecord(value) ? dataProperty(value, "request") : undefined;
  if (!isPlainRecord(request)) return result;
  const idempotencyKey = dataProperty(request, "idempotencyKey");
  if (
    dataProperty(request, "spaceId") === args.space_id
    && dataProperty(request, "worktreeId") === args.worktree_id
    && typeof idempotencyKey === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(idempotencyKey)
  ) result["idempotencyKey"] = idempotencyKey;
  return result;
}

export function validateWorkspaceOfficeImportArgs(value: unknown): WorkspaceOfficeImportArgs {
  const record = exactRecord(value, ["source_path", "space_id", "worktree_id"], [
    "idempotency_key", "name", "parent_node_id", "type",
  ]);
  const sourcePath = requiredString(record, "source_path");
  const worktreeId = requiredString(record, "worktree_id");
  const spaceId = requiredString(record, "space_id");
  const type = optionalString(record, "type");
  const name = optionalString(record, "name");
  const parentNodeId = optionalString(record, "parent_node_id");
  const idempotencyKey = optionalString(record, "idempotency_key");
  if (type !== undefined && !resultType(type)) throw invalidArguments("import");
  if (!compatibleImport(sourcePath, type)) throw invalidArguments("import");
  const result: WorkspaceOfficeImportArgs = {
    source_path: sourcePath,
    space_id: spaceId,
    worktree_id: worktreeId,
    ...(type === undefined ? {} : { type }),
    ...(name === undefined ? {} : { name }),
    ...(parentNodeId === undefined ? {} : { parent_node_id: parentNodeId }),
    ...(idempotencyKey === undefined ? {} : { idempotency_key: idempotencyKey }),
  };
  enforceArgumentBytes(result, "import");
  return result;
}

export function validateWorkspaceOfficeExportArgs(value: unknown): WorkspaceOfficeExportArgs {
  const record = exactRecord(value, ["output_path", "unit_id", "worktree_id"], ["force"]);
  const outputPath = requiredString(record, "output_path");
  const unitId = requiredString(record, "unit_id");
  const worktreeId = requiredString(record, "worktree_id");
  const force = dataProperty(record, "force");
  if (force !== undefined && typeof force !== "boolean") throw invalidArguments("export");
  if (![".xlsx", ".docx", ".pptx"].includes(extname(outputPath).toLowerCase())) {
    throw invalidArguments("export");
  }
  const result: WorkspaceOfficeExportArgs = {
    output_path: outputPath,
    unit_id: unitId,
    worktree_id: worktreeId,
    ...(force === undefined ? {} : { force }),
  };
  enforceArgumentBytes(result, "export");
  return result;
}

function validateWorkspaceOfficeImportResult(
  args: WorkspaceOfficeImportArgs,
  sourcePath: string,
  value: unknown,
): asserts value is WorkspaceImportFileResult {
  const record = exactResult(value, [
    "committed", "name", "nodeId", "resourceId", "sourcePath", "type", "unitId", "worktreeId",
  ]);
  const expectedType = args.type ?? inferredImportType(args.source_path);
  if (
    record["committed"] !== true
    || record["sourcePath"] !== sourcePath
    || record["worktreeId"] !== args.worktree_id
    || !resultType(record["type"])
    || record["type"] !== expectedType
    || (args.name !== undefined && record["name"] !== args.name)
  ) throw invalidResult("import");
  for (const key of ["name", "nodeId", "resourceId", "unitId"] as const) requiredResultString(record, key, "import");
}

function validateWorkspaceOfficeExportResult(
  args: WorkspaceOfficeExportArgs,
  outputPath: string,
  value: unknown,
): asserts value is WorkspaceExportFileResult {
  const record = exactResult(value, ["outputPath", "type", "unitId", "worktreeId"]);
  if (
    record["outputPath"] !== outputPath
    || record["unitId"] !== args.unit_id
    || record["worktreeId"] !== args.worktree_id
    || !resultType(record["type"])
    || !compatibleExport(outputPath, record["type"])
  ) throw invalidResult("export");
}

async function resolveOfficeSource(
  filesystem: FileSystem,
  exec: Pick<ToolRunContext, "agent" | "signal">,
  path: string,
  signal: AbortSignal,
): Promise<FsTarget> {
  const target = await resolveContainedPath(filesystem, undefined, exec, path, "office import", signal);
  const metadata = await filesystem.stat(target, signal);
  signal.throwIfAborted();
  if (metadata?.type !== "file") throw officeFailed("import");
  return target;
}

function compatibleImport(path: string, type: string | undefined): boolean {
  const extension = extname(path).toLowerCase();
  if (extension === ".xls" || extension === ".xlsx") {
    return type === undefined || type === "sheet" || type === "base";
  }
  if (extension === ".doc" || extension === ".docx") return type === undefined || type === "doc";
  if ([".ppt", ".pptx", ".pptm", ".ppsx", ".ppsm", ".potx"].includes(extension)) {
    return type === undefined || type === "slide";
  }
  return false;
}

function inferredImportType(path: string): "doc" | "sheet" | "slide" {
  const extension = extname(path).toLowerCase();
  if (extension === ".xls" || extension === ".xlsx") return "sheet";
  if (extension === ".doc" || extension === ".docx") return "doc";
  return "slide";
}

function compatibleExport(path: string, type: "base" | "doc" | "sheet" | "slide"): boolean {
  const extension = extname(path).toLowerCase();
  if (extension === ".xlsx") return type === "sheet" || type === "base";
  if (extension === ".docx") return type === "doc";
  return extension === ".pptx" && type === "slide";
}

function enforceArgumentBytes(value: object, operation: "export" | "import"): void {
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_OFFICE_ARGUMENT_BYTES) throw invalidArguments(operation);
}

function exactRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
): Record<string, unknown> {
  if (!isPlainRecord(value)) throw invalidArguments("operation");
  const allowed = new Set([...required, ...optional]);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.some((key) => typeof key !== "string" || !allowed.has(key))
    || required.some((key) => !Object.hasOwn(value, key))
  ) throw invalidArguments("operation");
  for (const key of ownKeys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined
      || !("value" in descriptor)
      || !descriptor.enumerable
      || descriptor.value === undefined
    ) throw invalidArguments("operation");
  }
  return value;
}

function exactResult(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainRecord(value) || Reflect.ownKeys(value).length !== keys.length) throw invalidResult("operation");
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw invalidResult("operation");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw invalidResult("operation");
    }
  }
  return value;
}

function requiredString(record: object, key: string): string {
  const value = dataProperty(record, key);
  if (typeof value !== "string" || value.trim() === "") throw invalidArguments("operation");
  return value;
}

function optionalString(record: object, key: string): string | undefined {
  const value = dataProperty(record, key);
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") throw invalidArguments("operation");
  return value;
}

function requiredResultString(record: object, key: string, operation: "export" | "import"): void {
  const value = dataProperty(record, key);
  if (typeof value !== "string" || value.trim() === "") throw invalidResult(operation);
}

function dataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function resultType(value: unknown): value is "base" | "doc" | "sheet" | "slide" {
  return value === "sheet" || value === "base" || value === "doc" || value === "slide";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function invalidArguments(operation: string): OfficeToolError {
  return new OfficeToolError(`Workspace Office ${operation} arguments are invalid.`, "workspace-argument-invalid");
}

function invalidResult(operation: string): OfficeToolError {
  return new OfficeToolError(`Workspace Office ${operation} returned an invalid result.`, "workspace-office-operation-failed");
}

function officeFailed(operation: "export" | "import"): OfficeToolError {
  return new OfficeToolError(`Workspace Office ${operation} failed.`, "workspace-office-operation-failed");
}

function officeFailure(
  operation: OfficeOperation,
  code: string,
  detail?: Record<string, unknown>,
): OfficeToolError {
  const envelope = JSON.stringify({ code, ...(detail === undefined ? {} : { detail }) });
  return new OfficeToolError(`Workspace Office ${operation} failed. ${envelope}`, code);
}

function cancelled(operation: OfficeOperation): OfficeToolError {
  return new OfficeToolError(
    `Workspace Office ${operation} was cancelled.`,
    "workspace-operation-cancelled",
  );
}

function disposing(operation: OfficeOperation): OfficeToolError {
  return new OfficeToolError(
    `Workspace Office ${operation} stopped because the plugin is disposing.`,
    "workspace-plugin-disposing",
  );
}

class OfficeToolError extends HarnessError {}
