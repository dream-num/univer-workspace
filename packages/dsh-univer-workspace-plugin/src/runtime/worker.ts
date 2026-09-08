/**
 * The headless collaboration worker: runs in a forked process owned by the
 * runtime pool and materializes one Univer runtime for a target Unit.
 *
 * The target carries the resolved workspace session token (unlike apps/cli,
 * which reads it from a session file), so the worker builds an authenticated
 * HTTP transport from the token alone and never touches the dsh host's
 * credential store.
 * @module dsh-univer-workspace-plugin/runtime/worker
 */

import {
  createCollaborationServerAdapter,
  createUniverCollaborationRuntimeFactory,
  type UniverFactoryContext,
} from "@univer-cli/univer-collaboration-runtime";
import { defineUniverCollaborationRuntimeWorker } from "@univer-cli/univer-collaboration-runtime-pool";
import { createStandardHeadlessUniverFactory } from "@univer-cli/headless-univer";
import { toUniverType, type WorkspaceRuntimeTarget } from "./target.js";
import { WorkerHttp } from "./worker-http.js";
import { WorkspaceSnapshotServerAdapter } from "./snapshot-adapter.js";

export default defineUniverCollaborationRuntimeWorker<WorkspaceRuntimeTarget>({
  async createRuntime(init) {
    const target = init;
    const http = new WorkerHttp(target);
    const snapshotServerService = new WorkspaceSnapshotServerAdapter({
      hostScope: target.scope,
      http,
    });

    const createUniver = async (context: UniverFactoryContext) => {
      if (context.resolveSnapshotService === undefined) {
        throw new Error("workspace reference loading requires a SnapshotService resolver");
      }
      return await createStandardHeadlessUniverFactory({
        license: target.license,
      })({ unitId: context.unitId, unitType: context.unitType });
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
