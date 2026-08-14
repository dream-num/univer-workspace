import { prepareContentExecutionProgram } from "@univer-cli/content-execution";
import type { DaemonClient, JsonValue } from "@univer-cli/daemon";
import { workspaceError } from "../../errors.js";
import type { WorkspaceRuntimeTarget } from "../../runtime/target.js";

export interface WorkspaceContentExecuteInput {
  readonly code: string;
  readonly unitId: string;
  readonly worktreeId: string;
}

export interface WorkspaceContentExecuteResult {
  readonly committed: boolean;
  readonly revision?: number;
  readonly status?: string;
  readonly value: JsonValue;
}

export interface WorkspaceEditableTargetResolver {
  resolveEditableRuntimeTarget(input: {
    readonly unitId: string;
    readonly worktreeId: string;
  }): Promise<WorkspaceRuntimeTarget>;
}

export class WorkspaceContentExecutionFeature {
  public constructor(
    private readonly source: WorkspaceEditableTargetResolver,
    private readonly daemon: Pick<DaemonClient, "request">,
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
    const target = await this.source.resolveEditableRuntimeTarget({
      unitId: input.unitId,
      worktreeId: input.worktreeId,
    });
    if (requiredUnitType !== undefined && target.unitType !== requiredUnitType) {
      throw workspaceError(
        "WORKSPACE_CONTENT_UNIT_TYPE_UNSUPPORTED",
        `Expected a ${requiredUnitType} Unit; received ${target.unitType}.`,
      );
    }
    const result = await this.daemon.request("runtime.execute-and-commit", {
      code: prepareContentExecutionProgram({
        code: input.code,
        unitId: target.unitId,
        unitType: target.unitType,
      }),
      target: serializeTarget(target),
    });
    if (!isRecord(result) || typeof result["committed"] !== "boolean" || !("value" in result)) {
      throw invalidResult();
    }
    if (result["committed"] === false) {
      return { committed: false, value: result["value"] };
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
      value: result["value"],
    };
  }
}

function serializeTarget(target: WorkspaceRuntimeTarget): JsonValue {
  return {
    origin: target.origin,
    revision: target.revision,
    scope: target.scope,
    unitId: target.unitId,
    unitType: target.unitType,
  };
}

function isRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResult(): Error {
  return workspaceError("WORKSPACE_RUNTIME_RESULT_INVALID", "Runtime result is invalid");
}
