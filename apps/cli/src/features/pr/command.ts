import { Command, InvalidArgumentError } from "commander";
import {
  findPullRequest,
  listPullRequests,
  PULL_REQUEST_STATES,
  pullRequestSpace,
  pullUrl,
  workspaceError,
  type WorkspaceCheck,
  type WorkspaceRevertItem,
  type WorkspaceRevertTarget,
  type WorkspaceSpaceFeature,
  type WorkspaceWorktree,
  type WorkspaceWorktreeFeature,
} from "@univerjs/univer-workspace-client-core/product";
import {
  emit,
  executeCommand,
  jsonFieldsOption,
  limitOf,
  oneOf,
  readText,
  table,
  type JsonFieldsOption,
} from "../../command.js";
import { REPO_OPTION, type RepoContext } from "../../repo-context.js";

export const PR_JSON_FIELDS = [
  "id", "name", "state", "units", "number", "summary", "spaceId", "kind", "visibility", "creator", "createdAt", "createdVia", "updatedAt",
  "capabilities",
  "issue",
  "checks",
] as const satisfies readonly (keyof WorkspaceWorktree)[];

const CHECK_JSON_FIELDS = ["name", "declared", "state", "results"] as const satisfies readonly (keyof WorkspaceCheck)[];
const REVERT_JSON_FIELDS = ["applied", "pullRequests", "canRevert", "refusal", "operation", "items"] as const;

const ISSUE_OPTION = [
  "--issue <number>",
  "the Issue in the same repository that this pull request serves (12 or #12; Team Space repositories only)",
  (value: string): number => {
    const match = /^#?([1-9]\d{0,9})$/.exec(value.trim());
    if (!match) throw new InvalidArgumentError("workspace-argument-invalid: --issue must be an Issue number such as 12 or #12.");
    return Number(match[1]);
  },
] as const;

interface RepoOption {
  readonly repo?: string;
}

export interface PullRequestDependencies {
  readonly context: RepoContext;
  readonly origin: () => Promise<string>;
  readonly spaces: WorkspaceSpaceFeature;
  /** The signed-in user's ID, for Personal Space ownership and `@me`. */
  readonly userId: () => Promise<string>;
  readonly worktrees: WorkspaceWorktreeFeature;
}

/** Subcommand names of one command tree. `pr` and `worktree` run the same handlers under different names. */
interface Names {
  readonly create: string;
  readonly edit: string;
  readonly get: string;
  /** Present only where Ready → Draft is its own command rather than `ready --undo`. */
  readonly reopen?: string;
}

const PR_NAMES: Names = { create: "create", edit: "edit", get: "view" };
const WORKTREE_NAMES: Names = { create: "create", edit: "update", get: "get", reopen: "reopen" };

/**
 * `pr` is the gh-style name; `worktree` is the same command group under the product's own name.
 * Both are built from the handlers below, so options, addressing and output cannot drift apart.
 */
export function createPullRequestCommands(deps: PullRequestDependencies): readonly Command[] {
  return [
    build(
      deps,
      "pr",
      "Work with pull requests (Worktrees). `uvw worktree` is the same command group.",
      PR_NAMES,
      true,
    ),
    build(
      deps,
      "worktree",
      "Work with Worktrees (pull requests). `uvw pr` is the same command group.",
      WORKTREE_NAMES,
      false,
    ),
  ];
}

