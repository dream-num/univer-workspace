/**
 * Compatibility barrel for the Workspace provider HTTP API.
 *
 * New code should import the responsibility-specific modules; this file keeps the historical
 * workspace-api.ts exports stable for existing consumers.
 * @module dsh-univer-workspace-plugin/provider/workspace-api
 */

export { WorkspaceApiError } from "./api-errors.ts";

export {
  listSpaces,
  listSpaceDocuments,
  narrowSpaces,
  narrowNodePage,
  narrowNodes,
  NODE_LIST_MAX_PAGES,
  NODE_LIST_MAX_NODES,
} from "./spaces-api.ts";
export type { RemoteSpace, WorkspaceNodePage } from "./spaces-api.ts";

export {
  narrowOpen,
  narrowUnitResource,
  openResource,
  resolveUnitResource,
  newIdempotencyKey,
  createDocument,
} from "./resources-api.ts";
export type { CreatedDocument } from "./resources-api.ts";

export {
  narrowWorktreeSummary,
  createWorktree,
  getWorktreeDetail,
  worktreeSummaryFromDetail,
  addWorktreeTrunkUnit,
  createWorktreeLocalUnit,
  narrowWorktreeUnit,
  openWorktreeUnit,
  markWorktreeReady,
  discardWorktree,
  mergeWorktree,
  reopenWorktree,
  narrowWorktreeDetail,
  listActiveWorktrees,
  listReviewWorktrees,
} from "./worktree-api.ts";
export type {
  WorktreeCapabilities,
  WorktreeCreator,
  WorktreeTeamSpace,
  WorktreeSummary,
  CreateWorktreeLocalUnitInput,
  WorktreeUnitDescriptor,
  OpenedWorktreeUnit,
  WorktreeUnitView,
  WorktreeStateView,
} from "./worktree-api.ts";

export { getWorktreeFileState, getFileState } from "./file-state-api.ts";
export type { DocumentFileState } from "./file-state-api.ts";
