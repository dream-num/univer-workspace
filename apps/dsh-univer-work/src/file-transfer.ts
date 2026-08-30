import type { Context } from "@deepseek-ai/cordis";
import type { FileSystem, FsTarget } from "@deepseek-ai/dsh-fs";
import { LocalFileSystem } from "@deepseek-ai/dsh-fs-local";
import { HarnessError } from "@deepseek-ai/dsh-llm";
import type { SandboxExecutionPolicy } from "@deepseek-ai/dsh-sandbox";
import type { SandboxPolicyService } from "@deepseek-ai/dsh-sandbox-policy";
import {
  defineTool,
  TOOL_ABORTED,
  validateArgs,
  type ParameterSchemaSpec,
  type PreToolDecision,
  type ToolExecutionResult,
  type ToolRunContext,
} from "@deepseek-ai/dsh-tools";
import {
  WorkspaceApplicationError,
  WorkspaceAssetFeature,
  WorkspaceBlobFeature,
  type WorkspaceHttp,
} from "@univerjs/univer-workspace-client-core";
import { WorkspaceAuthenticationRequiredError } from "./authentication-state.js";
import { closeWorkspaceTool } from "./space-node.js";
import {
  WorkspaceOwnerNotAcceptingError,
  type WorkspaceOwnedExecution,
  type WorkspaceToolOwner,
} from "./tool-owner.js";

interface WorkspaceFileTransferDependencies {
  readonly owner: WorkspaceToolOwner;
  readonly resolveAuthenticatedHttp: (signal?: AbortSignal) => Promise<WorkspaceHttp>;
}

export type WorkspaceFileEffectOperation =
  | "blob get"
  | "blob upload"
  | "blob download"
  | "asset download"
  | "resource export"
  | "office import"
  | "office export"
  | "screenshot"
  | "typst compile"
  | "typst apply"
  | "svg compile"
  | "svg apply";
type Operation = WorkspaceFileEffectOperation;
type OperationKind = "read" | "upload" | "download";
type PathExecution = Pick<ToolRunContext, "agent" | "signal">;
type OperationValidator<Input extends Record<string, unknown>> = (value: unknown) => Input;
type BlobGetArgs = { resource_id: string };
type BlobUploadArgs = {
  source_path: string;
  space_id: string;
  parent_node_id?: string;
  name?: string;
  declared_media_type?: string;
  idempotency_key?: string;
};
type BlobDownloadArgs = { resource_id: string; output_path: string; force?: boolean };
type AssetDownloadArgs = {
  worktree_id: string;
  asset_id: string;
  output_path: string;
  force?: boolean;
};

const blobGetParameters = {
  resource_id: { type: "string", required: true },
} as const;
const blobUploadParameters = {
  source_path: { type: "string", required: true },
  space_id: { type: "string", required: true },
  parent_node_id: { type: "string" },
  name: { type: "string" },
  declared_media_type: { type: "string" },
  idempotency_key: { type: "string" },
} as const;
const blobDownloadParameters = {
  resource_id: { type: "string", required: true },
  output_path: { type: "string", required: true },
  force: { type: "boolean" },
} as const;
const assetDownloadParameters = {
  worktree_id: { type: "string", required: true },
  asset_id: { type: "string", required: true },
  output_path: { type: "string", required: true },
  force: { type: "boolean" },
} as const;

const validators = {
  workspace_blob_get: operationValidator<BlobGetArgs>("blob get", blobGetParameters, (value) =>
    nonBlank(value["resource_id"])),
  workspace_blob_upload: operationValidator<BlobUploadArgs>("blob upload", blobUploadParameters, (value) =>
    nonBlank(value["source_path"])
      && nonBlank(value["space_id"])
      && optionalNonBlank(value["parent_node_id"])
      && optionalNonBlank(value["name"])
      && optionalNonBlank(value["declared_media_type"])
      && optionalNonBlank(value["idempotency_key"])),
  workspace_blob_download: operationValidator<BlobDownloadArgs>("blob download", blobDownloadParameters, (value) =>
    nonBlank(value["resource_id"]) && nonBlank(value["output_path"])),
  workspace_asset_download: operationValidator<AssetDownloadArgs>("asset download", assetDownloadParameters, (value) =>
    nonBlank(value["worktree_id"])
      && nonBlank(value["asset_id"])
      && nonBlank(value["output_path"])),
};

