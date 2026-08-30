import type { Context } from "@deepseek-ai/cordis";
import { HarnessError } from "@deepseek-ai/dsh-llm";
import {
  defineTool,
  TOOL_ABORTED,
  validateArgs,
  type ParameterSchemaSpec,
  type PreToolDecision,
  type ToolDefinition,
  type ToolExecutionResult,
  type ToolRunContext,
} from "@deepseek-ai/dsh-tools";
import {
  WorkspaceApplicationError,
  WorkspaceSpaceFeature,
  type WorkspaceHttp,
} from "@univerjs/univer-workspace-client-core";
import { WorkspaceAuthenticationRequiredError } from "./authentication-state.js";
import {
  WorkspaceOwnerNotAcceptingError,
  type WorkspaceOwnedExecution,
  type WorkspaceToolOwner,
} from "./tool-owner.js";

interface WorkspaceSpaceNodeDependencies {
  readonly owner: WorkspaceToolOwner;
  readonly resolveAuthenticatedHttp: (signal?: AbortSignal) => Promise<WorkspaceHttp>;
}

type Operation = "list" | "browse" | "find" | "create" | "rename" | "move" | "trash";
type OperationKind = "read" | "mutation";
type OperationValidator = (value: unknown) => void;

const unitTypes = ["sheet", "doc", "slide", "base", "board"] as const;
const resourceKinds = ["none", "univer", "blob"] as const;
const mutationNames = {
  workspace_node_create: "create",
  workspace_node_move: "move",
  workspace_node_rename: "rename",
  workspace_node_trash: "trash",
} as const;

const listParameters = {} as const;
const browseParameters = {
  space_id: { type: "string", required: true },
  parent_node_id: { type: "string" },
  recursive: { type: "boolean" },
  resource_kind: { type: "string", enum: resourceKinds },
  unit_type: { type: "string", enum: unitTypes },
} as const;
const findParameters = {
  space_id: { type: "string", required: true },
  query: { type: "string", required: true },
  resource_kind: { type: "string", enum: resourceKinds },
  unit_type: { type: "string", enum: unitTypes },
} as const;
const createParameters = {
  space_id: { type: "string", required: true },
  name: { type: "string", required: true },
  parent_node_id: { type: "string" },
} as const;
const renameParameters = {
  node_id: { type: "string", required: true },
  name: { type: "string", required: true },
} as const;
const moveParameters = {
  node_id: { type: "string", required: true },
  parent_node_id: {
    oneOf: [{ type: "string" }, { type: "null" }],
    required: true,
  },
} as const;
const trashParameters = {
  node_id: { type: "string", required: true },
} as const;

export const workspaceSpaceNodeValidators = {
  workspace_space_list: operationValidator("list", listParameters),
  workspace_space_browse: operationValidator("browse", browseParameters, validateBrowse),
  workspace_space_find: operationValidator("find", findParameters, validateFind),
  workspace_node_create: operationValidator("create", createParameters, validateCreate),
  workspace_node_rename: operationValidator("rename", renameParameters, validateRename),
  workspace_node_move: operationValidator("move", moveParameters, validateMove),
  workspace_node_trash: operationValidator("trash", trashParameters, validateTrash),
} satisfies Record<string, OperationValidator>;

