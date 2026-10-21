import { Command } from "commander";
import type { WorkspaceIssueFeature, WorkspaceIssueLabel } from "@univerjs/univer-workspace-client-core/product";
import { emit, executeCommand, jsonFieldsOption, oneOf, table, type JsonFieldsOption } from "../../command.js";
import { REPO_OPTION, type RepoContext } from "../../repo-context.js";

const LABEL_COLORS = ["gray", "blue", "green", "yellow", "orange", "red", "purple", "pink"] as const;
const JSON_OPTION = ["--json [fields]", "write JSON, optionally only these comma-separated fields"] as const;
export const LABEL_JSON_FIELDS = ["color", "description", "id", "name"] as const satisfies
  readonly (keyof WorkspaceIssueLabel)[];

interface RepoOption {
  readonly repo?: string;
}

export function createLabelCommand(feature: WorkspaceIssueFeature, context: RepoContext): Command {
  const label = new Command("label").description("Manage a repository's Issue labels");

  const list = new Command("list")
    .option(...REPO_OPTION)
    .option(...JSON_OPTION)
    .action(async (options: JsonFieldsOption & RepoOption) => {
      const labels = await executeCommand(list, async () =>
        await feature.labels((await context.repo(options.repo)).spaceId));
      emit(
        list,
        options,
        labels,
        table(labels.map((item) => [item.name, item.color, `${String(item.openIssueCount)} open`, item.description])),
      );
    });

  const create = new Command("create")
    .argument("<name>")
    .option(...REPO_OPTION)
    .requiredOption("--color <color>", LABEL_COLORS.join(", "))
    .option("--description <text>")
    .addOption(jsonFieldsOption(LABEL_JSON_FIELDS))
    .action(
      async (
        name: string,
        options: JsonFieldsOption & RepoOption & { readonly color: string; readonly description?: string },
      ) => {
        const created = await executeCommand(create, async () =>
          await feature.createLabel((await context.repo(options.repo)).spaceId, {
            name,
            color: oneOf(options.color, LABEL_COLORS, "--color"),
            ...(options.description === undefined ? {} : { description: options.description }),
          }));
        emit(create, options, created, `Created label ${created.name}`);
      },
    );

  const edit = new Command("edit")
    .argument("<name>")
    .option(...REPO_OPTION)
    .option("--name <name>", "new name")
    .option("--color <color>", LABEL_COLORS.join(", "))
    .option("--description <text>")
    .addOption(jsonFieldsOption(LABEL_JSON_FIELDS))
    .action(
      async (
        name: string,
        options: JsonFieldsOption &
          RepoOption & { readonly color?: string; readonly description?: string; readonly name?: string },
      ) => {
        const updated = await executeCommand(edit, async () =>
          await feature.updateLabel((await context.repo(options.repo)).spaceId, name, {
            ...(options.name === undefined ? {} : { name: options.name }),
            ...(options.color === undefined ? {} : { color: oneOf(options.color, LABEL_COLORS, "--color") }),
            ...(options.description === undefined ? {} : { description: options.description }),
          }));
        emit(edit, options, updated, `Edited label ${updated.name}`);
      },
    );

  const remove = new Command("delete")
    .argument("<name>")
    .option(...REPO_OPTION)
    .addOption(jsonFieldsOption(["deleted"]))
    .action(async (name: string, options: JsonFieldsOption & RepoOption) => {
      const value = await executeCommand(remove, async () =>
        await feature.deleteLabel((await context.repo(options.repo)).spaceId, name));
      emit(remove, options, value, `Deleted label ${name}`);
    });

  return label.addCommand(list).addCommand(create).addCommand(edit).addCommand(remove);
}
