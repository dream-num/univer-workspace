import { Command } from "commander";
import {
  workspaceError,
  type WorkspaceIssue,
  type WorkspaceIssueFeature,
  type WorkspaceIssueSummary,
} from "@univerjs/univer-workspace-client-core/product";
import {
  collect,
  emit,
  executeCommand,
  limitOf,
  oneOf,
  readText,
  table,
  type JsonFieldsOption,
} from "../../command.js";
import { REPO_OPTION, type RepoContext } from "../../repo-context.js";
import { issueUrl } from "../../urls.js";

const JSON_OPTION = ["--json [fields]", "write JSON, optionally only these comma-separated fields"] as const;

interface RepoOption {
  readonly repo?: string;
}

interface TextOptions {
  readonly body?: string;
  readonly bodyFile?: string;
}

export interface IssueCommandDependencies {
  readonly context: RepoContext;
  readonly feature: WorkspaceIssueFeature;
  readonly origin: () => Promise<string>;
}

/** `@me` is gh's spelling; the Issue API says `me`. */
export function userSpelling(value: string): string {
  return value === "@me" ? "me" : value;
}

/** Follows cursors until `limit` Issues are collected or the list ends. */
export async function listIssues(
  feature: WorkspaceIssueFeature,
  input: Parameters<WorkspaceIssueFeature["list"]>[0],
  limit: number,
): Promise<readonly WorkspaceIssueSummary[]> {
  const issues: WorkspaceIssueSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await feature.list({
      ...input,
      limit: Math.min(limit - issues.length, 100),
      ...(cursor === undefined ? {} : { cursor }),
    });
    issues.push(...page.issues);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined && issues.length < limit);
  return issues;
}

export function issueRows(issues: readonly WorkspaceIssueSummary[], showRepo = false): string {
  return table(
    issues.map((issue) => [
      showRepo ? `${issue.space.name}#${String(issue.number)}` : `#${String(issue.number)}`,
      issue.state,
      issue.title,
      issue.labels.map((label) => label.name).join(", "),
      issue.updatedAt,
    ]),
  );
}

