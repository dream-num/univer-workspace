import { Command } from "commander";
import type { WorkspaceFork, WorkspaceForkFeature } from "@univerjs/univer-workspace-client-core/product";
import {
  emit,
  executeCommand,
  jsonFieldsOption,
  present,
  table,
  type JsonFieldsOption,
  type JsonOption,
} from "../../command.js";
import type { RepoContext } from "../../repo-context.js";

const FORK_JSON_FIELDS = [
  "id", "name", "fullName", "owner", "upstream", "state", "worktree", "createdAt",
] as const satisfies readonly (keyof WorkspaceFork)[];

export function createForkCommand(forks: WorkspaceForkFeature, context: RepoContext): Command {
  const root = new Command("fork").description(
    "Work with forks: your own view of a Team repository, named owner/name, whose changes become one pull request there",
  );

  const create = new Command("create")
    .description("Fork a Team repository; creating the same fork again returns it")
    .argument("<repo>", "the Team repository to fork: owner/slug, unique bare slug from repo list, Space ID or URL")
    .requiredOption("--name <name>", "fork name: letters, digits, '.', '_' and '-'")
    .addOption(jsonFieldsOption(FORK_JSON_FIELDS))
    .action(async (repo: string, options: JsonFieldsOption & { readonly name: string }) => {
      const fork = await executeCommand(create, async () =>
        await forks.create({ name: options.name, upstreamSpaceId: (await context.repo(repo)).spaceId }),
      );
      emit(create, options, fork, fork.fullName);
    });

  const list = new Command("list")
    .description("List your forks")
    .addOption(jsonFieldsOption(FORK_JSON_FIELDS))
    .action(async (options: JsonFieldsOption) => {
      const all = await executeCommand(list, async () => await forks.list());
      emit(list, options, all, table(all.map((fork) => [fork.fullName, upstreamOf(fork), fork.state, pullOf(fork)])));
    });

  const view = new Command("view")
    .description("Show a fork, its upstream and its pull request")
    .argument("<fork>", "owner/name or fork ID")
    .addOption(jsonFieldsOption(FORK_JSON_FIELDS))
    .action(async (reference: string, options: JsonFieldsOption) => {
      const fork = await executeCommand(view, async () => await forks.get(reference));
      const number = fork.worktree?.number;
      emit(
        view,
        options,
        fork,
        [
          `${fork.fullName}  fork of ${upstreamOf(fork)}`,
          `state: ${fork.state}`,
          `id: ${fork.id}`,
          ...(number == null
            ? []
            : [`pull request: #${String(number)} in ${upstreamOf(fork)} (uvw pr view ${String(number)} -R ${upstreamOf(fork)})`]),
        ].join("\n"),
      );
    });

  const remove = new Command("delete")
    .description("Delete a fork; its open pull request stays in the upstream")
    .argument("<fork>", "owner/name or fork ID")
    .option("--json", "write structured JSON")
    .action(async (reference: string, options: JsonOption) => {
      const result = await executeCommand(remove, async () => await forks.delete(reference));
      const number = result.worktree?.number;
      present(
        remove,
        options,
        { fork: result.fork.fullName, worktree: result.worktree },
        `Deleted ${result.fork.fullName}${number == null ? "" : `; pull request #${String(number)} stays in ${upstreamOf(result.fork)}`}`,
      );
    });

  return root.addCommand(create).addCommand(list).addCommand(view).addCommand(remove);
}

function upstreamOf(fork: WorkspaceFork): string {
  return fork.upstream?.fullName ?? fork.upstream?.id ?? "(upstream not readable)";
}

function pullOf(fork: WorkspaceFork): string {
  return fork.worktree?.number == null ? "" : `#${String(fork.worktree.number)}`;
}
