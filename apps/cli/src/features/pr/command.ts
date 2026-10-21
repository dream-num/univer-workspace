import { Command } from "commander";
import {
  workspaceError,
  type WorkspaceSpaceFeature,
  type WorkspaceWorktree,
  type WorkspaceWorktreeFeature,
  type WorkspaceWorktreeState,
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
import { pullUrl } from "../../urls.js";

const JSON_OPTION = ["--json [fields]", "write JSON, optionally only these comma-separated fields"] as const;
export const PR_JSON_FIELDS = [
  "id", "name", "state", "units", "number", "summary", "spaceId", "kind", "visibility", "creator", "createdAt", "updatedAt",
] as const satisfies readonly (keyof WorkspaceWorktree)[];

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

const STATES = ["open", "merged", "discarded", "all"] as const;

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

  const repoSpace = async (repo: string | undefined) => {
    const { spaceId } = await context.repo(repo);
    const space = await spaces.get(spaceId);
    if (space.type === "personal" && space.owner?.id !== await userId()) {
      throw workspaceError(
        "workspace-argument-invalid",
        "Personal Space pull requests must target the signed-in user's own Space.",
      );
    }
    return space;
  };

  /** A `<n|url|id>` argument becomes the Worktree it names. */
  const find = async (argument: string, repo: string | undefined): Promise<WorkspaceWorktree> => {
    const target = await context.item(argument, repo, "pr");
    return target.kind === "id"
      ? await worktrees.get(target.id)
      : await worktrees.getByNumber(target.spaceId, target.number);
  };
  /** Same, when only the ID is needed: an ID argument costs no request. */
  const idOf = async (argument: string, repo: string | undefined): Promise<string> => {
    const target = await context.item(argument, repo, "pr");
    return target.kind === "id"
      ? target.id
      : (await worktrees.getByNumber(target.spaceId, target.number)).id;
  };
  const line = async (worktree: WorkspaceWorktree) =>
    `${label(worktree)} ${worktree.name} [${worktree.state}]\n${pullUrl(await origin(), worktree)}`;

  const list = new Command("list")
    .description("List pull requests of a repository")
    .option(...REPO_OPTION)
    .option("-s, --state <state>", "open (draft, ready, merging), merged, discarded or all", "open")
    .option("-A, --author <user>", "username or @me")
    .option("-S, --search <text>", "match title, body, author")
    .option("-L, --limit <n>", "maximum number of pull requests", "30")
    .option(...JSON_OPTION)
    .action(
      async (
        options: JsonFieldsOption &
          RepoOption & { author?: string; limit: string; search?: string; state: string },
      ) => {
        const items = await executeCommand(list, async () => {
          const state = oneOf(options.state, STATES, "--state");
          const limit = limitOf(options.limit);
          const space = await repoSpace(options.repo);
          return await worktrees.list({
            ...(space.type === "personal" ? { scope: "user" as const } : { scope: "space" as const, spaceId: space.id }),
            ...viewOf(state),
            limit,
            ...(options.search === undefined ? {} : { search: options.search }),
            ...(options.author === undefined
              ? {}
              : options.author === "@me"
                ? { creatorId: await userId() }
                : { creatorUsername: options.author }),
          });
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
    .option(...JSON_OPTION)
    .action(async (argument: string, options: JsonFieldsOption & RepoOption) => {
      const worktree = await executeCommand(get, async () => await find(argument, options.repo));
      emit(
        get,
        options,
        worktree,
        [
          `${label(worktree)} ${worktree.name} [${worktree.state}]`,
          `id: ${worktree.id}${worktree.creator ? ` · created by ${worktree.creator.username}` : ""}`,
          ...(worktree.summary ? ["", worktree.summary] : []),
          ...(worktree.units.length
            ? [
                "",
                table(
                  worktree.units.map((unit) => [unit.change, unit.type, unit.name, `unit ${unit.unitId}`]),
                ),
              ]
            : []),
          "",
          pullUrl(await origin(), worktree),
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
    .option("--idempotency-key <key>", "retry-safe key for this creation")
    .addOption(jsonFieldsOption(PR_JSON_FIELDS))
    .action(
      async (
        options: JsonFieldsOption &
          RepoOption & {
            body?: string;
            bodyFile?: string;
            idempotencyKey?: string;
            title: string;
            visibility?: string;
          },
      ) => {
        const worktree = await executeCommand(create, async () => {
          const space = await repoSpace(options.repo);
          const body = await readText(options.body, options.bodyFile, "--body or --body-file");
          return await worktrees.create({
            name: options.title,
            scope: space.type === "personal" ? { kind: "user" } : { kind: "space", spaceId: space.id },
            ...(body === undefined ? {} : { summary: body }),
            ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
            ...(options.visibility === undefined
              ? {}
              : { visibility: oneOf(options.visibility, ["private", "space"], "--visibility") }),
          });
        });
        emit(create, options, worktree, await line(worktree));
      },
    );

  const edit = new Command(names.edit)
    .description("Change a pull request's title, body or visibility")
    .argument("<pr>")
    .option(...REPO_OPTION)
    .option("-t, --title <title>")
    .option("-b, --body <markdown>")
    .option("-F, --body-file <path>", "read the body from a file, or - for stdin")
    .option("--visibility <visibility>", "private or space (Team Space repositories only)")
    .addOption(jsonFieldsOption(PR_JSON_FIELDS))
    .action(
      async (
        argument: string,
        options: JsonFieldsOption &
          RepoOption & { body?: string; bodyFile?: string; title?: string; visibility?: string },
      ) => {
        const worktree = await executeCommand(edit, async () => {
          const body = await readText(options.body, options.bodyFile, "--body or --body-file");
          if (options.title === undefined && body === undefined && options.visibility === undefined) {
            throw workspaceError(
              "workspace-argument-invalid",
              "Nothing to change: pass --title, --body/--body-file or --visibility.",
            );
          }
          return await worktrees.update(await idOf(argument, options.repo), {
            ...(options.title === undefined ? {} : { name: options.title }),
            ...(body === undefined ? {} : { summary: body }),
            ...(options.visibility === undefined
              ? {}
              : { visibility: oneOf(options.visibility, ["private", "space"], "--visibility") }),
          });
        });
        emit(edit, options, worktree, await line(worktree));
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
        const worktree = await executeCommand(command, async () => {
          return await worktrees.transition(
            await idOf(argument, options.repo),
            options.undo === true ? "reopen" : action,
          );
        });
        emit(command, options, worktree, await line(worktree));
      },
    );
  };

  root.addCommand(list).addCommand(get).addCommand(create).addCommand(edit);
  if (names.reopen === undefined) {
    root.addCommand(transition("ready", "ready", "Mark a draft pull request ready for review", true));
  } else {
    root.addCommand(transition("ready", "ready", "Mark a draft pull request ready for review", false));
    root.addCommand(transition(names.reopen, "reopen", "Move a ready pull request back to draft", false));
  }
  root.addCommand(transition("merge", "merge", "Merge a ready pull request into its repository", false));
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

function label(worktree: WorkspaceWorktree): string {
  return worktree.number == null ? worktree.id.slice(0, 8) : `#${String(worktree.number)}`;
}

function viewOf(
  state: (typeof STATES)[number],
): { readonly view: "active" | "processed" | "all"; readonly states?: readonly WorkspaceWorktreeState[] } {
  switch (state) {
    case "open":
      return { view: "active" };
    case "merged":
      return { view: "processed", states: ["merged"] };
    case "discarded":
      return { view: "processed", states: ["discarded"] };
    case "all":
      return { view: "all" };
  }
}
