import type {
  CollaborationRuntimeReadResult,
  CollaborationUnitData,
} from "@univer-cli/univer-collaboration-runtime";
import type { DaemonClient } from "@univer-cli/daemon";
import {
  serializeWorkspaceRuntimeTarget,
  type WorkspaceContentRuntimeOperations,
  type WorkspaceContentRuntimeWriteResult,
} from "@univerjs/univer-workspace-client-core";

export function createWorkspaceDaemonRuntimeOperations(
  daemon: Pick<DaemonClient, "request">,
): WorkspaceContentRuntimeOperations {
  return {
    async executeAndCommit(input) {
      return (await daemon.request("runtime.execute-and-commit", {
        code: input.code,
        target: serializeWorkspaceRuntimeTarget(input.target),
      })) as unknown as WorkspaceContentRuntimeWriteResult;
    },
    async executeRead(input) {
      return (await daemon.request("runtime.execute-read", {
        code: input.code,
        target: serializeWorkspaceRuntimeTarget(input.target),
      })) as unknown as CollaborationRuntimeReadResult;
    },
    async exportUnitData(input) {
      return (await daemon.request("runtime.export-unit-data", {
        target: serializeWorkspaceRuntimeTarget(input.target),
      })) as unknown as CollaborationUnitData;
    },
  };
}
