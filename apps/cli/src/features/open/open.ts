import type { WorkspaceAuth } from "../auth/session.js";
import { WorkspaceWorktreeFeature } from "../worktree/management.js";
import type { WorkspaceUnit } from "../worktree/model.js";
import { workspaceError } from "../../errors.js";

export class WorkspaceOpenFeature {
  public constructor(
    private readonly auth: WorkspaceAuth,
    private readonly worktrees: WorkspaceWorktreeFeature,
  ) {}

  public async createUrl(input: {
    readonly unitId?: string;
    readonly viewerBaseUrl?: string;
    readonly worktreeId: string;
  }): Promise<{
    readonly openUrl: string;
    readonly type: WorkspaceUnit["type"];
    readonly unitId: string;
    readonly worktreeId: string;
  }> {
    const url = parseUrl(input.viewerBaseUrl ?? (await this.auth.configuredOrigin()));
    const worktree = await this.worktrees.get(input.worktreeId);
    if (worktree.id !== input.worktreeId) {
      throw workspaceError(
        "workspace-result-mismatch",
        "Workspace response returned a different Worktree.",
      );
    }
    const unit = selectUnit(worktree.units, input.unitId, worktree.id);
    if (unit.worktreeId !== worktree.id) {
      throw workspaceError(
        "workspace-result-mismatch",
        "Workspace response contains a Unit from a different Worktree.",
      );
    }
    url.pathname = "/worktrees";
    url.search = "";
    url.searchParams.set("worktree", worktree.id);
    url.searchParams.set("unit", unit.unitId);
    url.searchParams.set("view", "agent");
    url.hash = "";
    return {
      openUrl: url.toString(),
      type: unit.type,
      unitId: unit.unitId,
      worktreeId: worktree.id,
    };
  }
}

function selectUnit(
  units: readonly WorkspaceUnit[],
  unitId: string | undefined,
  worktreeId: string,
): WorkspaceUnit {
  if (unitId !== undefined) {
    const unit = units.find((candidate) => candidate.unitId === unitId);
    if (unit === undefined)
      throw workspaceError(
        "workspace-unit-not-found",
        `Unit ${unitId} does not belong to Worktree ${worktreeId}.`,
        { unitId, worktreeId },
      );
    return unit;
  }
  if (units.length !== 1)
    throw workspaceError(
      "workspace-open-unit-required",
      `Worktree ${worktreeId} has ${String(units.length)} Units; select one with --unit <id>.`,
      { unitCount: units.length, worktreeId },
    );
  return units[0]!;
}

function parseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw workspaceError(
      "workspace-viewer-url-invalid",
      `Workspace viewer URL must be an absolute HTTP(S) URL: ${value}`,
      { viewerUrl: value },
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw workspaceError(
      "workspace-viewer-url-invalid",
      `Workspace viewer URL must be an absolute HTTP(S) URL: ${value}`,
      { viewerUrl: value },
    );
  return url;
}
