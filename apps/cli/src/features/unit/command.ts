import { Command } from "commander";
import type { WorkspaceUnitFeature } from "@univerjs/univer-workspace-client-core";
import { executeCommand, oneOf, present, type JsonOption } from "../../command.js";

export function createUnitCommand(feature: WorkspaceUnitFeature): Command {
  const root = new Command("unit").description("Manage Worktree Units");
  const list = new Command("list")
    .requiredOption("--worktree <id>")
    .option("--json")
    .action(async (options: JsonOption & { readonly worktree: string }) => {
      const value = {
        units: await executeCommand(list, async () => await feature.list(options.worktree)),
      };
      present(list, options, value);
    });
  const add = new Command("add")
    .requiredOption("--worktree <id>")
    .requiredOption("--resource <id>")
    .option("--json")
    .action(
      async (options: JsonOption & { readonly resource: string; readonly worktree: string }) => {
        const value = {
          unit: await executeCommand(
            add,
            async () => await feature.add(options.worktree, options.resource),
          ),
        };
        present(add, options, value);
      },
    );
  const create = new Command("create")
    .requiredOption("--worktree <id>")
    .requiredOption("--space <id>")
    .requiredOption("--type <type>")
    .requiredOption("--name <name>")
    .option("--parent <node>")
    .option("--idempotency-key <key>")
    .option("--json")
    .action(
      async (
        options: JsonOption & {
          readonly idempotencyKey?: string;
          readonly name: string;
          readonly parent?: string;
          readonly space: string;
          readonly type: string;
          readonly worktree: string;
        },
      ) => {
        const value = {
          unit: await executeCommand(
            create,
            async () =>
              await feature.create({
                name: options.name,
                spaceId: options.space,
                type: oneOf(options.type, ["sheet", "doc", "slide", "base", "board"], "--type"),
                worktreeId: options.worktree,
                ...(options.parent === undefined ? {} : { parentNodeId: options.parent }),
                ...(options.idempotencyKey === undefined
                  ? {}
                  : { idempotencyKey: options.idempotencyKey }),
              }),
          ),
        };
        present(create, options, value);
      },
    );
  return root.addCommand(list).addCommand(add).addCommand(create);
}
