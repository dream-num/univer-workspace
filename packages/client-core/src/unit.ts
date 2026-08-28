import { randomUUID } from "node:crypto";
import { executeWithStableIdentity, workspaceError } from "./errors.js";
import { isWorkspaceRecord, type AuthenticatedWorkspaceHttp } from "./http.js";
import type { WorkspaceUnitType } from "./space-model.js";
import { getWorktree, stableKey } from "./worktree.js";
import { parseUnit, type WorkspaceUnit } from "./worktree-model.js";

export class WorkspaceUnitFeature {
  public constructor(private readonly authenticatedHttp: AuthenticatedWorkspaceHttp) {}

  public async list(worktreeId: string): Promise<readonly WorkspaceUnit[]> {
    const worktree = await getWorktree(await this.authenticatedHttp(), worktreeId);
    if (worktree.units.some((unit) => unit.worktreeId !== worktreeId)) {
      throw workspaceError(
        "workspace-result-mismatch",
        "Workspace Unit list contains a Unit from a different Worktree.",
      );
    }
    return worktree.units;
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
    return await executeWithStableIdentity({
      identity,
      publicIdentity: {
        idempotencyKey: identity.idempotencyKey,
        name: identity.name,
        parentNodeId: identity.parentNodeId ?? null,
        spaceId: identity.spaceId,
        type: identity.type,
        worktreeId: identity.worktreeId,
      },
      operation: async (sameInput) => {
        const body = await http.json(
          `/api/worktrees/${encodeURIComponent(sameInput.worktreeId)}/units`,
          {
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
          },
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
