/**
 * Light entry: the product workflows that only talk HTTP (sign-in, Spaces, Issues, Worktrees and
 * their addressing). A Client Shell that needs just these imports `./product` and skips loading
 * the Univer runtime that the package root pulls in.
 */
export {
  completeCliLogin,
  loginWithPassword,
  logout,
  startCliLogin,
  whoami,
  type CliLoginCompletion,
  type PendingCliLogin,
  type WorkspaceAuthentication,
  type WorkspaceSubject,
} from "./auth.js";
export {
  executeWithStableIdentity,
  isWorkspaceResultUnknown,
  WorkspaceApplicationError,
  WorkspaceResultUnknownError,
  workspaceError,
  type StableIdentityOptions,
} from "./errors.js";
export {
  isWorkspaceRecord,
  WorkspaceHttp,
  type AuthenticatedWorkspaceHttp,
  type WorkspaceHttpOptions,
  type WorkspaceRequestOptions,
} from "./http.js";
export {
  WorkspaceIssueFeature,
  type ListIssuesInput,
  type UpdateIssueInput,
  type WorkspaceIssueLabelUsage,
} from "./issue.js";
export type {
  WorkspaceIssue,
  WorkspaceIssueLabel,
  WorkspaceIssuePage,
  WorkspaceIssueReference,
  WorkspaceIssueState,
  WorkspaceIssueStateReason,
  WorkspaceIssueSummary,
  WorkspaceIssueTimelineItem,
  WorkspaceIssueUser,
} from "./issue-model.js";
export {
  parseItemNumber,
  parseRepoReference,
  resolveRepoReference,
  type ResolvedWorkspaceRepo,
  type WorkspaceRepoReference,
} from "./repo-ref.js";
export {
  WorkspaceSpaceFeature,
  type BrowseSpaceInput,
  type WorkspaceResourceKindFilter,
} from "./space.js";
export type {
  WorkspaceAccessRole,
  WorkspaceNode,
  WorkspaceNodeSummary,
  WorkspaceSpace,
  WorkspaceUnitType,
} from "./space-model.js";
export { usernameKey } from "./username.js";
export { WorkspaceWorktreeFeature } from "./worktree.js";
export type { WorkspaceUnit, WorkspaceWorktree, WorkspaceWorktreeState } from "./worktree-model.js";
