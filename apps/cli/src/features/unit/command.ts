import { Command } from "commander";
import type { WorkspaceUnitFeature } from "@univerjs/univer-workspace-client-core";
import {
  isForkAddress,
  parseNodeReference,
  requireForkUpstream,
  workspaceError,
  type WorkspaceForkFeature,
} from "@univerjs/univer-workspace-client-core/product";
import { executeCommand, oneOf, present, type JsonOption } from "../../command.js";
import type { RepoContext } from "../../repo-context.js";

const WORKTREE = ["--worktree <id>", "Worktree ID, or a fork's owner/name"] as const;

export function createUnitCommand(
  feature: WorkspaceUnitFeature,
  forks: Pick<WorkspaceForkFeature, "addUnit" | "createUnit" | "units">,
  context: RepoContext,
  origin: () => Promise<string>,
): Command {
  const root = new Command("unit").description("Manage Worktree Units");
  const list = new Command("list")
    .requiredOption(...WORKTREE)
    .option("--json")
    .action(async (options: JsonOption & { readonly worktree: string }) => {
      const value = {
        units: await executeCommand(list, async () =>
          isForkAddress(options.worktree) ? await forks.units(options.worktree) : await feature.list(options.worktree),
        ),
      };
      present(list, options, value);
    });
  const add = new Command("add")
    .requiredOption(...WORKTREE)
    .requiredOption("--resource <id>")
    .option("--json")
    .action(
      async (options: JsonOption & { readonly resource: string; readonly worktree: string }) => {
        const value = {
          unit: await executeCommand(add, async () =>
            isForkAddress(options.worktree)
              ? await forks.addUnit(options.worktree, options.resource)
              : await feature.add(options.worktree, options.resource),
          ),
        };
        present(add, options, value);
      },
    );
  const create = new Command("create")
    .requiredOption(...WORKTREE)
    .requiredOption("--space <repo>", "owner/slug, unique bare slug from repo list, Space ID or URL; a fork names its upstream")
    .requiredOption("--type <type>")
    .requiredOption("--name <name>")
    .option("--parent <node>")
    .option(
      "--from <file>",
      "share link or Node ID of a file you can open: the new file is a copy of it that records it as its source, which only the copy's owner and editors can see; --type must be its type",
    )
    .option("--idempotency-key <key>")
    .option("--json")
    .action(
      async (
        options: JsonOption & {
          readonly from?: string;
          readonly idempotencyKey?: string;
          readonly name: string;
          readonly parent?: string;
          readonly space: string;
          readonly type: string;
          readonly worktree: string;
        },
      ) => {
        const value = {
          unit: await executeCommand(create, async () => {
            const resolved = await context.repoOrFork(options.space);
            const spaceId = "fork" in resolved ? requireForkUpstream(resolved.fork).id : resolved.spaceId;
            const input = {
              name: options.name,
              spaceId,
              type: oneOf(options.type, ["sheet", "doc", "slide", "base", "board"], "--type"),
              ...(options.parent === undefined ? {} : { parentNodeId: options.parent }),
              ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
            };
            if (!isForkAddress(options.worktree)) {
              return await feature.create({
                ...input,
                worktreeId: options.worktree,
                ...(options.from === undefined ? {} : { fromNodeId: parseNodeReference(options.from, await origin()) }),
              });
            }
            if (options.from !== undefined) {
              throw workspaceError(
                "workspace-argument-invalid",
                "--from needs a Worktree ID: write once through the fork, then pass the `worktree.id` from `uvw fork view --json worktree`.",
              );
            }
            return await forks.createUnit(options.worktree, input);
          }),
        };
        present(create, options, value);
      },
    );
  return root.addCommand(list).addCommand(add).addCommand(create);
}