const booleanSchema = { type: "boolean", required: true } as const;
const stringSchema = { type: "string", required: true } as const;
const nullableStringSchema = {
  oneOf: [{ type: "string" }, { type: "null" }],
  required: true,
} as const;
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
const nodeResourceSchema = {
  oneOf: [
    { type: "null" },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        capabilities: resourceCapabilitiesSchema,
        kind: { type: "string", const: "univer", required: true },
        resourceId: stringSchema,
        unitType: { type: "string", enum: unitTypes, required: true },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        availability: { type: "string", enum: ["ready", "quarantined"], required: true },
        byteSize: { type: "integer", required: true },
        capabilities: resourceCapabilitiesSchema,
        kind: { type: "string", const: "blob", required: true },
        mediaType: stringSchema,
        resourceId: stringSchema,
      },
    },
  ],
  required: true,
} as const;
const nodeSummaryProperties = {
  accessRole: { type: "string", enum: ["owner", "admin", "editor", "viewer"], required: true },
  capabilities: nodeCapabilitiesSchema,
  hasChildren: booleanSchema,
  name: stringSchema,
  nodeId: stringSchema,
  parentNodeId: nullableStringSchema,
  resource: nodeResourceSchema,
  spaceId: stringSchema,
  updatedAt: stringSchema,
} as const;
const nodeSummarySchema = {
  type: "object",
  additionalProperties: false,
  properties: nodeSummaryProperties,
  required: true,
} as const;
const nodeSchema = {
  type: "object",
  additionalProperties: false,
  properties: { ...nodeSummaryProperties, path: stringSchema },
} as const;
const spaceSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: stringSchema,
    name: stringSchema,
    type: { type: "string", enum: ["personal", "team"] },
  },
} as const;
const trashResourceSchema = {
  oneOf: [
    { type: "null" },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", const: "univer", required: true },
        resourceId: stringSchema,
        unitType: { type: "string", enum: unitTypes, required: true },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        byteSize: { type: "integer", required: true },
        kind: { type: "string", const: "blob", required: true },
        mediaType: stringSchema,
        resourceId: stringSchema,
      },
    },
  ],
  required: true,
} as const;
const trashBlockerSchema = {
  oneOf: [
    { type: "null" },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        code: { type: "string", const: "ACTIVE_WORKTREE_RESOURCE_REFERENCE", required: true },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        code: {
          type: "string",
          enum: ["RESTORE_PARENT_IN_TRASH", "NESTED_TRASH_BATCH"],
          required: true,
        },
        trashBatchId: stringSchema,
      },
    },
  ],
  required: true,
} as const;
const trashBatchSchema = {
  type: "object",
  additionalProperties: false,
  required: true,
  properties: {
    capabilities: {
      type: "object",
      additionalProperties: false,
      required: true,
      properties: { removePermanently: booleanSchema, restore: booleanSchema },
    },
    nodeCount: { type: "integer", required: true },
    originalLocation: {
      type: "object",
      additionalProperties: false,
      required: true,
      properties: {
        breadcrumbs: {
          type: "array",
          required: true,
          items: {
            type: "object",
            additionalProperties: false,
            properties: { name: stringSchema, nodeId: stringSchema },
          },
        },
      },
    },
    removeBlockedBy: trashBlockerSchema,
    restoreBlockedBy: trashBlockerSchema,
    root: {
      type: "object",
      additionalProperties: false,
      required: true,
      properties: { name: stringSchema, nodeId: stringSchema, resource: trashResourceSchema },
    },
    spaceId: stringSchema,
    trashBatchId: stringSchema,
    trashedAt: stringSchema,
    trashedBy: {
      type: "object",
      additionalProperties: false,
      required: true,
      properties: {
        avatarUrl: nullableStringSchema,
        id: stringSchema,
        name: stringSchema,
        username: stringSchema,
      },
    },
  },
} as const;

const spacesOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: { spaces: { type: "array", items: spaceSchema, required: true } },
} as const;
const nodesOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: { nodes: { type: "array", items: nodeSchema, required: true } },
} as const;
const nodeOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: { node: nodeSummarySchema },
} as const;
const trashOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: { trashBatch: trashBatchSchema },
} as const;

