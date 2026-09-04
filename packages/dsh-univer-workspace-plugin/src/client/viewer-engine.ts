/**
 * Public façade for the embedded document viewer.
 *
 * The implementation is intentionally split under `viewer/`: transport URL
 * construction, static locale packs, collaboration preset wiring, read-only
 * policy, and Univer runtime assembly each have an explicit seam. Consumers
 * keep importing this module so the decomposition does not change the client
 * contract.
 *
 * @module dsh-univer-workspace-plugin/client/viewer-engine
 */

import { createViewerRuntime } from "./viewer/runtime.ts";
import type { ViewerHandle, ViewerOptions } from "./viewer/contracts.ts";

export type {
  ViewerHandle,
  ViewerOptions,
  ViewerScope,
  ViewerUnitType,
} from "./viewer/contracts.ts";
export {
  isViewerUnitTypeSupported,
  SUPPORTED_VIEWER_UNIT_TYPES,
} from "./viewer-types.ts";
export {
  blockLocalEditingCommands,
  enforceSheetViewerReadOnlyPermissions,
  resolveViewerReadOnlyEnforcement,
  withReadOnlyPermissionLocale,
} from "./viewer/readonly.ts";
export type { ReadOnlyLocaleCopy, ViewerReadOnlyEnforcement } from "./viewer/readonly.ts";

/** Mount one trunk/worktree unit through the harness collaboration proxy. */
export async function createViewer(opts: ViewerOptions): Promise<ViewerHandle> {
  return createViewerRuntime(opts);
}