const stringSchema = { type: "string", required: true } as const;
const nullableStringSchema = {
  oneOf: [{ type: "string" }, { type: "null" }],
  required: true,
} as const;
const booleanSchema = { type: "boolean", required: true } as const;
const resourceCapabilitiesSchema = {
  type: "object",
  additionalProperties: false,
  required: true,
  properties: {
    downloadContent: booleanSchema,
    editContent: booleanSchema,
    openContent: booleanSchema,
  },
} as const;
const nodeCapabilitiesSchema = {
  type: "object",
  additionalProperties: false,
  required: true,
  properties: {
    browseChildren: booleanSchema,
    createChildren: booleanSchema,
    move: booleanSchema,
    rename: booleanSchema,
    share: booleanSchema,
    trash: booleanSchema,
  },
} as const;
const blobResourceSchema = {
  type: "object",
  additionalProperties: false,
  required: true,
  properties: {
    availability: { type: "string", enum: ["ready", "quarantined"], required: true },
    byteSize: { type: "integer", required: true },
    capabilities: resourceCapabilitiesSchema,
    kind: { type: "string", const: "blob", required: true },
    mediaType: stringSchema,
    resourceId: stringSchema,
  },
} as const;
const nodeSchema = {
  type: "object",
  additionalProperties: false,
  required: true,
  properties: {
    accessRole: { type: "string", enum: ["owner", "admin", "editor", "viewer"], required: true },
    capabilities: nodeCapabilitiesSchema,
    hasChildren: booleanSchema,
    name: stringSchema,
    nodeId: stringSchema,
    parentNodeId: nullableStringSchema,
    resource: blobResourceSchema,
    spaceId: stringSchema,
    updatedAt: stringSchema,
  },
} as const;
const blobGetOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: { node: nodeSchema, resource: blobResourceSchema },
} as const;
const uploadSchema = {
  type: "object",
  additionalProperties: false,
  required: true,
  properties: {
    idempotencyKey: stringSchema,
    uploadId: stringSchema,
    operationId: stringSchema,
    nodeId: stringSchema,
    resourceId: stringSchema,
    name: stringSchema,
    originalFilename: stringSchema,
    byteSize: { type: "integer", required: true },
    mediaType: stringSchema,
    availability: { type: "string", enum: ["ready", "quarantined"], required: true },
    node: nodeSchema,
    resource: blobResourceSchema,
  },
} as const;
const blobUploadOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: { upload: uploadSchema },
} as const;
const blobDownloadSchema = {
  type: "object",
  additionalProperties: false,
  required: true,
  properties: {
    resourceId: stringSchema,
    nodeId: stringSchema,
    outputPath: stringSchema,
    byteSize: { type: "integer", required: true },
    mediaType: stringSchema,
    etag: { type: "string" },
  },
} as const;
const assetDownloadSchema = {
  type: "object",
  additionalProperties: false,
  required: true,
  properties: {
    assetId: stringSchema,
    byteLength: { type: "integer", required: true },
    mediaType: stringSchema,
    outputPath: stringSchema,
    worktreeId: stringSchema,
    etag: { type: "string" },
  },
} as const;
const blobDownloadOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: { download: blobDownloadSchema },
} as const;
const assetDownloadOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: { download: assetDownloadSchema },
} as const;

