import type { Context } from "@deepseek-ai/cordis";
import { HarnessError } from "@deepseek-ai/dsh-llm";
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
  WorkspaceOpenFeature,
  WorkspaceUnitFeature,
  WorkspaceWorktreeFeature,
  type WorkspaceHttp,
  type WorkspaceUnit,
  type WorkspaceUnitType,
  type WorkspaceWorktree,
} from "@univerjs/univer-workspace-client-core";
import { WorkspaceAuthenticationRequiredError } from "./authentication-state.js";
import { closeWorkspaceTool } from "./space-node.js";
import {
  WorkspaceOwnerNotAcceptingError,
  type WorkspaceOwnedExecution,
  type WorkspaceToolOwner,
} from "./tool-owner.js";

interface WorkspaceWorktreeUnitDependencies {
  readonly owner: WorkspaceToolOwner;
  readonly resolveAuthenticatedHttp: (signal?: AbortSignal) => Promise<WorkspaceHttp>;
}

type Operation =
  | "worktree list"
  | "worktree get"
  | "worktree create"
  | "worktree update"
  | "worktree ready"
  | "worktree reopen"
  | "worktree merge"
  | "worktree discard"
  | "unit list"
  | "unit add"
  | "unit create"
  | "worktree review";
type OperationKind = "read" | "mutation";
type OperationValidator<Input extends Record<string, unknown>> = (value: unknown) => Input;
type ListArgs = { view?: "active" | "processed"; scope?: "user" | "space"; space_id?: string };
type WorktreeIdArgs = { worktree_id: string };
type CreateArgs = {
  name: string;
  scope: "user" | "space";
  space_id?: string;
  visibility?: "private" | "space";
  idempotency_key?: string;
};
type UpdateArgs = { worktree_id: string; name?: string; visibility?: "private" | "space" };
type UnitAddArgs = { worktree_id: string; resource_id: string };
type UnitCreateArgs = {
  worktree_id: string;
  space_id: string;
  type: WorkspaceUnitType;
  name: string;
  parent_node_id?: string;
  idempotency_key?: string;
};
type ReviewArgs = { worktree_id: string; unit_id?: string };

const views = ["active", "processed"] as const;
const scopes = ["user", "space"] as const;
const visibilities = ["private", "space"] as const;
const unitTypes = ["sheet", "doc", "slide", "base", "board"] as const;
const worktreeStates = ["draft", "ready", "merging", "merged", "discarded"] as const;

const listParameters = {
  view: { type: "string", enum: views },
  scope: { type: "string", enum: scopes },
  space_id: { type: "string" },
} as const;
const worktreeIdParameters = {
  worktree_id: { type: "string", required: true },
} as const;
const createParameters = {
  name: { type: "string", required: true },
  scope: { type: "string", enum: scopes, required: true },
  space_id: { type: "string" },
  visibility: { type: "string", enum: visibilities },
  idempotency_key: { type: "string" },
} as const;
const updateParameters = {
  worktree_id: { type: "string", required: true },
  name: { type: "string" },
  visibility: { type: "string", enum: visibilities },
} as const;
const unitAddParameters = {
  worktree_id: { type: "string", required: true },
  resource_id: { type: "string", required: true },
} as const;
const unitCreateParameters = {
  worktree_id: { type: "string", required: true },
  space_id: { type: "string", required: true },
  type: { type: "string", enum: unitTypes, required: true },
  name: { type: "string", required: true },
  parent_node_id: { type: "string" },
  idempotency_key: { type: "string" },
} as const;
const reviewParameters = {
  worktree_id: { type: "string", required: true },
  unit_id: { type: "string" },
} as const;

