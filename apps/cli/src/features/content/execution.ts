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
import { workspaceError } from "../../errors.js";

export function createWorkspaceDaemonRuntimeOperations(
  daemon: Pick<DaemonClient, "request">,
): WorkspaceContentRuntimeOperations {
  return {
    async executeAndCommit(input) {
      return (await request(daemon, "runtime.execute-and-commit", {
        code: input.code,
        target: serializeWorkspaceRuntimeTarget(input.target),
      })) as unknown as WorkspaceContentRuntimeWriteResult;
    },
    async executeRead(input) {
      return (await request(daemon, "runtime.execute-read", {
        code: input.code,
        target: serializeWorkspaceRuntimeTarget(input.target),
      })) as unknown as CollaborationRuntimeReadResult;
    },
    async exportUnitData(input) {
      return (await request(daemon, "runtime.export-unit-data", {
        target: serializeWorkspaceRuntimeTarget(input.target),
      })) as unknown as CollaborationUnitData;
    },
  };
}

/**
 * The daemon drops the code of a failed Facade program, so without one here an expected failure
 * such as a stale source map escapes as an uncaught exception that prints the bundled SDK source.
 */
async function request(
  daemon: Pick<DaemonClient, "request">,
  method: string,
  payload: Parameters<DaemonClient["request"]>[1],
): ReturnType<DaemonClient["request"]> {
  try {
    return await daemon.request(method, payload);
  } catch (error) {
    if (!isUncodedProgramError(error)) throw error;
    const coded = /^([A-Z][A-Z0-9_]+): (.+)$/su.exec(error.message);
    throw workspaceError(
      coded?.[1] ?? "workspace-runtime-program-failed",
      coded?.[2] ?? error.message,
    );
  }
}

function isUncodedProgramError(error: unknown): error is Error {
  return error instanceof Error && error.name === "Error" && !("code" in error);
}
