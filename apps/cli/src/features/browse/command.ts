import { Command } from "commander";
import {
  parseRepoReference,
  workspaceError,
  type WorkspaceIssueFeature,
  type WorkspaceWorktreeFeature,
} from "@univerjs/univer-workspace-client-core/product";
import { emit, executeCommand, jsonFieldsOption, type JsonFieldsOption } from "../../command.js";
import { REPO_OPTION, type RepoContext } from "../../repo-context.js";
import { issueUrl, pullUrl, repoUrl } from "../../urls.js";

/** Prints a Browser URL; it never opens a browser. */
export function createBrowseCommand(deps: {
  readonly context: RepoContext;
  readonly issues: WorkspaceIssueFeature;
  readonly origin: () => Promise<string>;
  readonly worktrees: WorkspaceWorktreeFeature;
}): Command {
  const { context, issues, origin, worktrees } = deps;
  const command = new Command("browse")
    .description("Print the Browser URL of a repository, Issue or pull request (it does not open a browser)")
    .argument("[number]", "Issue or pull request number, or a Worktree ID")
    .option(...REPO_OPTION)
    .option("--unit <id>", "open this file inside the pull request")
    .addOption(jsonFieldsOption(["url"]))
    .action(async (argument: string | undefined, options: JsonFieldsOption & { repo?: string; unit?: string }) => {
      const result = await executeCommand(command, async () => {
        const base = await origin();
        if (argument === undefined) {
          if (options.unit !== undefined) {
            throw workspaceError("workspace-argument-invalid", "--unit needs a pull request number.");
          }
          return { url: repoUrl(base, (await context.repo(options.repo)).spaceId) };
        }
        const reference = /^https?:\/\//i.test(argument.trim()) ? parseRepoReference(argument) : undefined;
        const urlKind = reference?.kind === "url" ? reference.item?.kind : undefined;
        const target = await context.item(argument, options.repo, urlKind ?? "pr");
        if (target.kind === "id") {
          const worktree = await worktrees.get(target.id);
          return { url: pullUrl(base, worktree, options.unit, await context.pullSpaceId(worktree)) };
        }
        // Issues and pull requests of a Team Space share one number sequence, so at most one exists.
        if (urlKind !== "issue") {
          try {
            const worktree = await worktrees.getByNumber(target.spaceId, target.number);
            return { url: pullUrl(base, worktree, options.unit, target.spaceId) };
          } catch (error) {
            if (urlKind === "pr" || !isNotFound(error)) throw error;
          }
        }
        try {
          await issues.get(target.spaceId, target.number);
        } catch (error) {
          if (isNotFound(error) || isConflict(error)) {
            throw workspaceError(
              "workspace-not-found",
              `No Issue or pull request #${String(target.number)} in this repository.`,
            );
          }
          throw error;
        }
        return { url: issueUrl(base, target.spaceId, target.number) };
      });
      emit(command, options, result, result.url);
    });
  return command;
}

function isNotFound(error: unknown): boolean {
  return statusOf(error) === 404;
}

function isConflict(error: unknown): boolean {
  return statusOf(error) === 409;
}

function statusOf(error: unknown): number | undefined {
  const detail = (error as { detail?: { status?: unknown } })?.detail;
  return typeof detail?.status === "number" ? detail.status : undefined;
}