const validators = {
  workspace_worktree_list: operationValidator<ListArgs>("worktree list", listParameters, (value) =>
    optionalNonBlank(value["space_id"])
      && (value["space_id"] === undefined || value["scope"] === "space")),
  workspace_worktree_get: operationValidator<WorktreeIdArgs>("worktree get", worktreeIdParameters, hasWorktreeId),
  workspace_worktree_create: operationValidator<CreateArgs>("worktree create", createParameters, (value) =>
    nonBlank(value["name"])
      && optionalNonBlank(value["idempotency_key"])
      && (value["scope"] === "user"
        ? value["space_id"] === undefined && value["visibility"] === undefined
        : nonBlank(value["space_id"]))),
  workspace_worktree_update: operationValidator<UpdateArgs>("worktree update", updateParameters, (value) =>
    hasWorktreeId(value)
      && optionalNonBlank(value["name"])
      && (value["name"] !== undefined || value["visibility"] !== undefined)),
  workspace_worktree_ready: operationValidator<WorktreeIdArgs>("worktree ready", worktreeIdParameters, hasWorktreeId),
  workspace_worktree_reopen: operationValidator<WorktreeIdArgs>("worktree reopen", worktreeIdParameters, hasWorktreeId),
  workspace_worktree_merge: operationValidator<WorktreeIdArgs>("worktree merge", worktreeIdParameters, hasWorktreeId),
  workspace_worktree_discard: operationValidator<WorktreeIdArgs>("worktree discard", worktreeIdParameters, hasWorktreeId),
  workspace_unit_list: operationValidator<WorktreeIdArgs>("unit list", worktreeIdParameters, hasWorktreeId),
  workspace_unit_add: operationValidator<UnitAddArgs>("unit add", unitAddParameters, (value) =>
    hasWorktreeId(value) && nonBlank(value["resource_id"])),
  workspace_unit_create: operationValidator<UnitCreateArgs>("unit create", unitCreateParameters, (value) =>
    hasWorktreeId(value)
      && nonBlank(value["space_id"])
      && nonBlank(value["name"])
      && optionalNonBlank(value["parent_node_id"])
      && optionalNonBlank(value["idempotency_key"])),
  workspace_worktree_review_url: operationValidator<ReviewArgs>("worktree review", reviewParameters, (value) =>
    hasWorktreeId(value) && optionalNonBlank(value["unit_id"])),
};

const mutationNames = {
  workspace_worktree_create: "worktree create",
  workspace_worktree_update: "worktree update",
  workspace_worktree_ready: "worktree ready",
  workspace_worktree_reopen: "worktree reopen",
  workspace_worktree_merge: "worktree merge",
  workspace_worktree_discard: "worktree discard",
  workspace_unit_add: "unit add",
  workspace_unit_create: "unit create",
} as const satisfies Record<string, Operation>;

const stringSchema = { type: "string", required: true } as const;
const nullableStringSchema = {
  oneOf: [{ type: "string" }, { type: "null" }],
  required: true,
} as const;
const targetSchema = {
  oneOf: [
    { type: "null" },
    {
      type: "object",
      additionalProperties: false,
      properties: { parentNodeId: nullableStringSchema, spaceId: stringSchema },
    },
  ],
  required: true,
} as const;
const unitSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    activationState: {
      type: "string",
      enum: ["notApplicable", "waitingForMerge", "pending", "completed", "failed", "discarded"],
      required: true,
    },
    change: { type: "string", enum: ["modified", "added", "deleted", "unchanged"], required: true },
    draftHeadRevision: { type: "integer", required: true },
    mergeResult: { type: "string", enum: ["pending", "merged", "unchanged", "conflict", "failed"], required: true },
    name: stringSchema,
    nodeId: stringSchema,
    resourceId: stringSchema,
    source: { type: "string", enum: ["trunk", "worktree"], required: true },
    target: targetSchema,
    type: { type: "string", enum: unitTypes, required: true },
    unitId: stringSchema,
    worktreeId: stringSchema,
  },
} as const;
const worktreeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: stringSchema,
    name: stringSchema,
    spaceId: { type: "string" },
    state: { type: "string", enum: worktreeStates, required: true },
    units: { type: "array", items: unitSchema, required: true },
  },
} as const;
const worktreesOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: { worktrees: { type: "array", items: worktreeSchema, required: true } },
} as const;
const worktreeOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: { worktree: { ...worktreeSchema, required: true } },
} as const;
const unitsOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: { units: { type: "array", items: unitSchema, required: true } },
} as const;
const unitOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: { unit: { ...unitSchema, required: true } },
} as const;
const reviewOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    review: {
      type: "object",
      additionalProperties: false,
      required: true,
      properties: {
        openUrl: stringSchema,
        type: { type: "string", enum: unitTypes, required: true },
        unitId: stringSchema,
        worktreeId: stringSchema,
      },
    },
  },
} as const;

