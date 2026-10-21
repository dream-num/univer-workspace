import { Command } from "commander";
import {
  workspaceError,
  type WorkspaceIssueFeature,
  type WorkspaceWorktreeFeature,
} from "@univerjs/univer-workspace-client-core/product";
import { emit, executeCommand, type JsonFieldsOption } from "../../command.js";
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
    .option("--json [fields]", "write JSON, optionally only these comma-separated fields")
    .action(async (argument: string | undefined, options: JsonFieldsOption & { repo?: string; unit?: string }) => {
      const result = await executeCommand(command, async () => {
        const base = await origin();
        if (argument === undefined) {
          if (options.unit !== undefined) {
            throw workspaceError("workspace-argument-invalid", "--unit needs a pull request number.");
          }
          return { url: repoUrl(base, (await context.repo(options.repo)).spaceId) };
        }
        const target = await context.item(argument, options.repo, "pr");
        if (target.kind === "id") {
          return { url: pullUrl(base, await worktrees.get(target.id), options.unit) };
        }
        // Issues and pull requests of a Team Space share one number sequence, so at most one exists.
        const text = argument.trim();
        const isIssueUrl = /^https?:\/\//i.test(text) && /\/issues\/\d+/.test(new URL(text).pathname);
        if (!isIssueUrl) {
          try {
            return { url: pullUrl(base, await worktrees.getByNumber(target.spaceId, target.number), options.unit) };
          } catch (error) {
            if (!isNotFound(error)) throw error;
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