export function createIssueCommand({ context, feature, origin }: IssueCommandDependencies): Command {
  const root = new Command("issue").description(
    "Work with Issues of a repository. Issues share their #N numbers with pull requests.",
  );

  const list = new Command("list")
    .description("List Issues in a repository")
    .option(...REPO_OPTION)
    .option("-s, --state <state>", "open, closed or all", "open")
    .option("-l, --label <name>", "require a label; repeat for several", collect)
    .option("-a, --assignee <user>", "username, @me, or none")
    .option("-A, --author <user>", "username or @me")
    .option("-S, --search <text>", "match title and body")
    .option("-L, --limit <n>", "maximum number of Issues", "30")
    .option(...JSON_OPTION)
    .action(
      async (
        options: JsonFieldsOption &
          RepoOption & {
            readonly assignee?: string;
            readonly author?: string;
            readonly label?: readonly string[];
            readonly limit: string;
            readonly search?: string;
            readonly state: string;
          },
      ) => {
        const issues = await executeCommand(list, async () => {
          const { spaceId } = await context.repo(options.repo);
          return await listIssues(
            feature,
            {
              spaceId,
              state: oneOf(options.state, ["open", "closed", "all"], "--state"),
              ...(options.label === undefined ? {} : { labels: options.label }),
              ...(options.assignee === undefined ? {} : { assignee: userSpelling(options.assignee) }),
              ...(options.author === undefined ? {} : { author: userSpelling(options.author) }),
              ...(options.search === undefined ? {} : { search: options.search }),
            },
            limitOf(options.limit),
          );
        });
        emit(list, options, issues, issueRows(issues));
      },
    );

  const view = new Command("view")
    .description("Show an Issue with its body, labels, assignees and referenced files")
    .argument("<number>", "Issue number (12 or #12) or Issue URL")
    .option(...REPO_OPTION)
    .option("-c, --comments", "include every comment and event")
    .option(...JSON_OPTION)
    .action(
      async (number: string, options: JsonFieldsOption & RepoOption & { readonly comments?: boolean }) => {
        const { issue, timeline } = await executeCommand(view, async () => {
          const target = await issueTarget(context, number, options.repo);
          const found = await feature.get(target.spaceId, target.number);
          return options.comments === true
            ? { issue: found, timeline: await feature.timeline(target.spaceId, target.number) }
            : { issue: found, timeline: undefined };
        });
        const value = timeline === undefined ? issue : { ...issue, timeline };
        emit(
          view,
          options,
          value,
          [
            `#${String(issue.number)} ${issue.title} [${issue.state}]`,
            `${issue.author.username} opened ${issue.createdAt}${issue.labels.length ? ` · ${issue.labels.map((label) => label.name).join(", ")}` : ""}`,
            ...(issue.assignees.length ? [`assignees: ${issue.assignees.map((user) => user.username).join(", ")}`] : []),
            ...(issue.references.length ? [`files: ${issue.references.map((ref) => ref.name ?? ref.nodeId).join(", ")}`] : []),
            "",
            issue.body,
            ...(timeline === undefined ? [] : ["", JSON.stringify(timeline, null, 2)]),
            "",
            issueUrl(await origin(), issue.space.id, issue.number),
          ].join("\n"),
        );
      },
    );

  const create = new Command("create")
    .description("Open an Issue")
    .option(...REPO_OPTION)
    .requiredOption("-t, --title <title>")
    .option("-b, --body <markdown>")
    .option("-F, --body-file <path>", "read the body from a file, or - for stdin")
    .option("-l, --label <name>", "label name; repeat for several", collect)
    .option("-a, --assignee <user>", "username or @me; repeat for several", collect)
    .option("--node <id>", "reference a file (Node); repeat for several", collect)
    .option(...JSON_OPTION)
    .action(
      async (
        options: JsonFieldsOption &
          RepoOption &
          TextOptions & {
            readonly assignee?: readonly string[];
            readonly label?: readonly string[];
            readonly node?: readonly string[];
            readonly title: string;
          },
      ) => {
        const issue = await executeCommand(create, async () => {
          const { spaceId } = await context.repo(options.repo);
          const body = await readText(options.body, options.bodyFile, "--body or --body-file");
          return await feature.create({
            spaceId,
            title: options.title,
            ...(body === undefined ? {} : { body }),
            ...(options.label === undefined ? {} : { labels: options.label }),
            ...(options.assignee === undefined ? {} : { assignees: options.assignee.map(userSpelling) }),
            ...(options.node === undefined ? {} : { nodeIds: options.node }),
          });
        });
        emit(create, options, issue, await issueLine(origin, issue));
      },
    );

  const edit = new Command("edit")
    .description("Change an Issue's text, labels, assignees or referenced files")
    .argument("<number>")
    .option(...REPO_OPTION)
    .option("-t, --title <title>")
    .option("-b, --body <markdown>")
    .option("-F, --body-file <path>", "read the body from a file, or - for stdin")
    .option("--add-label <name>", "repeatable", collect)
    .option("--remove-label <name>", "repeatable", collect)
    .option("--add-assignee <user>", "username or @me; repeatable", collect)
    .option("--remove-assignee <user>", "repeatable", collect)
    .option("--add-node <id>", "repeatable", collect)
    .option("--remove-node <id>", "repeatable", collect)
    .option(...JSON_OPTION)
    .action(
      async (
        number: string,
        options: JsonFieldsOption &
          RepoOption &
          TextOptions & {
            readonly addAssignee?: readonly string[];
            readonly addLabel?: readonly string[];
            readonly addNode?: readonly string[];
            readonly removeAssignee?: readonly string[];
            readonly removeLabel?: readonly string[];
            readonly removeNode?: readonly string[];
            readonly title?: string;
          },
      ) => {
        const issue = await executeCommand(edit, async () => {
          const target = await issueTarget(context, number, options.repo);
          const body = await readText(options.body, options.bodyFile, "--body or --body-file");
          return await feature.update(target.spaceId, target.number, {
            ...(options.title === undefined ? {} : { title: options.title }),
            ...(body === undefined ? {} : { body }),
            ...(options.addLabel === undefined ? {} : { addLabels: options.addLabel }),
            ...(options.removeLabel === undefined ? {} : { removeLabels: options.removeLabel }),
            ...(options.addAssignee === undefined ? {} : { addAssignees: options.addAssignee.map(userSpelling) }),
            ...(options.removeAssignee === undefined ? {} : { removeAssignees: options.removeAssignee.map(userSpelling) }),
            ...(options.addNode === undefined ? {} : { addNodes: options.addNode }),
            ...(options.removeNode === undefined ? {} : { removeNodes: options.removeNode }),
          });
        });
        emit(edit, options, issue, await issueLine(origin, issue));
      },
    );

  const close = new Command("close")
    .description("Close an Issue, optionally with a final comment")
    .argument("<number>")
    .option(...REPO_OPTION)
    .option("-r, --reason <reason>", 'completed or "not planned"', "completed")
    .option("-c, --comment <markdown>")
    .option("--comment-file <path>", "read the comment from a file, or - for stdin")
    .option(...JSON_OPTION)
    .action(
      async (
        number: string,
        options: JsonFieldsOption &
          RepoOption & { readonly comment?: string; readonly commentFile?: string; readonly reason: string },
      ) => {
        const issue = await executeCommand(close, async () => {
          const target = await issueTarget(context, number, options.repo);
          const comment = await readText(options.comment, options.commentFile, "--comment or --comment-file");
          const reason = oneOf(
            options.reason.replaceAll("-", " ").replaceAll("_", " "),
            ["completed", "not planned"],
            "--reason",
          );
          return await feature.close(target.spaceId, target.number, {
            reason: reason === "completed" ? "completed" : "not_planned",
            ...(comment === undefined ? {} : { comment }),
          });
        });
        emit(close, options, issue, await issueLine(origin, issue));
      },
    );

  const reopen = new Command("reopen")
    .argument("<number>")
    .option(...REPO_OPTION)
    .option(...JSON_OPTION)
    .action(async (number: string, options: JsonFieldsOption & RepoOption) => {
      const issue = await executeCommand(reopen, async () => {
        const target = await issueTarget(context, number, options.repo);
        return await feature.reopen(target.spaceId, target.number);
      });
      emit(reopen, options, issue, await issueLine(origin, issue));
    });

  const comment = new Command("comment")
    .description("Comment on an Issue")
    .argument("<number>")
    .option(...REPO_OPTION)
    .option("-b, --body <markdown>")
    .option("-F, --body-file <path>", "read the comment from a file, or - for stdin")
    .option(...JSON_OPTION)
    .action(async (number: string, options: JsonFieldsOption & RepoOption & TextOptions) => {
      const value = await executeCommand(comment, async () => {
        const target = await issueTarget(context, number, options.repo);
        const body = await readText(options.body, options.bodyFile, "--body or --body-file");
        if (body === undefined) {
          throw workspaceError("workspace-argument-invalid", "--body or --body-file is required.");
        }
        return await feature.comment(target.spaceId, target.number, body);
      });
      emit(comment, options, value, `Commented on #${number.replace(/^#/, "")}`);
    });

  return root
    .addCommand(list)
    .addCommand(view)
    .addCommand(create)
    .addCommand(edit)
    .addCommand(close)
    .addCommand(reopen)
    .addCommand(comment);
}

async function issueTarget(context: RepoContext, argument: string, repo: string | undefined) {
  const target = await context.item(argument, repo, "issue");
  if (target.kind !== "number") throw workspaceError("workspace-argument-invalid", "Expected an Issue number.");
  return target;
}

async function issueLine(origin: () => Promise<string>, issue: WorkspaceIssue): Promise<string> {
  return `#${String(issue.number)} ${issue.title} [${issue.state}]\n${issueUrl(await origin(), issue.space.id, issue.number)}`;
}