export function registerWorkspaceWorktreeUnitTools(
  ctx: Context,
  dependencies: WorkspaceWorktreeUnitDependencies,
): readonly (() => void)[] {
  const worktrees = new WorkspaceWorktreeFeature(dependencies.resolveAuthenticatedHttp);
  const units = new WorkspaceUnitFeature(dependencies.resolveAuthenticatedHttp);
  const execute = <Result>(
    operation: Operation,
    kind: OperationKind,
    exec: ToolRunContext,
    body: (signal: AbortSignal) => Promise<Result>,
  ): Promise<Result> => executeOwned(dependencies.owner, operation, kind, exec, body);
  const worktreeMutation = (
    operation: Operation,
    exec: ToolRunContext,
    body: (signal: AbortSignal) => Promise<WorkspaceWorktree>,
  ) => execute(operation, "mutation", exec, body).then(toolWorktree);

  const definitions = [
    closeWorkspaceTool(defineTool({
      name: "workspace_worktree_list",
      description: "List active or processed remote Workspace Worktrees visible to the current User.",
      parameters: listParameters,
      output: {
        schema: worktreesOutputSchema,
        render: (_args, value) => [{
          type: "text",
          text: value.worktrees.length === 0
            ? "No matching Workspace Worktrees were found."
            : `Workspace Worktrees (${String(value.worktrees.length)}): ${value.worktrees.map((worktree) => `${worktree.name} (${worktree.id}, ${worktree.state})`).join(", ")}.`,
        }],
      },
      isConcurrencySafe: () => true,
      execute: async (args, exec) => {
        validators.workspace_worktree_list(args);
        return {
          worktrees: (await execute("worktree list", "read", exec, async (signal) =>
            await worktrees.list({
              view: args.view ?? "active",
              ...(args.scope === undefined ? {} : { scope: args.scope }),
              ...(args.space_id === undefined ? {} : { spaceId: args.space_id }),
            }, signal))).map(toolWorktree),
        };
      },
    }), validators.workspace_worktree_list),
    closeWorkspaceTool(defineTool({
      name: "workspace_worktree_get",
      description: "Read one remote Workspace Worktree by stable identity.",
      parameters: worktreeIdParameters,
      output: {
        schema: worktreeOutputSchema,
        render: (_args, value) => [{ type: "text", text: `Workspace Worktree ${value.worktree.name} (${value.worktree.id}) is ${value.worktree.state}.` }],
      },
      isConcurrencySafe: () => true,
      execute: async (args, exec) => {
        const input = validators.workspace_worktree_get(args);
        return { worktree: toolWorktree(await execute("worktree get", "read", exec, async (signal) => await worktrees.get(input.worktree_id, signal))) };
      },
    }), validators.workspace_worktree_get),
    closeWorkspaceTool(defineTool({
      name: "workspace_worktree_create",
      description: "Create one isolated remote Workspace Worktree after human approval.",
      parameters: createParameters,
      output: {
        schema: worktreeOutputSchema,
        render: (_args, value) => [{ type: "text", text: `Created Workspace Worktree ${value.worktree.name} (${value.worktree.id}).` }],
      },
      finalizeContent: mutationFinalizer("worktree create"),
      execute: async (args, exec) => {
        const input = validators.workspace_worktree_create(args);
        return { worktree: await worktreeMutation("worktree create", exec, async (signal) => await worktrees.create({
          name: input.name,
          scope: input.scope === "user"
            ? { kind: "user" }
            : { kind: "space", spaceId: input.space_id! },
          ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
          ...(input.idempotency_key === undefined ? {} : { idempotencyKey: input.idempotency_key }),
        }, signal)) };
      },
    }), validators.workspace_worktree_create),
    closeWorkspaceTool(defineTool({
      name: "workspace_worktree_update",
      description: "Update one remote Workspace Worktree after human approval.",
      parameters: updateParameters,
      output: {
        schema: worktreeOutputSchema,
        render: (_args, value) => [{ type: "text", text: `Updated Workspace Worktree ${value.worktree.name} (${value.worktree.id}).` }],
      },
      finalizeContent: mutationFinalizer("worktree update"),
      execute: async (args, exec) => {
        const input = validators.workspace_worktree_update(args);
        return { worktree: await worktreeMutation("worktree update", exec, async (signal) => await worktrees.update(input.worktree_id, {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
        }, signal)) };
      },
    }), validators.workspace_worktree_update),
    ...worktreeTransitionDefinitions(worktrees, worktreeMutation),
    closeWorkspaceTool(defineTool({
      name: "workspace_unit_list",
      description: "List all Units participating in one remote Workspace Worktree.",
      parameters: worktreeIdParameters,
      output: {
        schema: unitsOutputSchema,
        render: (_args, value) => [{
          type: "text",
          text: value.units.length === 0
            ? "The Workspace Worktree has no Units."
            : `Workspace Units (${String(value.units.length)}): ${value.units.map((unit) => `${unit.name} (${unit.unitId}, ${unit.source})`).join(", ")}.`,
        }],
      },
      isConcurrencySafe: () => true,
      execute: async (args, exec) => {
        const input = validators.workspace_unit_list(args);
        return { units: (await execute("unit list", "read", exec, async (signal) => await units.list(input.worktree_id, signal))).map(toolUnit) };
      },
    }), validators.workspace_unit_list),
    closeWorkspaceTool(defineTool({
      name: "workspace_unit_add",
      description: "Stage one existing remote Workspace Resource in a Worktree after human approval.",
      parameters: unitAddParameters,
      output: {
        schema: unitOutputSchema,
        render: (_args, value) => [{ type: "text", text: `Added Workspace Resource ${value.unit.resourceId} as Unit ${value.unit.unitId}.` }],
      },
      finalizeContent: mutationFinalizer("unit add"),
      execute: async (args, exec) => {
        const input = validators.workspace_unit_add(args);
        return { unit: toolUnit(await execute("unit add", "mutation", exec, async (signal) => await units.add(input.worktree_id, input.resource_id, signal))) };
      },
    }), validators.workspace_unit_add),
    closeWorkspaceTool(defineTool({
      name: "workspace_unit_create",
      description: "Create one Worktree-local Workspace Unit after human approval.",
      parameters: unitCreateParameters,
      output: {
        schema: unitOutputSchema,
        render: (_args, value) => [{ type: "text", text: `Created Worktree-local Workspace Unit ${value.unit.name} (${value.unit.unitId}).` }],
      },
      finalizeContent: mutationFinalizer("unit create"),
      execute: async (args, exec) => {
        const input = validators.workspace_unit_create(args);
        return { unit: toolUnit(await execute("unit create", "mutation", exec, async (signal) => await units.create({
          worktreeId: input.worktree_id,
          spaceId: input.space_id,
          type: input.type,
          name: input.name,
          ...(input.parent_node_id === undefined ? {} : { parentNodeId: input.parent_node_id }),
          ...(input.idempotency_key === undefined ? {} : { idempotencyKey: input.idempotency_key }),
        }, signal))) };
      },
    }), validators.workspace_unit_create),
    closeWorkspaceTool(defineTool({
      name: "workspace_worktree_review_url",
      description: "Construct the authenticated Workspace Browser review URL for one Worktree Unit.",
      parameters: reviewParameters,
      output: {
        schema: reviewOutputSchema,
        render: (_args, value) => [{ type: "text", text: `Review Workspace Unit ${value.review.unitId} at ${value.review.openUrl}` }],
      },
      isConcurrencySafe: () => true,
      execute: async (args, exec) => {
        const input = validators.workspace_worktree_review_url(args);
        return {
          review: await execute("worktree review", "read", exec, async (signal) => {
            const http = await dependencies.resolveAuthenticatedHttp(signal);
            signal.throwIfAborted();
            return await new WorkspaceOpenFeature(
              async () => http,
              async () => http.origin,
            ).createUrl({
              worktreeId: input.worktree_id,
              ...(input.unit_id === undefined ? {} : { unitId: input.unit_id }),
            }, signal);
          }),
        };
      },
    }), validators.workspace_worktree_review_url),
  ];

  return [
    ...definitions.map((definition) => ctx.tools.register(definition)),
    ctx.on("tools/pre-execute", async (exec, next): Promise<PreToolDecision> => {
      if (!Object.hasOwn(mutationNames, exec.name)) return await next();
      const name = exec.name as keyof typeof mutationNames;
      validators[name](exec.arguments);
      const operation = mutationNames[name];
      return {
        kind: "ask",
        reason: operation === "worktree merge"
          ? "Merge the remote Workspace Worktree into Trunk."
          : operation === "worktree discard"
            ? "Discard the remote Workspace Worktree and its draft changes."
            : `Workspace ${operation} changes remote Workspace state.`,
      };
    }),
  ];
}