export function registerWorkspaceFileTransferTools(
  ctx: Context,
  dependencies: WorkspaceFileTransferDependencies,
): readonly (() => void)[] {
  const initialFilesystem = ctx.get("fs");
  if (initialFilesystem === undefined) return [];
  const sandboxPolicy = ctx.get("sandboxPolicy") as SandboxPolicyService | undefined;
  if (initialFilesystem.sandboxMode !== undefined && sandboxPolicy === undefined) {
    throw new Error("dsh-univer-work requires sandboxPolicy for a confining filesystem");
  }
  const blobs = new WorkspaceBlobFeature(dependencies.resolveAuthenticatedHttp);
  const assets = new WorkspaceAssetFeature(dependencies.resolveAuthenticatedHttp);
  const execute = <Result>(
    operation: Operation,
    kind: OperationKind,
    exec: ToolRunContext,
    body: (signal: AbortSignal) => Promise<Result>,
  ): Promise<Result> => executeOwned(dependencies.owner, operation, kind, exec, body);

  const definitions = [
    closeWorkspaceTool(defineTool({
      name: "workspace_blob_get",
      description: "Read one remote Workspace Blob Resource and its owning Node.",
      parameters: blobGetParameters,
      output: {
        schema: blobGetOutputSchema,
        render: (_args, value) => [{
          type: "text",
          text: `Workspace Blob ${value.resource.resourceId} belongs to Node ${value.node.name} (${value.node.nodeId}).`,
        }],
      },
      isConcurrencySafe: () => true,
      execute: async (args, exec) => {
        const input = validators.workspace_blob_get(args);
        const value = await execute("blob get", "read", exec, async (signal) => await blobs.get(input.resource_id, signal));
        return { node: { ...value.node, resource: value.resource }, resource: value.resource };
      },
    }), validators.workspace_blob_get),
    closeWorkspaceTool(defineTool({
      name: "workspace_blob_upload",
      description: "Upload one Host-local file as a remote Workspace Blob after human approval.",
      parameters: blobUploadParameters,
      output: {
        schema: blobUploadOutputSchema,
        render: (_args, value) => [{
          type: "text",
          text: `Uploaded Workspace Blob ${value.upload.name} (${value.upload.resourceId}) from ${value.upload.originalFilename}.`,
        }],
      },
      finalizeContent: transferFinalizer("blob upload"),
      execute: async (args, exec) => {
        const input = validators.workspace_blob_upload(args);
        return {
          upload: await execute("blob upload", "upload", exec, async (signal) => {
            const filesystem = currentFilesystem(ctx, "blob upload");
            requireLocal(filesystem, "blob upload");
            const source = await resolveTransferPath(filesystem, sandboxPolicy, exec, input.source_path, "blob upload", "source", signal);
            const sourcePath = filesystem.processPath(source);
            signal.throwIfAborted();
            return await blobs.upload({
              filePath: sourcePath,
              spaceId: input.space_id,
              ...(input.parent_node_id === undefined ? {} : { parentNodeId: input.parent_node_id }),
              ...(input.name === undefined ? {} : { name: input.name }),
              ...(input.declared_media_type === undefined ? {} : { declaredMediaType: input.declared_media_type }),
              ...(input.idempotency_key === undefined ? {} : { idempotencyKey: input.idempotency_key }),
            }, signal);
          }),
        } as never;
      },
    }), validators.workspace_blob_upload),
    closeWorkspaceTool(defineTool({
      name: "workspace_blob_download",
      description: "Download one remote Workspace Blob into the calling Session workspace after human approval.",
      parameters: blobDownloadParameters,
      output: {
        schema: blobDownloadOutputSchema,
        render: (_args, value) => [{
          type: "text",
          text: `Downloaded Workspace Blob ${value.download.resourceId} to ${value.download.outputPath}.`,
        }],
      },
      finalizeContent: transferFinalizer("blob download"),
      execute: async (args, exec) => {
        const input = validators.workspace_blob_download(args);
        return {
          download: await execute("blob download", "download", exec, async (signal) => {
            const filesystem = currentFilesystem(ctx, "blob download");
            const target = await resolveTransferPath(filesystem, sandboxPolicy, exec, input.output_path, "blob download", "output", signal);
            requireLocal(filesystem, "blob download");
            const outputPath = filesystem.processPath(target);
            signal.throwIfAborted();
            return await blobs.download({
              outputPath,
              resourceId: input.resource_id,
              ...(input.force === true ? { force: true } : {}),
            }, signal);
          }),
        } as never;
      },
    }), validators.workspace_blob_download),
    closeWorkspaceTool(defineTool({
      name: "workspace_asset_download",
      description: "Download one remote Workspace Asset into the calling Session workspace after human approval.",
      parameters: assetDownloadParameters,
      output: {
        schema: assetDownloadOutputSchema,
        render: (_args, value) => [{
          type: "text",
          text: `Downloaded Workspace Asset ${value.download.assetId} to ${value.download.outputPath}.`,
        }],
      },
      finalizeContent: transferFinalizer("asset download"),
      execute: async (args, exec) => {
        const input = validators.workspace_asset_download(args);
        return {
          download: await execute("asset download", "download", exec, async (signal) => {
            const filesystem = currentFilesystem(ctx, "asset download");
            const target = await resolveTransferPath(filesystem, sandboxPolicy, exec, input.output_path, "asset download", "output", signal);
            requireLocal(filesystem, "asset download");
            const outputPath = filesystem.processPath(target);
            signal.throwIfAborted();
            return await assets.download({
              assetId: input.asset_id,
              outputPath,
              worktreeId: input.worktree_id,
              ...(input.force === true ? { force: true } : {}),
            }, signal);
          }),
        } as never;
      },
    }), validators.workspace_asset_download),
  ];

  return [
    ...definitions.map((definition) => ctx.tools.register(definition)),
    ctx.on("tools/pre-execute", async (exec, next): Promise<PreToolDecision> => {
      if (exec.name === "workspace_blob_upload") {
        validators.workspace_blob_upload(exec.arguments);
        return { kind: "ask", reason: "Workspace Blob upload changes remote Workspace state." };
      }
      if (exec.name !== "workspace_blob_download" && exec.name !== "workspace_asset_download") {
        return await next();
      }
      const operation = exec.name === "workspace_blob_download" ? "blob download" : "asset download";
      try {
        const filesystem = currentFilesystem(ctx, operation);
        const policy = currentPolicy(filesystem, sandboxPolicy, exec, operation);
        requireLocal(filesystem, operation);
        const input = exec.name === "workspace_blob_download"
          ? validators.workspace_blob_download(exec.arguments)
          : validators.workspace_asset_download(exec.arguments);
        await resolveContainedPath(filesystem, policy, exec, input.output_path, operation, exec.signal);
        return {
          kind: "ask",
          reason: operation === "blob download"
            ? "Workspace Blob download writes a Host-local file."
            : "Workspace Asset download writes a Host-local file.",
        };
      } catch (error) {
        if (error instanceof FileTransferToolError) throw error;
        if (exec.signal.aborted) throw cancelled(operation);
        throw operationFailed(operation);
      }
    }),
  ];
}

