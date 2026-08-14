import { Command } from "commander";
import { executeCommand, oneOf, present, type JsonOption } from "../../command.js";
import { WorkspaceWorktreeFeature } from "./management.js";

export function createWorktreeCommand(feature: WorkspaceWorktreeFeature): Command {
  const root = new Command("worktree").description("Manage Workspace Worktrees");
  const list = new Command("list")
    .option("--view <view>", "active or processed", "active")
    .option("--scope <scope>", "user or space")
    .option("--space <id>", "Space ID")
    .option("--json", "write structured JSON")
    .action(
      async (
        options: JsonOption & {
          readonly scope?: string;
          readonly space?: string;
          readonly view: string;
        },
      ) => {
        const value = {
          worktrees: await executeCommand(
            list,
            async () =>
              await feature.list({
                view: oneOf(options.view, ["active", "processed"], "--view"),
                ...(options.scope === undefined
                  ? {}
                  : { scope: oneOf(options.scope, ["user", "space"], "--scope") }),
                ...(options.space === undefined ? {} : { spaceId: options.space }),
              }),
          ),
        };
        present(list, options, value);
      },
    );
  const get = new Command("get")
    .argument("<worktree>")
    .option("--json")
    .action(async (id: string, options: JsonOption) => {
      const value = { worktree: await executeCommand(get, async () => await feature.get(id)) };
      present(get, options, value);
    });
  const create = new Command("create")
    .requiredOption("--name <name>")
    .requiredOption("--scope <scope>", "user or space")
    .option("--space <id>")
    .option("--idempotency-key <key>")
    .option("--visibility <visibility>", "private or space")
    .option("--json")
    .action(
      async (
        options: JsonOption & {
          readonly idempotencyKey?: string;
          readonly name: string;
          readonly scope: string;
          readonly space?: string;
          readonly visibility?: string;
        },
      ) => {
        const scope = oneOf(options.scope, ["user", "space"], "--scope");
        if (scope === "space" && options.space === undefined)
          create.error("--space is required for Space Worktrees");
        const value = {
          worktree: await executeCommand(
            create,
            async () =>
              await feature.create({
                name: options.name,
                scope:
                  scope === "user" ? { kind: "user" } : { kind: "space", spaceId: options.space! },
                ...(options.idempotencyKey === undefined
                  ? {}
                  : { idempotencyKey: options.idempotencyKey }),
                ...(options.visibility === undefined
                  ? {}
                  : {
                      visibility: oneOf(options.visibility, ["private", "space"], "--visibility"),
                    }),
              }),
          ),
        };
        present(create, options, value);
      },
    );
  const update = new Command("update")
    .argument("<worktree>")
    .option("--name <name>")
    .option("--visibility <visibility>")
    .option("--json")
    .action(
      async (
        id: string,
        options: JsonOption & { readonly name?: string; readonly visibility?: string },
      ) => {
        if (options.name === undefined && options.visibility === undefined)
          update.error("--name or --visibility is required");
        const value = {
          worktree: await executeCommand(
            update,
            async () =>
              await feature.update(id, {
                ...(options.name === undefined ? {} : { name: options.name }),
                ...(options.visibility === undefined
                  ? {}
                  : {
                      visibility: oneOf(options.visibility, ["private", "space"], "--visibility"),
                    }),
              }),
          ),
        };
        present(update, options, value);
      },
    );
  root.addCommand(list).addCommand(get).addCommand(create).addCommand(update);
  for (const action of ["ready", "reopen", "merge", "discard"] as const) {
    const command = new Command(action)
      .argument("<worktree>")
      .option("--json")
      .action(async (id: string, options: JsonOption) => {
        const value = {
          worktree: await executeCommand(command, async () => await feature.transition(id, action)),
        };
        present(command, options, value);
      });
    root.addCommand(command);
  }
  return root;
}
