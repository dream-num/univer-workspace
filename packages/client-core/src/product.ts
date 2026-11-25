/**
 * Light entry: the product workflows that only talk HTTP (sign-in, Spaces, forks, Issues, Worktrees and
 * their addressing). A Client Shell that needs just these imports `./product` and skips loading
 * the Univer runtime that the package root pulls in.
 */
export {
  completeCliLogin,
  createGuestAgent,
  loginWithPassword,
  logout,
  startCliLogin,
  sessionIdentity,
  whoami,
  type CliLoginCompletion,
  type PendingCliLogin,
  type WorkspaceAuthentication,
  type WorkspaceBudget,
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
  WorkspaceIssueAcceptance,
  WorkspaceIssueLabel,
  WorkspaceIssuePage,
  WorkspaceIssuePullRequest,
  WorkspaceIssueReference,
  WorkspaceIssueState,
  WorkspaceIssueStateReason,
  WorkspaceIssueSummary,
  WorkspaceIssueTimelineItem,
  WorkspaceIssueUser,
  WorkspaceIssueVerdictKind,
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
  isForkAddress,
  requireForkUpstream,
  resolveRepoOrFork,
  WorkspaceForkFeature,
  type WorkspaceFork,
  type WorkspaceForkState,
  type WorkspaceForkWorktree,
} from "./fork.js";
export {
  parseItemNumber,
  parseNodeReference,
  parseRepoReference,
  resolveItemTarget,
  resolveNodeReference,
  resolveRepoReference,
  resolveUnitReference,
  type ItemTarget,
  type ResolvedWorkspaceRepo,
  type WorkspaceRepoReference,
} from "./repo-ref.js";
export {
  assertSpaceFilter,
  createRepo,
  editRepo,
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
export {
  createClaimLink,
  formatShare,
  SHARE_LINKS,
  shareNode,
  type WorkspaceClaimLink,
  type WorkspaceShare,
  type WorkspaceShareLink,
} from "./share.js";
export {
  SPACE_LANDINGS,
  SPACE_PROPOSALS,
  TEAM_ROLES,
  type WorkspaceAccessRole,
  type WorkspaceBlobResource,
  type WorkspaceLinkSharing,
  type WorkspaceNode,
  type WorkspaceNodeSummary,
  type WorkspaceSpace,
  type WorkspaceSpaceCapabilities,
  type WorkspaceSpaceLanding,
  type WorkspaceSpaceProposals,
  type WorkspaceTeamMember,
  type WorkspaceTeamMembers,
  type WorkspaceTeamRole,
  type WorkspaceTrashBatch,
  type WorkspaceUnitType,
} from "./space-model.js";
export { WorkspaceBlobFeature } from "./blob.js";
export { WorkspaceUnitFeature, worktreeUnits } from "./unit.js";
export { issueUrl, nodeUrl, pullUrl, repoUrl } from "./urls.js";
export { usernameKey } from "./username.js";
export { WorkspaceWorktreeFeature, type WorkspaceRevertTarget } from "./worktree.js";
export type { WorkspaceCheck, WorkspaceCheckResult, WorkspaceChecksSummary, WorkspaceRevertItem, WorkspaceRevertPlan, WorkspaceRevertResult, WorkspaceUnit, WorkspaceWorktree, WorkspaceWorktreeState } from "./worktree-model.js";

export { WorkspaceAssetFeature } from "./asset.js";

export { readWorkspaceHtmlView, type WorkspaceHtmlViewPage } from "./html-view-page.js";

export { findWorkspaceHtmlViewDraft, readWorkspaceHtmlViewDraftContent, readWorkspaceHtmlViewDraft, htmlViewDraftUrl, type WorkspaceHtmlViewDraft, type WorkspaceHtmlViewDraftStatus } from "./html-view-draft.js";

export { WorkspaceSkillDraftFeature, type WorkspaceSkillDraftInput, type WorkspaceSkillReviewFinding } from "./skill-draft.js";

export { WorkspaceSkillSourceFeature, type WorkspaceResolvedSkillSource, type WorkspaceSkillSourceReadInput } from "./skill-source.js";