function worktreeTransitionDefinitions(
  worktrees: WorkspaceWorktreeFeature,
  execute: (
    operation: Operation,
    exec: ToolRunContext,
    body: (signal: AbortSignal) => Promise<WorkspaceWorktree>,
  ) => Promise<ReturnType<typeof toolWorktree>>,
) {
  return ([
    ["workspace_worktree_ready", "ready", "Mark one draft Workspace Worktree ready for human review.", "Ready"],
    ["workspace_worktree_reopen", "reopen", "Reopen one ready Workspace Worktree for same-task rework.", "Reopened"],
    ["workspace_worktree_merge", "merge", "Merge one ready Workspace Worktree into Trunk after explicit human approval.", "Merged"],
    ["workspace_worktree_discard", "discard", "Discard one Workspace Worktree after explicit human approval.", "Discarded"],
  ] as const).map(([name, action, description, resultVerb]) => {
    const operation = `worktree ${action}` as Operation;
    const validator = validators[name];
    return closeWorkspaceTool(defineTool({
      name,
      description,
      parameters: worktreeIdParameters,
      output: {
        schema: worktreeOutputSchema,
        render: (_args, value) => [{ type: "text", text: `${resultVerb} Workspace Worktree ${value.worktree.name} (${value.worktree.id}).` }],
      },
      finalizeContent: mutationFinalizer(operation),
      execute: async (args, exec) => {
        const input = validator(args);
        return { worktree: await execute(operation, exec, async (signal) =>
          await worktrees.transition(input.worktree_id, action, signal)) };
      },
    }), validator);
  });
}

