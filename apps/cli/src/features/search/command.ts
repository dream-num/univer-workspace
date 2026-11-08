import { Command } from "commander";
import {
  listIssues,
  listPullRequests,
  issueApiUsername,
  PULL_REQUEST_STATES,
  type WorkspaceIssueFeature,
  type WorkspaceWorktreeFeature,
} from "@univerjs/univer-workspace-client-core/product";
import { collect, emit, executeCommand, jsonFieldsOption, limitOf, oneOf, table, type JsonFieldsOption } from "../../command.js";
import { ISSUE_LIST_JSON_FIELDS, issueRows } from "../issue/command.js";
import { PR_JSON_FIELDS } from "../pr/command.js";

export function createSearchCommand(
  issues: WorkspaceIssueFeature,
  worktrees: WorkspaceWorktreeFeature,
  userId: () => Promise<string>,
): Command {
  const root = new Command("search").description("Search across every repository you can access");

  const searchIssues = new Command("issues")
    .description("Find Issues across repositories")
    .option("-s, --state <state>", "open, closed or all", "open")
    .option("-l, --label <name>", "require a label; repeat for several", collect)
    .option("-a, --assignee <user>", "username, @me, or none")
    .option("-A, --author <user>", "username or @me")
    .option("-S, --search <text>", "match title and body")
    .option("-L, --limit <n>", "maximum number of Issues", "30")
    .addOption(jsonFieldsOption(ISSUE_LIST_JSON_FIELDS))
    .action(
      async (
        options: JsonFieldsOption & {
          readonly assignee?: string;
          readonly author?: string;
          readonly label?: readonly string[];
          readonly limit: string;
          readonly search?: string;
          readonly state: string;
        },
      ) => {
        const found = await executeCommand(searchIssues, async () =>
          await listIssues(
            issues,
            {
              state: oneOf(options.state, ["open", "closed", "all"], "--state"),
              ...(options.label === undefined ? {} : { labels: options.label }),
              ...(options.assignee === undefined ? {} : { assignee: issueApiUsername(options.assignee) }),
              ...(options.author === undefined ? {} : { author: issueApiUsername(options.author) }),
              ...(options.search === undefined ? {} : { search: options.search }),
            },
            limitOf(options.limit),
          ));
        emit(searchIssues, options, found, issueRows(found, true));
      },
    );

  const searchPrs = new Command("prs")
    .description("Find pull requests across repositories")
    .option("-s, --state <state>", "open, merged, discarded or all", "open")
    .option("-A, --author <user>", "username or @me")
    .option("-S, --search <text>", "match title, body, author or repository")
    .option("-L, --limit <n>", "maximum number of pull requests", "30")
    .addOption(jsonFieldsOption(PR_JSON_FIELDS))
    .action(
      async (options: JsonFieldsOption & { author?: string; limit: string; search?: string; state: string }) => {
        const found = await executeCommand(searchPrs, async () => {
          return await listPullRequests(
            { userId, worktrees },
            {
              state: oneOf(options.state, PULL_REQUEST_STATES, "--state"),
              limit: limitOf(options.limit),
              ...(options.search === undefined ? {} : { search: options.search }),
              ...(options.author === undefined ? {} : { author: options.author }),
            },
          );
        });
        emit(
          searchPrs,
          options,
          found,
          table(
            found.map((worktree) => [
              worktree.number == null ? worktree.id.slice(0, 8) : `#${String(worktree.number)}`,
              worktree.state,
              worktree.name,
              worktree.creator?.username ?? "",
              worktree.updatedAt ?? "",
            ]),
          ),
        );
      },
    );

  return root.addCommand(searchIssues).addCommand(searchPrs);
}