export function registerWorkspaceSpaceNodeTools(
  ctx: Context,
  dependencies: WorkspaceSpaceNodeDependencies,
): readonly (() => void)[] {
  const feature = new WorkspaceSpaceFeature(dependencies.resolveAuthenticatedHttp);
  const execute = <Result>(
    operation: Operation,
    kind: OperationKind,
    exec: ToolRunContext,
    body: (signal: AbortSignal) => Promise<Result>,
  ): Promise<Result> => executeOwned(dependencies.owner, operation, kind, exec, body);
  const mutationFinalizer = (_exec: unknown, result: Readonly<ToolExecutionResult>) =>
    result.isError && result.error.info?.code === TOOL_ABORTED
      ? [{
          type: "text" as const,
          text: "The Workspace mutation may have completed. Use workspace_space_browse or workspace_space_find to inspect the current Node state. Never replay the mutation automatically.",
        }]
      : undefined;

  const definitions = [
    closeWorkspaceTool(defineTool({
      name: "workspace_space_list",
      description: "List the remote Workspace Spaces visible to the current authenticated User.",
      parameters: listParameters,
      output: {
        schema: spacesOutputSchema,
        render: (_args, value) => [{
          type: "text",
          text: value.spaces.length === 0
            ? "No Workspace Spaces are visible."
            : `Workspace Spaces (${String(value.spaces.length)}): ${value.spaces.map((space) => `${space.name} (${space.id})`).join(", ")}.`,
        }],
      },
      isConcurrencySafe: () => true,
      execute: async (_args, exec) => ({
        spaces: [...await execute("list", "read", exec, async (signal) => await feature.list(signal))],
      }),
    }), workspaceSpaceNodeValidators.workspace_space_list),
    closeWorkspaceTool(defineTool({
      name: "workspace_space_browse",
      description: "Browse one remote Workspace Space directory, optionally recursively and by Resource or Unit type.",
      parameters: browseParameters,
      output: {
        schema: nodesOutputSchema,
        render: (_args, value) => [{
          type: "text",
          text: value.nodes.length === 0
            ? "No matching Workspace Nodes were found."
            : `Workspace Nodes (${String(value.nodes.length)}): ${value.nodes.map((node) => `${node.path} (${node.nodeId})`).join(", ")}.`,
        }],
      },
      isConcurrencySafe: () => true,
      execute: async (args, exec) => ({
        nodes: [...await execute("browse", "read", exec, async (signal) => await feature.browse({
          spaceId: args.space_id,
          ...(args.parent_node_id === undefined ? {} : { parentNodeId: args.parent_node_id }),
          ...(args.recursive === undefined ? {} : { recursive: args.recursive }),
          ...(args.resource_kind === undefined ? {} : { resourceKind: args.resource_kind }),
          ...(args.unit_type === undefined ? {} : { unitType: args.unit_type }),
        }, signal))],
      }),
    }), workspaceSpaceNodeValidators.workspace_space_browse),
    closeWorkspaceTool(defineTool({
      name: "workspace_space_find",
      description: "Find remote Workspace Nodes by case-insensitive name substring within one Space.",
      parameters: findParameters,
      output: {
        schema: nodesOutputSchema,
        render: (_args, value) => [{
          type: "text",
          text: value.nodes.length === 0
            ? "No matching Workspace Nodes were found."
            : `Matching Workspace Nodes (${String(value.nodes.length)}): ${value.nodes.map((node) => `${node.path} (${node.nodeId})`).join(", ")}.`,
        }],
      },
      isConcurrencySafe: () => true,
      execute: async (args, exec) => ({
        nodes: [...await execute("find", "read", exec, async (signal) => await feature.find({
          query: args.query,
          spaceId: args.space_id,
          ...(args.resource_kind === undefined ? {} : { resourceKind: args.resource_kind }),
          ...(args.unit_type === undefined ? {} : { unitType: args.unit_type }),
        }, signal))],
      }),
    }), workspaceSpaceNodeValidators.workspace_space_find),
    closeWorkspaceTool(defineTool({
      name: "workspace_node_create",
      description: "Create one organizational Node in a remote Workspace Space after human approval.",
      parameters: createParameters,
      output: {
        schema: nodeOutputSchema,
        render: (_args, value) => [{ type: "text", text: `Created Workspace Node ${value.node.name} (${value.node.nodeId}).` }],
      },
      finalizeContent: mutationFinalizer,
      execute: async (args, exec) => ({
        node: await execute("create", "mutation", exec, async (signal) => await feature.createNode({
          name: args.name,
          spaceId: args.space_id,
          ...(args.parent_node_id === undefined ? {} : { parentNodeId: args.parent_node_id }),
        }, signal)),
      }),
    }), workspaceSpaceNodeValidators.workspace_node_create),
    closeWorkspaceTool(defineTool({
      name: "workspace_node_rename",
      description: "Rename one remote Workspace Node after human approval.",
      parameters: renameParameters,
      output: {
        schema: nodeOutputSchema,
        render: (_args, value) => [{ type: "text", text: `Renamed Workspace Node to ${value.node.name} (${value.node.nodeId}).` }],
      },
      finalizeContent: mutationFinalizer,
      execute: async (args, exec) => ({
        node: await execute("rename", "mutation", exec, async (signal) => await feature.renameNode({
          name: args.name,
          nodeId: args.node_id,
        }, signal)),
      }),
    }), workspaceSpaceNodeValidators.workspace_node_rename),
    closeWorkspaceTool(defineTool({
      name: "workspace_node_move",
      description: "Move one remote Workspace Node to another parent or its Space root after human approval.",
      parameters: moveParameters,
      output: {
        schema: nodeOutputSchema,
        render: (_args, value) => [{ type: "text", text: `Moved Workspace Node ${value.node.name} (${value.node.nodeId}).` }],
      },
      finalizeContent: mutationFinalizer,
      execute: async (args, exec) => ({
        node: await execute("move", "mutation", exec, async (signal) => await feature.moveNode({
          nodeId: args.node_id,
          parentNodeId: args.parent_node_id,
        }, signal)),
      }),
    }), workspaceSpaceNodeValidators.workspace_node_move),
    closeWorkspaceTool(defineTool({
      name: "workspace_node_trash",
      description: "Move one remote Workspace Node subtree to Trash after human approval.",
      parameters: trashParameters,
      output: {
        schema: trashOutputSchema,
        render: (_args, value) => [{
          type: "text",
          text: `Moved Workspace Node ${value.trashBatch.root.name} (${value.trashBatch.root.nodeId}) and ${String(value.trashBatch.nodeCount)} Node(s) to Trash Batch ${value.trashBatch.trashBatchId}.`,
        }],
      },
      finalizeContent: mutationFinalizer,
      execute: async (args, exec) => {
        const trashBatch = await execute("trash", "mutation", exec, async (signal) =>
          await feature.trashNode(args.node_id, signal));
        return {
          trashBatch: {
            ...trashBatch,
            originalLocation: {
              breadcrumbs: [...trashBatch.originalLocation.breadcrumbs],
            },
          },
        };
      },
    }), workspaceSpaceNodeValidators.workspace_node_trash),
  ];

  return [
    ...definitions.map((definition) => ctx.tools.register(definition)),
    ctx.on("tools/pre-execute", async (exec, next): Promise<PreToolDecision> => {
      if (!Object.hasOwn(mutationNames, exec.name)) return await next();
      const name = exec.name as keyof typeof mutationNames;
      const operation = mutationNames[name];
      workspaceSpaceNodeValidators[name](exec.arguments);
      return { kind: "ask", reason: `Workspace Node ${operation} changes remote Workspace state.` };
    }),
  ];
}

