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

/** The 90-day runtime development license, overridable via UNIVER_LICENSE. */
const UNIVER_LICENSE =
  "2088168239728517120-1-eyJpIjoiMjA4ODE2ODIzOTcyODUxNzEyMCIsInYiOiIxIiwicCI6ImtPN3hWUG5mZVFYSlY2ZjRiSk03MFk5NHdOZTZkR3VRTDNxdklqRFpZblU9IiwiZG0iOlsibG9jYWxob3N0Il0sInJ0IjozLCJmdCI6eyJ1ZiI6eyJtdSI6MjE0NzQ4MzY0NiwiZXQiOjE3OTQ3NTg0MDAsIm1tIjoyMTQ3NDgzNjQ2LCJjdSI6MjE0NzQ4MzY0Nn0sInNmIjp7ImV0IjoxNzk0NzU4NDAwLCJydiI6dHJ1ZSwicHRuIjoyMTQ3NDgzNjQ2LCJtaXMiOjIxNDc0ODM2NDYsIm1wbiI6MjE0NzQ4MzY0NiwibmMiOjIxNDc0ODM2NDYsImllYyI6MCwiZmNjIjowfSwiZGYiOnsiZXQiOjE3OTQ3NTg0MDAsInJ2Ijp0cnVlLCJtaXMiOjIxNDc0ODM2NDYsIm1wbiI6MjE0NzQ4MzY0NiwiaWVjIjowfSwid3NmIjp7ImV0IjoxNzk0NzU4NDAwLCJobiI6MjE0NzQ4MzY0Nn19LCJ1ZCI6MTc5NDc1ODQwMCwiYXQiOjE3ODY2OTMxMTAsImUiOiJkZXZlbG9wZXJAdW5pdmVyLmFpIiwiZCI6OCwibiI6MTl9-ZidzNthAEZRZ13xLQUagdaUsjaMjrr5BDf4JGx9Zzsw1PgmNLak8wuZWQ1le9eMYUyubIa5YI4JpExgdHhN1BA==-1794758400";

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
        license: process.env.UNIVER_LICENSE?.trim() || UNIVER_LICENSE,
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