export function assertWorkspaceFileTransferComposition(ctx: Context): void {
  const filesystem = ctx.get("fs");
  if (filesystem?.sandboxMode !== undefined && ctx.get("sandboxPolicy") === undefined) {
    throw new Error("dsh-univer-work requires sandboxPolicy for a confining filesystem");
  }
}

function transferFinalizer(operation: Operation) {
  return (_exec: unknown, result: Readonly<ToolExecutionResult>) => {
    if (
      !result.isError
      || (result.error.info?.code !== TOOL_ABORTED
        && !(operation === "blob upload" && result.error.info?.code === "workspace-result-unknown"))
    ) return undefined;
    return [{
      type: "text" as const,
      text: operation === "blob upload"
        ? "The Workspace Blob upload may have completed. Inspect the target Space with workspace_space_browse or workspace_space_find before deciding any next action. Never retry the upload automatically."
        : "The Workspace download may have completed. Inspect the requested destination before deciding any next action. Never retry the download automatically.",
    }];
  };
}

async function resolveTransferPath(
  filesystem: FileSystem,
  sandboxPolicy: SandboxPolicyService | undefined,
  exec: PathExecution,
  path: string,
  operation: Operation,
  subject: "source" | "output",
  signal: AbortSignal,
): Promise<FsTarget> {
  const policy = subject === "source"
    ? undefined
    : currentPolicy(filesystem, sandboxPolicy, exec, operation);
  requireLocal(filesystem, operation);
  const target = await resolveContainedPath(filesystem, policy, exec, path, operation, signal);
  if (subject === "source") {
    const metadata = await filesystem.stat(target, signal);
    signal.throwIfAborted();
    if (metadata === undefined) throw sourceUnavailable(path);
    if (metadata.type !== "file") throw sourceInvalid(path);
  }
  return target;
}