export function closeWorkspaceTool(
  definition: ToolDefinition,
  validator: OperationValidator,
): ToolDefinition {
  return {
    ...definition,
    parameters: { ...definition.parameters, additionalProperties: false },
    execute: async (args, exec) => {
      validator(args);
      return await definition.execute(args, exec);
    },
  };
}

function operationValidator(
  operation: Operation,
  parameters: ParameterSchemaSpec,
  refine: (value: Record<string, unknown>) => boolean = () => true,
): OperationValidator {
  const expectedKeys = Object.keys(parameters).sort();
  return (value) => {
    if (!isPlainRecord(value)) throw invalidArguments(operation);
    const ownKeys = Reflect.ownKeys(value);
    const actualKeys = Object.keys(value).sort();
    if (
      ownKeys.length !== actualKeys.length
      || actualKeys.some((key) => !expectedKeys.includes(key))
    ) throw invalidArguments(operation);
    if (validateArgs(parameters, value).length > 0 || !refine(value)) {
      throw invalidArguments(operation);
    }
  };
}

function validateBrowse(value: Record<string, unknown>): boolean {
  return nonBlank(value["space_id"])
    && optionalNonBlank(value["parent_node_id"])
    && validFilters(value);
}

function validateFind(value: Record<string, unknown>): boolean {
  return nonBlank(value["space_id"]) && nonBlank(value["query"]) && validFilters(value);
}

function validateCreate(value: Record<string, unknown>): boolean {
  return nonBlank(value["space_id"])
    && validNodeName(value["name"])
    && optionalNonBlank(value["parent_node_id"]);
}

function validateRename(value: Record<string, unknown>): boolean {
  return nonBlank(value["node_id"]) && validNodeName(value["name"]);
}

