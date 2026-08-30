import { prepareContentExecutionProgram } from "@univer-cli/content-execution";
import type { CollaborationRuntimeValue } from "@univer-cli/univer-collaboration-runtime";
import type { WorkspaceContentRuntimeOperations } from "./content-runtime.js";
import { workspaceError } from "./errors.js";
import type { WorkspaceRuntimeTarget } from "./runtime-target.js";

export interface WorkspaceContentExecuteInput {
  readonly code: string;
  readonly maxValueBytes?: number;
  readonly maxValueDepth?: number;
  readonly signal?: AbortSignal;
  readonly unitId: string;
  readonly worktreeId: string;
}

export interface WorkspaceContentExecuteResult {
  readonly committed: boolean;
  readonly revision?: number;
  readonly status?: string;
  readonly value: CollaborationRuntimeValue;
}

export interface WorkspaceEditableTargetResolver {
  resolveEditableRuntimeTarget(input: {
    readonly unitId: string;
    readonly worktreeId: string;
  }, signal?: AbortSignal): Promise<WorkspaceRuntimeTarget>;
}

export class WorkspaceContentExecutionFeature {
  public constructor(
    private readonly source: WorkspaceEditableTargetResolver,
    private readonly runtime: Pick<WorkspaceContentRuntimeOperations, "executeAndCommit">,
  ) {}

  public async execute(
    input: WorkspaceContentExecuteInput,
  ): Promise<WorkspaceContentExecuteResult> {
    return await this.executeForTarget(input);
  }

  public async executeSlide(
    input: WorkspaceContentExecuteInput,
  ): Promise<WorkspaceContentExecuteResult> {
    return await this.executeForTarget(input, "slide");
  }

  private async executeForTarget(
    input: WorkspaceContentExecuteInput,
    requiredUnitType?: "slide",
  ): Promise<WorkspaceContentExecuteResult> {
    input.signal?.throwIfAborted();
    const targetInput = {
      unitId: input.unitId,
      worktreeId: input.worktreeId,
    };
    const target = input.signal === undefined
      ? await this.source.resolveEditableRuntimeTarget(targetInput)
      : await this.source.resolveEditableRuntimeTarget(targetInput, input.signal);
    input.signal?.throwIfAborted();
    if (requiredUnitType !== undefined && target.unitType !== requiredUnitType) {
      throw workspaceError(
        "WORKSPACE_CONTENT_UNIT_TYPE_UNSUPPORTED",
        `Expected a ${requiredUnitType} Unit; received ${target.unitType}.`,
      );
    }
    const result: unknown = await this.runtime.executeAndCommit({
      code: prepareContentExecutionProgram({
        code: input.code,
        unitId: target.unitId,
        unitType: target.unitType,
      }),
      target,
      ...(input.maxValueBytes === undefined ? {} : { maxValueBytes: input.maxValueBytes }),
      ...(input.maxValueDepth === undefined ? {} : { maxValueDepth: input.maxValueDepth }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    if (!isRecord(result) || typeof result["committed"] !== "boolean" || !("value" in result)) {
      throw invalidResult();
    }
    if (result["committed"] === false) {
      return { committed: false, value: result["value"] as CollaborationRuntimeValue };
    }
    if (
      !Number.isSafeInteger(result["revision"]) ||
      Number(result["revision"]) < 1 ||
      typeof result["status"] !== "string" ||
      result["status"].length === 0
    ) {
      throw invalidResult();
    }
    return {
      committed: true,
      revision: Number(result["revision"]),
      status: result["status"],
      value: result["value"] as CollaborationRuntimeValue,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResult(): Error {
  return workspaceError("WORKSPACE_RUNTIME_RESULT_INVALID", "Runtime result is invalid");
}
