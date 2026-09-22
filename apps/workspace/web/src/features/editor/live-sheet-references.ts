import type { IEmbedResourceRefUnitProviderRegistration } from "@univerjs-pro/embed";
import { UniverInstanceType } from "@univerjs/core";
import {
  createWorkspaceReferenceScopePolicy,
  type WorkspaceReferenceHostContext,
} from "@univerjs/univer-workspace-reference-provider";

/** Observe working Sheet sources through the host's existing SDK transport.
 * Merge previews stay frozen. A trunk source in a Worktree host must not join
 * the host's Worktree room: that would change the source scope chosen by policy.
 */
export function withLiveSheetReferences(
  registration: IEmbedResourceRefUnitProviderRegistration,
  hostContext: WorkspaceReferenceHostContext,
  connect: (unitId: string) => Promise<void>,
): IEmbedResourceRefUnitProviderRegistration {
  const policy = createWorkspaceReferenceScopePolicy(hostContext);
  const connections = new Map<string, Promise<void>>();
  return {
    ...registration,
    provider: {
      async ensureUnit(input) {
        const result = await registration.provider.ensureUnit(input);
        input.signal?.throwIfAborted();
        const scope = policy.select(result.unitId);
        if (
          result.unitType !== UniverInstanceType.UNIVER_SHEET ||
          scope.kind === "mergePreview" ||
          scope.kind !== hostContext.view.kind
        ) return result;
        let connection = connections.get(result.unitId);
        if (!connection) {
          connection = connect(result.unitId).catch((error: unknown) => {
            connections.delete(result.unitId);
            throw error;
          });
          connections.set(result.unitId, connection);
        }
        await connection;
        input.signal?.throwIfAborted();
        return result;
      },
    },
  };
}
