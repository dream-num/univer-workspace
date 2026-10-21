import { Command } from "commander";
import type {
  WorkspaceIssueFeature,
  WorkspaceWorktreeFeature,
} from "@univerjs/univer-workspace-client-core/product";
import { collect, emit, executeCommand, limitOf, oneOf, table, type JsonFieldsOption } from "../../command.js";
import { issueRows, listIssues, userSpelling } from "../issue/command.js";

const JSON_OPTION = ["--json [fields]", "write JSON, optionally only these comma-separated fields"] as const;
const STATES = ["open", "merged", "discarded", "all"] as const;

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
    .option(...JSON_OPTION)
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
              ...(options.assignee === undefined ? {} : { assignee: userSpelling(options.assignee) }),
              ...(options.author === undefined ? {} : { author: userSpelling(options.author) }),
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
    .option(...JSON_OPTION)
    .action(
      async (options: JsonFieldsOption & { author?: string; limit: string; search?: string; state: string }) => {
        const found = await executeCommand(searchPrs, async () => {
          const state = oneOf(options.state, STATES, "--state");
          return await worktrees.list({
            view: state === "open" ? "active" : state === "all" ? "all" : "processed",
            ...(state === "merged" || state === "discarded" ? { states: [state] } : {}),
            limit: limitOf(options.limit),
            ...(options.search === undefined ? {} : { search: options.search }),
            ...(options.author === undefined
              ? {}
              : options.author === "@me"
                ? { creatorId: await userId() }
                : { creatorUsername: options.author }),
          });
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