function mutationFinalizer(operation: Operation) {
  return (_exec: unknown, result: Readonly<ToolExecutionResult>) => {
    if (
      !result.isError
      || (result.error.info?.code !== TOOL_ABORTED
        && result.error.info?.code !== "workspace-result-unknown")
    ) return undefined;
    const inspection = operation === "worktree create"
      ? "workspace_worktree_list"
      : operation === "unit add" || operation === "unit create"
        ? "workspace_unit_list"
        : "workspace_worktree_get";
    return [{
      type: "text" as const,
      text: `The Workspace mutation may have completed. Inspect current state with ${inspection} before deciding any next action. Never replay the mutation automatically.`,
    }];
  };
}

function toolWorktree(worktree: WorkspaceWorktree) {
  return {
    ...worktree,
    units: worktree.units.map(toolUnit),
  };
}

function toolUnit(unit: WorkspaceUnit) {
  return {
    ...unit,
    target: unit.target === null ? null : { ...unit.target },
  };
}

function operationValidator<
  Input extends Record<string, unknown>,
>(
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

function hasWorktreeId(value: Record<string, unknown>): boolean {
  return nonBlank(value["worktree_id"]);
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
    if (error instanceof WorktreeUnitToolError) throw error;
    if (error instanceof WorkspaceOwnerNotAcceptingError) throw disposing(operation);
    throw operationFailed(operation);
  }
}

function sanitizeOperationFailure(
  operation: Operation,
  kind: OperationKind,
  error: unknown,
  owned: WorkspaceOwnedExecution,
): WorktreeUnitToolError {
  if (error instanceof WorktreeUnitToolError) return error;
  if (
    kind === "mutation"
    && error instanceof WorkspaceApplicationError
    && error.code === "workspace-result-unknown"
  ) return workspaceFailure(operation, error.code, projectDetail(error.detail));
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
  "workspace-lifecycle-invalid",
  "workspace-viewer-url-invalid",
  "workspace-open-unit-required",
  "workspace-unit-not-found",
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

class WorktreeUnitToolError extends HarnessError {}

function invalidArguments(operation: Operation): WorktreeUnitToolError {
  return new WorktreeUnitToolError(`Workspace ${operation} arguments are invalid.`, "workspace-argument-invalid");
}

function cancelled(operation: Operation): WorktreeUnitToolError {
  return new WorktreeUnitToolError(`Workspace ${operation} was cancelled.`, "workspace-operation-cancelled");
}

function disposing(operation: Operation): WorktreeUnitToolError {
  return new WorktreeUnitToolError(`Workspace ${operation} stopped because the plugin is disposing.`, "workspace-plugin-disposing");
}

function operationFailed(operation: Operation): WorktreeUnitToolError {
  return workspaceFailure(operation, "workspace-operation-failed");
}

function workspaceFailure(
  operation: Operation,
  code: string,
  detail?: Record<string, unknown>,
): WorktreeUnitToolError {
  const envelope = JSON.stringify({ code, ...(detail === undefined ? {} : { detail }) });
  return new WorktreeUnitToolError(`Workspace ${operation} failed. ${envelope}`, code);
}

function projectDetail(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainRecord(value)) return undefined;
  const detail: Record<string, unknown> = {};
  for (const key of [
    "path", "spaceId", "worktreeId", "unitId", "resourceId", "name", "idempotencyKey",
    "expectedState", "actualState", "actualId",
  ] as const) {
    if (typeof value[key] === "string") detail[key] = value[key];
  }
  if (value["parentNodeId"] === null || typeof value["parentNodeId"] === "string") {
    detail["parentNodeId"] = value["parentNodeId"];
  }
  for (const key of ["status", "unitCount"] as const) {
    if (Number.isSafeInteger(value[key])) detail[key] = value[key];
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
    "spaceId", "worktreeId", "unitId", "resourceId", "name", "idempotencyKey", "type", "state",
  ] as const) {
    if (typeof value[key] === "string") result[key] = value[key];
  }
  if (value["parentNodeId"] === null || typeof value["parentNodeId"] === "string") {
    result["parentNodeId"] = value["parentNodeId"];
  }
  return Object.keys(result).length === 0 ? undefined : result;
}
