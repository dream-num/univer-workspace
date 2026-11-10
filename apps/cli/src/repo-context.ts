import {
  pullSpaceId,
  resolveItemTarget,
  resolveRepoReference,
  workspaceError,
  type ItemTarget,
  type ResolvedWorkspaceRepo,
  type WorkspaceSpaceFeature,
  type WorkspaceWorktree,
} from "@univerjs/univer-workspace-client-core/product";

/** `-R, --repo <ref>` (shared by every repository-scoped command). */
export const REPO_OPTION = [
  "-R, --repo <ref>",
  "repository: owner/slug, owner/personal, a unique bare slug from repo list, a Space ID or a Workspace URL (default: $UVW_REPO)",
] as const;

/**
 * Resolves the repository context shared by the repository-scoped commands: `-R` first, then
 * `UVW_REPO`. There is deliberately no stored default, so concurrent agents cannot disturb each other.
 */
export class RepoContext {
  public constructor(
    private readonly spaces: Pick<WorkspaceSpaceFeature, "lookup" | "get" | "list">,
    private readonly origin: () => Promise<string>,
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  public async repo(option: string | undefined): Promise<ResolvedWorkspaceRepo> {
    const text = option ?? nonEmpty(this.env["UVW_REPO"]);
    if (text === undefined) {
      throw workspaceError(
        "workspace-argument-invalid",
        "A repository is required: pass -R owner/slug or set UVW_REPO.",
      );
    }
    return await resolveRepoReference(this.spaces, text, await this.origin());
  }

  /**
   * An issue or pull request argument: `12`, `#12`, a Browser URL, or (pull requests only) a
   * Worktree ID. A number needs a repository; a URL carries its own.
   */
  public async item(
    argument: string,
    repoOption: string | undefined,
    kind: "issue" | "pr",
  ): Promise<ItemTarget> {
    return await resolveItemTarget(argument, kind, this.origin, () => this.repo(repoOption));
  }

  public async pullSpaceId(worktree: WorkspaceWorktree, resolvedSpaceId?: string): Promise<string | undefined> {
    return await pullSpaceId(this.spaces, worktree, resolvedSpaceId);
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}