function validateMove(value: Record<string, unknown>): boolean {
  return nonBlank(value["node_id"])
    && (value["parent_node_id"] === null || nonBlank(value["parent_node_id"]))
    && value["parent_node_id"] !== value["node_id"];
}

function validateTrash(value: Record<string, unknown>): boolean {
  return nonBlank(value["node_id"]);
}

function validFilters(value: Record<string, unknown>): boolean {
  return value["unit_type"] === undefined
    || (value["resource_kind"] !== "none" && value["resource_kind"] !== "blob");
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function optionalNonBlank(value: unknown): boolean {
  return value === undefined || nonBlank(value);
}

function validNodeName(value: unknown): boolean {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 255;
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
    if (error instanceof SpaceNodeToolError) throw error;
    if (error instanceof WorkspaceOwnerNotAcceptingError) throw disposing(operation);
    throw operationFailed(operation);
  }
}

function sanitizeOperationFailure(
  operation: Operation,
  kind: OperationKind,
  error: unknown,
  owned: WorkspaceOwnedExecution,
): SpaceNodeToolError {
  if (error instanceof SpaceNodeToolError) return error;
  if (
    kind === "mutation"
    && error instanceof WorkspaceApplicationError
    && error.code === "workspace-result-unknown"
  ) {
    return workspaceFailure(operation, error.code, projectDetail(error.detail));
  }
  if (owned.ownerSignal.aborted) return disposing(operation);
  if (owned.callerSignal.aborted) return cancelled(operation);
  if (error instanceof WorkspaceAuthenticationRequiredError) {
    return workspaceFailure(operation, "workspace-authentication-required");
  }
  if (error instanceof WorkspaceApplicationError && stableWorkspaceCodes.has(error.code)) {
    return workspaceFailure(operation, error.code, projectDetail(error.detail));
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
  "UNAUTHENTICATED",
  "INVALID_INPUT",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INTERNAL_ERROR",
]);

class SpaceNodeToolError extends HarnessError {}

function invalidArguments(operation: Operation): SpaceNodeToolError {
  return new SpaceNodeToolError(`Workspace ${operation} arguments are invalid.`, "workspace-argument-invalid");
}

function cancelled(operation: Operation): SpaceNodeToolError {
  return new SpaceNodeToolError(`Workspace ${operation} was cancelled.`, "workspace-operation-cancelled");
}

function disposing(operation: Operation): SpaceNodeToolError {
  return new SpaceNodeToolError(`Workspace ${operation} stopped because the plugin is disposing.`, "workspace-plugin-disposing");
}

function operationFailed(operation: Operation): SpaceNodeToolError {
  return workspaceFailure(operation, "workspace-operation-failed");
}

function workspaceFailure(
  operation: Operation,
  code: string,
  detail?: Record<string, unknown>,
): SpaceNodeToolError {
  const envelope = JSON.stringify({ code, ...(detail === undefined ? {} : { detail }) });
  return new SpaceNodeToolError(`Workspace ${operation} failed. ${envelope}`, code);
}

function projectDetail(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainRecord(value)) return undefined;
  const detail: Record<string, unknown> = {};
  for (const key of ["path", "spaceId", "nodeId", "name"] as const) {
    if (typeof value[key] === "string") detail[key] = value[key];
  }
  if (value["parentNodeId"] === null || typeof value["parentNodeId"] === "string") {
    detail["parentNodeId"] = value["parentNodeId"];
  }
  if (Number.isSafeInteger(value["status"])) detail["status"] = value["status"];
  for (const key of ["requested", "actual"] as const) {
    const projected = projectIdentity(value[key]);
    if (projected !== undefined) detail[key] = projected;
  }
  return Object.keys(detail).length === 0 ? undefined : detail;
}

function projectIdentity(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainRecord(value)) return undefined;
  const result: Record<string, unknown> = {};
  for (const key of ["nodeId", "name"] as const) {
    if (typeof value[key] === "string") result[key] = value[key];
  }
  if (value["parentNodeId"] === null || typeof value["parentNodeId"] === "string") {
    result["parentNodeId"] = value["parentNodeId"];
  }
  return Object.keys(result).length === 0 ? undefined : result;
}
