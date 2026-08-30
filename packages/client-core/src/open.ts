import { workspaceError } from "./errors.js";
import type { AuthenticatedWorkspaceHttp } from "./http.js";
import { getWorktree } from "./worktree.js";
import type { WorkspaceUnit } from "./worktree-model.js";

export interface WorkspaceOpenResult {
  readonly openUrl: string;
  readonly type: WorkspaceUnit["type"];
  readonly unitId: string;
  readonly worktreeId: string;
}

export class WorkspaceOpenFeature {
  public constructor(
    private readonly authenticatedHttp: AuthenticatedWorkspaceHttp,
    private readonly configuredOrigin: () => Promise<string>,
  ) {}

  public async createUrl(input: {
    readonly unitId?: string;
    readonly viewerBaseUrl?: string;
    readonly worktreeId: string;
  }, signal?: AbortSignal): Promise<WorkspaceOpenResult> {
    signal?.throwIfAborted();
    const url =
      input.viewerBaseUrl === undefined
        ? parseUrl(await this.configuredOrigin())
        : parseUrl(input.viewerBaseUrl);
    signal?.throwIfAborted();
    const http = await this.authenticatedHttp(signal);
    signal?.throwIfAborted();
    const worktree = await getWorktree(http, input.worktreeId, signal);
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
    if (unit === undefined) {
      throw workspaceError(
        "workspace-unit-not-found",
        `Unit ${unitId} does not belong to Worktree ${worktreeId}.`,
        { unitId, worktreeId },
      );
    }
    return unit;
  }
  if (units.length !== 1) {
    throw workspaceError(
      "workspace-open-unit-required",
      `Worktree ${worktreeId} has ${String(units.length)} Units; select one with --unit <id>.`,
      { unitCount: units.length, worktreeId },
    );
  }
  return units[0]!;
}

function parseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidViewerUrl(value);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw invalidViewerUrl(value);
  return url;
}

function invalidViewerUrl(value: string): Error {
  return workspaceError(
    "workspace-viewer-url-invalid",
    `Workspace viewer URL must be an absolute HTTP(S) URL: ${value}`,
    { viewerUrl: value },
  );
}
