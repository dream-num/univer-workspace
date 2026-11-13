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
  LABEL_COLORS,
  listIssues,
  issueApiUsername,
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
  browseUrl,
  findPullRequest,
  listPullRequests,
  pullRequestSpace,
  pullRequestView,
  pullSpaceId,
  PULL_REQUEST_STATES,
  type PullRequestState,
} from "./pull-request.js";
export {
  parseItemNumber,
  parseRepoReference,
  resolveItemTarget,
  resolveRepoReference,
  type ItemTarget,
  type ResolvedWorkspaceRepo,
  type WorkspaceRepoReference,
} from "./repo-ref.js";
export {
  assertSpaceFilter,
  createRepo,
  nodeMoveParent,
  repoEditPatch,
  REPO_DESCRIPTION_MAX,
  REPO_EDIT_FIELDS,
  selectRepos,
  WorkspaceSpaceFeature,
  type BrowseSpaceInput,
  type ParameterName,
  type RepoEditField,
  type WorkspaceResourceKindFilter,
} from "./space.js";
export type {
  WorkspaceAccessRole,
  WorkspaceBlobResource,
  WorkspaceNode,
  WorkspaceNodeSummary,
  WorkspaceSpace,
  WorkspaceTrashBatch,
  WorkspaceUnitType,
} from "./space-model.js";
export { WorkspaceBlobFeature } from "./blob.js";
export { WorkspaceUnitFeature, worktreeUnits } from "./unit.js";
export { issueUrl, nodeUrl, pullUrl, repoUrl } from "./urls.js";
export { usernameKey } from "./username.js";
export { WorkspaceWorktreeFeature } from "./worktree.js";
export type { WorkspaceUnit, WorkspaceWorktree, WorkspaceWorktreeState } from "./worktree-model.js";

export { WorkspaceAssetFeature } from "./asset.js";

export { readWorkspaceHtmlView, type WorkspaceHtmlViewPage } from "./html-view-page.js";

export { readWorkspaceHtmlViewDraft, htmlViewDraftUrl, type WorkspaceHtmlViewDraft, type WorkspaceHtmlViewDraftStatus } from "./html-view-draft.js";

export { WorkspaceSkillDraftFeature, type WorkspaceSkillDraftInput, type WorkspaceSkillReviewFinding } from "./skill-draft.js";
