import {
  parseItemNumber,
  parseRepoReference,
  resolveRepoReference,
  workspaceError,
  type ResolvedWorkspaceRepo,
  type WorkspaceSpaceFeature,
  type WorkspaceWorktree,
} from "@univerjs/univer-workspace-client-core/product";

/** `-R, --repo <ref>` (shared by every repository-scoped command). */
export const REPO_OPTION = [
  "-R, --repo <ref>",
  "repository: owner/slug, owner/personal, a Space ID or a Workspace URL (default: $UVW_REPO)",
] as const;

/** What an issue or pull request argument named. */
export type ItemTarget =
  | { readonly kind: "number"; readonly number: number; readonly spaceId: string }
  | { readonly kind: "id"; readonly id: string };

/**
 * Resolves the repository context shared by the repository-scoped commands: `-R` first, then
 * `UVW_REPO`. There is deliberately no stored default, so concurrent agents cannot disturb each other.
 */
export class RepoContext {
  public constructor(
    private readonly spaces: Pick<WorkspaceSpaceFeature, "lookup">,
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
    const text = argument.trim();
    if (/^https?:\/\//i.test(text)) {
      await this.assertSameOrigin(text);
      const parsed = parseRepoReference(text);
      if (parsed.kind === "worktree-url" && kind === "pr") return { kind: "id", id: parsed.worktreeId };
      if (parsed.kind === "url" && parsed.item?.kind === kind) {
        return { kind: "number", number: parsed.item.number, spaceId: parsed.spaceId };
      }
      throw workspaceError(
        "workspace-argument-invalid",
        `"${text}" does not point at ${kind === "pr" ? "a pull request" : "an issue"}.`,
      );
    }
    const number = parseItemNumber(text);
    if (number !== undefined) return { kind: "number", number, spaceId: (await this.repo(repoOption)).spaceId };
    if (kind === "pr") return { kind: "id", id: text };
    throw workspaceError(
      "workspace-argument-invalid",
      `Issue number must look like 12 or #12, got "${argument}".`,
    );
  }

  /** A User Worktree's Browser repository is its creator's Personal Space, not a Unit target. */
  public async pullSpaceId(worktree: WorkspaceWorktree, resolvedSpaceId?: string): Promise<string | undefined> {
    if (worktree.number == null) return undefined;
    if (worktree.spaceId !== undefined) return worktree.spaceId;
    if (resolvedSpaceId !== undefined) return resolvedSpaceId;
    if (worktree.kind !== "user" || worktree.creator === undefined) return undefined;
    const space = await this.spaces.lookup(worktree.creator.username, "personal");
    if (space.type !== "personal" || space.owner?.id !== worktree.creator.id) {
      throw workspaceError("workspace-result-mismatch", "The Personal Space does not belong to the pull request's creator.");
    }
    return space.id;
  }

  private async assertSameOrigin(url: string): Promise<void> {
    if (new URL(url).origin !== new URL(await this.origin()).origin) {
      throw workspaceError(
        "workspace-origin-mismatch",
        "The URL belongs to a different Workspace than the configured origin.",
      );
    }
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}
