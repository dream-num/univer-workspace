import {
  createCollaborationServerAdapter,
  createUniverCollaborationRuntimeFactory,
  type UniverFactoryContext,
} from "@univer-cli/univer-collaboration-runtime";
import { defineUniverCollaborationRuntimeWorker } from "@univer-cli/univer-collaboration-runtime-pool";
import { createStandardHeadlessUniverFactory } from "@univer-cli/headless-univer";
import { UniverInstanceType } from "@univerjs/core";
import { workspaceError } from "./errors.js";
import { WorkspaceHttp } from "./http.js";
import { loadWorkspaceReferenceHostContext } from "./reference-host.js";
import { createWorkspaceReferencedUnitProviderRegistration } from "./referenced-unit-provider.js";
import { parseWorkspaceRuntimeTarget, type WorkspaceRuntimeTarget } from "./runtime-target.js";
import { WorkspaceSnapshotServerAdapter } from "./snapshot-server-adapter.js";

export interface WorkspaceContentWorkerInit {
  readonly credential: string;
  readonly license: string;
  readonly target: unknown;
}

export const workspaceContentRuntimeWorker = defineUniverCollaborationRuntimeWorker<unknown>({
  async createRuntime(value) {
    const init = parseWorkerInit(value);
    const target = parseWorkspaceRuntimeTarget(init.target);
    const http = new WorkspaceHttp({
      cookie: init.credential,
      origin: target.origin,
      role: "worker",
    });
    const hostContext = await loadWorkspaceReferenceHostContext(http, target);
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
        license: init.license,
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

export default workspaceContentRuntimeWorker;

function parseWorkerInit(value: unknown): WorkspaceContentWorkerInit {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !["credential", "license", "target"].includes(key)) ||
    typeof value["credential"] !== "string" ||
    value["credential"].length === 0 ||
    typeof value["license"] !== "string" ||
    value["license"].trim().length === 0 ||
    value["target"] === undefined
  ) {
    throw workspaceError(
      "WORKSPACE_RUNTIME_INIT_INVALID",
      "Workspace content worker initialization is invalid",
    );
  }
  return {
    credential: value["credential"],
    license: value["license"],
    target: value["target"],
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