function build(
  deps: PullRequestDependencies,
  name: string,
  description: string,
  names: Names,
  guardGhVerbs: boolean,
): Command {
  const { context, origin, spaces, userId, worktrees } = deps;
  const root = new Command(name).description(description);

  const repoSpace = async (repo: string | undefined, purpose: "list" | "create") =>
    await pullRequestSpace(spaces, userId, (await context.repo(repo)).spaceId, purpose);

  const find = async (argument: string, repo: string | undefined) =>
    await findPullRequest(worktrees, argument, origin, () => context.repo(repo));
  const urlOf = async ({ worktree, spaceId }: Awaited<ReturnType<typeof find>>) =>
    pullUrl(await origin(), worktree, undefined, await context.pullSpaceId(worktree, spaceId));
  /** Resolve text links before writing; JSON only needs an ID and keeps the no-read fast path. */
  const writeTarget = async (argument: string, options: JsonFieldsOption & RepoOption) => {
    if (options.json === undefined) {
      const result = await find(argument, options.repo);
      return { id: result.worktree.id, url: await urlOf(result) };
    }
    const target = await context.item(argument, options.repo, "pr");
    return {
      id: target.kind === "id" ? target.id : (await worktrees.getByNumber(target.spaceId, target.number)).id,
      url: undefined,
    };
  };
  const line = (worktree: WorkspaceWorktree, url: string | undefined) =>
    url === undefined ? "" : `${label(worktree)} ${worktree.name} [${worktree.state}]\n${url}`;

  const list = new Command("list")
    .description("List pull requests of a repository")
    .option(...REPO_OPTION)
    .option("-s, --state <state>", "open (draft, ready, merging), merged, discarded or all", "open")
    .option("-A, --author <user>", "username or @me")
    .option("-S, --search <text>", "match title, body, author")
    .option("-L, --limit <n>", "maximum number of pull requests", "30")
    .addOption(jsonFieldsOption(PR_JSON_FIELDS))
    .action(
      async (
        options: JsonFieldsOption &
          RepoOption & { author?: string; limit: string; search?: string; state: string },
      ) => {
        const items = await executeCommand(list, async () => {
          const state = oneOf(options.state, PULL_REQUEST_STATES, "--state");
          const limit = limitOf(options.limit);
          const space = await repoSpace(options.repo, "list");
          return await listPullRequests(
            { userId, worktrees },
            {
              space,
              state,
              limit,
              ...(options.search === undefined ? {} : { search: options.search }),
              ...(options.author === undefined ? {} : { author: options.author }),
            },
          );
        });
        emit(
          list,
          options,
          items,
          table(
            items.map((worktree) => [
              label(worktree),
              worktree.state,
              worktree.name,
              worktree.creator?.username ?? "",
              worktree.updatedAt ?? "",
            ]),
          ),
        );
      },
    );

  const get = new Command(names.get)
    .description("Show a pull request with the files it changes")
    .argument("<pr>", "number (12 or #12), Worktree ID, or Browser URL")
    .option(...REPO_OPTION)
    .addOption(jsonFieldsOption(PR_JSON_FIELDS))
    .action(async (argument: string, options: JsonFieldsOption & RepoOption) => {
      const { worktree, url } = await executeCommand(get, async () => {
        const result = await find(argument, options.repo);
        return { worktree: result.worktree, url: options.json === undefined ? await urlOf(result) : undefined };
      });
      emit(
        get,
        options,
        worktree,
        [
          `${label(worktree)} ${worktree.name} [${worktree.state}]`,
          `id: ${worktree.id}${worktree.creator ? ` · created by ${worktree.creator.username}` : ""}`,
          ...(worktree.issue ? [`issue: #${String(worktree.issue.number)} ${worktree.issue.title} [${worktree.issue.state}]`] : []),
          ...(worktree.checks
            ? [`checks: ${String(worktree.checks.passed)} passed, ${String(worktree.checks.failed)} failed, ${String(worktree.checks.missing)} missing`]
            : []),
          ...(worktree.summary ? ["", worktree.summary] : []),
          ...(worktree.units.length
            ? [
                "",
                table(
                  worktree.units.map((unit) => [unit.change, unit.type, unit.name, `unit ${unit.unitId}`, freshness(unit)]),
                ),
              ]
            : []),
          "",
          ...(url === undefined ? [] : [url]),
        ].join("\n"),
      );
    });

  const create = new Command(names.create)
    .description("Open a draft pull request; add its files with the content commands")
    .option(...REPO_OPTION)
    .requiredOption("-t, --title <title>")
    .option("-b, --body <markdown>")
    .option("-F, --body-file <path>", "read the body from a file, or - for stdin")
    .option("--visibility <visibility>", "private or space (Team Space repositories only)")
    .option(...ISSUE_OPTION)
    .option("--idempotency-key <key>", "retry-safe key for this creation")
    .addOption(jsonFieldsOption(PR_JSON_FIELDS))
    .action(
      async (
        options: JsonFieldsOption &
          RepoOption & {
            body?: string;
            bodyFile?: string;
            idempotencyKey?: string;
            issue?: number;
            title: string;
            visibility?: string;
          },
      ) => {
        const { worktree, url } = await executeCommand(create, async () => {
          const space = await repoSpace(options.repo, "create");
          const body = await readText(options.body, options.bodyFile, "--body or --body-file");
          const base = options.json === undefined ? await origin() : undefined;
          const worktree = await worktrees.create({
            name: options.title,
            scope: space.type === "personal" ? { kind: "user" } : { kind: "space", spaceId: space.id },
            ...(body === undefined ? {} : { summary: body }),
            ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
            ...(options.visibility === undefined
              ? {}
              : { visibility: oneOf(options.visibility, ["private", "space"], "--visibility") }),
            ...(options.issue === undefined ? {} : { issueNumber: options.issue }),
          });
          return { worktree, url: base === undefined ? undefined : pullUrl(base, worktree, undefined, space.id) };
        });
        emit(create, options, worktree, line(worktree, url));
      },
    );

  const edit = new Command(names.edit)
    .description("Change a pull request's title, body, visibility or the Issue it serves, or leave out its files in Trash")
    .argument("<pr>")
    .option(...REPO_OPTION)
    .option("-t, --title <title>")
    .option("-b, --body <markdown>")
    .option("-F, --body-file <path>", "read the body from a file, or - for stdin")
    .option("--visibility <visibility>", "private or space (Team Space repositories only)")
    .option(...ISSUE_OPTION)
    .option(
      "--leave-out-trashed",
      "leave out every file in Trash or permanently deleted, which pr merge refuses, so the other files can merge. Those files stay as they are. In a repository that requires checks, report them again",
    )
    .addOption(jsonFieldsOption(PR_JSON_FIELDS))
    .action(
      async (
        argument: string,
        options: JsonFieldsOption &
          RepoOption & { body?: string; bodyFile?: string; issue?: number; leaveOutTrashed?: boolean; title?: string; visibility?: string },
      ) => {
        const { worktree, url } = await executeCommand(edit, async () => {
          const body = await readText(options.body, options.bodyFile, "--body or --body-file");
          const edits = options.title !== undefined || body !== undefined || options.visibility !== undefined || options.issue !== undefined;
          if (!edits && !options.leaveOutTrashed) {
            throw workspaceError(
              "workspace-argument-invalid",
              "Nothing to change: pass --title, --body/--body-file, --visibility, --issue or --leave-out-trashed.",
            );
          }
          const target = await writeTarget(argument, options);
          const updated = edits
            ? await worktrees.update(target.id, {
              ...(options.title === undefined ? {} : { name: options.title }),
              ...(body === undefined ? {} : { summary: body }),
              ...(options.visibility === undefined
                ? {}
                : { visibility: oneOf(options.visibility, ["private", "space"], "--visibility") }),
              ...(options.issue === undefined ? {} : { issueNumber: options.issue }),
            })
            : undefined;
          const worktree = options.leaveOutTrashed || updated === undefined ? await worktrees.leaveOutTrashed(target.id) : updated;
          return { worktree, url: target.url };
        });
        emit(edit, options, worktree, line(worktree, url));
      },
    );

  const transition = (
    commandName: string,
    action: "ready" | "reopen" | "merge" | "discard",
    text: string,
    undoOption: boolean,
  ): Command => {
    const command = new Command(commandName).description(text).argument("<pr>").option(...REPO_OPTION);
    if (undoOption) command.option("--undo", "move a ready pull request back to draft");
    return command.addOption(jsonFieldsOption(PR_JSON_FIELDS)).action(
      async (argument: string, options: JsonFieldsOption & RepoOption & { undo?: boolean }) => {
        const { worktree, url } = await executeCommand(command, async () => {
          const target = await writeTarget(argument, options);
          const worktree = await worktrees.transition(
            target.id,
            options.undo === true ? "reopen" : action,
          );
          return { worktree, url: target.url };
        });
        emit(command, options, worktree, line(worktree, url));
      },
    );
  };

  const check = new Command("check")
    .description("Report whether one check declared in trunk's .agents/checks.md passed on a ready pull request")
    .argument("<pr>")
    .argument("<name>", "a `## name` heading in .agents/checks.md")
    .option(...REPO_OPTION)
    .option("--passed", "the check passed")
    .option("--failed", "the check failed")
    .option("--summary <text>", "what you checked and found")
    .addOption(jsonFieldsOption(CHECK_JSON_FIELDS))
    .action(
      async (
        argument: string,
        name: string,
        options: JsonFieldsOption & RepoOption & { failed?: boolean; passed?: boolean; summary?: string },
      ) => {
        const result = await executeCommand(check, async () => {
          if (options.passed === options.failed) {
            throw workspaceError("workspace-argument-invalid", "Pass exactly one of --passed or --failed.");
          }
          const target = await writeTarget(argument, options);
          return await worktrees.reportCheck(target.id, name, {
            state: options.passed === true ? "passed" : "failed",
            ...(options.summary === undefined ? {} : { summary: options.summary }),
          });
        });
        emit(
          check,
          options,
          result,
          [
            `${result.name}: ${result.state}${result.declared ? "" : " (not declared)"}`,
            ...result.results.map((entry) =>
              `${entry.reporter.username} ${entry.state}${entry.counts ? "" : entry.current ? " (does not count)" : " (out of date)"}${entry.summary ? `: ${entry.summary}` : ""}`),
          ].join("\n"),
        );
      },
    );

  const revert = new Command("revert")
    .description("Show what reverting a merged pull request, or every merged pull request of an Issue, would do; --yes reverts")
    .argument("[pr]", "a merged pull request; omit with --issue")
    .option(...REPO_OPTION)
    .option(...ISSUE_OPTION)
    .option("--yes", "revert. A file edited on trunk after the merge stays as it is; a person can overwrite it in the browser")
    .addOption(jsonFieldsOption(REVERT_JSON_FIELDS))
    .action(async (argument: string | undefined, options: JsonFieldsOption & RepoOption & { issue?: number; yes?: boolean }) => {
      const result = await executeCommand(revert, async () => {
        if ((argument === undefined) === (options.issue === undefined)) {
          throw workspaceError("workspace-argument-invalid", "Pass a pull request or --issue, not both.");
        }
        let target: WorkspaceRevertTarget;
        if (options.issue === undefined) {
          target = { worktreeId: (await find(argument!, options.repo)).worktree.id };
        } else {
          const issue = await context.item(String(options.issue), options.repo, "issue");
          if (issue.kind !== "number") throw workspaceError("workspace-argument-invalid", "Expected an Issue number.");
          target = { spaceId: issue.spaceId, issueNumber: issue.number };
        }
        if (options.yes !== true) {
          const plan = await worktrees.revertPlan(target);
          return { applied: false, pullRequests: plan.pullRequests, canRevert: plan.capabilities.revert, refusal: plan.refusal, items: plan.items };
        }
        const done = await worktrees.revert(target);
        return { applied: true, operation: done.operation, items: done.items ?? [] };
      });
      emit(revert, options, result, [
        ...(result.applied ? [`Revert ${result.operation!.state}`] : [result.refusal ?? "Plan only; run again with --yes to revert."]),
        ...result.items.map(revertLine),
      ].join("\n"));
      if (result.applied && result.operation!.state === "failed") {
        revert.error(result.operation!.error?.message ?? "The revert failed.", { code: "workspace.command.failed", exitCode: 1 });
      }
    });

  root.addCommand(list).addCommand(get).addCommand(create).addCommand(edit).addCommand(check).addCommand(revert);
  if (names.reopen === undefined) {
    root.addCommand(transition("ready", "ready", "Mark a draft pull request ready for review", true));
  } else {
    root.addCommand(transition("ready", "ready", "Mark a draft pull request ready for review", false));
    root.addCommand(transition(names.reopen, "reopen", "Move a ready pull request back to draft", false));
  }
  root.addCommand(transition("merge", "merge", "Merge a ready pull request into its repository, or finish a merge that stopped", false));
  root.addCommand(transition("discard", "discard", "Discard a pull request. This cannot be undone", false));

  if (guardGhVerbs) {
    for (const verb of ["close", "reopen"]) {
      const guard = new Command(verb)
        .helpOption(false)
        .allowUnknownOption()
        .allowExcessArguments()
        .argument("[args...]")
        .action(() => {
          guard.error(
            "workspace-argument-invalid: pull requests are not closed or reopened. " +
              "Use `uvw pr discard <pr>` (irreversible) or `uvw pr ready <pr> --undo` (back to draft).",
            { code: "workspace.command.failed", exitCode: 1 },
          );
        });
      root.addCommand(guard, { hidden: true });
    }
  }
  return root;
}

function revertLine(item: WorkspaceRevertItem): string {
  const edits = item.laterEdits.map((edit) => `${edit.user?.username ?? "a removed user"} (${String(edit.revisions)})`).join(", ");
  return `${item.state.padEnd(11)} ${item.action.padEnd(7)} ${item.name}${edits ? ` edited later by ${edits}` : ""}${item.reason && !edits ? `: ${item.reason}` : ""}`;
}

function label(worktree: WorkspaceWorktree): string {
  return worktree.number == null ? worktree.id.slice(0, 8) : `#${String(worktree.number)}`;
}

function freshness({ fileState, freshness: value }: WorkspaceWorktree["units"][number]): string {
  if (fileState === "inTrash") return "in Trash";
  if (fileState === "deleted") return "deleted";
  if (!value) return "";
  if (value.revisionsBehind === 0) return value.label;
  return `${value.label === "stale" ? "stale, " : ""}behind by ${String(value.revisionsBehind)}`;
}
