import {
  createCollaborationServerAdapter,
  createUniverCollaborationRuntimeFactory,
  type UniverFactoryContext,
} from "@univer-cli/univer-collaboration-runtime";
import { defineUniverCollaborationRuntimeWorker } from "@univer-cli/univer-collaboration-runtime-pool";
import type { JsonValue } from "@univer-cli/daemon";
import { createStandardHeadlessUniverFactory } from "@univer-cli/headless-univer";
import { UniverInstanceType } from "@univerjs/core";
import { resolveUniverLicense, workspaceSessionPath } from "../config.js";
import { workspaceError } from "../errors.js";
import { readWorkspaceCookie } from "../features/auth/session.js";
import { WorkspaceHttp } from "../transport/http.js";
import { createWorkspaceReferencedUnitProviderRegistration } from "./referenced-unit-provider.js";
import type { WorkspaceReferenceHostContext } from "./reference-scope.js";
import { WorkspaceSnapshotServerAdapter } from "./snapshot-server-adapter.js";
import { parseWorkspaceRuntimeTarget, type WorkspaceRuntimeTarget } from "./target.js";

export default defineUniverCollaborationRuntimeWorker<JsonValue>({
  async createRuntime(init) {
    const target = parseWorkspaceRuntimeTarget(init);
    const cookie = await readWorkspaceCookie({
      origin: target.origin,
      sessionPath: workspaceSessionPath(process.env),
    });
    if (cookie === undefined) {
      throw workspaceError(
        "workspace-authentication-required",
        "Log in to the current Workspace origin first.",
      );
    }
    const http = new WorkspaceHttp({ cookie, origin: target.origin, role: "worker" });
    const hostContext = await loadReferenceHostContext(http, target);
    const snapshotServerService = new WorkspaceSnapshotServerAdapter({
      hostScope: target.scope,
      http,
    });
    const createUniver = async (context: UniverFactoryContext) => {
      if (context.resolveSnapshotService === undefined) {
        throw workspaceError(
          "workspace-reference-runtime-invalid",
          "Workspace reference loading requires a SnapshotService resolver.",
        );
      }
      return await createStandardHeadlessUniverFactory({
        embedPluginConfig: {
          resourceRefUnitProviderRegistrations: [
            createWorkspaceReferencedUnitProviderRegistration({
              hostContext,
              resolveSnapshotService: context.resolveSnapshotService,
            }),
          ],
        },
        license: resolveUniverLicense(process.env),
      })(context);
    };
    const prefix =
      target.scope.kind === "trunk"
        ? "/universer-api"
        : `/universer-api/worktrees/${encodeURIComponent(target.scope.worktreeId)}`;
    const url = (path: string): string => new URL(`${prefix}${path}`, target.origin).href;
    const backend = createCollaborationServerAdapter({
      collabSubmitChangesetUrl: url("/comb"),
      collabWebSocketUrl: url("/comb/connect"),
      httpRequest: async (input, options) => await http.collaborationRequest(input, options),
      snapshotServerUrl: url("/snapshot"),
      wsSessionTicketUrl: new URL("/universer-api/user/session-ticket", target.origin).href,
    });
    return await createUniverCollaborationRuntimeFactory({
      backend,
      createUniver,
      snapshotServerService,
    }).load(target.unitId, toUniverType(target.unitType));
  },
});

async function loadReferenceHostContext(
  http: WorkspaceHttp,
  target: WorkspaceRuntimeTarget,
): Promise<WorkspaceReferenceHostContext> {
  if (target.scope.kind === "trunk") return { mappedUnitIds: [], scope: target.scope };
  const body = await http.json(`/api/worktrees/${encodeURIComponent(target.scope.worktreeId)}`);
  const worktree = body["worktree"];
  if (
    typeof worktree !== "object" ||
    worktree === null ||
    Array.isArray(worktree) ||
    Reflect.get(worktree, "id") !== target.scope.worktreeId ||
    !Array.isArray(Reflect.get(worktree, "units"))
  ) {
    throw workspaceError("workspace-invalid-response", "Workspace Worktree response is invalid.");
  }
  const units = Reflect.get(worktree, "units") as unknown[];
  const mappedUnitIds = units.flatMap((unit) => {
    if (typeof unit !== "object" || unit === null || Array.isArray(unit)) return [];
    const unitId = Reflect.get(unit, "unitId");
    return typeof unitId === "string" && unitId !== "" ? [unitId] : [];
  });
  const host = units.find(
    (unit) =>
      typeof unit === "object" &&
      unit !== null &&
      !Array.isArray(unit) &&
      Reflect.get(unit, "unitId") === target.unitId,
  );
  if (typeof host !== "object" || host === null || Array.isArray(host)) {
    throw workspaceError(
      "workspace-unit-not-found",
      "Workspace runtime target Unit is not in the selected Worktree.",
    );
  }
  if (Reflect.get(host, "draftHeadRevision") !== target.revision) {
    throw workspaceError(
      "workspace-runtime-target-stale",
      "Workspace runtime target revision changed before the worker started.",
    );
  }
  return { mappedUnitIds, scope: target.scope };
}

function toUniverType(unitType: WorkspaceRuntimeTarget["unitType"]): UniverInstanceType {
  switch (unitType) {
    case "sheet":
      return UniverInstanceType.UNIVER_SHEET;
    case "doc":
      return UniverInstanceType.UNIVER_DOC;
    case "slide":
      return UniverInstanceType.UNIVER_SLIDE;
    case "base":
      return UniverInstanceType.UNIVER_BASE;
    case "board":
      return UniverInstanceType.UNIVER_BOARD;
  }
}
