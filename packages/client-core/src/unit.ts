import { randomUUID } from "node:crypto";
import { executeWithStableIdentity, workspaceError, WorkspaceResultUnknownError } from "./errors.js";
import { isWorkspaceRecord, type AuthenticatedWorkspaceHttp, type WorkspaceHttp } from "./http.js";
import type { WorkspaceUnitType } from "./space-model.js";
import { getWorktree, stableKey } from "./worktree.js";
import { parseUnit, type WorkspaceUnit, type WorkspaceWorktree } from "./worktree-model.js";

/** The Units of a fetched Worktree, refusing a Unit that belongs to a different Worktree. */
export function worktreeUnits(worktree: WorkspaceWorktree): readonly WorkspaceUnit[] {
  if (worktree.units.some((unit) => unit.worktreeId !== worktree.id)) {
    throw workspaceError(
      "workspace-result-mismatch",
      "Workspace Unit list contains a Unit from a different Worktree.",
    );
  }
  return worktree.units;
}

export class WorkspaceUnitFeature {
  public constructor(private readonly authenticatedHttp: AuthenticatedWorkspaceHttp) {}

  public async list(worktreeId: string): Promise<readonly WorkspaceUnit[]> {
    return worktreeUnits(await getWorktree(await this.authenticatedHttp(), worktreeId));
  }

  public async add(worktreeId: string, resourceId: string): Promise<WorkspaceUnit> {
    const http = await this.authenticatedHttp();
    return await executeWithStableIdentity({
      identity: { resourceId, worktreeId },
      operation: async (sameInput) => {
        const body = await http.json(
          `/api/worktrees/${encodeURIComponent(sameInput.worktreeId)}/units`,
          {
            body: { resourceId: sameInput.resourceId, source: "trunk" },
            idempotencyKey: stableKey("add-unit", sameInput.worktreeId, sameInput.resourceId),
            method: "POST",
          },
        );
        const value = body["unit"];
        if (
          isWorkspaceRecord(value) &&
          (value["source"] !== "trunk" ||
            value["resourceId"] !== sameInput.resourceId ||
            value["target"] !== null)
        ) {
          throw workspaceError(
            "workspace-result-mismatch",
            "Workspace response returned a different added Resource Unit.",
          );
        }
        const unit = parseUnit(value, sameInput.worktreeId);
        if (
          unit.source !== "trunk" ||
          unit.resourceId !== sameInput.resourceId ||
          unit.target !== null
        ) {
          throw workspaceError(
            "workspace-result-mismatch",
            "Workspace response returned a different added Resource Unit.",
          );
        }
        return unit;
      },
    });
  }

  public async create(input: {
    readonly fromNodeId?: string;
    readonly idempotencyKey?: string;
    readonly initialData?: Readonly<Record<string, unknown>>;
    readonly name: string;
    readonly parentNodeId?: string;
    readonly spaceId: string;
    readonly type: WorkspaceUnitType;
    readonly worktreeId: string;
  }): Promise<WorkspaceUnit> {
    const http = await this.authenticatedHttp();
    const identity = { ...input, idempotencyKey: input.idempotencyKey ?? randomUUID() };
    if (identity.fromNodeId !== undefined) {
      if (identity.initialData !== undefined) {
        throw workspaceError("workspace-argument-invalid", "A copy takes its content from its source.");
      }
      await assertSourceType(http, identity.fromNodeId, identity.type);
    }
    return await executeWithStableIdentity({
      identity,
      publicIdentity: {
        ...(identity.fromNodeId === undefined ? {} : { fromNodeId: identity.fromNodeId }),
        idempotencyKey: identity.idempotencyKey,
        name: identity.name,
        parentNodeId: identity.parentNodeId ?? null,
        spaceId: identity.spaceId,
        type: identity.type,
        worktreeId: identity.worktreeId,
      },
      operation: async (sameInput) => {
        const body =
          sameInput.fromNodeId === undefined
            ? await http.json(`/api/worktrees/${encodeURIComponent(sameInput.worktreeId)}/units`, {
                body: {
                  name: sameInput.name,
                  ...(sameInput.initialData === undefined
                    ? {}
                    : { initialData: sameInput.initialData }),
                  source: "worktree",
                  targetParentNodeId: sameInput.parentNodeId ?? null,
                  targetSpaceId: sameInput.spaceId,
                  unitType: sameInput.type,
                },
                idempotencyKey: sameInput.idempotencyKey,
                method: "POST",
              })
            : completedCopy(
                await http.json(`/api/nodes/${encodeURIComponent(sameInput.fromNodeId)}/copies`, {
                  body: {
                    name: sameInput.name,
                    target: {
                      kind: "worktree",
                      worktreeId: sameInput.worktreeId,
                      spaceId: sameInput.spaceId,
                      parentNodeId: sameInput.parentNodeId ?? null,
                    },
                  },
                  idempotencyKey: sameInput.idempotencyKey,
                  method: "POST",
                }),
              );
        const unit = parseUnit(body["unit"], sameInput.worktreeId);
        if (
          unit.source !== "worktree" ||
          unit.type !== sameInput.type ||
          unit.name !== sameInput.name ||
          unit.target?.spaceId !== sameInput.spaceId ||
          unit.target.parentNodeId !== (sameInput.parentNodeId ?? null)
        ) {
          throw workspaceError(
            "workspace-result-mismatch",
            "Workspace Unit response does not match the requested Worktree-local Unit.",
          );
        }
        return unit;
      },
    });
  }
}

/** A copy lands as a Unit of the type of its source, so a different requested type is refused before anything is written. */
async function assertSourceType(
  http: WorkspaceHttp,
  nodeId: string,
  type: WorkspaceUnitType,
): Promise<void> {
  const { node } = await http.json(`/api/nodes/${encodeURIComponent(nodeId)}`);
  const resource = isWorkspaceRecord(node) ? node["resource"] : undefined;
  const sourceType =
    isWorkspaceRecord(resource) && resource["kind"] === "univer" ? resource["unitType"] : undefined;
  if (sourceType === type) return;
  throw workspaceError(
    "workspace-argument-invalid",
    typeof sourceType === "string"
      ? `The source is a ${sourceType} file, so the copy must have type ${sourceType}.`
      : "The source is not a Unit, so it cannot be copied into a pull request.",
    { nodeId },
  );
}

/** The response of a copy that completed. A copy still running has an unknown result; a failed one cannot be replayed. */
function completedCopy(body: Record<string, unknown>): Record<string, unknown> {
  const operation = body["operation"];
  if (body["unit"] !== undefined || !isWorkspaceRecord(operation)) return body;
  if (operation["state"] !== "failed") throw new WorkspaceResultUnknownError("The copy is still running.");
  const error = isWorkspaceRecord(operation["error"]) ? operation["error"] : {};
  throw workspaceError(
    typeof error["code"] === "string" ? error["code"] : "workspace-copy-failed",
    `${typeof error["message"] === "string" ? error["message"] : "The copy failed."} Copy again with a new idempotency key.`,
  );
}