export function currentPolicy(
  filesystem: FileSystem,
  sandboxPolicy: SandboxPolicyService | undefined,
  exec: PathExecution,
  operation: Operation,
): SandboxExecutionPolicy | undefined {
  if (filesystem.sandboxMode === undefined) return undefined;
  if (sandboxPolicy === undefined) throw operationFailed(operation);
  const policy = sandboxPolicy.resolve({ ...(exec.agent === undefined ? {} : { session: exec.agent.session }) });
  if (policy.mode === "read-only") throw policyDenied();
  return policy;
}

export async function resolveContainedPath(
  filesystem: FileSystem,
  policy: SandboxExecutionPolicy | undefined,
  exec: PathExecution,
  path: string,
  operation: Operation,
  signal: AbortSignal,
): Promise<FsTarget> {
  signal.throwIfAborted();
  const cwd = exec.agent?.session.header.cwd;
  if (cwd === undefined) throw sessionCwdRequired();
  try {
    const root = await filesystem.resolve(cwd, { cwd, signal });
    signal.throwIfAborted();
    const rootInfo = await filesystem.stat(root, signal);
    signal.throwIfAborted();
    if (rootInfo?.type !== "directory") throw sessionCwdRequired();
    const target = await filesystem.resolve(path, { cwd, signal });
    signal.throwIfAborted();
    if (!filesystem.contains(root, target)) throw pathOutsideSession(operation, path);
    if (policy?.mode === "workspace-write") {
      const policyRoot = await filesystem.resolve(policy.workspaceRoot, { cwd, signal });
      signal.throwIfAborted();
      if (!filesystem.contains(policyRoot, target)) throw pathOutsideSession(operation, path);
    }
    return target;
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof FileTransferToolError) throw error;
    throw operationFailed(operation);
  }
}

export function requireLocal(filesystem: FileSystem, _operation: Operation): asserts filesystem is LocalFileSystem {
  if (!(filesystem instanceof LocalFileSystem)) throw localFilesystemRequired();
}

export function currentFilesystem(ctx: Context, operation: Operation): FileSystem {
  const filesystem = ctx.get("fs");
  if (filesystem === undefined) throw operationFailed(operation);
  return filesystem;
}

