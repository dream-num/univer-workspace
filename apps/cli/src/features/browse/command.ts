import { Command } from "commander";
import {
  browseUrl,
  type WorkspaceIssueFeature,
  type WorkspaceWorktreeFeature,
} from "@univerjs/univer-workspace-client-core/product";
import { emit, executeCommand, jsonFieldsOption, type JsonFieldsOption } from "../../command.js";
import { REPO_OPTION, type RepoContext } from "../../repo-context.js";

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
      const result = await executeCommand(command, async () =>
        await browseUrl(
          {
            issues,
            origin,
            pullSpaceId: (worktree) => context.pullSpaceId(worktree),
            repo: () => context.repo(options.repo),
            worktrees,
          },
          {
            ...(argument === undefined ? {} : { argument }),
            ...(options.unit === undefined ? {} : { unit: options.unit }),
          },
        ));
      emit(command, options, result, result.url);
    });
  return command;
}