function operationValidator<Input extends Record<string, unknown>>(
  operation: Operation,
  parameters: ParameterSchemaSpec,
  refine: (value: Record<string, unknown>) => boolean,
): OperationValidator<Input> {
  const expectedKeys = Object.keys(parameters).sort();
  return (value) => {
    if (!isPlainRecord(value)) throw invalidArguments(operation);
    const ownKeys = Reflect.ownKeys(value);
    const actualKeys = Object.keys(value).sort();
    if (
      ownKeys.length !== actualKeys.length
      || actualKeys.some((key) => !expectedKeys.includes(key))
      || validateArgs(parameters, value).length > 0
      || !refine(value)
    ) throw invalidArguments(operation);
    return value as Input;
  };
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function optionalNonBlank(value: unknown): boolean {
  return value === undefined || nonBlank(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

async function executeOwned<Result>(
  owner: WorkspaceToolOwner,
  operation: Operation,
  kind: OperationKind,
  exec: ToolRunContext,
  body: (signal: AbortSignal) => Promise<Result>,
): Promise<Result> {
  try {
    return await owner.run(exec, async (owned) => {
      try {
        owned.signal.throwIfAborted();
        const result = await body(owned.signal);
        if (kind === "read") {
          if (owned.ownerSignal.aborted) throw disposing(operation);
          if (owned.callerSignal.aborted) throw cancelled(operation);
        }
        return result;
      } catch (error) {
        throw sanitizeOperationFailure(operation, kind, error, owned);
      }
    });
  } catch (error) {
    if (error instanceof FileTransferToolError) throw error;
    if (error instanceof WorkspaceOwnerNotAcceptingError) throw disposing(operation);
    throw operationFailed(operation);
  }
}

function sanitizeOperationFailure(
  operation: Operation,
  kind: OperationKind,
  error: unknown,
  owned: WorkspaceOwnedExecution,
): FileTransferToolError {
  if (error instanceof FileTransferToolError) return error;
  const projected = projectWorkspaceFileTransferDependencyFailure(error);
  if (
    kind === "upload"
    && projected?.code === "workspace-result-unknown"
  ) return workspaceFailure(operation, projected.code, projected.detail);
  if (owned.ownerSignal.aborted) return disposing(operation);
  if (owned.callerSignal.aborted) return cancelled(operation);
  if (projected !== undefined) {
    return workspaceFailure(operation, projected.code, projected.detail);
  }
  return operationFailed(operation);
}

const stableWorkspaceCodes = new Set([
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
]);

class FileTransferToolError extends HarnessError {
  readonly #detail: Record<string, unknown> | undefined;

  public constructor(message: string, code: string, detail?: Record<string, unknown>) {
    super(message, code);
    this.#detail = detail;
  }

  public projectedDetail(): Record<string, unknown> | undefined {
    return this.#detail;
  }
}

export function projectWorkspaceFileTransferDependencyFailure(
  error: unknown,
): { code: string; detail?: Record<string, unknown> } | undefined {
  if (error instanceof FileTransferToolError) {
    if (!stableWorkspaceCodes.has(error.code) && !isFileTransferOwnerCode(error.code)) return undefined;
    const detail = error.projectedDetail();
    return { code: error.code, ...(detail === undefined ? {} : { detail }) };
  }
  if (error instanceof WorkspaceAuthenticationRequiredError) {
    return { code: "workspace-authentication-required" };
  }
  if (error instanceof WorkspaceApplicationError && stableWorkspaceCodes.has(error.code)) {
    const detail = projectDetail(error.detail);
    return { code: error.code, ...(detail === undefined ? {} : { detail }) };
  }
  return undefined;
}

function isFileTransferOwnerCode(code: string): boolean {
  return code === "workspace-file-policy-denied"
    || code === "workspace-session-cwd-required"
    || code === "workspace-file-path-outside-session"
    || code === "workspace-local-filesystem-required"
    || code === "workspace-file-operation-failed"
    || code === "workspace-operation-cancelled"
    || code === "workspace-plugin-disposing";
}

export function projectWorkspaceFileEffectFailure(
  error: unknown,
  operation: WorkspaceFileEffectOperation,
): Error | undefined {
  if (!(error instanceof FileTransferToolError)) return undefined;
  const projected = projectWorkspaceFileTransferDependencyFailure(error);
  switch (projected?.code) {
    case "workspace-file-policy-denied": return policyDenied();
    case "workspace-local-filesystem-required": return localFilesystemRequired();
    case "workspace-session-cwd-required": return sessionCwdRequired();
    case "workspace-file-path-outside-session":
      return new FileTransferToolError(
        `Workspace ${operation} path is outside the calling Session workspace.`,
        "workspace-file-path-outside-session",
      );
    case "workspace-operation-cancelled": return cancelled(operation);
    case "workspace-plugin-disposing": return disposing(operation);
    case "workspace-file-operation-failed": return operationFailed(operation);
    default: return undefined;
  }
}

function invalidArguments(operation: Operation): FileTransferToolError {
  return new FileTransferToolError(`Workspace ${operation} arguments are invalid.`, "workspace-argument-invalid");
}

function policyDenied(): FileTransferToolError {
  return new FileTransferToolError("Workspace file download is denied by the current sandbox policy.", "workspace-file-policy-denied");
}

function localFilesystemRequired(): FileTransferToolError {
  return new FileTransferToolError("Workspace file transfer requires the Host-local filesystem.", "workspace-local-filesystem-required");
}

function sessionCwdRequired(): FileTransferToolError {
  return new FileTransferToolError("Workspace file transfer requires a calling Agent Session workspace.", "workspace-session-cwd-required");
}

function pathOutsideSession(operation: Operation, path: string): FileTransferToolError {
  return workspaceFailure(operation, "workspace-file-path-outside-session", { path });
}

function sourceInvalid(path: string): FileTransferToolError {
  return workspaceFailure("blob upload", "workspace-blob-source-invalid", { path });
}

function sourceUnavailable(path: string): FileTransferToolError {
  return workspaceFailure("blob upload", "workspace-blob-source-unavailable", { path });
}

function cancelled(operation: Operation): FileTransferToolError {
  return new FileTransferToolError(`Workspace ${operation} was cancelled.`, "workspace-operation-cancelled");
}

function disposing(operation: Operation): FileTransferToolError {
  return new FileTransferToolError(`Workspace ${operation} stopped because the plugin is disposing.`, "workspace-plugin-disposing");
}

function operationFailed(operation: Operation): FileTransferToolError {
  return workspaceFailure(operation, "workspace-file-operation-failed");
}

function workspaceFailure(
  operation: Operation,
  code: string,
  detail?: Record<string, unknown>,
): FileTransferToolError {
  const envelope = JSON.stringify({ code, ...(detail === undefined ? {} : { detail }) });
  return new FileTransferToolError(`Workspace ${operation} failed. ${envelope}`, code, detail);
}

function projectDetail(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainRecord(value)) return undefined;
  const detail: Record<string, unknown> = {};
  for (const key of [
    "path", "sourcePath", "outputPath", "spaceId", "parentNodeId", "name",
    "originalFilename", "declaredMediaType", "idempotencyKey", "uploadId", "state",
    "operationId", "nodeId", "resourceId", "assetId", "worktreeId", "mediaType",
    "availability", "expectedKind", "actualKind", "expectedUploadId", "actualUploadId",
    "expectedNodeId", "actualNodeId", "expectedResourceId", "actualResourceId",
  ] as const) {
    if (typeof value[key] === "string") detail[key] = value[key];
  }
  if (value["parentNodeId"] === null) detail["parentNodeId"] = null;
  if (value["declaredMediaType"] === null) detail["declaredMediaType"] = null;
  for (const key of ["status", "byteSize", "expectedByteSize", "actualByteSize", "receivedSize"] as const) {
    if (Number.isSafeInteger(value[key])) detail[key] = value[key];
  }
  for (const key of ["downloadContent", "editContent", "openContent"] as const) {
    if (typeof value[key] === "boolean") detail[key] = value[key];
  }
  for (const key of ["request", "requested", "actual"] as const) {
    const projected = projectIdentity(value[key]);
    if (projected !== undefined) detail[key] = projected;
  }
  return Object.keys(detail).length === 0 ? undefined : detail;
}

function projectIdentity(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainRecord(value)) return undefined;
  const result: Record<string, unknown> = {};
  for (const key of [
    "path", "sourcePath", "outputPath", "spaceId", "name", "originalFilename",
    "declaredMediaType", "idempotencyKey", "uploadId", "state", "operationId", "nodeId",
    "resourceId", "assetId", "worktreeId", "mediaType", "availability", "kind",
  ] as const) {
    if (typeof value[key] === "string") result[key] = value[key];
  }
  if (value["parentNodeId"] === null || typeof value["parentNodeId"] === "string") {
    result["parentNodeId"] = value["parentNodeId"];
  }
  if (value["declaredMediaType"] === null) result["declaredMediaType"] = null;
  for (const key of ["byteSize", "expectedByteSize", "actualByteSize", "receivedSize"] as const) {
    if (Number.isSafeInteger(value[key])) result[key] = value[key];
  }
  return Object.keys(result).length === 0 ? undefined : result;
}
